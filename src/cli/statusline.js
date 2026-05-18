#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { calculateSessionCost } from "../core/calculate.js";
import { getAppCacheDirectory } from "../core/app-cache-dir.js";
import { formatMoney, normalizeCurrency } from "../core/currency.js";
import { readCachedUsdExchangeRate } from "../core/fx-rates.js";
import { mergeStatusLinePayload, parseStatusLinePayload } from "../core/statusline-payload.js";

main();

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const raw = readStdin();
    if (!raw.trim()) {
      return;
    }

    const payload = parseStatusLinePayload(raw);
    const { sessionUsage } = mergeStatusLinePayload(payload);
    const currencyConfig = resolveCurrencyConfig();
    const usageBased = tryCalculate(sessionUsage, "usage-based", currencyConfig);
    const premiumRequests = tryCalculate(sessionUsage, "premium-requests", currencyConfig);
    const aggregateUsageBased = sessionUsage.aggregateUsage
      ? tryCalculate(sessionUsage.aggregateUsage, "usage-based", currencyConfig)
      : null;
    const aggregatePremiumRequests = sessionUsage.aggregateUsage
      ? tryCalculate(sessionUsage.aggregateUsage, "premium-requests", currencyConfig)
      : null;
    const costLine = args.hideCost
      ? ""
      : formatStatusLine(usageBased, premiumRequests, sessionUsage, aggregateUsageBased, aggregatePremiumRequests);
    const passthroughInput = JSON.stringify(buildEnrichedPayload(payload, {
      aggregatePremiumRequests,
      aggregateUsageBased,
      costLine,
      premiumRequests,
      sessionUsage,
      usageBased
    }));
    const passthroughLine = runPassthroughStatusLine(passthroughInput, args);
    const line = renderStatusLine(costLine, passthroughLine, args);

    if (line) {
      process.stdout.write(line);
    }
  } catch (error) {
    logDebugError("statusline failed", error);
  }
}

function parseArgs(argv) {
  const args = {
    hideCost: process.env.COPILOT_COST_STATUSLINE_HIDE_COST === "true",
    passthrough: process.env.COPILOT_COST_STATUSLINE_PASSTHROUGH,
    passthroughTimeoutMs: readNumber(process.env.COPILOT_COST_STATUSLINE_PASSTHROUGH_TIMEOUT_MS) ?? 1000,
    mode: process.env.COPILOT_COST_STATUSLINE_MODE,
    position: process.env.COPILOT_COST_STATUSLINE_POSITION ?? "right",
    separator: process.env.COPILOT_COST_STATUSLINE_SEPARATOR ?? " · "
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--hide-cost":
        args.hideCost = true;
        break;
      case "--passthrough":
        args.passthrough = readValue(argv, ++index, arg);
        break;
      case "--mode":
        args.mode = readValue(argv, ++index, arg);
        break;
      case "--passthrough-timeout-ms":
        args.passthroughTimeoutMs = readNumber(readValue(argv, ++index, arg)) ?? 1000;
        break;
      case "--position":
        args.position = readValue(argv, ++index, arg);
        break;
      case "--separator":
        args.separator = readValue(argv, ++index, arg);
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  args.mode ??= args.passthrough ? "passthrough" : "standalone";
  return args;
}

function readStdin() {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function tryCalculate(sessionUsage, billingModel, currencyConfig) {
  try {
    return calculateSessionCost(sessionUsage, {
      billingModel,
      plan: process.env.COPILOT_COST_PLAN ?? "pro",
      currency: currencyConfig.currency,
      exchangeRates: currencyConfig.exchangeRates,
      exchangeRateMetadata: currencyConfig.exchangeRateMetadata,
      promotionalAllowance: process.env.COPILOT_COST_PROMOTIONAL_ALLOWANCE === "true",
      remainingPremiumRequests: readNumber(process.env.COPILOT_COST_REMAINING_PREMIUM_REQUESTS),
      billReasoningTokens: process.env.COPILOT_COST_BILL_REASONING_TOKENS === "true"
    });
  } catch (error) {
    logDebugError(`failed to calculate ${billingModel} statusline cost`, error);
    return null;
  }
}

function formatStatusLine(usageBased, premiumRequests, sessionUsage, aggregateUsageBased, aggregatePremiumRequests) {
  const parts = [];
  const isResumed = sessionUsage.logicalSession?.isResumed === true;
  if (isResumed && aggregateUsageBased) {
    parts.push(`${green(`~${formatMoney(aggregateUsageBased.displayTotal, aggregateUsageBased.currency.code)}`)} ${dim("total")}`);
    if (usageBased) {
      parts.push(dim(`this ${formatMoney(usageBased.displayTotal, usageBased.currency.code)}`));
    }
  } else if (usageBased) {
    parts.push(`${green(`~${formatMoney(usageBased.displayTotal, usageBased.currency.code)}`)} ${dim(`(${round(usageBased.aiCredits)} cr)`)}`);
  }
  if (isResumed && aggregatePremiumRequests) {
    parts.push(yellow(`${aggregatePremiumRequests.totalPremiumRequests} PRU total`));
  } else if (premiumRequests) {
    parts.push(yellow(`${premiumRequests.totalPremiumRequests} PRU`));
  } else if (sessionUsage.premiumRequests !== undefined) {
    parts.push(yellow(`${sessionUsage.premiumRequests} PRU`));
  }
  if (isResumed) {
    parts.push(dim(`${sessionUsage.logicalSession.instanceCount} instances`));
  }
  if (sessionUsage.lastCallInputTokens !== undefined || sessionUsage.lastCallOutputTokens !== undefined) {
    parts.push(dim(`last ${compact(sessionUsage.lastCallInputTokens ?? 0)} in/${compact(sessionUsage.lastCallOutputTokens ?? 0)} out`));
  }

  return parts.length > 0 ? `${magenta("💸 Cost")} ${parts.join(dim(" · "))}` : "";
}

function buildEnrichedPayload(payload, { aggregatePremiumRequests, aggregateUsageBased, costLine, premiumRequests, sessionUsage, usageBased }) {
  return {
    ...payload,
    copilot_cost: {
      schema_version: 1,
      status_line: costLine,
      aggregate_usage_based: aggregateUsageBased,
      aggregate_premium_requests: aggregatePremiumRequests,
      usage_based: usageBased,
      premium_requests: premiumRequests,
      session_usage: sessionUsage
    }
  };
}

function runPassthroughStatusLine(input, args) {
  if (!args.passthrough) {
    return "";
  }

  try {
    const result = spawnSync(args.passthrough, {
      encoding: "utf8",
      input,
      shell: true,
      stdio: ["pipe", "pipe", "ignore"],
      timeout: args.passthroughTimeoutMs,
      windowsHide: true
    });

    if (result.error || result.status !== 0) {
      logDebugError("passthrough statusline failed", result.error ?? new Error(`exit code ${result.status}`));
      return "";
    }

    return String(result.stdout ?? "").trim();
  } catch (error) {
    logDebugError("passthrough statusline failed", error);
    return "";
  }
}

function renderStatusLine(costLine, passthroughLine, args) {
  if (args.mode === "passthrough") {
    return String(passthroughLine ?? "").trim() || String(costLine ?? "").trim();
  }

  if (args.mode === "standalone" || !args.passthrough) {
    return String(costLine ?? "").trim();
  }

  if (args.mode !== "decorate") {
    throw new Error(`Unsupported statusline mode: ${args.mode}`);
  }

  const cost = String(costLine ?? "").trim();
  const passthrough = String(passthroughLine ?? "").trim();
  if (!cost) {
    return passthrough;
  }
  if (!passthrough) {
    return cost;
  }

  if (args.position === "left") {
    return `${cost}${args.separator}${passthrough}`;
  }
  if (args.position === "replace") {
    return cost;
  }
  if (args.position === "passthrough") {
    return passthrough;
  }

  return `${passthrough}${args.separator}${cost}`;
}

function resolveCurrencyConfig() {
  const code = normalizeCurrency(process.env.COPILOT_COST_CURRENCY ?? "USD");
  if (code === "USD") {
    return { currency: "USD" };
  }

  // Env var takes priority
  const perCurrencyVar = `COPILOT_COST_FX_${code}`;
  const envSource = process.env[perCurrencyVar] !== undefined
    ? perCurrencyVar
    : (process.env.COPILOT_COST_EXCHANGE_RATE !== undefined ? "COPILOT_COST_EXCHANGE_RATE" : null);
  const envRate = readNumber(process.env[perCurrencyVar] ?? process.env.COPILOT_COST_EXCHANGE_RATE);
  if (envRate !== undefined && envSource) {
    return {
      currency: code,
      exchangeRates: { [code]: envRate },
      exchangeRateMetadata: {
        [code]: {
          base: "USD",
          quote: code,
          rate: envRate,
          source: envSource
        }
      }
    };
  }

  // Fall back to fx-rates cache
  try {
    const cached = readCachedUsdExchangeRate(code);
    if (cached) {
      return {
        currency: code,
        exchangeRates: { [code]: cached.rate },
        exchangeRateMetadata: { [code]: cached }
      };
    }
  } catch (error) {
    logDebugError(`failed to read cached ${code} exchange rate`, error);
  }

  // No rate available: degrade to USD so the cost segment still renders.
  logDebugError(
    `no USD-to-${code} exchange rate available`,
    new Error("falling back to USD for statusline display")
  );
  return { currency: "USD" };
}

function readNumber(value) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function readValue(argv, index, flag) {
  const value = argv[index];
  if (!value) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function compact(value) {
  const number = Number(value ?? 0);
  if (number >= 1_000_000) {
    return `${round(number / 1_000_000)}M`;
  }
  if (number >= 1_000) {
    return `${round(number / 1_000)}K`;
  }
  return String(number);
}

function round(value) {
  return Math.round(value * 10) / 10;
}

function color(code, value) {
  if (process.env.NO_COLOR || process.env.COPILOT_COST_STATUSLINE_COLOR === "false") {
    return String(value);
  }
  return `\u001b[${code}m${value}\u001b[0m`;
}

function dim(value) {
  return color("2", value);
}

function green(value) {
  return color("38;5;82", value);
}

function magenta(value) {
  return color("38;5;213", value);
}

function yellow(value) {
  return color("38;5;214", value);
}

function logDebugError(message, error) {
  if (process.env.COPILOT_COST_STATUSLINE_DEBUG !== "true") {
    return;
  }

  const directory = getAppCacheDirectory();
  fs.mkdirSync(directory, { recursive: true });
  fs.appendFileSync(
    path.join(directory, "statusline-debug.log"),
    `${new Date().toISOString()} ${message}: ${error?.stack ?? error?.message ?? "unknown error"}\n`
  );
}
