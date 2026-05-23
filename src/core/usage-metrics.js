export function usageMetricsToSessionUsage(sessionId, metrics, options = {}) {
  const modelMetrics = metrics?.modelMetrics && typeof metrics.modelMetrics === "object"
    ? metrics.modelMetrics
    : {};
  const modelUsage = Object.entries(modelMetrics).map(([model, item]) => {
    const requests = item.requests ?? {};
    const usage = item.usage ?? {};
    return {
      model,
      requests: numberOrZero(requests.count),
      premiumRequests: numberOrZero(requests.cost),
      inputTokens: numberOrZero(usage.inputTokens),
      cachedInputTokens: numberOrZero(usage.cacheReadTokens),
      cacheWriteTokens: numberOrZero(usage.cacheWriteTokens),
      outputTokens: numberOrZero(usage.outputTokens),
      reasoningTokens: numberOrZero(usage.reasoningTokens),
      totalNanoAiu: readOptionalNumber(item.totalNanoAiu),
      tokenDetails: cloneTokenDetails(item.tokenDetails)
    };
  });

  return {
    sessionId,
    source: options.source ?? "copilot-cli-rpc-usage",
    timestamp: new Date().toISOString(),
    metricsEventType: "usage.getMetrics",
    metricsTimestamp: new Date().toISOString(),
    metricsStale: false,
    currentModel: metrics.currentModel,
    premiumRequests: readOptionalNumber(metrics.totalPremiumRequestCost),
    totalNanoAiu: readOptionalNumber(metrics.totalNanoAiu),
    tokenDetails: cloneTokenDetails(metrics.tokenDetails),
    totalApiDurationMs: readOptionalNumber(metrics.totalApiDurationMs),
    totalUserRequests: readOptionalNumber(metrics.totalUserRequests),
    totalLinesAdded: readOptionalNumber(metrics.codeChanges?.linesAdded),
    totalLinesRemoved: readOptionalNumber(metrics.codeChanges?.linesRemoved),
    filesModifiedCount: readOptionalNumber(metrics.codeChanges?.filesModifiedCount),
    sessionStartTime: readOptionalNumber(metrics.sessionStartTime),
    lastCallInputTokens: readOptionalNumber(metrics.lastCallInputTokens),
    lastCallOutputTokens: readOptionalNumber(metrics.lastCallOutputTokens),
    modelUsage
  };
}

export function mergeResumedSessionUsage(currentUsage, previousUsage) {
  if (!previousUsage) {
    return currentUsage;
  }

  if (!hasUsageReset(currentUsage, previousUsage)) {
    if (previousUsage.aggregateUsage && usageWeight(currentUsage) === 0 && usageWeight(previousUsage) === 0) {
      return {
        ...currentUsage,
        logicalSession: previousUsage.logicalSession,
        aggregateUsage: previousUsage.aggregateUsage
      };
    }
    return currentUsage;
  }

  const previousAggregate = previousUsage.aggregateUsage ?? previousUsage;
  const aggregateUsage = {
    sessionId: previousUsage.logicalSession?.id ?? `session:${currentUsage.sessionId}`,
    source: "copilot-cli-resumed-session-aggregate",
    timestamp: currentUsage.timestamp,
    metricsEventType: "usage.resumed-aggregate",
    metricsTimestamp: currentUsage.metricsTimestamp,
    metricsStale: false,
    currentModel: currentUsage.currentModel ?? previousUsage.currentModel,
    sessionName: currentUsage.sessionName ?? previousUsage.sessionName,
    workspaceDirectory: currentUsage.workspaceDirectory ?? previousUsage.workspaceDirectory,
    transcriptPath: currentUsage.transcriptPath ?? previousUsage.transcriptPath,
    premiumRequests: aggregatePremiumRequests(previousAggregate.premiumRequests, currentUsage.premiumRequests),
    totalNanoAiu: aggregatePremiumRequests(previousAggregate.totalNanoAiu, currentUsage.totalNanoAiu),
    totalApiDurationMs: sumOptional(previousAggregate.totalApiDurationMs, currentUsage.totalApiDurationMs),
    totalDurationMs: sumOptional(previousAggregate.totalDurationMs, currentUsage.totalDurationMs),
    totalLinesAdded: sumOptional(previousAggregate.totalLinesAdded, currentUsage.totalLinesAdded),
    totalLinesRemoved: sumOptional(previousAggregate.totalLinesRemoved, currentUsage.totalLinesRemoved),
    modelUsage: sumModelUsage(previousAggregate.modelUsage ?? [], currentUsage.modelUsage ?? [])
  };
  if (aggregateUsage.premiumRequests === undefined) {
    delete aggregateUsage.premiumRequests;
  }
  if (aggregateUsage.totalNanoAiu === undefined) {
    delete aggregateUsage.totalNanoAiu;
  }

  const priorResetCount = Number(previousUsage.logicalSession?.resetCount ?? 0);
  return {
    ...currentUsage,
    logicalSession: {
      id: aggregateUsage.sessionId,
      source: previousUsage.logicalSession?.source ?? (previousUsage.transcriptPath ? "transcript_path" : "session_id"),
      key: previousUsage.logicalSession?.key ?? previousUsage.transcriptPath ?? currentUsage.sessionId,
      currentInstanceId: currentUsage.sessionId,
      instanceCount: previousUsage.logicalSession?.instanceCount ?? 1,
      resumeCount: Math.max(Number(previousUsage.logicalSession?.resumeCount ?? 0), 1),
      isResumed: true,
      resetCount: priorResetCount + 1,
      frozenContributions: [
        ...readFrozenContributions(previousUsage),
        toFrozenContribution(previousUsage)
      ]
    },
    aggregateUsage
  };
}

function hasUsageReset(currentUsage, previousUsage) {
  const currentTotal = sumTokenUsage(currentUsage);
  const previousTotal = sumTokenUsage(previousUsage);
  const currentPremiumRequests = numberOrZero(currentUsage.premiumRequests);
  const previousPremiumRequests = numberOrZero(previousUsage.premiumRequests);
  const currentNanoAiu = numberOrZero(currentUsage.totalNanoAiu);
  const previousNanoAiu = numberOrZero(previousUsage.totalNanoAiu);
  return (previousTotal > 0 && currentTotal < previousTotal)
    || (previousPremiumRequests > 0 && currentPremiumRequests < previousPremiumRequests)
    || (previousNanoAiu > 0 && currentNanoAiu < previousNanoAiu);
}

function usageWeight(sessionUsage) {
  return sumTokenUsage(sessionUsage)
    + numberOrZero(sessionUsage?.premiumRequests)
    + numberOrZero(sessionUsage?.totalNanoAiu);
}

function sumTokenUsage(sessionUsage) {
  return (sessionUsage.modelUsage ?? []).reduce(
    (total, item) => total
      + numberOrZero(item.inputTokens)
      + numberOrZero(item.cachedInputTokens)
      + numberOrZero(item.cacheWriteTokens)
      + numberOrZero(item.outputTokens)
      + numberOrZero(item.reasoningTokens),
    0
  );
}

function aggregatePremiumRequests(previousValue, currentValue) {
  const previous = readOptionalNumber(previousValue);
  const current = readOptionalNumber(currentValue);
  if (previous === undefined) {
    return current;
  }
  if (current === undefined) {
    return previous;
  }
  return current >= previous ? current : round(previous + current);
}

function sumOptional(previousValue, currentValue) {
  const previous = readOptionalNumber(previousValue);
  const current = readOptionalNumber(currentValue);
  if (previous === undefined) {
    return current;
  }
  if (current === undefined) {
    return previous;
  }
  return previous + current;
}

function sumModelUsage(previousModelUsage, currentModelUsage) {
  const byModel = new Map();
  for (const item of [...previousModelUsage, ...currentModelUsage]) {
    if (!item.model) {
      continue;
    }
    const target = byModel.get(item.model) ?? {
      model: item.model,
      requests: 0,
      inputTokens: 0,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      totalNanoAiu: 0
    };
    target.requests += numberOrZero(item.requests);
    target.inputTokens += numberOrZero(item.inputTokens);
    target.cachedInputTokens += numberOrZero(item.cachedInputTokens);
    target.cacheWriteTokens += numberOrZero(item.cacheWriteTokens);
    target.outputTokens += numberOrZero(item.outputTokens);
    target.reasoningTokens += numberOrZero(item.reasoningTokens);
    target.totalNanoAiu += numberOrZero(item.totalNanoAiu);
    byModel.set(item.model, target);
  }
  return Array.from(byModel.values()).map((item) => {
    if (item.totalNanoAiu === 0) {
      delete item.totalNanoAiu;
    }
    return item;
  });
}

function readFrozenContributions(sessionUsage) {
  return Array.isArray(sessionUsage.logicalSession?.frozenContributions)
    ? sessionUsage.logicalSession.frozenContributions.map((item) => ({ ...item }))
    : [];
}

function toFrozenContribution(sessionUsage) {
  return {
    sessionId: sessionUsage.sessionId,
    source: sessionUsage.source,
    timestamp: sessionUsage.timestamp,
    premiumRequests: sessionUsage.premiumRequests,
    totalNanoAiu: sessionUsage.totalNanoAiu,
    totalApiDurationMs: sessionUsage.totalApiDurationMs,
    totalDurationMs: sessionUsage.totalDurationMs,
    totalLinesAdded: sessionUsage.totalLinesAdded,
    totalLinesRemoved: sessionUsage.totalLinesRemoved,
    modelUsage: (sessionUsage.modelUsage ?? []).map((item) => ({ ...item }))
  };
}

function numberOrZero(value) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function readOptionalNumber(value) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
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

function round(value) {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}
