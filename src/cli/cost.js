#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { calculateSessionCost } from "../core/calculate.js";
import { formatMoney } from "../core/currency.js";
import { readLatestLiveSession, readLiveSession } from "../core/live-session-store.js";
import { readSessionUsageFromEvents } from "../core/session-events.js";
import { parseStatusLinePayload, statusLinePayloadToSessionUsage } from "../core/statusline-payload.js";

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

main();

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      printHelp();
      return;
    }

    const sessionUsage = readUsage(args);
    const result = calculateSessionCost(sessionUsage, {
      billingModel: args.billingModel,
      plan: args.plan,
      multiplierSet: args.multiplierSet,
      premiumRequests: args.premiumRequests,
      remainingPremiumRequests: args.remainingPremiumRequests,
      currency: args.currency,
      promotionalAllowance: args.promotionalAllowance,
      billReasoningTokens: args.billReasoningTokens,
      exchangeRates: args.exchangeRate
        ? { [String(args.currency ?? "USD").toUpperCase()]: Number(args.exchangeRate) }
        : undefined
    });

    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    printHuman(result);
  } catch (error) {
    console.error(`copilot-cost: ${error.message}`);
    process.exitCode = 1;
  }
}

function parseArgs(argv) {
  const args = {
    billingModel: undefined,
    currency: "USD",
    multiplierSet: "current",
    plan: "pro"
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--billing-model":
        args.billingModel = readValue(argv, ++index, arg);
        break;
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
      case "--no-bill-reasoning-tokens":
        args.billReasoningTokens = false;
        break;
      case "--json":
        args.json = true;
        break;
      case "--multiplier-set":
        args.multiplierSet = readValue(argv, ++index, arg);
        break;
      case "--plan":
        args.plan = readValue(argv, ++index, arg);
        break;
      case "--premium-requests":
        args.premiumRequests = readNumber(readValue(argv, ++index, arg), arg);
        args.billingModel ??= "premium-requests";
        break;
      case "--promotional-allowance":
        args.promotionalAllowance = true;
        break;
      case "--remaining-premium-requests":
        args.remainingPremiumRequests = readNumber(readValue(argv, ++index, arg), arg);
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
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  args.billingModel ??= "usage-based";
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

  if (args.premiumRequests !== undefined && !args.file && !args.sample) {
    return {
      sessionId: args.sessionId,
      premiumRequests: args.premiumRequests
    };
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

function printHuman(result) {
  console.log(`Session: ${result.sessionId ?? "(unknown)"}`);
  console.log(`Plan: ${result.plan}`);
  console.log(`Billing model: ${result.billingModel}`);
  if (result.metricsStale) {
    console.log(`Metrics status: stale as of ${result.metricsTimestamp}; latest event is ${result.latestEventType} at ${result.latestEventTimestamp}`);
  }

  if (result.billingModel === "usage-based") {
    console.log(`Cost: ${formatMoney(result.totalUsd, "USD")} (${formatMoney(result.displayTotal, result.currency.code)})`);
    console.log(`AI credits: ${result.aiCredits}`);
    console.log(`Included monthly credits for plan: ${result.includedAiCredits}`);
    console.log(`Currency rate: USD -> ${result.currency.code} ${result.currency.exchangeRate} (${result.currency.source})`);
    console.log("");
    console.log("Model breakdown:");
    for (const item of result.modelBreakdown) {
      console.log(`- ${item.model}: ${formatMoney(item.totalUsd, "USD")} / ${item.aiCredits} credits (${item.inputTokens} input, ${item.cachedInputTokens} cached, ${item.outputTokens} output, ${item.reasoningTokens} reasoning tokens)`);
    }
    return;
  }

  console.log(`Premium requests: ${result.totalPremiumRequests}`);
  console.log(`Included monthly premium requests for plan: ${result.includedPremiumRequests}`);
  console.log(`Overage-equivalent value: ${formatMoney(result.overageEquivalentUsd, "USD")} (${formatMoney(result.displayOverageEquivalent, result.currency.code)})`);
  console.log(`Premium request overage rate: ${formatMoney(result.premiumRequestUnitUsd, "USD")} per PRU`);
  console.log(`Currency rate: USD -> ${result.currency.code} ${result.currency.exchangeRate} (${result.currency.source})`);
  if (result.remainingPremiumRequestsBeforeSession !== undefined) {
    console.log(`Remaining premium requests before session: ${result.remainingPremiumRequestsBeforeSession}`);
    console.log(`Billable premium requests from this session: ${result.billablePremiumRequests}`);
    console.log(`Estimated incremental charge: ${formatMoney(result.billableUsd, "USD")} (${formatMoney(result.displayBillable, result.currency.code)})`);
  } else {
    console.log("Estimated incremental charge: unknown without remaining monthly allowance before this session");
  }
  console.log(`Multiplier set: ${result.multiplierSet}`);
  if (result.modelBreakdown.length > 0) {
    console.log("");
    console.log("Model breakdown:");
    for (const item of result.modelBreakdown) {
      console.log(`- ${item.model}: ${item.requests} requests x ${item.multiplier} = ${item.premiumRequests} PRUs`);
    }
  }
}

function printHelp() {
  console.log(`Usage: copilot-cost --file <usage.json> [options]
       copilot-cost --premium-requests <count> [options]
       copilot-cost --live [options]

Options:
  --sample                         Use fixtures/session-usage.sample.json
  --session <id>                   Read actual counters from ~/.copilot session events
  --live                           Read latest live snapshot captured by the statusline bridge
  --live-session <id>              Read a specific live statusline snapshot
  --statusline-payload <file>      Read a raw Copilot CLI statusline JSON payload
  --copilot-home <path>            Override Copilot home when using --session
  --billing-model <model>          usage-based | premium-requests
  --plan <plan>                    free | pro | pro-plus | business | enterprise | student
  --premium-requests <count>       Calculate from an already-multiplied PRU count
  --remaining-premium-requests <n> Monthly PRUs remaining before this session
  --session-id <id>                Session id to include in output
  --no-bill-reasoning-tokens       Do not include reasoning tokens as output-token cost
  --currency <code>                Display currency, default USD
  --exchange-rate <rate>           USD-to-currency exchange rate for non-USD display
  --multiplier-set <set>           current | annual-after-2026-06-01
  --promotional-allowance          Use Business/Enterprise promotional UBB allowance
  --json                           Print machine-readable JSON
  --help                           Show help
`);
}

function readValue(argv, index, flag) {
  const value = argv[index];
  if (!value) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function readNumber(value, flag) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${flag} requires a non-negative number.`);
  }
  return parsed;
}

