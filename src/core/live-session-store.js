import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function getLiveSessionStoreDirectory(options = {}) {
  return options.storeDirectory
    ?? process.env.COPILOT_COST_LIVE_STORE
    ?? path.join(process.env.LOCALAPPDATA ?? os.tmpdir(), "copilot-cli-cost", "live-sessions");
}

export function readLatestLiveSession(options = {}) {
  const latestPath = getLatestSessionPath(options);
  if (!fs.existsSync(latestPath)) {
    throw new Error(`No live Copilot cost snapshot found: ${latestPath}`);
  }
  return JSON.parse(fs.readFileSync(latestPath, "utf8"));
}

export function readLiveSession(sessionId, options = {}) {
  if (!sessionId) {
    throw new Error("Session id is required.");
  }

  const snapshotPath = getLiveSessionPath(sessionId, options);
  if (!fs.existsSync(snapshotPath)) {
    throw new Error(`No live Copilot cost snapshot found for session '${sessionId}': ${snapshotPath}`);
  }
  return JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
}

export function writeLiveSession(sessionUsage, options = {}) {
  const directory = getLiveSessionStoreDirectory(options);
  fs.mkdirSync(directory, { recursive: true });

  const sessionPath = getLiveSessionPath(sessionUsage.sessionId, options);
  const latestPath = getLatestSessionPath(options);
  const body = JSON.stringify(sessionUsage, null, 2);

  fs.writeFileSync(sessionPath, body);
  fs.writeFileSync(latestPath, body);

  return {
    latestPath,
    sessionPath
  };
}

export function getLiveSessionPath(sessionId, options = {}) {
  if (!sessionId) {
    throw new Error("Session id is required.");
  }

  return path.join(getLiveSessionStoreDirectory(options), `${safeFileName(sessionId)}.json`);
}

function getLatestSessionPath(options = {}) {
  return path.join(getLiveSessionStoreDirectory(options), "latest.json");
}

function safeFileName(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]/g, "_");
}
