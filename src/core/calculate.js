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

const NANO_AI_UNITS_PER_AI_CREDIT = 1_000_000_000;

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
  const directSessionAiCredits = readDirectAiCredits(
    {
      aiCredits: scenario.aiCredits ?? sessionUsage.aiCredits,
      totalNanoAiu: scenario.totalNanoAiu ?? sessionUsage.totalNanoAiu
    },
    "copilot-cli-session-aiu"
  );
  const modelBreakdown = normalizeModelUsage(sessionUsage).map((usage) => {
    const modelId = resolveKnownModelId(usage.model, usageBasedRates);
    const directAiCredits = readDirectAiCredits(usage, "copilot-cli-model-aiu");
    const rate = usageBasedRates[modelId];
    if (!rate && !directAiCredits && !directSessionAiCredits) {
      throw new Error(`No usage-based token rate configured for model '${usage.model}' (${modelId}).`);
    }

    const uncachedInputTokens = getUncachedInputTokens(usage.inputTokens, usage.cachedInputTokens);
    const inputUsd = rate ? costForTokens(uncachedInputTokens, rate.inputPerMillionUsd) : 0;
    const cachedInputUsd = rate ? costForTokens(usage.cachedInputTokens, rate.cachedInputPerMillionUsd) : 0;
    const cacheWriteUsd = rate ? costForTokens(usage.cacheWriteTokens, rate.cacheWritePerMillionUsd) : 0;
    const outputUsd = rate ? costForTokens(usage.outputTokens, rate.outputPerMillionUsd) : 0;
    const billReasoningTokens = scenario.billReasoningTokens === true;
    const reasoningUsd = rate && billReasoningTokens
      ? costForTokens(usage.reasoningTokens, rate.outputPerMillionUsd)
      : 0;
    const tokenEstimatedTotalUsd = roundCost(inputUsd + cachedInputUsd + cacheWriteUsd + outputUsd + reasoningUsd);
    const totalUsd = directAiCredits
      ? aiCreditsToUsd(directAiCredits.aiCredits)
      : tokenEstimatedTotalUsd;
    const aiCredits = directAiCredits?.aiCredits ?? usdToAiCredits(tokenEstimatedTotalUsd);

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
        inputPerMillionUsd: rate?.inputPerMillionUsd,
        cachedInputPerMillionUsd: rate?.cachedInputPerMillionUsd,
        cacheWritePerMillionUsd: rate?.cacheWritePerMillionUsd,
        outputPerMillionUsd: rate?.outputPerMillionUsd,
        reasoningPerMillionUsd: rate && billReasoningTokens ? rate.outputPerMillionUsd : 0
      },
      inputUsd,
      cachedInputUsd,
      cacheWriteUsd,
      outputUsd,
      reasoningUsd,
      totalUsd,
      tokenEstimatedTotalUsd,
      tokenEstimatedAiCredits: usdToAiCredits(tokenEstimatedTotalUsd),
      totalNanoAiu: directAiCredits?.totalNanoAiu,
      aiCredits,
      creditCalculationMethod: directAiCredits ? "copilot-aiu" : "token-estimate",
      creditCalculationSource: directAiCredits?.source ?? "token-rate-estimate",
      displayTotal: convertUsd(totalUsd, currency),
      tokenEstimatedDisplayTotal: convertUsd(tokenEstimatedTotalUsd, currency)
    };
  });

  const tokenEstimatedTotalUsd = roundCost(sum(modelBreakdown, (item) => item.tokenEstimatedTotalUsd));
  const tokenEstimatedAiCredits = usdToAiCredits(tokenEstimatedTotalUsd);
  const modelCreditSource = getModelCreditSource(modelBreakdown);
  const totalUsd = directSessionAiCredits
    ? aiCreditsToUsd(directSessionAiCredits.aiCredits)
    : roundCost(sum(modelBreakdown, (item) => item.totalUsd));
  const aiCredits = directSessionAiCredits?.aiCredits ?? usdToAiCredits(totalUsd);
  const creditCalculationMethod = directSessionAiCredits
    ? "copilot-aiu"
    : modelCreditSource.method;
  const creditCalculationSource = directSessionAiCredits?.source ?? modelCreditSource.source;
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
    totalNanoAiu: directSessionAiCredits?.totalNanoAiu,
    tokenEstimatedTotalUsd,
    tokenEstimatedDisplayTotal: convertUsd(tokenEstimatedTotalUsd, currency),
    tokenEstimatedAiCredits,
    creditCalculationMethod,
    creditCalculationSource,
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

export function resolveKnownModelId(model, lookupTable) {
  const modelId = normalizeModelId(model);
  if (lookupTable?.[modelId] !== undefined) {
    return modelId;
  }

  return Object.keys(lookupTable ?? {})
    .filter((candidate) => hasModelPrefix(modelId, candidate))
    .sort((left, right) => right.length - left.length)[0] ?? modelId;
}

function hasModelPrefix(modelId, candidate) {
  if (!modelId.startsWith(candidate)) {
    return false;
  }
  const nextChar = modelId.charAt(candidate.length);
  return nextChar === "" || nextChar === "-" || nextChar === "(" || nextChar === "[";
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
    reasoningTokens: numberOrZero(item.reasoningTokens),
    totalNanoAiu: readOptionalNumber(item.totalNanoAiu),
    aiCredits: readOptionalNumber(item.aiCredits)
  }));
}

function getModelCreditSource(modelBreakdown) {
  if (modelBreakdown.length === 0) {
    return {
      method: "token-estimate",
      source: "token-rate-estimate"
    };
  }

  const aiuCount = modelBreakdown.filter((item) => item.creditCalculationMethod === "copilot-aiu").length;
  if (aiuCount === modelBreakdown.length) {
    return {
      method: "copilot-aiu",
      source: "copilot-cli-model-aiu"
    };
  }
  if (aiuCount > 0) {
    return {
      method: "mixed",
      source: "mixed-model-aiu-token-estimate"
    };
  }
  return {
    method: "token-estimate",
    source: "token-rate-estimate"
  };
}

function readDirectAiCredits(usage, source) {
  const totalNanoAiu = readOptionalNumber(usage.totalNanoAiu);
  if (totalNanoAiu !== undefined) {
    return {
      aiCredits: nanoAiuToAiCredits(totalNanoAiu),
      source,
      totalNanoAiu
    };
  }

  const aiCredits = readOptionalNumber(usage.aiCredits);
  if (aiCredits !== undefined) {
    return {
      aiCredits,
      source: source === "copilot-cli-model-aiu" ? "model-ai-credits" : "session-ai-credits"
    };
  }

  return undefined;
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

function aiCreditsToUsd(aiCredits) {
  return roundCost(numberOrZero(aiCredits) * AI_CREDIT_USD);
}

function nanoAiuToAiCredits(totalNanoAiu) {
  return roundCost(numberOrZero(totalNanoAiu) / NANO_AI_UNITS_PER_AI_CREDIT);
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
