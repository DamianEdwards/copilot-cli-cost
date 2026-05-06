# Architecture

## Goal

Show Copilot CLI session cost on demand and eventually in live UI surfaces:

- `/cost`
- `/cost session <session-id>`
- status line
- side panel with plan and currency comparisons

## Design

The implementation is split into four layers.

| Layer | Responsibility |
| --- | --- |
| Metering | Collect session id, model id, request count, and token buckets. |
| Pricing | Compute premium request units or usage-based AI Credit cost. |
| Entitlement | Resolve the user's plan and billing entity. |
| Presentation | Render `/cost`, status line, side panel, JSON output, and currency conversion. |

## Data model

Canonical usage input:

```json
{
  "sessionId": "session-id",
  "plan": "pro",
  "currency": "USD",
  "modelUsage": [
    {
      "model": "gpt-5.5",
      "requests": 1,
      "inputTokens": 1000,
      "cachedInputTokens": 2000,
      "cacheWriteTokens": 0,
      "outputTokens": 500
    }
  ]
}
```

Canonical cost output:

- USD total
- AI Credits
- selected display currency and exchange-rate source
- per-model breakdown
- plan allowance impact

## Billing calculators

### Premium requests

`requests * modelMultiplier`

The calculator supports:

- `current`
- `annual-after-2026-06-01`

If Copilot CLI has already reported a session-level premium request count, the calculator can accept that directly and skip model multipliers:

```powershell
node src/cli/cost.js --premium-requests 12.5 --plan pro
```

This is useful for `/usage` or `/session info` output because those commands report post-multiplier premium request units. The direct PRU path can show allowance impact and overage-equivalent value immediately. To calculate an actual incremental charge, it also needs the user's remaining monthly premium requests before the session.

### Usage-based billing

```text
inputTokens        * model.inputPerMillionUsd
cachedInputTokens  * model.cachedInputPerMillionUsd
cacheWriteTokens   * model.cacheWritePerMillionUsd
outputTokens       * model.outputPerMillionUsd
```

All token costs are divided by 1,000,000. AI Credits are then:

```text
usd / 0.01
```

The model breakdown keeps every token bucket separate so UI surfaces can show the exact subtotal:

```text
inputUsd       = inputTokens       / 1,000,000 * inputPerMillionUsd
cachedInputUsd = cachedInputTokens / 1,000,000 * cachedInputPerMillionUsd
cacheWriteUsd  = cacheWriteTokens  / 1,000,000 * cacheWritePerMillionUsd
outputUsd      = outputTokens      / 1,000,000 * outputPerMillionUsd
reasoningUsd   = reasoningTokens   / 1,000,000 * outputPerMillionUsd
```

Reasoning tokens are currently treated as output-priced unless `billReasoningTokens` is disabled. This should be revisited if GitHub documents a separate reasoning-token rate.

## Accuracy notes

The estimate is intended to be explainable and reconcilable, not an invoice:

- Token buckets and premium request totals come from Copilot CLI's own live `usage.getMetrics()` RPC, completed-session `modelMetrics`, or statusline counters.
- Per-token rates and AI Credit conversion match GitHub's published model pricing table: prices are per 1M tokens and `1 AI credit = $0.01 USD`.
- Anthropic cache write charges are modeled separately because GitHub documents a cache-write rate for those models.
- Premium request calculations prefer Copilot's already-multiplied PRU total when present, avoiding double-applying local multiplier assumptions.
- Business and Enterprise AI Credit allowances are pooled at the billing entity level, so the session estimate does not necessarily represent incremental billable spend.
- USD is canonical; non-USD values are display estimates based on the configured exchange-rate snapshot.
- Published rates, plan allowances, and transition dates can change, so `src/core/rates.js` should be periodically checked against GitHub's billing docs.

## Currency

USD remains canonical. Other currencies are display-only estimates using a configured USD-to-currency exchange rate.

This avoids mixing GitHub's USD rate table with local tax, billing currency, regional pricing, or exchange-rate timing concerns.

## Copilot CLI integration

Current documented plugin surfaces:

- `plugin.json` for plugin metadata
- `skills/` for agent instructions
- `hooks.json` as a legacy event-recorder sample; it is not registered in `plugin.json`
- marketplace metadata in `.github/plugin/marketplace.json`
- `.github/extensions/copilot-cli-cost` for deterministic SDK commands, tools, and the webview panel

Current documented hooks expose lifecycle events but not per-model token usage. The hook recorder in this repo captures events for correlation, but actual/reconciled costs require one of:

- the Copilot SDK session RPC API, `session.rpc.usage.getMetrics()`, for the current live session
- local Copilot CLI session events with `modelMetrics` in `~/.copilot/session-state/<session-id>/events.jsonl`
- the experimental Copilot CLI `statusLine` JSON payload
- a first-party Copilot CLI session usage export with per-model token buckets
- a future plugin hook that includes token usage per model call
- GitHub usage API reconciliation for org/enterprise billing entities

The Copilot usage metrics REST API is not the primary source for session-level cost. It returns daily or 28-day organization/enterprise reports via download links and is useful for reconciliation, but it does not expose a documented `sessionId` filter or a live per-session endpoint.

Completed sessions currently include counters in `session.shutdown`, including `totalPremiumRequests` and per-model token buckets under `modelMetrics`. That is enough to calculate actual completed-session cost.

Active sessions should use the deterministic SDK extension first. It calls `session.rpc.usage.getMetrics()` and normalizes the result via `src/core/usage-metrics.js`. The RPC result includes:

- `totalPremiumRequestCost`
- `totalUserRequests`
- `totalApiDurationMs`
- `currentModel`
- `lastCallInputTokens` and `lastCallOutputTokens`
- `codeChanges`
- per-model `requests.count`, `requests.cost`, and token buckets under `usage`

The extension writes the normalized RPC snapshot to `%LOCALAPPDATA%\copilot-cli-cost\live-sessions` so the standalone CLI and statusline ecosystem can consume the same shape.

Active sessions can also use the experimental statusline payload, enabled with:

```jsonc
{
  "experimental": true,
  "experimental_flags": ["STATUS_LINE"],
  "statusLine": {
    "type": "command",
    "command": "D:\\src\\GitHub\\DamianEdwards\\copilot-cli-cost\\scripts\\statusline.cmd"
  }
}
```

The payload includes:

- `session_id`
- `model.id` and `model.display_name`
- `cost.total_premium_requests`
- cumulative token buckets under `context_window.total_*`
- last-call token buckets under `context_window.last_call_*`

The payload does not provide a historical per-model breakdown. `src/cli/statusline.js` caches successive cumulative snapshots under `%LOCALAPPDATA%\copilot-cli-cost\live-sessions` and attributes deltas to the active model for each refresh. `/cost --live` reads the latest cached snapshot when the SDK extension has not already written an RPC-derived one.

The statusline entrypoint is designed to be a decorator, not a replacement. If `COPILOT_COST_STATUSLINE_PASSTHROUGH` is set, it invokes that command with the original stdin payload enriched with `copilot_cost`. By default the passthrough command owns all rendering; `COPILOT_COST_STATUSLINE_MODE=decorate` composes the passthrough output with the bridge's compact cost segment. This lets users keep any custom statusline while still feeding the live cost cache.

## Entitlement lookup

The plan resolver should remain an adapter. Expected sources:

- explicit user configuration
- Copilot CLI current user/billing entity if exposed
- organization or enterprise Copilot seat/usage APIs for admins
- manual override for what-if comparisons

The cost engine should not call GitHub APIs directly.

