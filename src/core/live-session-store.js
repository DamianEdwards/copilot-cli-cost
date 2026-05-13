import fs from "node:fs";
import path from "node:path";
import { getAppCacheSubdirectory } from "./app-cache-dir.js";

export function getLiveSessionStoreDirectory(options = {}) {
  const env = options.env ?? process.env;
  return options.storeDirectory
    ?? env.COPILOT_COST_LIVE_STORE
    ?? getAppCacheSubdirectory("live-sessions", options);
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

export function listLiveSessions(options = {}) {
  const directory = getLiveSessionStoreDirectory(options);
  if (!fs.existsSync(directory)) {
    return [];
  }

  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json") && entry.name !== "latest.json")
    .map((entry) => {
      const snapshotPath = path.join(directory, entry.name);
      const sessionUsage = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
      const stat = fs.statSync(snapshotPath);
      const sessionId = sessionUsage.sessionId ?? path.basename(entry.name, ".json");
      return {
        source: "live-session",
        sessionId,
        sessionName: sessionUsage.sessionName,
        workspaceDirectory: sessionUsage.workspaceDirectory,
        currentModel: sessionUsage.currentModel,
        metricsTimestamp: sessionUsage.metricsTimestamp,
        metricsStale: sessionUsage.metricsStale === true,
        updatedAt: sessionUsage.metricsTimestamp ?? sessionUsage.timestamp ?? stat.mtime.toISOString(),
        sourcePath: snapshotPath
      };
    })
    .sort(compareUpdatedAtDescending);
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

function compareUpdatedAtDescending(left, right) {
  return Date.parse(right.updatedAt ?? "") - Date.parse(left.updatedAt ?? "");
}

function safeFileName(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]/g, "_");
}
