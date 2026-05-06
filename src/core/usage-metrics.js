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
      reasoningTokens: numberOrZero(usage.reasoningTokens)
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
