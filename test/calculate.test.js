import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { calculateSessionCost } from "../src/core/calculate.js";
import { readSessionUsageFromEvents } from "../src/core/session-events.js";
import { mergeStatusLinePayload, statusLinePayloadToSessionUsage } from "../src/core/statusline-payload.js";
import { usageMetricsToSessionUsage } from "../src/core/usage-metrics.js";

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

  assert.equal(result.totalUsd, 57.55);
  assert.equal(result.aiCredits, 5755);
  assert.equal(result.includedAiCredits, 1000);
  assert.equal(result.modelBreakdown.length, 2);
  assert.deepEqual(result.modelBreakdown[0].rates, {
    inputPerMillionUsd: 5,
    cachedInputPerMillionUsd: 0.5,
    cacheWritePerMillionUsd: 0,
    outputPerMillionUsd: 30,
    reasoningPerMillionUsd: 30
  });
  assert.equal(result.modelBreakdown[0].inputUsd, 5);
  assert.equal(result.modelBreakdown[0].cachedInputUsd, 0.5);
  assert.equal(result.modelBreakdown[0].outputUsd, 30);
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
  assert.equal(result.displayTotal, 51.795);
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

test("calculates usage-based billing from Copilot CLI event metrics", () => {
  const usage = readSessionUsageFromEvents("sample-session", {
    eventsPath: new URL("../fixtures/events.sample.jsonl", import.meta.url)
  });
  const result = calculateSessionCost(usage, {
    billingModel: "usage-based",
    plan: "pro"
  });

  assert.equal(result.totalUsd, 0.774159);
  assert.equal(result.modelBreakdown[0].reasoningUsd, 0.01005);
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
    assert.equal(result.stdout, "base gpt-5.5 77.4159 credits 7.5 PRU");
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
          COPILOT_COST_STATUSLINE_COLOR: "false",
          COPILOT_COST_LIVE_STORE: storeDirectory
        },
        input,
        shell: false
      }
    );

    assert.equal(result.status, 0);
    assert.match(result.stdout, /^base gpt-5\.5 · 💸 Cost /);
    assert.match(result.stdout, /~\$0\.7742 \(77\.4 cr\)/);
    assert.match(result.stdout, /7\.5 PRU/);
  } finally {
    fs.rmSync(storeDirectory, { force: true, recursive: true });
  }
});

function readFixture(name) {
  return JSON.parse(fs.readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8"));
}

