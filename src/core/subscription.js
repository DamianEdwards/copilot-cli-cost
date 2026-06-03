import fs from "node:fs";
import path from "node:path";
import { getAppCacheDirectory } from "./app-cache-dir.js";

const SUBSCRIPTION_CACHE_FILE = "current-subscription.json";

export function mapCopilotPlan(plan) {
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

export function getCurrentSubscriptionCachePath(options = {}) {
  const env = options.env ?? process.env;
  if (env.COPILOT_COST_SUBSCRIPTION_CACHE) {
    return env.COPILOT_COST_SUBSCRIPTION_CACHE;
  }
  return path.join(getAppCacheDirectory(options), SUBSCRIPTION_CACHE_FILE);
}

export function readCurrentSubscriptionCache(options = {}) {
  const cachePath = getCurrentSubscriptionCachePath(options);
  const raw = fs.readFileSync(cachePath, "utf8").replace(/^\uFEFF/, "");
  const cached = JSON.parse(raw);
  if (!cached || typeof cached !== "object" || Array.isArray(cached)) {
    throw new Error(`Current subscription cache must be a JSON object: ${cachePath}`);
  }

  const plan = mapCopilotPlan(cached.plan ?? cached.rawPlan);
  return {
    ...cached,
    plan,
    source: cached.source ?? "subscription-cache"
  };
}

export function writeCurrentSubscriptionCache(subscription, options = {}) {
  const cachePath = getCurrentSubscriptionCachePath(options);
  const payload = {
    ...subscription,
    plan: mapCopilotPlan(subscription?.plan ?? subscription?.rawPlan),
    cachedAt: new Date(options.now ?? Date.now()).toISOString()
  };
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  fs.writeFileSync(cachePath, `${JSON.stringify(payload, null, 2)}\n`);
  return payload;
}

export function resolveConfiguredPlan(env = process.env) {
  return env.COPILOT_COST_PLAN ? mapCopilotPlan(env.COPILOT_COST_PLAN) : undefined;
}

export function resolveCurrentPlan(options = {}) {
  return resolveCurrentPlanInfo(options).plan;
}

export function resolveCurrentPlanInfo(options = {}) {
  const env = options.env ?? process.env;
  const configuredPlan = resolveConfiguredPlan(env);
  if (configuredPlan) {
    return {
      assumed: false,
      plan: configuredPlan,
      source: "COPILOT_COST_PLAN"
    };
  }
  const subscription = readCurrentSubscriptionCache(options);
  return {
    assumed: false,
    plan: subscription.plan,
    source: subscription.source
  };
}
