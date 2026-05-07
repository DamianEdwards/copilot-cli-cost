import {
  AI_CREDIT_USD,
  PREMIUM_REQUEST_USD,
  TOKENS_PER_MILLION,
  modelAliases,
  planAllowances,
  planIds,
  premiumRequestMultipliers,
  usageBasedRates
} from "./rates.js";
import { convertUsd, resolveCurrency } from "./currency.js";

export function calculateSessionCost(sessionUsage, scenario = {}) {
  const billingModel = scenario.billingModel ?? "usage-based";
  if (billingModel === "usage-based") {
    return calculateUsageBasedCost(sessionUsage, scenario);
  }
  if (billingModel === "premium-requests") {
    return calculatePremiumRequestCost(sessionUsage, scenario);
  }
  throw new Error(`Unsupported billing model: ${billingModel}`);
}

export function calculateUsageBasedCost(sessionUsage, scenario = {}) {
  const currency = resolveCurrency(scenario.currency ?? sessionUsage.currency ?? "USD", {
    exchangeRateMetadata: scenario.exchangeRateMetadata,
    exchangeRates: scenario.exchangeRates
  });
  const modelBreakdown = normalizeModelUsage(sessionUsage).map((usage) => {
    const modelId = normalizeModelId(usage.model);
    const rate = usageBasedRates[modelId];
    if (!rate) {
      throw new Error(`No usage-based token rate configured for model '${usage.model}' (${modelId}).`);
    }

    const uncachedInputTokens = getUncachedInputTokens(usage.inputTokens, usage.cachedInputTokens);
    const inputUsd = costForTokens(uncachedInputTokens, rate.inputPerMillionUsd);
    const cachedInputUsd = costForTokens(usage.cachedInputTokens, rate.cachedInputPerMillionUsd);
    const cacheWriteUsd = costForTokens(usage.cacheWriteTokens, rate.cacheWritePerMillionUsd);
    const outputUsd = costForTokens(usage.outputTokens, rate.outputPerMillionUsd);
    const billReasoningTokens = scenario.billReasoningTokens === true;
    const reasoningUsd = billReasoningTokens
      ? costForTokens(usage.reasoningTokens, rate.outputPerMillionUsd)
      : 0;
    const totalUsd = roundCost(inputUsd + cachedInputUsd + cacheWriteUsd + outputUsd + reasoningUsd);

    return {
      model: modelId,
      displayName: usage.model,
      requests: usage.requests,
      inputTokens: usage.inputTokens,
      uncachedInputTokens,
      cachedInputTokens: usage.cachedInputTokens,
      cacheWriteTokens: usage.cacheWriteTokens,
      outputTokens: usage.outputTokens,
      reasoningTokens: usage.reasoningTokens,
      rates: {
        inputPerMillionUsd: rate.inputPerMillionUsd,
        cachedInputPerMillionUsd: rate.cachedInputPerMillionUsd,
        cacheWritePerMillionUsd: rate.cacheWritePerMillionUsd,
        outputPerMillionUsd: rate.outputPerMillionUsd,
        reasoningPerMillionUsd: billReasoningTokens ? rate.outputPerMillionUsd : 0
      },
      inputUsd,
      cachedInputUsd,
      cacheWriteUsd,
      outputUsd,
      reasoningUsd,
      totalUsd,
      aiCredits: usdToAiCredits(totalUsd),
      displayTotal: convertUsd(totalUsd, currency)
    };
  });

  const totalUsd = roundCost(sum(modelBreakdown, (item) => item.totalUsd));
  const aiCredits = usdToAiCredits(totalUsd);
  const plan = normalizePlanId(scenario.plan ?? sessionUsage.plan ?? planIds.pro);
  const includedAiCredits = getIncludedAiCredits(plan, scenario);

  return {
    billingModel: "usage-based",
    sessionId: sessionUsage.sessionId,
    source: sessionUsage.source,
    metricsEventType: sessionUsage.metricsEventType,
    metricsTimestamp: sessionUsage.metricsTimestamp,
    latestEventType: sessionUsage.latestEventType,
    latestEventTimestamp: sessionUsage.latestEventTimestamp,
    metricsStale: sessionUsage.metricsStale === true,
    plan,
    currency,
    totalUsd,
    displayTotal: convertUsd(totalUsd, currency),
    aiCredits,
    includedAiCredits,
    includedCreditsApplied: Math.min(aiCredits, includedAiCredits),
    overageCreditsIfAllowanceExhausted: aiCredits,
    overageUsdIfAllowanceExhausted: totalUsd,
    modelBreakdown
  };
}

export function calculatePremiumRequestCost(sessionUsage, scenario = {}) {
  const currency = resolveCurrency(scenario.currency ?? sessionUsage.currency ?? "USD", {
    exchangeRateMetadata: scenario.exchangeRateMetadata,
    exchangeRates: scenario.exchangeRates
  });
  const multiplierSet = scenario.multiplierSet ?? "current";
  const multipliers = premiumRequestMultipliers[multiplierSet];
  if (!multipliers) {
    throw new Error(`Unsupported premium request multiplier set: ${multiplierSet}`);
  }

  const directPremiumRequests = readDirectPremiumRequests(sessionUsage, scenario);
  const modelBreakdown = directPremiumRequests === undefined ? normalizeModelUsage(sessionUsage).map((usage) => {
    const modelId = normalizeModelId(usage.model);
    const multiplier = multipliers[modelId];
    if (multiplier === undefined) {
      throw new Error(`No premium request multiplier configured for model '${usage.model}' (${modelId}).`);
    }

    const requests = usage.requests || 0;
    const premiumRequests = roundCost(requests * multiplier);

    return {
      model: modelId,
      displayName: usage.model,
      requests,
      multiplier,
      premiumRequests
    };
  }) : [];

  const plan = normalizePlanId(scenario.plan ?? sessionUsage.plan ?? planIds.pro);
  const totalPremiumRequests = directPremiumRequests ?? roundCost(sum(modelBreakdown, (item) => item.premiumRequests));
  const includedPremiumRequests = planAllowances.premiumRequests[plan] ?? 0;
  const remainingPremiumRequestsBeforeSession = readOptionalNumber(scenario.remainingPremiumRequests ?? sessionUsage.remainingPremiumRequestsBeforeSession);
  const billablePremiumRequests = remainingPremiumRequestsBeforeSession === undefined
    ? null
    : Math.max(roundCost(totalPremiumRequests - remainingPremiumRequestsBeforeSession), 0);
  const billableUsd = billablePremiumRequests === null ? null : roundCost(billablePremiumRequests * PREMIUM_REQUEST_USD);
  const overageEquivalentUsd = roundCost(totalPremiumRequests * PREMIUM_REQUEST_USD);

  return {
    billingModel: "premium-requests",
    sessionId: sessionUsage.sessionId,
    sessionSource: sessionUsage.source,
    metricsEventType: sessionUsage.metricsEventType,
    metricsTimestamp: sessionUsage.metricsTimestamp,
    latestEventType: sessionUsage.latestEventType,
    latestEventTimestamp: sessionUsage.latestEventTimestamp,
    metricsStale: sessionUsage.metricsStale === true,
    plan,
    currency,
    multiplierSet,
    source: directPremiumRequests === undefined ? "model-breakdown" : "direct-premium-requests",
    totalPremiumRequests,
    includedPremiumRequests,
    includedPremiumRequestsApplied: Math.min(totalPremiumRequests, includedPremiumRequests),
    remainingPremiumRequestsBeforeSession,
    billablePremiumRequests,
    billableUsd,
    displayBillable: billableUsd === null ? null : convertUsd(billableUsd, currency),
    premiumRequestUnitUsd: PREMIUM_REQUEST_USD,
    overageEquivalentUsd,
    displayOverageEquivalent: convertUsd(overageEquivalentUsd, currency),
    overagePremiumRequestsIfAllowanceExhausted: totalPremiumRequests,
    modelBreakdown
  };
}

export function normalizeModelId(model) {
  const raw = String(model ?? "").trim();
  const lower = raw.toLowerCase();
  return modelAliases[lower] ?? lower.replace(/\s+/g, "-");
}

export function normalizePlanId(plan) {
  const normalized = String(plan ?? planIds.pro).trim().toLowerCase();
  if (normalized === "pro+" || normalized === "pro_plus" || normalized === "proplus") {
    return planIds.proPlus;
  }
  if (normalized === "individual" || normalized === "copilot-pro") {
    return planIds.pro;
  }
  if (normalized === "enterprise-cloud") {
    return planIds.enterprise;
  }
  return normalized;
}

function normalizeModelUsage(sessionUsage) {
  const usage = sessionUsage.modelUsage ?? sessionUsage.models;
  if (usage === undefined || usage === null) {
    return [];
  }
  if (!Array.isArray(usage)) {
    throw new Error("Session usage modelUsage must be an array.");
  }

  return usage.map((item) => ({
    model: item.model,
    requests: numberOrZero(item.requests ?? item.requestCount),
    inputTokens: numberOrZero(item.inputTokens),
    cachedInputTokens: numberOrZero(item.cachedInputTokens ?? item.cachedTokens),
    cacheWriteTokens: numberOrZero(item.cacheWriteTokens),
    outputTokens: numberOrZero(item.outputTokens),
    reasoningTokens: numberOrZero(item.reasoningTokens)
  }));
}

function readDirectPremiumRequests(sessionUsage, scenario) {
  return readOptionalNumber(
    scenario.premiumRequests
      ?? sessionUsage.premiumRequests
      ?? sessionUsage.totalPremiumRequests
      ?? sessionUsage.currentSessionPremiumRequests
  );
}

function readOptionalNumber(value) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Expected a non-negative number, received '${value}'.`);
  }
  return parsed;
}

function getIncludedAiCredits(plan, scenario) {
  if (scenario.promotionalAllowance && planAllowances.promotionalAiCredits[plan] !== undefined) {
    return planAllowances.promotionalAiCredits[plan];
  }
  return planAllowances.aiCredits[plan] ?? 0;
}

function costForTokens(tokens, perMillionUsd) {
  return roundCost((numberOrZero(tokens) / TOKENS_PER_MILLION) * perMillionUsd);
}

function getUncachedInputTokens(inputTokens, cachedInputTokens) {
  return Math.max(numberOrZero(inputTokens) - numberOrZero(cachedInputTokens), 0);
}

function usdToAiCredits(usd) {
  return roundCost(usd / AI_CREDIT_USD);
}

function sum(items, selector) {
  return items.reduce((total, item) => total + selector(item), 0);
}

function numberOrZero(value) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundCost(value) {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}

