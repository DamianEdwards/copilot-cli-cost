#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { calculateSessionCost } from "../core/calculate.js";
import { getAppCacheDirectory } from "../core/app-cache-dir.js";
import { formatMoney } from "../core/currency.js";
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
    const usageBased = tryCalculate(sessionUsage, "usage-based");
    const premiumRequests = tryCalculate(sessionUsage, "premium-requests");
    const costLine = args.hideCost
      ? ""
      : formatStatusLine(usageBased, premiumRequests, sessionUsage);
    const passthroughInput = JSON.stringify(buildEnrichedPayload(payload, {
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

function tryCalculate(sessionUsage, billingModel) {
  try {
    return calculateSessionCost(sessionUsage, {
      billingModel,
      plan: process.env.COPILOT_COST_PLAN ?? "pro",
      currency: process.env.COPILOT_COST_CURRENCY ?? "USD",
      exchangeRates: readExchangeRates(),
      promotionalAllowance: process.env.COPILOT_COST_PROMOTIONAL_ALLOWANCE === "true",
      remainingPremiumRequests: readNumber(process.env.COPILOT_COST_REMAINING_PREMIUM_REQUESTS),
      billReasoningTokens: process.env.COPILOT_COST_BILL_REASONING_TOKENS !== "false"
    });
  } catch (error) {
    logDebugError(`failed to calculate ${billingModel} statusline cost`, error);
    return null;
  }
}

function formatStatusLine(usageBased, premiumRequests, sessionUsage) {
  const parts = [];
  if (usageBased) {
    parts.push(`${green(`~${formatMoney(usageBased.displayTotal, usageBased.currency.code)}`)} ${dim(`(${round(usageBased.aiCredits)} cr)`)}`);
  }
  if (premiumRequests) {
    parts.push(yellow(`${premiumRequests.totalPremiumRequests} PRU`));
  } else if (sessionUsage.premiumRequests !== undefined) {
    parts.push(yellow(`${sessionUsage.premiumRequests} PRU`));
  }
  if (sessionUsage.lastCallInputTokens !== undefined || sessionUsage.lastCallOutputTokens !== undefined) {
    parts.push(dim(`last ${compact(sessionUsage.lastCallInputTokens ?? 0)} in/${compact(sessionUsage.lastCallOutputTokens ?? 0)} out`));
  }

  return parts.length > 0 ? `${magenta("💸 Cost")} ${parts.join(dim(" · "))}` : "";
}

function buildEnrichedPayload(payload, { costLine, premiumRequests, sessionUsage, usageBased }) {
  return {
    ...payload,
    copilot_cost: {
      schema_version: 1,
      status_line: costLine,
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

function readExchangeRates() {
  const code = String(process.env.COPILOT_COST_CURRENCY ?? "USD").toUpperCase();
  const rate = readNumber(process.env.COPILOT_COST_EXCHANGE_RATE);
  return rate === undefined ? undefined : { [code]: rate };
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
