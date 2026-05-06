import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function readSessionUsageFromEvents(sessionId, options = {}) {
  if (!sessionId) {
    throw new Error("Session id is required.");
  }

  const eventsPath = options.eventsPath ?? getSessionEventsPath(sessionId, options);
  if (!fs.existsSync(eventsPath)) {
    throw new Error(`Copilot session events file not found: ${eventsPath}`);
  }

  let latestMetricsEvent = null;
  let latestEvent = null;
  let latestNonHookEvent = null;
  for (const line of fs.readFileSync(eventsPath, "utf8").split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }

    const event = JSON.parse(line);
    latestEvent = event;
    if (!String(event.type ?? "").startsWith("hook.")) {
      latestNonHookEvent = event;
    }
    if (event?.data?.modelMetrics || event?.data?.totalPremiumRequests !== undefined) {
      latestMetricsEvent = event;
    }
  }

  if (!latestMetricsEvent?.data?.modelMetrics) {
    throw new Error(`No model metrics found in Copilot session events: ${eventsPath}`);
  }

  return eventMetricsToSessionUsage(sessionId, latestMetricsEvent, latestNonHookEvent ?? latestEvent, eventsPath);
}

export function getSessionEventsPath(sessionId, options = {}) {
  const copilotHome = options.copilotHome ?? process.env.COPILOT_HOME ?? path.join(os.homedir(), ".copilot");
  return path.join(copilotHome, "session-state", sessionId, "events.jsonl");
}

function eventMetricsToSessionUsage(sessionId, event, latestEvent, sourcePath) {
  const modelUsage = Object.entries(event.data.modelMetrics).map(([model, metrics]) => {
    const usage = metrics.usage ?? {};
    const requests = metrics.requests ?? {};

    return {
      model,
      requests: numberOrZero(requests.count),
      premiumRequests: numberOrZero(requests.cost),
      inputTokens: numberOrZero(usage.inputTokens),
      cachedInputTokens: numberOrZero(usage.cacheReadTokens),
      cacheWriteTokens: numberOrZero(usage.cacheWriteTokens),
      outputTokens: numberOrZero(usage.outputTokens),
      reasoningTokens: numberOrZero(usage.reasoningTokens)
    };
  });

  return {
    sessionId,
    source: "copilot-cli-events",
    sourcePath,
    timestamp: event.timestamp,
    metricsEventType: event.type,
    metricsTimestamp: event.timestamp,
    latestEventType: latestEvent?.type,
    latestEventTimestamp: latestEvent?.timestamp,
    metricsStale: latestEvent?.timestamp !== event.timestamp,
    currentModel: event.data.currentModel,
    premiumRequests: readOptionalNumber(event.data.totalPremiumRequests),
    modelUsage
  };
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

