import fs from "node:fs";
import { getLiveSessionPath, readLiveSession, writeLiveSession } from "./live-session-store.js";

const TOKEN_TOTAL_FIELDS = Object.freeze({
  inputTokens: "total_input_tokens",
  cachedInputTokens: "total_cache_read_tokens",
  cacheWriteTokens: "total_cache_write_tokens",
  outputTokens: "total_output_tokens",
  reasoningTokens: "total_reasoning_tokens"
});

export function parseStatusLinePayload(raw) {
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new Error("Statusline payload is empty.");
  }

  const payload = JSON.parse(raw);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Statusline payload must be a JSON object.");
  }

  return payload;
}

export function statusLinePayloadToSessionUsage(payload, options = {}) {
  const sessionId = readString(payload.session_id)
    ?? readString(options.sessionId)
    ?? "current";
  const currentModel = readModelId(payload, options);
  const totals = readContextTotals(payload.context_window);

  return {
    sessionId,
    source: "copilot-cli-statusline",
    timestamp: new Date().toISOString(),
    metricsEventType: "statusline.refresh",
    metricsTimestamp: new Date().toISOString(),
    metricsStale: false,
    currentModel,
    sessionName: readString(payload.session_name),
    workspaceDirectory: readString(payload.workspace?.current_dir) ?? readString(payload.cwd),
    transcriptPath: readString(payload.transcript_path),
    version: readString(payload.version),
    premiumRequests: readOptionalNumber(payload.cost?.total_premium_requests),
    totalApiDurationMs: readOptionalNumber(payload.cost?.total_api_duration_ms),
    totalDurationMs: readOptionalNumber(payload.cost?.total_duration_ms),
    totalLinesAdded: readOptionalNumber(payload.cost?.total_lines_added),
    totalLinesRemoved: readOptionalNumber(payload.cost?.total_lines_removed),
    contextWindowSize: readOptionalNumber(payload.context_window?.context_window_size),
    contextWindowUsedPercentage: readOptionalNumber(payload.context_window?.used_percentage),
    lastCallInputTokens: readOptionalNumber(payload.context_window?.last_call_input_tokens),
    lastCallOutputTokens: readOptionalNumber(payload.context_window?.last_call_output_tokens),
    lastContextTotals: totals,
    attribution: {
      mode: "single-snapshot",
      note: "Statusline payload contains cumulative token totals but not historical per-model buckets. Initial totals are attributed to the active model."
    },
    modelUsage: [
      {
        model: currentModel,
        requests: 0,
        inputTokens: totals.inputTokens,
        cachedInputTokens: totals.cachedInputTokens,
        cacheWriteTokens: totals.cacheWriteTokens,
        outputTokens: totals.outputTokens,
        reasoningTokens: totals.reasoningTokens
      }
    ]
  };
}

export function mergeStatusLinePayload(payload, options = {}) {
  const snapshot = statusLinePayloadToSessionUsage(payload, options);
  const previousPath = getLiveSessionPath(snapshot.sessionId, options);
  const previous = fs.existsSync(previousPath)
    ? readLiveSession(snapshot.sessionId, options)
    : null;

  if (!previous || previous.source !== "copilot-cli-statusline" || !previous.lastContextTotals) {
    const paths = writeLiveSession(snapshot, options);
    return { sessionUsage: snapshot, paths, wasReset: true };
  }

  const currentTotals = snapshot.lastContextTotals;
  const previousTotals = previous.lastContextTotals;
  if (hasCounterReset(currentTotals, previousTotals)) {
    const paths = writeLiveSession(snapshot, options);
    return { sessionUsage: snapshot, paths, wasReset: true };
  }

  const delta = subtractTotals(currentTotals, previousTotals);
  const modelUsage = addDeltaToModel(previous.modelUsage ?? [], snapshot.currentModel, delta);
  const merged = {
    ...previous,
    ...snapshot,
    modelUsage,
    lastContextTotals: currentTotals,
    attribution: {
      mode: "delta-by-active-model",
      note: "Successive statusline cumulative-token deltas are attributed to the active model for that refresh."
    }
  };

  const paths = writeLiveSession(merged, options);
  return { sessionUsage: merged, paths, wasReset: false };
}

function readModelId(payload, options) {
  const model = readString(payload.model?.id)
    ?? readString(payload.model?.display_name)
    ?? readString(options.model);
  if (!model) {
    throw new Error("Statusline payload does not include model.id or model.display_name.");
  }
  return model;
}

function readContextTotals(contextWindow) {
  const totals = {};
  for (const [canonicalName, payloadName] of Object.entries(TOKEN_TOTAL_FIELDS)) {
    totals[canonicalName] = numberOrZero(contextWindow?.[payloadName]);
  }
  return totals;
}

function hasCounterReset(currentTotals, previousTotals) {
  return Object.keys(TOKEN_TOTAL_FIELDS).some((key) => currentTotals[key] < numberOrZero(previousTotals[key]));
}

function subtractTotals(currentTotals, previousTotals) {
  const delta = {};
  for (const key of Object.keys(TOKEN_TOTAL_FIELDS)) {
    delta[key] = Math.max(currentTotals[key] - numberOrZero(previousTotals[key]), 0);
  }
  return delta;
}

function addDeltaToModel(modelUsage, model, delta) {
  const usage = modelUsage.map((item) => ({ ...item }));
  let target = usage.find((item) => item.model === model);
  if (!target) {
    target = {
      model,
      requests: 0,
      inputTokens: 0,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0
    };
    usage.push(target);
  }

  for (const key of Object.keys(TOKEN_TOTAL_FIELDS)) {
    target[key] = numberOrZero(target[key]) + delta[key];
  }

  return usage;
}

function readString(value) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  return String(value);
}

function readOptionalNumber(value) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function numberOrZero(value) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}
