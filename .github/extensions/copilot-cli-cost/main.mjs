import { joinSession } from "@github/copilot-sdk/extension";
import { join, resolve } from "node:path";
import { calculateSessionCost } from "../../../src/core/calculate.js";
import { formatMoney } from "../../../src/core/currency.js";
import { readLatestLiveSession, readLiveSession, writeLiveSession } from "../../../src/core/live-session-store.js";
import { readSessionUsageFromEvents } from "../../../src/core/session-events.js";
import { usageMetricsToSessionUsage } from "../../../src/core/usage-metrics.js";
import { CopilotWebview } from "./lib/copilot-webview.js";

const repoRoot = resolve(import.meta.dirname, "../../..");
let session;
let currentSubscriptionPromise;

const webview = new CopilotWebview({
  callbacks: {
    getCostData: (options) => getPanelData(options),
    log: (message, options) => session?.log(String(message), options)
  },
  contentDir: join(import.meta.dirname, "content"),
  extensionName: "copilot_cost",
  height: 760,
  title: "Copilot Cost",
  width: 1020
});

session = await joinSession({
  commands: [
    {
      name: "cost",
      description: "Show Copilot session cost or manage the cost panel. Examples: /cost, /cost panel on, /cost session <id>",
      handler: handleCostCommand
    }
  ],
  hooks: {
    onSessionEnd: webview.close
  },
  tools: [
    ...webview.tools,
    {
      name: "copilot_cost_get",
      description: "Get deterministic Copilot session cost data from live Copilot SDK usage metrics, statusline cache fallback, or completed session events.",
      parameters: {
        type: "object",
        properties: {
          billingModel: { type: "string", enum: ["usage-based", "premium-requests"] },
          currency: { type: "string", description: "Display currency code, default USD." },
          plan: { type: "string", description: "Plan id, e.g. pro, pro-plus, business, enterprise." },
          sessionId: { type: "string", description: "Session id to read." },
          source: { type: "string", enum: ["live", "live-session", "completed"], description: "Usage source." }
        }
      },
      skipPermission: true,
      handler: async (args = {}) => {
        const data = await getCostData({
          billingModel: args.billingModel,
          currency: args.currency,
          plan: args.plan,
          sessionId: args.sessionId,
          source: args.source ?? (args.sessionId ? "completed" : "live")
        });
        return JSON.stringify(data, null, 2);
      }
    }
  ]
});

async function handleCostCommand(context) {
  const tokens = tokenize(context.args);
  const [verb, subject] = tokens;

  if (verb === "panel") {
    await handlePanelCommand(subject, tokens.slice(2));
    return;
  }

  try {
    const parsed = parseCostArgs(tokens);
    const data = await getCostData(parsed);
    await session.log(formatCostCommandOutput(data));
  } catch (error) {
    await session.log(`Copilot Cost: ${error.message}`, { level: "error" });
  }
}

async function handlePanelCommand(action = "on") {
  if (action === "on" || action === "open" || action === "show") {
    await webview.show();
    await session.log("Copilot Cost panel opened.");
    return;
  }

  if (action === "off" || action === "close") {
    webview.close();
    await session.log("Copilot Cost panel closed.");
    return;
  }

  if (action === "refresh" || action === "reload") {
    await webview.show({ reload: true });
    await session.log("Copilot Cost panel refreshed.");
    return;
  }

  await session.log("Usage: /cost panel on|off|refresh", { level: "warning" });
}

function parseCostArgs(tokens) {
  const parsed = {
    billingModel: undefined,
    currency: undefined,
    plan: undefined,
    sessionId: undefined,
    source: "live"
  };

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    switch (token) {
      case "live":
        parsed.source = "live";
        break;
      case "live-session":
        parsed.source = "live-session";
        parsed.sessionId = readRequiredToken(tokens, ++index, token);
        break;
      case "session":
        parsed.source = "completed";
        parsed.sessionId = readRequiredToken(tokens, ++index, token);
        break;
      case "--billing-model":
        parsed.billingModel = readRequiredToken(tokens, ++index, token);
        break;
      case "--currency":
        parsed.currency = readRequiredToken(tokens, ++index, token);
        break;
      case "--plan":
        parsed.plan = readRequiredToken(tokens, ++index, token);
        break;
      default:
        throw new Error(`Unknown /cost argument: ${token}`);
    }
  }

  return parsed;
}

async function getPanelData(options = {}) {
  return getCostData({ ...options, source: "live" });
}

async function getCostData({
  billingModel,
  currency = process.env.COPILOT_COST_CURRENCY ?? "USD",
  plan,
  sessionId,
  source = "live"
} = {}) {
  const sessionUsage = await readUsage({ sessionId, source });
  const currentSubscription = await getCurrentSubscription();
  const resolvedPlan = plan ?? currentSubscription.plan ?? process.env.COPILOT_COST_PLAN ?? "pro";
  const scenario = {
    billingModel,
    currency,
    exchangeRates: readExchangeRates(currency),
    plan: resolvedPlan,
    promotionalAllowance: process.env.COPILOT_COST_PROMOTIONAL_ALLOWANCE === "true"
  };

  const usageBased = tryCalculate(sessionUsage, {
    ...scenario,
    billingModel: "usage-based"
  });
  const premiumRequests = tryCalculate(sessionUsage, {
    ...scenario,
    billingModel: "premium-requests"
  });

  return {
    generatedAt: new Date().toISOString(),
    currentSubscription,
    repoRoot,
    requestedBillingModel: billingModel,
    sessionUsage,
    source,
    usageBased,
    premiumRequests,
    selected: billingModel === "premium-requests" ? premiumRequests : usageBased
  };
}

async function getCurrentSubscription() {
  const subscription = await (currentSubscriptionPromise ??= readCurrentSubscription());
  const configuredPlan = process.env.COPILOT_COST_PLAN ? mapCopilotPlan(process.env.COPILOT_COST_PLAN) : undefined;
  if (subscription.plan || !configuredPlan) {
    return subscription;
  }
  return {
    ...subscription,
    plan: configuredPlan,
    rawPlan: process.env.COPILOT_COST_PLAN,
    source: "COPILOT_COST_PLAN",
    statusMessage: subscription.statusMessage
  };
}

async function readCurrentSubscription() {
  try {
    const status = await session.rpc.auth.getStatus();
    const mappedPlan = mapCopilotPlan(status.copilotPlan);
    return {
      login: status.login,
      plan: mappedPlan,
      rawPlan: status.copilotPlan,
      statusMessage: status.statusMessage,
      source: "session.rpc.auth.getStatus"
    };
  } catch (error) {
    const configuredPlan = process.env.COPILOT_COST_PLAN;
    return {
      error: error.message,
      plan: configuredPlan ? mapCopilotPlan(configuredPlan) : undefined,
      rawPlan: configuredPlan,
      source: configuredPlan ? "COPILOT_COST_PLAN" : "unavailable"
    };
  }
}

function mapCopilotPlan(plan) {
  const normalized = String(plan ?? "").trim().toLowerCase().replace(/[_\s]+/g, "-");
  if (!normalized) {
    return undefined;
  }
  if (normalized.includes("enterprise")) {
    return "enterprise";
  }
  if (normalized.includes("business")) {
    return "business";
  }
  if (normalized.includes("pro-plus") || normalized.includes("proplus")) {
    return "pro-plus";
  }
  if (normalized.includes("student")) {
    return "student";
  }
  if (normalized.includes("free")) {
    return "free";
  }
  if (normalized.includes("pro")) {
    return "pro";
  }
  return normalized;
}

async function readUsage({ sessionId, source }) {
  if (source === "completed") {
    if (!sessionId) {
      throw new Error("Session id is required for completed-session cost. Usage: /cost session <session-id>");
    }
    return readSessionUsageFromEvents(sessionId);
  }

  if (source === "live-session") {
    if (!sessionId) {
      throw new Error("Session id is required for live-session cost. Usage: /cost live-session <session-id>");
    }
    return readLiveSession(sessionId);
  }

  return readLiveRpcUsageOrFallback();
}

async function readLiveRpcUsageOrFallback() {
  try {
    const metrics = await session.rpc.usage.getMetrics();
    const sessionUsage = usageMetricsToSessionUsage(session.sessionId, metrics);
    writeLiveSession(sessionUsage);
    return sessionUsage;
  } catch (error) {
    try {
      return withFallbackReason(readLiveSession(session.sessionId), error);
    } catch {
      try {
        return withFallbackReason(readLatestLiveSession(), error);
      } catch {
        throw new Error(`Unable to read live usage metrics from usage.getMetrics or statusline cache: ${error.message}`);
      }
    }
  }
}

function withFallbackReason(sessionUsage, error) {
  return {
    ...sessionUsage,
    fallbackReason: `usage.getMetrics unavailable: ${error.message}`
  };
}

function tryCalculate(sessionUsage, scenario) {
  try {
    return calculateSessionCost(sessionUsage, scenario);
  } catch (error) {
    return {
      error: error.message
    };
  }
}

function formatCostCommandOutput(data) {
  const lines = [];
  const sessionId = data.sessionUsage?.sessionId ?? "(unknown)";
  lines.push(`Copilot Cost for session ${sessionId}`);

  if (data.usageBased?.error) {
    lines.push(`Usage-based: unavailable (${data.usageBased.error})`);
  } else if (data.usageBased) {
    lines.push(`Usage-based: ~${formatMoney(data.usageBased.totalUsd, "USD")} (${data.usageBased.aiCredits} AI credits)`);
    lines.push(`Plan allowance: ${data.usageBased.includedAiCredits} AI credits for ${data.usageBased.plan}`);
  }

  if (data.premiumRequests?.error) {
    lines.push(`Premium requests: unavailable (${data.premiumRequests.error})`);
  } else if (data.premiumRequests) {
    lines.push(`Premium requests: ${data.premiumRequests.totalPremiumRequests} PRU (~${formatMoney(data.premiumRequests.overageEquivalentUsd, "USD")} overage-equivalent)`);
    lines.push(`Included monthly PRUs: ${data.premiumRequests.includedPremiumRequests} for ${data.premiumRequests.plan}`);
  }

  lines.push("");
  lines.push("Panel: /cost panel on");
  lines.push("Completed session: /cost session <session-id>");
  return lines.join("\n");
}

function readExchangeRates(currency) {
  const rate = readOptionalNumber(process.env.COPILOT_COST_EXCHANGE_RATE);
  return rate === undefined ? undefined : { [String(currency).toUpperCase()]: rate };
}

function readOptionalNumber(value) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function readRequiredToken(tokens, index, flag) {
  const value = tokens[index];
  if (!value) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function tokenize(value) {
  const tokens = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match;
  while ((match = pattern.exec(value ?? "")) !== null) {
    tokens.push(match[1] ?? match[2] ?? match[3]);
  }
  return tokens;
}
