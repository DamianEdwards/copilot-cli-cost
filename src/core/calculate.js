import {
  AI_CREDIT_USD,
  TOKENS_PER_MILLION,
  modelAliases,
  planAiCreditAllotments,
  planAllowances,
  planIds,
  promotionalAllowancePeriod,
  usageBasedRates
} from "./rates.js";
import { convertUsd, resolveCurrency } from "./currency.js";

export function calculateSessionCost(sessionUsage, scenario = {}) {
  const billingModel = scenario.billingModel ?? "usage-based";
  if (billingModel !== "usage-based") {
    throw new Error(`Unsupported billing model: ${billingModel}`);
  }
  return calculateUsageBasedCost(sessionUsage, scenario);
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
  const includedAiCreditAllotment = getIncludedAiCreditAllotment(plan, scenario);
  const includedAiCredits = includedAiCreditAllotment.totalAiCredits;
  const allowanceUsagePercentage = calculateAllowanceUsagePercentage(aiCredits, includedAiCredits);

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
    includedAiCreditAllotment,
    includedAiCredits,
    allowanceUsagePercentage,
    includedCreditsApplied: Math.min(aiCredits, includedAiCredits),
    overageCreditsIfAllowanceExhausted: aiCredits,
    overageUsdIfAllowanceExhausted: totalUsd,
    modelBreakdown
  };
}

export function normalizeModelId(model) {
  const raw = String(model ?? "").trim();
  const lower = raw.toLowerCase();
  return modelAliases[lower] ?? lower.replace(/\s+/g, "-");
}

export function normalizePlanId(plan) {
  const normalized = String(plan ?? planIds.pro).trim().toLowerCase().replace(/[_\s]+/g, "-");
  if (
    normalized === "pro+"
    || normalized === "pro-plus"
    || normalized === "proplus"
    || normalized === "copilot-pro+"
    || normalized === "copilot-pro-plus"
    || normalized === "copilot-proplus"
    || normalized === "github-copilot-pro+"
    || normalized === "github-copilot-pro-plus"
  ) {
    return planIds.proPlus;
  }
  if (normalized === "max" || normalized === "copilot-max" || normalized === "github-copilot-max") {
    return planIds.max;
  }
  if (normalized === "individual" || normalized === "copilot-pro" || normalized === "github-copilot-pro") {
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

function getIncludedAiCreditAllotment(plan, scenario) {
  const baseAllotment = planAiCreditAllotments[plan] ?? {
    baseAiCredits: 0,
    flexAiCredits: 0,
    totalAiCredits: 0
  };
  const promotionalAiCredits = planAllowances.promotionalAiCredits[plan] ?? 0;
  if (isPromotionalAllowanceActive(scenario) && promotionalAiCredits > 0) {
    return {
      baseAiCredits: baseAllotment.baseAiCredits,
      flexAiCredits: baseAllotment.flexAiCredits,
      promotionalAiCredits,
      totalAiCredits: baseAllotment.totalAiCredits + promotionalAiCredits
    };
  }
  return baseAllotment;
}

function isPromotionalAllowanceActive(scenario) {
  if (typeof scenario.promotionalAllowance === "boolean") {
    return scenario.promotionalAllowance;
  }

  const currentTime = Date.parse(scenario.currentDate ?? new Date().toISOString());
  return Number.isFinite(currentTime)
    && currentTime >= Date.parse(promotionalAllowancePeriod.startsAt)
    && currentTime < Date.parse(promotionalAllowancePeriod.endsBefore);
}

function calculateAllowanceUsagePercentage(usage, allowance) {
  const allowanceValue = numberOrZero(allowance);
  if (allowanceValue <= 0) {
    return null;
  }
  return roundCost((numberOrZero(usage) / allowanceValue) * 100);
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
