import crypto from "node:crypto";
import fs from "node:fs";
import {
  getLiveSessionPath,
  readLiveSession,
  registerLogicalSessionInstance,
  writeLiveSession
} from "./live-session-store.js";
import { readRichestSessionUsageFromEvents } from "./session-events.js";
import { mergeResumedSessionUsage } from "./usage-metrics.js";

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
  const logicalSession = resolveLogicalSession(snapshot, previous);

  let sessionUsage;
  let wasReset;
  if (!previous || previous.source !== "copilot-cli-statusline" || !previous.lastContextTotals) {
    const resumedUsage = mergeResumedSessionUsage(snapshot, readPreviousUsageForResume(snapshot.sessionId, previous, options));
    sessionUsage = resumedUsage.logicalSession?.isResumed
      ? withResumeLogicalSession(resumedUsage, logicalSession)
      : withLogicalSession(snapshot, logicalSession);
    wasReset = true;
  } else {
    const currentTotals = snapshot.lastContextTotals;
    const previousTotals = previous.lastContextTotals;
    if (hasCounterReset(currentTotals, previousTotals)) {
      sessionUsage = withLogicalSession(snapshot, logicalSession, {
        frozenContributions: [
          ...readFrozenContributions(previous),
          toFrozenContribution(previous)
        ]
      });
      wasReset = true;
    } else {
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
      sessionUsage = withLogicalSession(merged, logicalSession, {
        frozenContributions: readFrozenContributions(previous)
      });
      wasReset = false;
    }
  }

  writeLiveSession(sessionUsage, options);
  const index = registerLogicalSessionInstance(sessionUsage, logicalSession, options);
  const aggregateUsage = buildLogicalSessionAggregate(index, sessionUsage.sessionId, options);
  const enrichedUsage = withLogicalSessionAggregate(sessionUsage, index, aggregateUsage);
  const paths = writeLiveSession(enrichedUsage, options);
  return { sessionUsage: enrichedUsage, paths, wasReset };
}

function readPreviousUsageForResume(sessionId, previous, options) {
  let eventUsage = null;
  try {
    eventUsage = readRichestSessionUsageFromEvents(sessionId, options);
  } catch {
    eventUsage = null;
  }
  return usageWeight(eventUsage) > usageWeight(previous) ? eventUsage : previous;
}

function usageWeight(sessionUsage) {
  return (sessionUsage?.modelUsage ?? []).reduce(
    (total, item) => total
      + numberOrZero(item.inputTokens)
      + numberOrZero(item.cachedInputTokens)
      + numberOrZero(item.cacheWriteTokens)
      + numberOrZero(item.outputTokens)
      + numberOrZero(item.reasoningTokens),
    numberOrZero(sessionUsage?.premiumRequests)
  );
}

function resolveLogicalSession(snapshot, previous) {
  if (snapshot.transcriptPath) {
    return {
      id: `transcript:${hashValue(snapshot.transcriptPath)}`,
      source: "transcript_path",
      key: snapshot.transcriptPath
    };
  }

  if (previous?.logicalSession?.id && previous.logicalSession.source === "transcript_path") {
    return {
      id: previous.logicalSession.id,
      source: previous.logicalSession.source,
      key: previous.logicalSession.key
    };
  }

  return {
    id: `session:${snapshot.sessionId}`,
    source: "session_id",
    key: snapshot.sessionId
  };
}

function hashValue(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 16);
}

function withLogicalSession(sessionUsage, logicalSession, options = {}) {
  const frozenContributions = options.frozenContributions ?? readFrozenContributions(sessionUsage);
  return {
    ...sessionUsage,
    logicalSession: {
      id: logicalSession.id,
      source: logicalSession.source,
      key: logicalSession.key,
      currentInstanceId: sessionUsage.sessionId,
      instanceCount: 1,
      resumeCount: 0,
      isResumed: false,
      resetCount: frozenContributions.length,
      frozenContributions
    }
  };
}

function withResumeLogicalSession(sessionUsage, logicalSession) {
  return {
    ...sessionUsage,
    logicalSession: {
      ...sessionUsage.logicalSession,
      id: logicalSession.id,
      source: logicalSession.source,
      key: logicalSession.key,
      currentInstanceId: sessionUsage.sessionId
    },
    aggregateUsage: sessionUsage.aggregateUsage
      ? {
          ...sessionUsage.aggregateUsage,
          sessionId: logicalSession.id
        }
      : undefined
  };
}

function withLogicalSessionAggregate(sessionUsage, index, aggregateUsage) {
  const instanceCount = index.instances.length;
  const premiumRequestsAggregation = aggregateUsage.logicalSession?.premiumRequestsAggregation;
  const hasAggregateHistory = usageWeight(aggregateUsage) > usageWeight(sessionUsage);
  const resumeCount = Math.max(
    Number(sessionUsage.logicalSession?.resumeCount ?? 0),
    Math.max(instanceCount - 1, 0),
    hasAggregateHistory ? 1 : 0
  );
  return {
    ...sessionUsage,
    logicalSession: {
      ...sessionUsage.logicalSession,
      instances: index.instances,
      instanceCount,
      resumeCount,
      isResumed: sessionUsage.logicalSession?.isResumed === true || instanceCount > 1 || hasAggregateHistory,
      premiumRequestsAggregation
    },
    aggregateUsage
  };
}

function buildLogicalSessionAggregate(index, currentInstanceId, options) {
  const contributions = [];
  let currentInstance;
  for (const instance of index.instances) {
    const usage = readLiveSession(instance.sessionId, options);
    for (const frozen of readFrozenContributions(usage)) {
      contributions.push(frozen);
    }
    contributions.push(usage);
    if (instance.sessionId === currentInstanceId) {
      currentInstance = usage;
    }
  }

  const premiumRequestsAggregation = aggregatePremiumRequests(contributions);
  const aggregateUsage = {
    sessionId: index.id,
    source: "copilot-cli-statusline-logical-session",
    timestamp: currentInstance?.timestamp ?? new Date().toISOString(),
    metricsEventType: "statusline.logical-aggregate",
    metricsTimestamp: currentInstance?.metricsTimestamp,
    metricsStale: false,
    currentModel: currentInstance?.currentModel,
    sessionName: currentInstance?.sessionName,
    workspaceDirectory: currentInstance?.workspaceDirectory,
    transcriptPath: index.source === "transcript_path" ? index.key : undefined,
    premiumRequests: premiumRequestsAggregation.value,
    totalApiDurationMs: sumOptional(contributions, "totalApiDurationMs"),
    totalDurationMs: sumOptional(contributions, "totalDurationMs"),
    totalLinesAdded: sumOptional(contributions, "totalLinesAdded"),
    totalLinesRemoved: sumOptional(contributions, "totalLinesRemoved"),
    modelUsage: sumModelUsage(contributions),
    logicalSession: {
      id: index.id,
      source: index.source,
      key: index.key,
      currentInstanceId,
      instances: index.instances,
      instanceCount: index.instances.length,
      resumeCount: Math.max(index.instances.length - 1, 0),
      isResumed: index.instances.length > 1,
      premiumRequestsAggregation
    }
  };

  if (aggregateUsage.premiumRequests === undefined) {
    delete aggregateUsage.premiumRequests;
  }
  return aggregateUsage;
}

function aggregatePremiumRequests(contributions) {
  let value;
  let mode = "none";
  for (const contribution of contributions) {
    const premiumRequests = readOptionalNumber(contribution.premiumRequests);
    if (premiumRequests === undefined) {
      continue;
    }

    if (value === undefined) {
      value = premiumRequests;
      mode = "single";
    } else if (premiumRequests >= value && value > 0) {
      value = premiumRequests;
      mode = mode === "sum-reset-instances" ? "mixed" : "latest-cumulative";
    } else {
      value = round(value + premiumRequests);
      mode = mode === "latest-cumulative" ? "mixed" : "sum-reset-instances";
    }
  }

  return { value, mode };
}

function sumModelUsage(contributions) {
  const byModel = new Map();
  for (const contribution of contributions) {
    for (const item of contribution.modelUsage ?? []) {
      const model = item.model;
      if (!model) {
        continue;
      }
      const target = byModel.get(model) ?? {
        model,
        requests: 0,
        inputTokens: 0,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0
      };
      target.requests += numberOrZero(item.requests);
      target.inputTokens += numberOrZero(item.inputTokens);
      target.cachedInputTokens += numberOrZero(item.cachedInputTokens);
      target.cacheWriteTokens += numberOrZero(item.cacheWriteTokens);
      target.outputTokens += numberOrZero(item.outputTokens);
      target.reasoningTokens += numberOrZero(item.reasoningTokens);
      byModel.set(model, target);
    }
  }
  return Array.from(byModel.values());
}

function sumOptional(contributions, property) {
  let total = 0;
  let hasValue = false;
  for (const contribution of contributions) {
    if (contribution[property] !== undefined) {
      total += numberOrZero(contribution[property]);
      hasValue = true;
    }
  }
  return hasValue ? total : undefined;
}

function readFrozenContributions(sessionUsage) {
  return Array.isArray(sessionUsage?.logicalSession?.frozenContributions)
    ? sessionUsage.logicalSession.frozenContributions.map((item) => ({ ...item }))
    : [];
}

function toFrozenContribution(sessionUsage) {
  return {
    sessionId: `${sessionUsage.sessionId}#reset-${readFrozenContributions(sessionUsage).length + 1}`,
    source: sessionUsage.source,
    timestamp: sessionUsage.timestamp,
    premiumRequests: sessionUsage.premiumRequests,
    totalApiDurationMs: sessionUsage.totalApiDurationMs,
    totalDurationMs: sessionUsage.totalDurationMs,
    totalLinesAdded: sessionUsage.totalLinesAdded,
    totalLinesRemoved: sessionUsage.totalLinesRemoved,
    modelUsage: (sessionUsage.modelUsage ?? []).map((item) => ({ ...item }))
  };
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

function round(value) {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}
