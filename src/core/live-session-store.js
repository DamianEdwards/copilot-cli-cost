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

export function readLogicalSessionIndex(logicalSessionId, options = {}) {
  if (!logicalSessionId) {
    throw new Error("Logical session id is required.");
  }

  const indexPath = getLogicalSessionPath(logicalSessionId, options);
  if (!fs.existsSync(indexPath)) {
    throw new Error(`No logical Copilot cost session index found for '${logicalSessionId}': ${indexPath}`);
  }
  return JSON.parse(fs.readFileSync(indexPath, "utf8"));
}

export function registerLogicalSessionInstance(sessionUsage, logicalSession, options = {}) {
  if (!sessionUsage?.sessionId) {
    throw new Error("Session id is required.");
  }
  if (!logicalSession?.id) {
    throw new Error("Logical session id is required.");
  }

  const now = sessionUsage.timestamp ?? new Date().toISOString();
  const indexPath = getLogicalSessionPath(logicalSession.id, options);
  const existing = fs.existsSync(indexPath)
    ? JSON.parse(fs.readFileSync(indexPath, "utf8"))
    : null;
  const instances = Array.isArray(existing?.instances)
    ? existing.instances.map((instance) => ({ ...instance }))
    : [];
  const existingInstance = instances.find((instance) => instance.sessionId === sessionUsage.sessionId);
  const nextInstance = {
    sessionId: sessionUsage.sessionId,
    firstSeenAt: existingInstance?.firstSeenAt ?? now,
    lastSeenAt: now,
    sessionName: sessionUsage.sessionName,
    transcriptPath: sessionUsage.transcriptPath,
    workspaceDirectory: sessionUsage.workspaceDirectory
  };

  if (existingInstance) {
    Object.assign(existingInstance, nextInstance);
  } else {
    instances.push(nextInstance);
  }

  const index = {
    schemaVersion: 1,
    id: logicalSession.id,
    source: logicalSession.source,
    key: logicalSession.key,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    instances
  };
  fs.mkdirSync(path.dirname(indexPath), { recursive: true });
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
  return index;
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

export function getLogicalSessionPath(logicalSessionId, options = {}) {
  if (!logicalSessionId) {
    throw new Error("Logical session id is required.");
  }

  return path.join(getLiveSessionStoreDirectory(options), "logical", `${safeFileName(logicalSessionId)}.json`);
}

function getLatestSessionPath(options = {}) {
  return path.join(getLiveSessionStoreDirectory(options), "latest.json");
}

function safeFileName(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]/g, "_");
}
