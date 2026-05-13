import { joinSession } from "@github/copilot-sdk/extension";
import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { calculateSessionCost } from "../../../src/core/calculate.js";
import { formatMoney } from "../../../src/core/currency.js";
import { getUsdExchangeRate } from "../../../src/core/fx-rates.js";
import { listLiveSessions, readLatestLiveSession, readLiveSession, writeLiveSession } from "../../../src/core/live-session-store.js";
import { listCompletedSessionSummaries, readSessionUsageFromEvents, readSessionWorkspaceMetadata } from "../../../src/core/session-events.js";
import { usageMetricsToSessionUsage } from "../../../src/core/usage-metrics.js";
import { CopilotWebview } from "./lib/copilot-webview.js";

const repoRoot = resolve(import.meta.dirname, "../../..");
let session;
let currentSubscriptionPromise;

const webview = new CopilotWebview({
  callbacks: {
    getCostData: (options) => getPanelData(options),
    listSessions: () => listPanelSessions(),
    log: (message, options) => session?.log(String(message), options),
    openExternal: (url) => openExternal(url)
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
          plan: { type: "string", description: "Plan id, e.g. pro, pro-plus, max, business, enterprise." },
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

  if (verb === "help" || verb === "-h" || verb === "--help") {
    await session.log(formatCostHelp());
    return;
  }

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

function formatCostHelp() {
  return [
    "Copilot Cost usage",
    "",
    "/cost",
    "/cost panel on|off|refresh",
    "/cost session <session-id>",
    "/cost live-session <session-id>",
    "/cost --plan pro|pro-plus|max|business|enterprise",
    "/cost --billing-model usage-based|premium-requests",
    "/cost --currency USD"
  ].join("\n");
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
  return getCostData({ ...options, source: options.source ?? "live" });
}

async function listPanelSessions() {
  const currentSessionId = session.sessionId;
  const currentMetadata = readSessionWorkspaceMetadataSafe(currentSessionId);
  const current = {
    source: "live",
    sessionId: currentSessionId,
    sessionName: currentMetadata.sessionName ?? "Current session",
    workspaceDirectory: currentMetadata.workspaceDirectory,
    repository: currentMetadata.repository,
    branch: currentMetadata.branch,
    isCurrent: true,
    updatedAt: new Date().toISOString()
  };
  const liveSessions = listLiveSessions()
    .filter((item) => item.sessionId !== currentSessionId)
    .map((item) => withWorkspaceMetadata(item));
  const completedSessions = listCompletedSessionSummaries({ limit: 200 });

  return {
    currentSessionId,
    generatedAt: new Date().toISOString(),
    sessions: [current, ...liveSessions, ...completedSessions]
  };
}

function withWorkspaceMetadata(item) {
  const metadata = readSessionWorkspaceMetadataSafe(item.sessionId);
  return {
    ...item,
    sessionName: metadata.sessionName ?? item.sessionName,
    workspaceDirectory: metadata.workspaceDirectory ?? item.workspaceDirectory,
    repository: metadata.repository ?? item.repository,
    branch: metadata.branch ?? item.branch
  };
}

function readSessionWorkspaceMetadataSafe(sessionId) {
  try {
    return readSessionWorkspaceMetadata(sessionId);
  } catch {
    return {};
  }
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
  const exchangeRate = await resolveExchangeRate(currency);
  const scenario = {
    billingModel,
    currency,
    exchangeRateMetadata: exchangeRate.metadata,
    exchangeRates: exchangeRate.exchangeRates,
    billReasoningTokens: process.env.COPILOT_COST_BILL_REASONING_TOKENS === "true",
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
    exchangeRate: exchangeRate.rateInfo,
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
  if (normalized.includes("pro+") || normalized.includes("pro-plus") || normalized.includes("proplus")) {
    return "pro-plus";
  }
  if (normalized.includes("max")) {
    return "max";
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

function openExternal(url) {
  const target = new URL(String(url));
  if (target.protocol !== "https:" && target.protocol !== "http:") {
    throw new Error(`Unsupported external URL protocol: ${target.protocol}`);
  }

  const href = target.href;
  if (process.platform === "win32") {
    spawn("cmd", ["/c", "start", "", href], {
      detached: true,
      stdio: "ignore",
      windowsHide: true
    }).unref();
    return;
  }

  const command = process.platform === "darwin" ? "open" : "xdg-open";
  spawn(command, [href], {
    detached: true,
    stdio: "ignore"
  }).unref();
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
    lines.push(`Usage-based estimate: ${formatMoney(data.usageBased.totalUsd, "USD")} (${data.usageBased.aiCredits} AI credits)`);
    lines.push(`Plan allowance: ${formatAiCreditAllotment(data.usageBased)} for ${data.usageBased.plan}`);
  }

  if (data.premiumRequests?.error) {
    lines.push(`Premium requests: unavailable (${data.premiumRequests.error})`);
  } else if (data.premiumRequests) {
    lines.push(`Premium requests: ${data.premiumRequests.totalPremiumRequests} PRU (${formatMoney(data.premiumRequests.overageEquivalentUsd, "USD")} overage-equivalent)`);
    lines.push(`Included monthly PRUs: ${data.premiumRequests.includedPremiumRequests} for ${data.premiumRequests.plan}`);
  }

  lines.push("");
  lines.push("Panel: /cost panel on");
  lines.push("Completed session: /cost session <session-id>");
  return lines.join("\n");
}

function formatAiCreditAllotment(usageBased) {
  const allotment = usageBased.includedAiCreditAllotment ?? {
    baseAiCredits: usageBased.includedAiCredits ?? 0,
    flexAiCredits: 0,
    totalAiCredits: usageBased.includedAiCredits ?? 0
  };
  const flexAiCredits = Number(allotment.flexAiCredits ?? 0);
  if (flexAiCredits <= 0) {
    return `${allotment.totalAiCredits} AI credits`;
  }
  return `${allotment.totalAiCredits} AI credits (${allotment.baseAiCredits} base + ${flexAiCredits} flex)`;
}

async function resolveExchangeRate(currency) {
  const code = String(currency ?? "USD").toUpperCase();
  if (code === "USD") {
    return {
      exchangeRates: undefined,
      metadata: undefined,
      rateInfo: {
        base: "USD",
        quote: "USD",
        rate: 1,
        source: "native-usd"
      }
    };
  }

  const envRateName = `COPILOT_COST_FX_${code}`;
  const rate = readOptionalNumber(process.env[envRateName] ?? process.env.COPILOT_COST_EXCHANGE_RATE);
  if (rate !== undefined) {
    const rateInfo = {
      base: "USD",
      quote: code,
      rate,
      source: process.env[envRateName] ? envRateName : "COPILOT_COST_EXCHANGE_RATE"
    };
    return {
      exchangeRates: { [code]: rate },
      metadata: { [code]: rateInfo },
      rateInfo
    };
  }

  const rateInfo = await getUsdExchangeRate(code);
  return {
    exchangeRates: { [code]: rateInfo.rate },
    metadata: { [code]: rateInfo },
    rateInfo
  };
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
