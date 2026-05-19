const loadPromiseKey = Symbol.for("copilot-cli-cost.extension.loadPromise");

await (globalThis[loadPromiseKey] ??= (async () => {
  const { bootstrap } = await import("./lib/copilot-webview.js");
  await bootstrap(import.meta.dirname);
  await import("./main.mjs");
})());
