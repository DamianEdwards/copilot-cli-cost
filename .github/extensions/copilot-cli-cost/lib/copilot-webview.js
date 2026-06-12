import { spawn, execSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, isAbsolute, join, normalize, resolve, sep } from "node:path";

const MIME = {
  ".css": "text/css",
  ".html": "text/html",
  ".js": "text/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml"
};

const BRIDGE_JS = `(() => {
  const ws = new WebSocket("ws://" + location.host);
  const pending = new Map();
  let nextId = 0;
  const ready = new Promise((resolve) => ws.addEventListener("open", resolve, { once: true }));
  ws.onmessage = async (event) => {
    const message = JSON.parse(event.data);
    if ("code" in message) {
      let result, error;
      try {
        result = await (0, eval)(message.code);
        try { JSON.stringify(result); } catch { result = String(result); }
      } catch (e) {
        error = e?.stack || String(e);
      }
      ws.send(JSON.stringify({ id: message.id, result, error }));
    } else {
      const callback = pending.get(message.id);
      if (callback) {
        pending.delete(message.id);
        callback(message);
      }
    }
  };
  window.copilot = new Proxy({}, {
    get: (_, method) => async (...args) => {
      await ready;
      return new Promise((resolve, reject) => {
        const id = "p" + (nextId++);
        pending.set(id, ({ result, error }) => error ? reject(new Error(error)) : resolve(result));
        ws.send(JSON.stringify({ id, method, args }));
      });
    },
  });
})();`;

export async function bootstrap(extensionDirectory) {
  if (hasPanelDependencies(extensionDirectory)) {
    return;
  }

  console.error("[extension-bootstrap] Installing Copilot Cost panel dependencies...");
  execSync("npm install --include=optional --no-audit --no-fund", { cwd: extensionDirectory, stdio: "ignore" });
  console.error("[extension-bootstrap] Copilot Cost panel dependencies installed.");
}

function hasPanelDependencies(extensionDirectory) {
  return getRequiredPanelPackages().every((packageName) => existsSync(getPackageJsonPath(extensionDirectory, packageName)));
}

function getRequiredPanelPackages({ arch = process.arch, platform = process.platform } = {}) {
  const packages = ["@webviewjs/webview", "ws"];
  const nativePackage = getWebviewNativePackageName(platform, arch);
  if (nativePackage) {
    packages.push(nativePackage);
  }
  return packages;
}

function getWebviewNativePackageName(platform, arch) {
  if (platform === "darwin" && (arch === "arm64" || arch === "x64")) {
    return `@webviewjs/webview-darwin-${arch}`;
  }
  if (platform === "linux" && arch === "x64") {
    return "@webviewjs/webview-linux-x64-gnu";
  }
  if (platform === "win32" && (arch === "arm64" || arch === "ia32" || arch === "x64")) {
    return `@webviewjs/webview-win32-${arch}-msvc`;
  }
  return null;
}

function getPackageJsonPath(extensionDirectory, packageName) {
  return join(extensionDirectory, "node_modules", ...packageName.split("/"), "package.json");
}

export class CopilotWebview {
  constructor({ callbacks = {}, contentDir, extensionName, height = 760, title = "Copilot Cost", width = 980 } = {}) {
    if (!extensionName) {
      throw new Error("CopilotWebview requires extensionName.");
    }
    if (!contentDir) {
      throw new Error("CopilotWebview requires contentDir.");
    }

    this.callbacks = callbacks;
    this.contentDir = isAbsolute(contentDir) ? contentDir : resolve(process.cwd(), contentDir);
    this.extensionName = extensionName;
    this.height = height;
    this.prefix = extensionName.replace(/[^a-zA-Z0-9_]/g, "_");
    this.title = title;
    this.width = width;
    this._handle = null;
    this._canvasHandles = new Map();
    this.close = this.close.bind(this);
    this.closeAll = this.closeAll.bind(this);
    this.closeCanvas = this.closeCanvas.bind(this);
    this.openCanvas = this.openCanvas.bind(this);
    this.show = this.show.bind(this);
  }

  async show({ reload = false } = {}) {
    if (this._handle) {
      if (reload) {
        await this._handle.eval("location.reload()", { timeoutMs: 1000 }).catch(() => {});
      }
      return this._handle;
    }

    const handle = await showWebview({
      callbacks: this.callbacks,
      dir: this.contentDir,
      height: this.height,
      title: this.title,
      width: this.width
    });
    this._handle = handle;
    handle.onClose(() => {
      if (this._handle === handle) {
        this._handle = null;
      }
    });
    return handle;
  }

  async openCanvas(instanceId) {
    if (!instanceId) {
      throw new Error("CopilotWebview canvas open requires an instanceId.");
    }

    let handle = this._canvasHandles.get(instanceId);
    if (!handle) {
      handle = await createBridgeServer({
        callbacks: this.callbacks,
        dir: this.contentDir
      });
      this._canvasHandles.set(instanceId, handle);
      handle.onClose(() => {
        if (this._canvasHandles.get(instanceId) === handle) {
          this._canvasHandles.delete(instanceId);
        }
      });
    }

    return {
      status: "Ready",
      title: this.title,
      url: handle.url
    };
  }

  eval(code, options) {
    if (!this._handle) {
      return Promise.reject(new Error("webview is not open"));
    }
    return this._handle.eval(code, options);
  }

  close() {
    if (this._handle) {
      this._handle.close();
    }
  }

  closeAll() {
    this.close();
    for (const [instanceId, handle] of this._canvasHandles) {
      this._canvasHandles.delete(instanceId);
      handle.close();
    }
  }

  closeCanvas(instanceId) {
    const handle = this._canvasHandles.get(instanceId);
    if (handle) {
      this._canvasHandles.delete(instanceId);
      handle.close();
    }
  }

  get tools() {
    const { prefix } = this;
    return [
      {
        name: `${prefix}_panel_show`,
        description: "Open the Copilot Cost native side panel window.",
        parameters: {
          type: "object",
          properties: {
            reload: { type: "boolean", description: "Reload the panel if it is already open." }
          }
        },
        skipPermission: true,
        handler: async ({ reload = false } = {}) => {
          await this.show({ reload });
          return reload ? "Copilot Cost panel opened/refreshed." : "Copilot Cost panel opened.";
        }
      },
      {
        name: `${prefix}_panel_eval`,
        description: "Evaluate JavaScript inside the open Copilot Cost panel.",
        parameters: {
          type: "object",
          properties: {
            code: { type: "string", description: "JavaScript code to evaluate." },
            timeout: { type: "number", description: "Timeout in seconds, max 10." }
          },
          required: ["code"]
        },
        handler: async ({ code, timeout } = {}) => {
          const timeoutMs = Math.min(Math.max(Number(timeout) || 3, 0.1), 10) * 1000;
          const result = await this.eval(code, { timeoutMs });
          return typeof result === "string" ? result : JSON.stringify(result);
        }
      },
      {
        name: `${prefix}_panel_close`,
        description: "Close the Copilot Cost panel if it is open.",
        parameters: { type: "object", properties: {} },
        skipPermission: true,
        handler: async () => {
          this.close();
          return "Copilot Cost panel closed.";
        }
      }
    ];
  }
}

async function showWebview({ callbacks = {}, dir, height, title, width }) {
  const bridge = await createBridgeServer({ callbacks, dir });
  const id = randomBytes(4).toString("hex");
  const userDataDir = process.platform === "win32" ? join(tmpdir(), `copilot-cost-webview-${id}`) : null;
  const childEnv = {
    ...process.env,
    CW_HEIGHT: String(height),
    CW_TITLE: title,
    CW_URL: bridge.url,
    CW_WIDTH: String(width)
  };
  if (userDataDir) {
    childEnv.WEBVIEW2_USER_DATA_FOLDER = userDataDir;
  }

  const child = spawn("node", [join(import.meta.dirname, "webview-child.mjs")], {
    env: childEnv,
    stdio: ["ignore", "ignore", "inherit"]
  });

  const handle = {
    close() {
      if (!child.killed) {
        child.kill();
      }
    },
    eval(code, options) {
      return bridge.eval(code, options);
    },
    onClose(callback) {
      bridge.onClose(callback);
    }
  };

  child.on("exit", (code) => {
    bridge.close(code);
    if (userDataDir) {
      removeUserDataDirectory(userDataDir);
    }
  });

  return handle;
}

async function createBridgeServer({ callbacks = {}, dir }) {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    throw new Error(`directory does not exist: ${dir}`);
  }
  if (!existsSync(join(dir, "index.html"))) {
    throw new Error(`${dir} does not contain an index.html file`);
  }

  const { WebSocketServer } = await import("ws");
  const pending = new Map();
  const closeListeners = [];
  let socket = null;
  let closed = false;

  const server = createServer(staticHandler(dir));
  server.on("clientError", (_error, clientSocket) => {
    try {
      clientSocket.destroy();
    } catch {}
  });

  const wss = new WebSocketServer({ server });
  wss.on("connection", (sock) => {
    socket = sock;
    sock.on("message", async (data) => {
      let message;
      try {
        message = JSON.parse(data);
      } catch {
        return;
      }

      if ("method" in message) {
        let result, error;
        try {
          const callback = callbacks[message.method];
          if (typeof callback !== "function") {
            throw new Error(`unknown callback: ${message.method}`);
          }
          result = await callback(...(message.args || []));
          try { JSON.stringify(result); } catch { result = String(result); }
        } catch (e) {
          error = e?.stack || String(e);
        }
        sock.send(JSON.stringify({ id: message.id, result, error }));
      } else {
        const callback = pending.get(message.id);
        if (callback) {
          pending.delete(message.id);
          callback(message);
        }
      }
    });
    sock.on("close", () => {
      if (socket === sock) {
        socket = null;
      }
    });
  });

  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const url = `http://127.0.0.1:${server.address().port}/`;

  const handle = {
    url,
    close(code) {
      if (closed) {
        return;
      }
      closed = true;
      for (const client of wss.clients) {
        try {
          client.close();
        } catch {}
      }
      wss.close();
      server.close();
      for (const callback of closeListeners) {
        try {
          callback(code);
        } catch {}
      }
    },
    eval(code, { timeoutMs = 3000 } = {}) {
      if (closed) {
        return Promise.reject(new Error("webview bridge is closed"));
      }
      if (!socket) {
        return Promise.reject(new Error("webview page is not connected yet"));
      }
      const requestId = randomUUID();
      return new Promise((resolveEval, rejectEval) => {
        const timer = setTimeout(() => {
          pending.delete(requestId);
          rejectEval(new Error(`timeout (${timeoutMs}ms)`));
        }, timeoutMs);
        pending.set(requestId, ({ result, error }) => {
          clearTimeout(timer);
          if (error) {
            rejectEval(new Error(error));
          } else {
            resolveEval(result);
          }
        });
        socket.send(JSON.stringify({ id: requestId, code }));
      });
    },
    onClose(callback) {
      closeListeners.push(callback);
    }
  };

  return handle;
}

function staticHandler(rootDirectory) {
  return async (request, response) => {
    if (request.url === "/__bridge.js") {
      response.writeHead(200, { "Content-Type": "text/javascript" });
      response.end(BRIDGE_JS);
      return;
    }

    const relativePath = request.url === "/" ? "/index.html" : decodeURIComponent(request.url.split("?")[0]);
    const absolutePath = normalize(join(rootDirectory, relativePath));
    if (!absolutePath.startsWith(rootDirectory + sep)) {
      response.writeHead(403);
      response.end();
      return;
    }

    try {
      const buffer = await readFile(absolutePath);
      response.writeHead(200, { "Content-Type": MIME[extname(absolutePath)] || "application/octet-stream" });
      response.end(buffer);
    } catch {
      if (!response.headersSent) {
        response.writeHead(404);
      }
      response.end();
    }
  };
}

async function removeUserDataDirectory(directory) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rm(directory, { force: true, maxRetries: 3, recursive: true });
      return;
    } catch {
      await new Promise((resolveRetry) => setTimeout(resolveRetry, 200 * (attempt + 1)));
    }
  }
}
