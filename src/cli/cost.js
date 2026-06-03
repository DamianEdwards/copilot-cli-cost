#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { calculateSessionCost } from "../core/calculate.js";
import { formatMoney } from "../core/currency.js";
import { getUsdExchangeRate } from "../core/fx-rates.js";
import { readLatestLiveSession, readLiveSession } from "../core/live-session-store.js";
import { readSessionUsageFromEvents } from "../core/session-events.js";
import { parseStatusLinePayload, statusLinePayloadToSessionUsage } from "../core/statusline-payload.js";
import { formatPackageVersion } from "../core/version.js";

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

main();

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      printHelp();
      return;
    }

    if (args.version) {
      console.log(formatPackageVersion());
      return;
    }

    const sessionUsage = readUsage(args);
    const exchangeRate = await resolveExchangeRate(args);
    const scenario = {
      plan: args.plan,
      currency: args.currency,
      promotionalAllowance: args.promotionalAllowance,
      billReasoningTokens: args.billReasoningTokens,
      exchangeRateMetadata: exchangeRate.metadata,
      exchangeRates: exchangeRate.exchangeRates
    };
    const result = calculateSessionCost(sessionUsage, scenario);
    const aggregateResult = sessionUsage.logicalSession?.isResumed && sessionUsage.aggregateUsage
      ? calculateSessionCost(sessionUsage.aggregateUsage, scenario)
      : null;

    if (args.json) {
      console.log(JSON.stringify(aggregateResult ? { current: result, aggregate: aggregateResult } : result, null, 2));
      return;
    }

    printHuman(result, aggregateResult, sessionUsage);
  } catch (error) {
    console.error(`copilot-cost: ${error.message}`);
    process.exitCode = 1;
  }
}

async function resolveExchangeRate(args) {
  const code = String(args.currency ?? "USD").toUpperCase();
  if (code === "USD") {
    return {};
  }

  if (args.exchangeRate) {
    const rate = Number(args.exchangeRate);
    const rateInfo = {
      base: "USD",
      quote: code,
      rate,
      source: "configured"
    };
    return {
      exchangeRates: { [code]: rate },
      metadata: { [code]: rateInfo }
    };
  }

  const envRateName = `COPILOT_COST_FX_${code}`;
  const envRate = readOptionalNumber(process.env[envRateName] ?? process.env.COPILOT_COST_EXCHANGE_RATE);
  if (envRate !== undefined) {
    const rateInfo = {
      base: "USD",
      quote: code,
      rate: envRate,
      source: process.env[envRateName] ? envRateName : "COPILOT_COST_EXCHANGE_RATE"
    };
    return {
      exchangeRates: { [code]: envRate },
      metadata: { [code]: rateInfo }
    };
  }

  const rateInfo = await getUsdExchangeRate(code);
  return {
    exchangeRates: { [code]: rateInfo.rate },
    metadata: { [code]: rateInfo }
  };
}

function readOptionalNumber(value) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return parsed;
}

function parseArgs(argv) {
  const args = {
    billReasoningTokens: process.env.COPILOT_COST_BILL_REASONING_TOKENS === "true",
    currency: "USD",
    plan: "pro"
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--currency":
        args.currency = readValue(argv, ++index, arg);
        break;
      case "--exchange-rate":
        args.exchangeRate = readValue(argv, ++index, arg);
        break;
      case "--file":
        args.file = readValue(argv, ++index, arg);
        break;
      case "--live":
        args.live = true;
        break;
      case "--live-session":
        args.liveSession = readValue(argv, ++index, arg);
        break;
      case "--bill-reasoning-tokens":
        args.billReasoningTokens = true;
        break;
      case "--no-bill-reasoning-tokens":
        args.billReasoningTokens = false;
        break;
      case "--json":
        args.json = true;
        break;
      case "--plan":
        args.plan = readValue(argv, ++index, arg);
        break;
      case "--promotional-allowance":
        args.promotionalAllowance = true;
        break;
      case "--no-promotional-allowance":
        args.promotionalAllowance = false;
        break;
      case "--sample":
        args.sample = true;
        break;
      case "--session-id":
        args.sessionId = readValue(argv, ++index, arg);
        break;
      case "--session":
        args.session = readValue(argv, ++index, arg);
        break;
      case "--statusline-payload":
        args.statusLinePayload = readValue(argv, ++index, arg);
        break;
      case "--copilot-home":
        args.copilotHome = readValue(argv, ++index, arg);
        break;
      case "--help":
      case "-h":
        args.help = true;
        break;
      case "--version":
      case "-v":
        args.version = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function readUsage(args) {
  if (args.liveSession) {
    return readLiveSession(args.liveSession);
  }

  if (args.live) {
    return readLatestLiveSession();
  }

  if (args.session) {
    return readSessionUsageFromEvents(args.session, {
      copilotHome: args.copilotHome
    });
  }

  if (args.statusLinePayload) {
    const payload = parseStatusLinePayload(fs.readFileSync(args.statusLinePayload, "utf8"));
    return statusLinePayloadToSessionUsage(payload);
  }

  const file = args.sample
    ? path.join(rootDirectory, "fixtures", "session-usage.sample.json")
    : args.file;

  if (!file) {
    throw new Error("Pass --file <session-usage.json>, --sample, --session <id>, --live, or --statusline-payload <file>.");
  }

  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function printHuman(result, aggregateResult, sessionUsage = {}) {
  console.log(`Session: ${result.sessionId ?? "(unknown)"}`);
  if (sessionUsage.logicalSession?.isResumed) {
    console.log(`Logical session: ${sessionUsage.logicalSession.instanceCount} resumed instances (${sessionUsage.logicalSession.id})`);
  }
  console.log(`Plan: ${result.plan}`);
  if (result.metricsStale) {
    console.log(`Metrics status: stale as of ${result.metricsTimestamp}; latest event is ${result.latestEventType} at ${result.latestEventTimestamp}`);
  }

  console.log(`Cost: ${formatMoney(result.totalUsd, "USD")} (${formatMoney(result.displayTotal, result.currency.code)})`);
  if (aggregateResult) {
    console.log(`Logical session cost: ${formatMoney(aggregateResult.totalUsd, "USD")} (${formatMoney(aggregateResult.displayTotal, aggregateResult.currency.code)})`);
  }
  console.log(`AI credits: ${result.aiCredits}`);
  console.log(`Included monthly credits for plan: ${formatAiCreditAllotment(result)}`);
  console.log(`Currency rate: USD -> ${result.currency.code} ${result.currency.exchangeRate} (${result.currency.source})`);
  console.log("");
  console.log("Model breakdown:");
  for (const item of result.modelBreakdown) {
    const uncachedInputTokens = item.uncachedInputTokens ?? Math.max(Number(item.inputTokens ?? 0) - Number(item.cachedInputTokens ?? 0), 0);
    console.log(`- ${item.model}: ${formatMoney(item.totalUsd, "USD")} / ${item.aiCredits} credits (${uncachedInputTokens} uncached input, ${item.cachedInputTokens} cached input, ${item.outputTokens} output, ${item.reasoningTokens} reasoning tokens)`);
  }
}

function printHelp() {
  console.log(`Usage: copilot-cost --file <usage.json> [options]
       copilot-cost --live [options]

Options:
  --sample                         Use fixtures/session-usage.sample.json
  --session <id>                   Read actual counters from ~/.copilot session events
  --live                           Read latest live snapshot captured by the statusline bridge
  --live-session <id>              Read a specific live statusline snapshot
  --statusline-payload <file>      Read a raw Copilot CLI statusline JSON payload
  --copilot-home <path>            Override Copilot home when using --session
  --plan <plan>                    free | pro | pro-plus | max | business | enterprise | student
  --session-id <id>                Session id to include in output
  --bill-reasoning-tokens          Include reasoning tokens as output-priced cost
  --no-bill-reasoning-tokens       Keep reasoning tokens informational only
  --currency <code>                Display currency, default USD
  --exchange-rate <rate>           USD-to-currency exchange rate override for non-USD display
  --promotional-allowance          Force Business/Enterprise promotional UBB allowances on
  --no-promotional-allowance       Force Business/Enterprise promotional UBB allowances off
  --json                           Print machine-readable JSON
  --version                        Show version
  --help                           Show help
`);
}

function formatAiCreditAllotment(result) {
  const allotment = result.includedAiCreditAllotment ?? {
    baseAiCredits: result.includedAiCredits ?? 0,
    flexAiCredits: 0,
    promotionalAiCredits: 0,
    totalAiCredits: result.includedAiCredits ?? 0
  };
  const components = formatAiCreditAllotmentComponents(allotment);
  if (components.length <= 0) {
    return `${allotment.totalAiCredits}`;
  }
  return `${allotment.totalAiCredits} (${components.join(" + ")})`;
}

function formatAiCreditAllotmentComponents(allotment) {
  const components = [];
  const baseAiCredits = Number(allotment.baseAiCredits ?? 0);
  const flexAiCredits = Number(allotment.flexAiCredits ?? 0);
  const promotionalAiCredits = Number(allotment.promotionalAiCredits ?? 0);
  if (baseAiCredits > 0 && (flexAiCredits > 0 || promotionalAiCredits > 0)) {
    components.push(`${allotment.baseAiCredits} base`);
  }
  if (flexAiCredits > 0) {
    components.push(`${flexAiCredits} flex`);
  }
  if (promotionalAiCredits > 0) {
    components.push(`${promotionalAiCredits} promotional`);
  }
  return components;
}

function readValue(argv, index, flag) {
  const value = argv[index];
  if (!value) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}
