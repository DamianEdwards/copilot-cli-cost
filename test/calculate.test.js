import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { getAppCacheDirectory } from "../src/core/app-cache-dir.js";
import { calculateSessionCost } from "../src/core/calculate.js";
import { getFxRateCacheDirectory, getUsdExchangeRate } from "../src/core/fx-rates.js";
import { getLiveSessionStoreDirectory, listLiveSessions, readLiveSession, writeLiveSession } from "../src/core/live-session-store.js";
import { listCompletedSessionSummaries, readRichestSessionUsageFromEvents, readSessionUsageFromEvents, readSessionWorkspaceMetadata } from "../src/core/session-events.js";
import { mergeStatusLinePayload, statusLinePayloadToSessionUsage } from "../src/core/statusline-payload.js";
import { writeCurrentSubscriptionCache } from "../src/core/subscription.js";
import { mergeResumedSessionUsage, usageMetricsToSessionUsage } from "../src/core/usage-metrics.js";

const sessionUsage = {
  sessionId: "test-session",
  modelUsage: [
    {
      model: "gpt-5.5",
      requests: 2,
      inputTokens: 1_000_000,
      cachedInputTokens: 1_000_000,
      outputTokens: 1_000_000
    },
    {
      model: "claude-sonnet-4.6",
      requests: 1,
      inputTokens: 1_000_000,
      cachedInputTokens: 1_000_000,
      cacheWriteTokens: 1_000_000,
      outputTokens: 1_000_000
    }
  ]
};

test("calculates usage-based billing from token buckets", () => {
  const result = calculateSessionCost(sessionUsage, {
    billingModel: "usage-based",
    plan: "pro",
    currency: "USD"
  });

  assert.equal(result.totalUsd, 49.55);
  assert.equal(result.aiCredits, 4955);
  assert.equal(result.includedAiCredits, 1500);
  assert.equal(result.allowanceUsagePercentage, 330.333333);
  assert.deepEqual(result.includedAiCreditAllotment, {
    baseAiCredits: 1000,
    flexAiCredits: 500,
    totalAiCredits: 1500
  });
  assert.equal(result.modelBreakdown.length, 2);
  assert.deepEqual(result.modelBreakdown[0].rates, {
    inputPerMillionUsd: 5,
    cachedInputPerMillionUsd: 0.5,
    cacheWritePerMillionUsd: 0,
    outputPerMillionUsd: 30,
    reasoningPerMillionUsd: 0
  });
  assert.equal(result.modelBreakdown[0].uncachedInputTokens, 0);
  assert.equal(result.modelBreakdown[0].inputUsd, 0);
  assert.equal(result.modelBreakdown[0].cachedInputUsd, 0.5);
  assert.equal(result.modelBreakdown[0].outputUsd, 30);
});

test("calculates usage-based allowances with individual flex allotments", () => {
  const proPlus = calculateSessionCost(sessionUsage, {
    billingModel: "usage-based",
    plan: "pro+",
    currency: "USD"
  });
  const max = calculateSessionCost(sessionUsage, {
    billingModel: "usage-based",
    plan: "Copilot Max",
    currency: "USD"
  });
  const free = calculateSessionCost(sessionUsage, {
    billingModel: "usage-based",
    plan: "free",
    currency: "USD"
  });

  assert.equal(proPlus.plan, "pro-plus");
  assert.equal(proPlus.includedAiCredits, 7000);
  assert.deepEqual(proPlus.includedAiCreditAllotment, {
    baseAiCredits: 3900,
    flexAiCredits: 3100,
    totalAiCredits: 7000
  });
  assert.equal(max.plan, "max");
  assert.equal(max.includedAiCredits, 20000);
  assert.deepEqual(max.includedAiCreditAllotment, {
    baseAiCredits: 10000,
    flexAiCredits: 10000,
    totalAiCredits: 20000
  });
  assert.equal(free.includedAiCredits, 0);
  assert.equal(free.allowanceUsagePercentage, null);
});

test("calculates usage-based input billing from uncached input tokens", () => {
  const result = calculateSessionCost(
    {
      sessionId: "uncached-input-session",
      modelUsage: [
        {
          model: "gpt-5.5",
          inputTokens: 1_000_000,
          cachedInputTokens: 400_000
        }
      ]
    },
    {
      billingModel: "usage-based",
      currency: "USD"
    }
  );

  assert.equal(result.modelBreakdown[0].inputTokens, 1_000_000);
  assert.equal(result.modelBreakdown[0].uncachedInputTokens, 600_000);
  assert.equal(result.modelBreakdown[0].inputUsd, 3);
  assert.equal(result.modelBreakdown[0].cachedInputUsd, 0.2);
  assert.equal(result.totalUsd, 3.2);
});

test("keeps reasoning tokens informational unless explicitly billed", () => {
  const usage = {
    sessionId: "reasoning-token-session",
    modelUsage: [
      {
        model: "gpt-5.4",
        inputTokens: 2_034_655,
        cachedInputTokens: 1_883_264,
        outputTokens: 18_049,
        reasoningTokens: 7_280
      }
    ]
  };

  const defaultResult = calculateSessionCost(usage, {
    billingModel: "usage-based",
    currency: "USD"
  });
  const optInResult = calculateSessionCost(usage, {
    billingModel: "usage-based",
    billReasoningTokens: true,
    currency: "USD"
  });

  assert.equal(defaultResult.modelBreakdown[0].uncachedInputTokens, 151_391);
  assert.equal(defaultResult.modelBreakdown[0].reasoningUsd, 0);
  assert.equal(defaultResult.modelBreakdown[0].rates.reasoningPerMillionUsd, 0);
  assert.equal(defaultResult.totalUsd, 1.120029);
  assert.equal(optInResult.modelBreakdown[0].reasoningUsd, 0.1092);
  assert.equal(optInResult.modelBreakdown[0].rates.reasoningPerMillionUsd, 15);
  assert.equal(optInResult.totalUsd, 1.229229);
});

test("calculates zero usage when model usage is not available yet", () => {
  const result = calculateSessionCost(
    {
      sessionId: "new-session",
      source: "copilot-cli-rpc-usage",
      premiumRequests: 0
    },
    {
      billingModel: "usage-based",
      plan: "pro",
      currency: "USD"
    }
  );

  assert.equal(result.totalUsd, 0);
  assert.equal(result.displayTotal, 0);
  assert.equal(result.aiCredits, 0);
  assert.deepEqual(result.modelBreakdown, []);
});

test("normalizes empty usage.getMetrics responses as zero usage", () => {
  const usage = usageMetricsToSessionUsage("new-rpc-session", {
    totalPremiumRequestCost: 0,
    totalUserRequests: 0,
    totalApiDurationMs: 0
  });

  assert.equal(usage.sessionId, "new-rpc-session");
  assert.equal(usage.premiumRequests, 0);
  assert.deepEqual(usage.modelUsage, []);
});

test("calculates premium request billing from model multipliers", () => {
  const result = calculateSessionCost(sessionUsage, {
    billingModel: "premium-requests",
    plan: "pro-plus",
    multiplierSet: "current"
  });

  assert.equal(result.totalPremiumRequests, 16);
  assert.equal(result.includedPremiumRequests, 1500);
  assert.equal(result.allowanceUsagePercentage, 1.066667);
});

test("calculates premium request billing from direct PRU count", () => {
  const result = calculateSessionCost(
    {
      sessionId: "direct-pru-session",
      premiumRequests: 12.5
    },
    {
      billingModel: "premium-requests",
      plan: "pro",
      remainingPremiumRequests: 10,
      currency: "EUR",
      exchangeRates: {
        EUR: 0.9
      }
    }
  );

  assert.equal(result.source, "direct-premium-requests");
  assert.equal(result.totalPremiumRequests, 12.5);
  assert.equal(result.allowanceUsagePercentage, 4.166667);
  assert.equal(result.overageEquivalentUsd, 0.5);
  assert.equal(result.displayOverageEquivalent, 0.45);
  assert.equal(result.billablePremiumRequests, 2.5);
  assert.equal(result.billableUsd, 0.1);
  assert.equal(result.displayBillable, 0.09);
});

test("supports non-USD display currency with explicit exchange rate", () => {
  const result = calculateSessionCost(sessionUsage, {
    billingModel: "usage-based",
    plan: "enterprise",
    currency: "EUR",
    exchangeRates: {
      EUR: 0.9
    }
  });

  assert.equal(result.currency.code, "EUR");
  assert.equal(result.displayTotal, 44.595);
});

test("carries exchange-rate metadata into calculation output", () => {
  const result = calculateSessionCost(sessionUsage, {
    billingModel: "usage-based",
    plan: "enterprise",
    currency: "EUR",
    exchangeRateMetadata: {
      EUR: {
        date: "2026-05-06",
        fetchedAt: "2026-05-06T12:00:00.000Z",
        source: "frankfurter",
        url: "https://api.frankfurter.dev/v2/rate/USD/EUR"
      }
    },
    exchangeRates: {
      EUR: 0.9
    }
  });

  assert.equal(result.currency.code, "EUR");
  assert.equal(result.currency.source, "frankfurter");
  assert.equal(result.currency.date, "2026-05-06");
  assert.equal(result.currency.url, "https://api.frankfurter.dev/v2/rate/USD/EUR");
});

test("resolves platform-specific cache directories", () => {
  assert.equal(
    getAppCacheDirectory({
      env: { LOCALAPPDATA: "C:\\Users\\alex\\AppData\\Local" },
      homeDirectory: "C:\\Users\\alex",
      platform: "win32"
    }),
    "C:\\Users\\alex\\AppData\\Local\\copilot-cli-cost"
  );
  assert.equal(
    getAppCacheDirectory({
      env: { LOCALAPPDATA: "C:\\Temp\\LocalAppData" },
      homeDirectory: "/home/alex",
      platform: "linux"
    }),
    "/home/alex/.cache/copilot-cli-cost"
  );
  assert.equal(
    getAppCacheDirectory({
      env: {},
      homeDirectory: "/Users/alex",
      platform: "darwin"
    }),
    "/Users/alex/Library/Caches/copilot-cli-cost"
  );
  assert.equal(
    getAppCacheDirectory({
      env: { XDG_CACHE_HOME: "/var/cache/alex" },
      homeDirectory: "/home/alex",
      platform: "linux"
    }),
    "/var/cache/alex/copilot-cli-cost"
  );
});

test("uses app cache defaults for live sessions and fx rates", () => {
  const options = {
    env: {},
    homeDirectory: "/home/alex",
    platform: "linux"
  };

  assert.equal(getLiveSessionStoreDirectory(options), "/home/alex/.cache/copilot-cli-cost/live-sessions");
  assert.equal(getFxRateCacheDirectory(options), "/home/alex/.cache/copilot-cli-cost/fx-rates");
});

test("preserves app-specific cache overrides", () => {
  assert.equal(
    getLiveSessionStoreDirectory({
      env: {
        COPILOT_COST_LIVE_STORE: "/tmp/copilot-live",
        LOCALAPPDATA: "C:\\Temp\\LocalAppData"
      },
      homeDirectory: "/home/alex",
      platform: "linux"
    }),
    "/tmp/copilot-live"
  );
  assert.equal(
    getFxRateCacheDirectory({
      env: {
        COPILOT_COST_FX_CACHE: "/tmp/copilot-fx",
        XDG_CACHE_HOME: "/tmp/xdg-cache"
      },
      homeDirectory: "/home/alex",
      platform: "linux"
    }),
    "/tmp/copilot-fx"
  );
});

test("fetches and caches Frankfurter USD exchange rates", async () => {
  const storeDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "copilot-cost-fx-test-"));
  let fetchCount = 0;
  const fetchImpl = async (url) => {
    fetchCount += 1;
    assert.equal(url, "https://api.frankfurter.dev/v2/rate/USD/EUR");
    return {
      ok: true,
      status: 200,
      json: async () => ({
        date: "2026-05-06",
        rate: 0.88
      })
    };
  };

  try {
    const first = await getUsdExchangeRate("eur", {
      cacheDirectory: storeDirectory,
      fetchImpl,
      now: Date.parse("2026-05-06T12:00:00.000Z")
    });
    const second = await getUsdExchangeRate("EUR", {
      cacheDirectory: storeDirectory,
      fetchImpl,
      now: Date.parse("2026-05-06T12:05:00.000Z")
    });

    assert.equal(first.source, "frankfurter");
    assert.equal(first.rate, 0.88);
    assert.equal(second.source, "frankfurter-cache");
    assert.equal(second.rate, 0.88);
    assert.equal(fetchCount, 1);
  } finally {
    fs.rmSync(storeDirectory, { force: true, recursive: true });
  }
});

test("accepts Frankfurter latest-style rate payloads", async () => {
  const storeDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "copilot-cost-fx-test-"));
  try {
    const rate = await getUsdExchangeRate("GBP", {
      cacheDirectory: storeDirectory,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          date: "2026-05-06",
          rates: {
            GBP: 0.75
          }
        })
      }),
      now: Date.parse("2026-05-06T12:00:00.000Z")
    });

    assert.equal(rate.quote, "GBP");
    assert.equal(rate.rate, 0.75);
  } finally {
    fs.rmSync(storeDirectory, { force: true, recursive: true });
  }
});

test("uses stale cached exchange rates when Frankfurter is unavailable", async () => {
  const storeDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "copilot-cost-fx-test-"));
  try {
    const first = await getUsdExchangeRate("EUR", {
      cacheDirectory: storeDirectory,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          date: "2026-05-06",
          rate: 0.88
        })
      }),
      now: Date.parse("2026-05-06T12:00:00.000Z")
    });
    const stale = await getUsdExchangeRate("EUR", {
      cacheDirectory: storeDirectory,
      fetchImpl: async () => {
        throw new Error("network unavailable");
      },
      now: Date.parse("2026-05-08T12:00:00.000Z")
    });

    assert.equal(first.source, "frankfurter");
    assert.equal(stale.source, "frankfurter-cache-stale");
    assert.equal(stale.rate, 0.88);
    assert.equal(stale.stale, true);
    assert.equal(stale.error, "network unavailable");
  } finally {
    fs.rmSync(storeDirectory, { force: true, recursive: true });
  }
});

test("reads Copilot CLI session shutdown metrics from events jsonl", () => {
  const usage = readSessionUsageFromEvents("sample-session", {
    eventsPath: new URL("../fixtures/events.sample.jsonl", import.meta.url)
  });

  assert.equal(usage.source, "copilot-cli-events");
  assert.equal(usage.metricsEventType, "session.shutdown");
  assert.equal(usage.metricsStale, false);
  assert.equal(usage.premiumRequests, 7.5);
  assert.equal(usage.modelUsage[0].model, "gpt-5.5");
  assert.equal(usage.modelUsage[0].inputTokens, 135659);
  assert.equal(usage.modelUsage[0].cachedInputTokens, 91648);
  assert.equal(usage.modelUsage[0].outputTokens, 1333);
  assert.equal(usage.modelUsage[0].reasoningTokens, 335);
});

test("lists live session snapshots with searchable metadata", () => {
  const storeDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "copilot-cost-live-list-test-"));
  try {
    writeLiveSession(
      {
        sessionId: "live-session-a",
        sessionName: "Estimate panel cost",
        source: "copilot-cli-statusline",
        timestamp: "2026-05-06T12:00:00.000Z",
        metricsTimestamp: "2026-05-06T12:00:00.000Z",
        workspaceDirectory: "D:\\TEST"
      },
      { storeDirectory }
    );
    writeLiveSession(
      {
        sessionId: "live-session-b",
        source: "copilot-cli-rpc-usage",
        timestamp: "2026-05-06T12:05:00.000Z",
        metricsTimestamp: "2026-05-06T12:05:00.000Z"
      },
      { storeDirectory }
    );

    const sessions = listLiveSessions({ storeDirectory });

    assert.equal(sessions.length, 2);
    assert.equal(sessions[0].sessionId, "live-session-b");
    assert.equal(sessions[1].sessionName, "Estimate panel cost");
    assert.equal(sessions[1].workspaceDirectory, "D:\\TEST");
    assert.equal(sessions.some((item) => item.sessionId === "latest"), false);
  } finally {
    fs.rmSync(storeDirectory, { force: true, recursive: true });
  }
});

test("lists completed sessions that have cost metrics", () => {
  const copilotHome = fs.mkdtempSync(path.join(os.tmpdir(), "copilot-cost-events-list-test-"));
  try {
    const sessionDirectory = path.join(copilotHome, "session-state", "completed-session");
    fs.mkdirSync(sessionDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(sessionDirectory, "workspace.yaml"),
      [
        "id: completed-session",
        "cwd: D:\\WORK",
        "repository: DamianEdwards/copilot-cli-cost",
        "branch: damianedwards/issue-14-session-picker",
        "name: Resume Summary Name",
        "created_at: 2026-05-06T11:58:00.000Z",
        "updated_at: 2026-05-06T12:02:00.000Z"
      ].join("\n")
    );
    fs.writeFileSync(
      path.join(sessionDirectory, "events.jsonl"),
      [
        JSON.stringify({
          type: "session.start",
          timestamp: "2026-05-06T11:59:00.000Z",
          data: {
            sessionName: "Compare historical cost",
            workspaceDirectory: "D:\\WORK"
          }
        }),
        JSON.stringify({
          type: "session.shutdown",
          timestamp: "2026-05-06T12:00:00.000Z",
          data: {
            currentModel: "gpt-5.5",
            totalPremiumRequests: 7.5,
            modelMetrics: {
              "gpt-5.5": {
                requests: { count: 1, cost: 7.5 },
                usage: {
                  inputTokens: 135659,
                  cacheReadTokens: 91648,
                  outputTokens: 1333
                }
              }
            }
          }
        })
      ].join("\n")
    );

    const ignoredDirectory = path.join(copilotHome, "session-state", "no-metrics-session");
    fs.mkdirSync(ignoredDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(ignoredDirectory, "events.jsonl"),
      `${JSON.stringify({ type: "session.start", timestamp: "2026-05-06T12:01:00.000Z" })}\n`
    );

    const sessions = listCompletedSessionSummaries({ copilotHome });

    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].source, "completed");
    assert.equal(sessions[0].sessionId, "completed-session");
    assert.equal(sessions[0].sessionName, "Resume Summary Name");
    assert.equal(sessions[0].workspaceDirectory, "D:\\WORK");
    assert.equal(sessions[0].repository, "DamianEdwards/copilot-cli-cost");
    assert.equal(sessions[0].branch, "damianedwards/issue-14-session-picker");
    assert.equal(sessions[0].updatedAt, "2026-05-06T12:00:00.000Z");
  } finally {
    fs.rmSync(copilotHome, { force: true, recursive: true });
  }
});

test("reads Copilot resume summary names from workspace metadata", () => {
  const copilotHome = fs.mkdtempSync(path.join(os.tmpdir(), "copilot-cost-workspace-metadata-test-"));
  try {
    const sessionDirectory = path.join(copilotHome, "session-state", "metadata-session");
    fs.mkdirSync(sessionDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(sessionDirectory, "workspace.yaml"),
      [
        "id: metadata-session",
        "cwd: D:\\src\\repo",
        "git_root: D:\\src\\repo",
        "repository: DamianEdwards/copilot-cli-cost",
        "branch: damianedwards/test",
        "name: Issue 14 review",
        "user_named: true",
        "created_at: 2026-05-13T20:16:40.094Z",
        "updated_at: 2026-05-13T20:16:51.761Z"
      ].join("\n")
    );

    const metadata = readSessionWorkspaceMetadata("metadata-session", { copilotHome });

    assert.equal(metadata.sessionName, "Issue 14 review");
    assert.equal(metadata.workspaceDirectory, "D:\\src\\repo");
    assert.equal(metadata.repository, "DamianEdwards/copilot-cli-cost");
    assert.equal(metadata.branch, "damianedwards/test");
  } finally {
    fs.rmSync(copilotHome, { force: true, recursive: true });
  }
});

test("calculates usage-based billing from Copilot CLI event metrics", () => {
  const usage = readSessionUsageFromEvents("sample-session", {
    eventsPath: new URL("../fixtures/events.sample.jsonl", import.meta.url)
  });
  const result = calculateSessionCost(usage, {
    billingModel: "usage-based",
    plan: "pro"
  });

  assert.equal(result.totalUsd, 0.305869);
  assert.equal(result.modelBreakdown[0].uncachedInputTokens, 44011);
  assert.equal(result.modelBreakdown[0].inputUsd, 0.220055);
  assert.equal(result.modelBreakdown[0].reasoningUsd, 0);
});

test("can read richest Copilot CLI event metrics when later resume metrics reset", () => {
  const storeDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "copilot-cost-test-"));
  const eventsPath = path.join(storeDirectory, "events.jsonl");
  try {
    fs.writeFileSync(eventsPath, [
      JSON.stringify({
        type: "session.shutdown",
        timestamp: "2026-05-13T18:00:00.000Z",
        data: {
          totalPremiumRequests: 7.5,
          currentModel: "gpt-5.5",
          modelMetrics: {
            "gpt-5.5": {
              requests: { count: 1, cost: 7.5 },
              usage: {
                inputTokens: 1000,
                cacheReadTokens: 750,
                outputTokens: 100
              }
            }
          }
        }
      }),
      JSON.stringify({
        type: "session.shutdown",
        timestamp: "2026-05-13T20:00:00.000Z",
        data: {
          totalPremiumRequests: 0,
          currentModel: "gpt-5.5",
          modelMetrics: {}
        }
      })
    ].join("\n"));

    const latest = readSessionUsageFromEvents("resumed-events", { eventsPath });
    const richest = readRichestSessionUsageFromEvents("resumed-events", { eventsPath });

    assert.equal(latest.modelUsage.length, 0);
    assert.equal(latest.premiumRequests, 0);
    assert.equal(richest.modelUsage[0].inputTokens, 1000);
    assert.equal(richest.premiumRequests, 7.5);
    assert.equal(richest.metricsStale, true);
  } finally {
    fs.rmSync(storeDirectory, { force: true, recursive: true });
  }
});

test("normalizes Copilot CLI statusline payloads", () => {
  const payload = readFixture("statusline-payload.sample.json");
  const usage = statusLinePayloadToSessionUsage(payload);

  assert.equal(usage.source, "copilot-cli-statusline");
  assert.equal(usage.sessionId, "statusline-sample-session");
  assert.equal(usage.premiumRequests, 7.5);
  assert.equal(usage.modelUsage[0].model, "gpt-5.5");
  assert.equal(usage.modelUsage[0].inputTokens, 135659);
  assert.equal(usage.modelUsage[0].cachedInputTokens, 91648);
  assert.equal(usage.modelUsage[0].cacheWriteTokens, 12000);
  assert.equal(usage.modelUsage[0].outputTokens, 1333);
  assert.equal(usage.modelUsage[0].reasoningTokens, 335);
});

test("normalizes Copilot CLI usage.getMetrics results", () => {
  const usage = usageMetricsToSessionUsage("rpc-session", {
    totalPremiumRequestCost: 7.5,
    totalUserRequests: 1,
    totalApiDurationMs: 1234,
    currentModel: "gpt-5.5",
    lastCallInputTokens: 42,
    lastCallOutputTokens: 24,
    codeChanges: {
      filesModifiedCount: 2,
      linesAdded: 10,
      linesRemoved: 3
    },
    modelMetrics: {
      "gpt-5.5": {
        requests: { count: 1, cost: 7.5 },
        usage: {
          inputTokens: 135659,
          outputTokens: 1333,
          cacheReadTokens: 91648,
          cacheWriteTokens: 12000,
          reasoningTokens: 335
        }
      }
    }
  });

  assert.equal(usage.source, "copilot-cli-rpc-usage");
  assert.equal(usage.metricsEventType, "usage.getMetrics");
  assert.equal(usage.premiumRequests, 7.5);
  assert.equal(usage.lastCallInputTokens, 42);
  assert.equal(usage.modelUsage[0].model, "gpt-5.5");
  assert.equal(usage.modelUsage[0].inputTokens, 135659);
  assert.equal(usage.modelUsage[0].cachedInputTokens, 91648);
  assert.equal(usage.modelUsage[0].cacheWriteTokens, 12000);
  assert.equal(usage.modelUsage[0].outputTokens, 1333);
  assert.equal(usage.modelUsage[0].reasoningTokens, 335);
});

test("preserves prior usage when live RPC counters reset after resume", () => {
  const previous = {
    sessionId: "resumed-rpc-session",
    source: "copilot-cli-statusline",
    timestamp: "2026-05-13T18:00:00.000Z",
    premiumRequests: 7.5,
    modelUsage: [
      {
        model: "gpt-5.5",
        inputTokens: 135659,
        cachedInputTokens: 91648,
        cacheWriteTokens: 12000,
        outputTokens: 1333,
        reasoningTokens: 335
      }
    ]
  };
  const current = usageMetricsToSessionUsage("resumed-rpc-session", {
    totalPremiumRequestCost: 0,
    currentModel: "gpt-5.5",
    modelMetrics: {}
  });

  const merged = mergeResumedSessionUsage(current, previous);

  assert.equal(merged.logicalSession.isResumed, true);
  assert.equal(merged.logicalSession.resetCount, 1);
  assert.equal(merged.aggregateUsage.premiumRequests, 7.5);
  assert.equal(merged.aggregateUsage.modelUsage[0].inputTokens, 135659);
  assert.equal(merged.modelUsage.length, 0);
});

test("merges statusline cumulative-token deltas by active model", () => {
  const storeDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "copilot-cost-test-"));
  try {
    const first = readFixture("statusline-payload.sample.json");
    mergeStatusLinePayload(first, { storeDirectory });

    const second = structuredClone(first);
    second.model.id = "claude-sonnet-4.6";
    second.context_window.total_input_tokens += 1000;
    second.context_window.total_output_tokens += 200;
    second.context_window.total_cache_read_tokens += 300;
    second.context_window.total_cache_write_tokens += 400;
    second.context_window.total_reasoning_tokens += 50;

    const { sessionUsage } = mergeStatusLinePayload(second, { storeDirectory });
    const sonnetUsage = sessionUsage.modelUsage.find((item) => item.model === "claude-sonnet-4.6");

    assert.equal(sessionUsage.modelUsage.length, 2);
    assert.equal(sonnetUsage.inputTokens, 1000);
    assert.equal(sonnetUsage.outputTokens, 200);
    assert.equal(sonnetUsage.cachedInputTokens, 300);
    assert.equal(sonnetUsage.cacheWriteTokens, 400);
    assert.equal(sonnetUsage.reasoningTokens, 50);
  } finally {
    fs.rmSync(storeDirectory, { force: true, recursive: true });
  }
});

test("aggregates resumed statusline instances by transcript path", () => {
  const storeDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "copilot-cost-test-"));
  try {
    const first = readFixture("statusline-payload.sample.json");
    first.session_id = "resumed-instance-1";
    first.transcript_path = "D:\\TEST\\.copilot\\transcripts\\conversation.jsonl";
    mergeStatusLinePayload(first, { storeDirectory });

    const second = structuredClone(first);
    second.session_id = "resumed-instance-2";
    second.cost.total_premium_requests = 2.5;
    second.context_window.total_input_tokens = 50000;
    second.context_window.total_output_tokens = 500;
    second.context_window.total_cache_read_tokens = 10000;
    second.context_window.total_cache_write_tokens = 2000;
    second.context_window.total_reasoning_tokens = 20;

    const resumed = mergeStatusLinePayload(second, { storeDirectory }).sessionUsage;
    assert.equal(resumed.sessionId, "resumed-instance-2");
    assert.equal(resumed.logicalSession.isResumed, true);
    assert.equal(resumed.logicalSession.instanceCount, 2);
    assert.equal(resumed.modelUsage[0].inputTokens, 50000);
    assert.equal(resumed.aggregateUsage.modelUsage[0].inputTokens, 185659);
    assert.equal(resumed.aggregateUsage.modelUsage[0].outputTokens, 1833);
    assert.equal(resumed.aggregateUsage.premiumRequests, 10);

    const refreshed = structuredClone(second);
    refreshed.cost.total_premium_requests = 3;
    refreshed.context_window.total_input_tokens += 1000;
    const refreshedUsage = mergeStatusLinePayload(refreshed, { storeDirectory }).sessionUsage;

    assert.equal(refreshedUsage.modelUsage[0].inputTokens, 51000);
    assert.equal(refreshedUsage.aggregateUsage.modelUsage[0].inputTokens, 186659);
    assert.equal(refreshedUsage.aggregateUsage.premiumRequests, 10.5);
  } finally {
    fs.rmSync(storeDirectory, { force: true, recursive: true });
  }
});

test("does not double-count cumulative premium requests across resumed statusline instances", () => {
  const storeDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "copilot-cost-test-"));
  try {
    const first = readFixture("statusline-payload.sample.json");
    first.session_id = "cumulative-pru-instance-1";
    first.transcript_path = "D:\\TEST\\.copilot\\transcripts\\cumulative-pru.jsonl";
    mergeStatusLinePayload(first, { storeDirectory });

    const second = structuredClone(first);
    second.session_id = "cumulative-pru-instance-2";
    second.cost.total_premium_requests = 8;
    second.context_window.total_input_tokens = 50000;
    second.context_window.total_output_tokens = 500;
    second.context_window.total_cache_read_tokens = 10000;
    second.context_window.total_cache_write_tokens = 2000;
    second.context_window.total_reasoning_tokens = 20;

    const usage = mergeStatusLinePayload(second, { storeDirectory }).sessionUsage;

    assert.equal(usage.aggregateUsage.premiumRequests, 8);
    assert.equal(usage.logicalSession.premiumRequestsAggregation.mode, "latest-cumulative");
  } finally {
    fs.rmSync(storeDirectory, { force: true, recursive: true });
  }
});

test("preserves prior contribution when statusline counters reset within one instance", () => {
  const storeDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "copilot-cost-test-"));
  try {
    const first = readFixture("statusline-payload.sample.json");
    first.session_id = "reset-instance";
    first.transcript_path = "D:\\TEST\\.copilot\\transcripts\\reset.jsonl";
    mergeStatusLinePayload(first, { storeDirectory });

    const reset = structuredClone(first);
    reset.context_window.total_input_tokens = 100;
    reset.context_window.total_output_tokens = 10;
    reset.context_window.total_cache_read_tokens = 20;
    reset.context_window.total_cache_write_tokens = 5;
    reset.context_window.total_reasoning_tokens = 1;
    reset.cost.total_premium_requests = 1;

    const usage = mergeStatusLinePayload(reset, { storeDirectory }).sessionUsage;
    const cached = readLiveSession("reset-instance", { storeDirectory });

    assert.equal(usage.logicalSession.resetCount, 1);
    assert.equal(cached.aggregateUsage.modelUsage[0].inputTokens, 135759);
    assert.equal(cached.aggregateUsage.premiumRequests, 8.5);
  } finally {
    fs.rmSync(storeDirectory, { force: true, recursive: true });
  }
});

test("statusline preserves resumed aggregate when current payload is zero", () => {
  const storeDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "copilot-cost-test-"));
  try {
    writeLiveSession({
      sessionId: "zero-statusline-resume",
      source: "copilot-cli-rpc-usage",
      timestamp: "2026-05-13T20:00:00.000Z",
      premiumRequests: 0,
      modelUsage: [],
      logicalSession: {
        id: "session:zero-statusline-resume",
        source: "session_id",
        key: "zero-statusline-resume",
        currentInstanceId: "zero-statusline-resume",
        isResumed: true,
        instanceCount: 1,
        resumeCount: 1,
        resetCount: 1
      },
      aggregateUsage: {
        sessionId: "session:zero-statusline-resume",
        source: "copilot-cli-resumed-session-aggregate",
        timestamp: "2026-05-13T20:00:00.000Z",
        premiumRequests: 7.5,
        modelUsage: [
          {
            model: "gpt-5.5",
            inputTokens: 135659,
            cachedInputTokens: 91648,
            cacheWriteTokens: 12000,
            outputTokens: 1333,
            reasoningTokens: 335
          }
        ]
      }
    }, { storeDirectory });

    const payload = readFixture("statusline-payload.sample.json");
    payload.session_id = "zero-statusline-resume";
    payload.cost.total_premium_requests = 0;
    payload.context_window.total_input_tokens = 0;
    payload.context_window.total_output_tokens = 0;
    payload.context_window.total_cache_read_tokens = 0;
    payload.context_window.total_cache_write_tokens = 0;
    payload.context_window.total_reasoning_tokens = 0;

    const usage = mergeStatusLinePayload(payload, { storeDirectory }).sessionUsage;

    assert.equal(usage.logicalSession.isResumed, true);
    assert.equal(usage.aggregateUsage.modelUsage[0].inputTokens, 135659);
    assert.equal(usage.aggregateUsage.premiumRequests, 7.5);
    assert.equal(usage.modelUsage[0].inputTokens, 0);

    const refreshed = mergeStatusLinePayload(payload, { storeDirectory }).sessionUsage;
    assert.equal(refreshed.logicalSession.isResumed, true);
    assert.equal(refreshed.aggregateUsage.modelUsage[0].inputTokens, 135659);
    assert.equal(refreshed.aggregateUsage.premiumRequests, 7.5);
  } finally {
    fs.rmSync(storeDirectory, { force: true, recursive: true });
  }
});

test("statusline CLI enriches passthrough payload by default", () => {
  const storeDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "copilot-cost-test-"));
  const passthroughPath = path.join(storeDirectory, "passthrough.mjs");
  try {
    fs.writeFileSync(
      passthroughPath,
      "import fs from 'node:fs'; const raw = fs.readFileSync(0, 'utf8'); const payload = JSON.parse(raw); process.stdout.write(`base ${payload.model.id} ${payload.copilot_cost.usage_based.aiCredits} credits ${payload.copilot_cost.premium_requests.totalPremiumRequests} PRU`);"
    );

    const input = fs.readFileSync(new URL("../fixtures/statusline-payload.sample.json", import.meta.url), "utf8");
    const result = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL("../src/cli/statusline.js", import.meta.url)),
        "--passthrough",
        `"${process.execPath}" "${passthroughPath}"`
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          COPILOT_COST_STATUSLINE_COLOR: "false",
          COPILOT_COST_LIVE_STORE: storeDirectory
        },
        input,
        shell: false
      }
    );

    assert.equal(result.status, 0);
    assert.equal(result.stdout, "base gpt-5.5 30.5869 credits 7.5 PRU");
  } finally {
    fs.rmSync(storeDirectory, { force: true, recursive: true });
  }
});

test("statusline CLI can decorate passthrough statusline output", () => {
  const storeDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "copilot-cost-test-"));
  const passthroughPath = path.join(storeDirectory, "passthrough.mjs");
  try {
    fs.writeFileSync(
      passthroughPath,
      "import fs from 'node:fs'; const raw = fs.readFileSync(0, 'utf8'); const payload = JSON.parse(raw); process.stdout.write(`base ${payload.model.id}`);"
    );

    const input = fs.readFileSync(new URL("../fixtures/statusline-payload.sample.json", import.meta.url), "utf8");
    const result = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL("../src/cli/statusline.js", import.meta.url)),
        "--mode",
        "decorate",
        "--passthrough",
        `"${process.execPath}" "${passthroughPath}"`
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          COPILOT_COST_CURRENCY: "USD",
          COPILOT_COST_FX_CACHE: storeDirectory,
          COPILOT_COST_LOCALE: "en-US",
          COPILOT_COST_PLAN: "pro",
          COPILOT_COST_STATUSLINE_COLOR: "false",
          COPILOT_COST_LIVE_STORE: storeDirectory
        },
        input,
        shell: false
      }
    );

    assert.equal(result.status, 0);
    assert.match(result.stdout, /^base gpt-5\.5 · 💸 Cost /);
    assert.match(result.stdout, /~\$0\.3059 \(30\.6 cr, 2% pro\)/);
    assert.match(result.stdout, /7\.5 PRU, 2\.5% pro/);
  } finally {
    fs.rmSync(storeDirectory, { force: true, recursive: true });
  }
});

test("statusline CLI shows allowance percentage for the configured plan", () => {
  const storeDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "copilot-cost-test-"));
  try {
    const input = fs.readFileSync(new URL("../fixtures/statusline-payload.sample.json", import.meta.url), "utf8");
    const result = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL("../src/cli/statusline.js", import.meta.url)),
        "--mode",
        "standalone"
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          COPILOT_COST_CURRENCY: "USD",
          COPILOT_COST_LOCALE: "en-US",
          COPILOT_COST_PLAN: "pro",
          COPILOT_COST_STATUSLINE_COLOR: "false",
          COPILOT_COST_LIVE_STORE: storeDirectory
        },
        input,
        shell: false
      }
    );

    assert.equal(result.status, 0);
    assert.equal(result.stdout, "💸 Cost ~$0.3059 (30.6 cr, 2% pro) · 7.5 PRU, 2.5% pro · last 42K in/3K out");
  } finally {
    fs.rmSync(storeDirectory, { force: true, recursive: true });
  }
});

test("statusline CLI uses cached detected subscription plan", () => {
  const storeDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "copilot-cost-test-"));
  const subscriptionCache = path.join(storeDirectory, "current-subscription.json");
  try {
    writeCurrentSubscriptionCache(
      {
        login: "octocat",
        plan: "enterprise",
        rawPlan: "Copilot Enterprise",
        source: "session.rpc.auth.getStatus"
      },
      {
        env: {
          COPILOT_COST_SUBSCRIPTION_CACHE: subscriptionCache
        }
      }
    );
    fs.writeFileSync(subscriptionCache, `\uFEFF${fs.readFileSync(subscriptionCache, "utf8")}`);

    const input = fs.readFileSync(new URL("../fixtures/statusline-payload.sample.json", import.meta.url), "utf8");
    const env = { ...process.env };
    delete env.COPILOT_COST_PLAN;
    const result = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL("../src/cli/statusline.js", import.meta.url)),
        "--mode",
        "standalone"
      ],
      {
        encoding: "utf8",
        env: {
          ...env,
          COPILOT_COST_CURRENCY: "USD",
          COPILOT_COST_LOCALE: "en-US",
          COPILOT_COST_STATUSLINE_COLOR: "false",
          COPILOT_COST_LIVE_STORE: storeDirectory,
          COPILOT_COST_SUBSCRIPTION_CACHE: subscriptionCache
        },
        input,
        shell: false
      }
    );

    assert.equal(result.status, 0);
    assert.equal(result.stdout, "💸 Cost ~$0.3059 (30.6 cr, 0.8% enterprise) · 7.5 PRU, 0.8% enterprise · last 42K in/3K out");
  } finally {
    fs.rmSync(storeDirectory, { force: true, recursive: true });
  }
});

test("statusline CLI labels fallback plan as assumed", () => {
  const storeDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "copilot-cost-test-"));
  const subscriptionCache = path.join(storeDirectory, "missing-subscription.json");
  try {
    const input = fs.readFileSync(new URL("../fixtures/statusline-payload.sample.json", import.meta.url), "utf8");
    const env = { ...process.env };
    delete env.COPILOT_COST_PLAN;
    const result = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL("../src/cli/statusline.js", import.meta.url)),
        "--mode",
        "standalone"
      ],
      {
        encoding: "utf8",
        env: {
          ...env,
          COPILOT_COST_CURRENCY: "USD",
          COPILOT_COST_LOCALE: "en-US",
          COPILOT_COST_STATUSLINE_COLOR: "false",
          COPILOT_COST_LIVE_STORE: storeDirectory,
          COPILOT_COST_SUBSCRIPTION_CACHE: subscriptionCache
        },
        input,
        shell: false
      }
    );

    assert.equal(result.status, 0);
    assert.equal(result.stdout, "💸 Cost ~$0.3059 (30.6 cr, 2% assumed pro) · 7.5 PRU, 2.5% assumed pro · last 42K in/3K out");
  } finally {
    fs.rmSync(storeDirectory, { force: true, recursive: true });
  }
});

test("statusline CLI reads exchange rate from fx-rates cache", () => {
  const storeDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "copilot-cost-test-"));
  const fxCacheDirectory = path.join(storeDirectory, "fx");
  const passthroughPath = path.join(storeDirectory, "passthrough.mjs");
  try {
    fs.mkdirSync(fxCacheDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(fxCacheDirectory, "USD-EUR.json"),
      JSON.stringify({
        base: "USD",
        quote: "EUR",
        rate: 0.5,
        date: "2026-05-18",
        fetchedAt: new Date().toISOString(),
        source: "frankfurter-cache",
        url: "https://api.frankfurter.dev/v2/rate/USD/EUR"
      })
    );
    fs.writeFileSync(
      passthroughPath,
      "import fs from 'node:fs'; const raw = fs.readFileSync(0, 'utf8'); const payload = JSON.parse(raw); const cur = payload.copilot_cost.usage_based.currency; process.stdout.write(`${cur.code} ${cur.exchangeRate} ${cur.source}`);"
    );

    const input = fs.readFileSync(new URL("../fixtures/statusline-payload.sample.json", import.meta.url), "utf8");
    const env = { ...process.env };
    delete env.COPILOT_COST_EXCHANGE_RATE;
    delete env.COPILOT_COST_FX_EUR;
    const result = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL("../src/cli/statusline.js", import.meta.url)),
        "--passthrough",
        `"${process.execPath}" "${passthroughPath}"`
      ],
      {
        encoding: "utf8",
        env: {
          ...env,
          COPILOT_COST_CURRENCY: "EUR",
          COPILOT_COST_FX_CACHE: fxCacheDirectory,
          COPILOT_COST_STATUSLINE_COLOR: "false",
          COPILOT_COST_LIVE_STORE: storeDirectory
        },
        input,
        shell: false
      }
    );

    assert.equal(result.status, 0);
    assert.equal(result.stdout, "EUR 0.5 frankfurter-cache");
  } finally {
    fs.rmSync(storeDirectory, { force: true, recursive: true });
  }
});

test("statusline CLI falls back to USD when no exchange rate is available", () => {
  const storeDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "copilot-cost-test-"));
  const fxCacheDirectory = path.join(storeDirectory, "fx-empty");
  const passthroughPath = path.join(storeDirectory, "passthrough.mjs");
  try {
    fs.mkdirSync(fxCacheDirectory, { recursive: true });
    fs.writeFileSync(
      passthroughPath,
      "import fs from 'node:fs'; const raw = fs.readFileSync(0, 'utf8'); const payload = JSON.parse(raw); process.stdout.write(payload.copilot_cost.usage_based.currency.code);"
    );

    const input = fs.readFileSync(new URL("../fixtures/statusline-payload.sample.json", import.meta.url), "utf8");
    const env = { ...process.env };
    delete env.COPILOT_COST_EXCHANGE_RATE;
    delete env.COPILOT_COST_FX_EUR;
    const result = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL("../src/cli/statusline.js", import.meta.url)),
        "--passthrough",
        `"${process.execPath}" "${passthroughPath}"`
      ],
      {
        encoding: "utf8",
        env: {
          ...env,
          COPILOT_COST_CURRENCY: "EUR",
          COPILOT_COST_FX_CACHE: fxCacheDirectory,
          COPILOT_COST_STATUSLINE_COLOR: "false",
          COPILOT_COST_LIVE_STORE: storeDirectory
        },
        input,
        shell: false
      }
    );

    assert.equal(result.status, 0);
    assert.equal(result.stdout, "USD");
  } finally {
    fs.rmSync(storeDirectory, { force: true, recursive: true });
  }
});

test("statusline CLI uses env var source name in exchange-rate metadata", () => {
  const storeDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "copilot-cost-test-"));
  const passthroughPath = path.join(storeDirectory, "passthrough.mjs");
  try {
    fs.writeFileSync(
      passthroughPath,
      "import fs from 'node:fs'; const raw = fs.readFileSync(0, 'utf8'); const payload = JSON.parse(raw); const cur = payload.copilot_cost.usage_based.currency; process.stdout.write(`${cur.code} ${cur.exchangeRate} ${cur.source}`);"
    );

    const input = fs.readFileSync(new URL("../fixtures/statusline-payload.sample.json", import.meta.url), "utf8");
    const env = { ...process.env };
    delete env.COPILOT_COST_EXCHANGE_RATE;
    const result = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL("../src/cli/statusline.js", import.meta.url)),
        "--passthrough",
        `"${process.execPath}" "${passthroughPath}"`
      ],
      {
        encoding: "utf8",
        env: {
          ...env,
          COPILOT_COST_CURRENCY: "EUR",
          COPILOT_COST_FX_EUR: "0.75",
          COPILOT_COST_FX_CACHE: storeDirectory,
          COPILOT_COST_STATUSLINE_COLOR: "false",
          COPILOT_COST_LIVE_STORE: storeDirectory
        },
        input,
        shell: false
      }
    );

    assert.equal(result.status, 0);
    assert.equal(result.stdout, "EUR 0.75 COPILOT_COST_FX_EUR");
  } finally {
    fs.rmSync(storeDirectory, { force: true, recursive: true });
  }
});

test("statusline launcher prefers copilot-cli-cost checkout from payload cwd", () => {
  const storeDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "copilot-cost-test-"));
  try {
    const workspace = path.join(storeDirectory, "workspace");
    const statuslineDirectory = path.join(workspace, "src", "cli");
    fs.mkdirSync(statuslineDirectory, { recursive: true });
    fs.writeFileSync(path.join(workspace, "package.json"), JSON.stringify({ name: "copilot-cli-cost" }));
    fs.writeFileSync(
      path.join(statuslineDirectory, "statusline.js"),
      "import fs from 'node:fs'; const payload = JSON.parse(fs.readFileSync(0, 'utf8')); process.stdout.write(`workspace ${payload.cwd}`);"
    );

    const payload = readFixture("statusline-payload.sample.json");
    payload.cwd = workspace;
    payload.workspace.current_dir = workspace;
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(new URL("../scripts/statusline-launcher.mjs", import.meta.url))],
      {
        encoding: "utf8",
        input: JSON.stringify(payload),
        shell: false
      }
    );

    assert.equal(result.status, 0);
    assert.equal(result.stdout, `workspace ${workspace}`);
  } finally {
    fs.rmSync(storeDirectory, { force: true, recursive: true });
  }
});

function readFixture(name) {
  return JSON.parse(fs.readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8"));
}

