import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function readSessionUsageFromEvents(sessionId, options = {}) {
  return readSessionUsageFromEventsCore(sessionId, options, "latest");
}

export function readRichestSessionUsageFromEvents(sessionId, options = {}) {
  return readSessionUsageFromEventsCore(sessionId, options, "richest");
}

function readSessionUsageFromEventsCore(sessionId, options, mode) {
  if (!sessionId) {
    throw new Error("Session id is required.");
  }

  const eventsPath = options.eventsPath ?? getSessionEventsPath(sessionId, options);
  if (!fs.existsSync(eventsPath)) {
    throw new Error(`Copilot session events file not found: ${eventsPath}`);
  }

  const events = readSessionEvents(eventsPath);
  const selectedMetricsEvent = mode === "richest" ? events.richestMetricsEvent : events.latestMetricsEvent;
  if (!selectedMetricsEvent?.data?.modelMetrics && selectedMetricsEvent?.data?.totalNanoAiu === undefined) {
    throw new Error(`No model metrics found in Copilot session events: ${eventsPath}`);
  }

  return eventMetricsToSessionUsage(sessionId, {
    ...events,
    latestMetricsEvent: selectedMetricsEvent
  }, eventsPath, options);
}

export function listCompletedSessionSummaries(options = {}) {
  const sessionStateDirectory = options.sessionStateDirectory ?? getSessionStateDirectory(options);
  if (!fs.existsSync(sessionStateDirectory)) {
    return [];
  }

  const candidates = fs.readdirSync(sessionStateDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const sessionId = entry.name;
      const eventsPath = path.join(sessionStateDirectory, sessionId, "events.jsonl");
      if (!fs.existsSync(eventsPath)) {
        return null;
      }
      return {
        eventsPath,
        sessionId,
        updatedAtMs: fs.statSync(eventsPath).mtimeMs
      };
    })
    .filter((candidate) => candidate !== null)
    .sort((left, right) => right.updatedAtMs - left.updatedAtMs);
  const limitedCandidates = options.limit ? candidates.slice(0, options.limit) : candidates;

  return limitedCandidates
    .map((candidate) => readSessionSummaryFromEvents(candidate.sessionId, { ...options, eventsPath: candidate.eventsPath }))
    .filter((summary) => summary !== null)
    .sort(compareUpdatedAtDescending);
}

export function readSessionSummaryFromEvents(sessionId, options = {}) {
  if (!sessionId) {
    throw new Error("Session id is required.");
  }

  const eventsPath = options.eventsPath ?? getSessionEventsPath(sessionId, options);
  if (!fs.existsSync(eventsPath)) {
    throw new Error(`Copilot session events file not found: ${eventsPath}`);
  }

  const events = readSessionEvents(eventsPath);
  if (!events.latestMetricsEvent?.data?.modelMetrics && events.latestMetricsEvent?.data?.totalNanoAiu === undefined) {
    return null;
  }

  const stat = fs.statSync(eventsPath);
  const workspaceMetadata = readSessionWorkspaceMetadata(sessionId, options);
  return {
    source: "completed",
    sessionId,
    sessionName: workspaceMetadata.sessionName ?? events.metadata.sessionName,
    workspaceDirectory: workspaceMetadata.workspaceDirectory ?? events.metadata.workspaceDirectory,
    repository: workspaceMetadata.repository,
    branch: workspaceMetadata.branch,
    currentModel: events.latestMetricsEvent.data.currentModel,
    metricsTimestamp: events.latestMetricsEvent.timestamp,
    latestEventType: events.latestEvent?.type,
    latestEventTimestamp: events.latestEvent?.timestamp,
    metricsStale: events.latestEvent?.timestamp !== events.latestMetricsEvent.timestamp,
    updatedAt: events.latestEvent?.timestamp ?? events.latestMetricsEvent.timestamp ?? stat.mtime.toISOString(),
    sourcePath: String(eventsPath)
  };
}

export function getSessionStateDirectory(options = {}) {
  const copilotHome = options.copilotHome ?? process.env.COPILOT_HOME ?? path.join(os.homedir(), ".copilot");
  return path.join(copilotHome, "session-state");
}

export function getSessionEventsPath(sessionId, options = {}) {
  return path.join(getSessionStateDirectory(options), sessionId, "events.jsonl");
}

export function readSessionWorkspaceMetadata(sessionId, options = {}) {
  if (!sessionId) {
    throw new Error("Session id is required.");
  }

  const workspacePath = options.workspacePath ?? path.join(getSessionStateDirectory(options), sessionId, "workspace.yaml");
  if (!fs.existsSync(workspacePath)) {
    return {};
  }

  const data = parseWorkspaceYaml(fs.readFileSync(workspacePath, "utf8"));
  return {
    sessionId: data.id ?? sessionId,
    sessionName: readString(data.name),
    workspaceDirectory: readString(data.cwd),
    gitRoot: readString(data.git_root),
    repository: readString(data.repository),
    branch: readString(data.branch),
    createdAt: readString(data.created_at),
    updatedAt: readString(data.updated_at),
    sourcePath: workspacePath
  };
}

function readSessionEvents(eventsPath) {
  let latestMetricsEvent = null;
  let richestMetricsEvent = null;
  let latestEvent = null;
  let latestNonHookEvent = null;
  const metadata = {};
  for (const line of fs.readFileSync(eventsPath, "utf8").split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }

    const event = JSON.parse(line);
    latestEvent = event;
    updateEventMetadata(metadata, event);
    if (!String(event.type ?? "").startsWith("hook.")) {
      latestNonHookEvent = event;
    }
    if (event?.data?.modelMetrics || event?.data?.totalNanoAiu !== undefined) {
      latestMetricsEvent = event;
      if (!richestMetricsEvent || eventMetricsWeight(event) > eventMetricsWeight(richestMetricsEvent)) {
        richestMetricsEvent = event;
      }
    }
  }

  return {
    latestMetricsEvent,
    richestMetricsEvent,
    latestEvent: latestNonHookEvent ?? latestEvent,
    metadata
  };
}

function eventMetricsToSessionUsage(sessionId, events, sourcePath, options = {}) {
  const event = events.latestMetricsEvent;
  const latestEvent = events.latestEvent;
  const workspaceMetadata = readSessionWorkspaceMetadata(sessionId, options);
  const modelUsage = Object.entries(event.data.modelMetrics ?? {}).map(([model, metrics]) => {
    const usage = metrics.usage ?? {};
    const requests = metrics.requests ?? {};

    return {
      model,
      requests: numberOrZero(requests.count),
      inputTokens: numberOrZero(usage.inputTokens),
      cachedInputTokens: numberOrZero(usage.cacheReadTokens),
      cacheWriteTokens: numberOrZero(usage.cacheWriteTokens),
      outputTokens: numberOrZero(usage.outputTokens),
      reasoningTokens: numberOrZero(usage.reasoningTokens),
      totalNanoAiu: readOptionalNumber(metrics.totalNanoAiu),
      tokenDetails: cloneTokenDetails(metrics.tokenDetails)
    };
  });

  return {
    sessionId,
    source: "copilot-cli-events",
    sourcePath,
    sessionName: workspaceMetadata.sessionName ?? events.metadata.sessionName,
    workspaceDirectory: workspaceMetadata.workspaceDirectory ?? events.metadata.workspaceDirectory,
    repository: workspaceMetadata.repository,
    branch: workspaceMetadata.branch,
    timestamp: event.timestamp,
    metricsEventType: event.type,
    metricsTimestamp: event.timestamp,
    latestEventType: latestEvent?.type,
    latestEventTimestamp: latestEvent?.timestamp,
    metricsStale: latestEvent?.timestamp !== event.timestamp,
    currentModel: event.data.currentModel,
    totalNanoAiu: readOptionalNumber(event.data.totalNanoAiu),
    tokenDetails: cloneTokenDetails(event.data.tokenDetails),
    modelUsage
  };
}

function updateEventMetadata(metadata, event) {
  const data = event.data ?? {};
  const sessionName = readString(
    data.sessionName
      ?? data.session_name
      ?? data.name
      ?? data.title
      ?? event.sessionName
      ?? event.session_name
  );
  if (sessionName) {
    metadata.sessionName = sessionName;
  }

  const workspaceDirectory = readString(
    data.workspaceDirectory
      ?? data.workspace_directory
      ?? data.workspace?.current_dir
      ?? data.cwd
      ?? event.workspaceDirectory
      ?? event.workspace_directory
      ?? event.cwd
  );
  if (workspaceDirectory) {
    metadata.workspaceDirectory = workspaceDirectory;
  }
}

function parseWorkspaceYaml(raw) {
  const result = {};
  for (const line of raw.split(/\r?\n/)) {
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!match) {
      continue;
    }

    result[match[1]] = unquoteYamlScalar(match[2]);
  }
  return result;
}

function unquoteYamlScalar(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\""))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function compareUpdatedAtDescending(left, right) {
  return Date.parse(right.updatedAt ?? "") - Date.parse(left.updatedAt ?? "");
}

function readString(value) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  return String(value);
}

function numberOrZero(value) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function readOptionalNumber(value) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function eventMetricsWeight(event) {
  let total = numberOrZero(event?.data?.totalNanoAiu);
  for (const metrics of Object.values(event?.data?.modelMetrics ?? {})) {
    const usage = metrics.usage ?? {};
    total += numberOrZero(metrics.totalNanoAiu)
      + numberOrZero(usage.inputTokens)
      + numberOrZero(usage.cacheReadTokens)
      + numberOrZero(usage.cacheWriteTokens)
      + numberOrZero(usage.outputTokens)
      + numberOrZero(usage.reasoningTokens);
  }
  return total;
}

function cloneTokenDetails(tokenDetails) {
  if (!tokenDetails || typeof tokenDetails !== "object" || Array.isArray(tokenDetails)) {
    return undefined;
  }
  return Object.fromEntries(
    Object.entries(tokenDetails).map(([key, value]) => [
      key,
      value && typeof value === "object" && !Array.isArray(value)
        ? { ...value }
        : value
    ])
  );
}
