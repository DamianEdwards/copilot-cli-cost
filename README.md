# Copilot CLI Cost

Copilot CLI Cost is a GitHub Copilot CLI plugin scaffold for showing session cost across both Copilot billing models:

- Premium request units (the current request/multiplier model)
- Usage-based billing with GitHub AI Credits

The calculator stores canonical cost in USD and converts to a selected display currency with an explicit exchange-rate snapshot.

![Copilot Cost panel showing session estimates and token bucket breakdown](docs/session-cost-panel.png)

## Current status

This repository is intentionally split into three parts:

1. A working standalone calculator in `src/` that accepts session usage JSON and computes costs.
2. A Copilot CLI statusline bridge that reads Copilot CLI's live statusline payload, caches the latest session counters, and prints a compact cost segment.
3. A deterministic Copilot CLI SDK extension under `.github/extensions/copilot-cli-cost` that registers `/cost`, cost tools, and a native cost panel.
4. A Copilot CLI plugin layout (`plugin.json`, `skills/`) for marketplace install/discovery.

The deterministic SDK extension now prefers Copilot CLI's live `session.rpc.usage.getMetrics()` API. The statusline bridge is still useful as a composable statusline decorator and fallback live cache.

## Repository layout

```text
.
├── .github/plugin/marketplace.json  # Marketplace metadata for plugin discovery
├── .github/extensions/copilot-cli-cost
│   ├── extension.mjs                # Deterministic SDK extension entrypoint
│   ├── main.mjs                     # /cost command, tools, and panel callbacks
│   └── content/                     # Native webview panel UI
├── docs/architecture.md             # Design notes and integration seams
├── fixtures/session-usage.sample.json
├── hooks.json                       # Legacy hook recorder sample, not registered by plugin.json
├── plugin.json                      # Copilot CLI plugin manifest
├── scripts/hooks/record-event.js    # Hook event recorder
├── scripts/statusline.cmd           # Windows statusline bridge entrypoint
├── skills/copilot-cost/SKILL.md     # Cost-estimation skill instructions
├── src/cli/cost.js                  # Standalone calculator CLI
├── src/cli/statusline.js            # Statusline payload reader/cache/writer
├── src/core/                        # Billing, currency, and rate logic
└── test/                            # Node test suite
```

## Try the calculator

```powershell
cd D:\src\GitHub\DamianEdwards\copilot-cli-cost
npm test
npm run cost -- --sample
npm run cost -- --sample --billing-model premium-requests --plan pro-plus
npm run cost -- --premium-requests 12.5 --plan pro --remaining-premium-requests 10
npm run cost -- --session aba582fa-1b08-472e-a69b-54228d95803b --plan pro
npm run cost -- --session aba582fa-1b08-472e-a69b-54228d95803b --billing-model premium-requests --plan pro
npm run cost -- --statusline-payload .\fixtures\statusline-payload.sample.json --plan pro
npm run cost -- --premium-requests 12.5 --plan pro --currency EUR --exchange-rate 0.9
npm run cost -- --sample --currency EUR --exchange-rate 0.9
```

## Install the plugin locally

```powershell
cd D:\src\GitHub\DamianEdwards\copilot-cli-cost
copilot plugin marketplace add D:\src\GitHub\DamianEdwards\copilot-cli-cost
copilot plugin install copilot-cli-cost@copilot-cli-cost-marketplace
copilot plugin list
```

Copilot CLI 1.0.43 does not accept direct local paths for `copilot plugin install`, even though some docs mention local path installs. Local development works by registering this repository as a local marketplace first.

Inside Copilot CLI, check that the skill is visible:

```text
/skills list
```

The deterministic SDK extension registers `/cost` directly when Copilot CLI discovers `.github/extensions/copilot-cli-cost` from this repository or from your user extensions directory. It reads live session metrics from the Copilot SDK RPC API and falls back to the statusline cache if RPC metrics are unavailable.

For global local development, create `~\.copilot\extensions\copilot-cli-cost\extension.mjs` that delegates to this repository:

```js
import { pathToFileURL } from "node:url";

await import(pathToFileURL("D:\\src\\GitHub\\DamianEdwards\\copilot-cli-cost\\.github\\extensions\\copilot-cli-cost\\extension.mjs").href);
```

Then reload extensions and try:

```text
/cost
/cost panel on
/cost panel off
/cost session <session-id>
```

Unlike prompt commands, this `/cost` command is handled by extension JavaScript and does not ask the model to calculate the result.

## Live cost via SDK extension

The SDK extension is the preferred live path because it can ask the current Copilot CLI session for metrics directly:

```js
await session.rpc.usage.getMetrics()
```

That returns per-model request counts, premium request cost, token buckets, current model, last-call token counts, API duration, and code-change counters. `/cost`, `copilot_cost_get`, and the panel use this source by default and write the normalized snapshot to `%LOCALAPPDATA%\copilot-cli-cost\live-sessions` for interoperability with the standalone CLI/statusline tools.

## Live cost via statusline

Copilot CLI can also invoke a custom statusline command with a JSON payload on stdin. In current CLI builds this is gated by the experimental statusline flag. This is optional for `/cost`, but useful if you want live cost in the terminal statusline or want to enrich another custom statusline.

Add this to `~/.copilot/config.json`:

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

The statusline bridge reads the payload, updates a live cache under `%LOCALAPPDATA%\copilot-cli-cost\live-sessions`, and prints a compact segment such as:

```text
💸 Cost ~$0.7742 (77.4 cr) · 7.5 PRU · last 42K in/3K out
```

The cached live snapshot can be read at any time:

```powershell
npm run cost -- --live --plan pro
npm run cost -- --live --billing-model premium-requests --plan pro
```

Or read a specific live session snapshot:

```powershell
npm run cost -- --live-session <session-id> --plan pro
```

Statusline configuration can be controlled with environment variables before launching `copilot`:

```powershell
$env:COPILOT_COST_PLAN = "enterprise"
$env:COPILOT_COST_CURRENCY = "EUR"
$env:COPILOT_COST_EXCHANGE_RATE = "0.9"
$env:COPILOT_COST_PROMOTIONAL_ALLOWANCE = "true"
copilot
```

If you already have a custom statusline, keep using it by making this statusline a decorator. Configure Copilot CLI to call `scripts\statusline.cmd`, then point `COPILOT_COST_STATUSLINE_PASSTHROUGH` at your existing statusline command:

```powershell
$env:COPILOT_COST_STATUSLINE_PASSTHROUGH = "C:\Users\alex\.copilot\statusline\statusline.cmd"
copilot
```

When passthrough is configured, the default mode is `passthrough`: the inner statusline receives the original payload plus a `copilot_cost` object and is responsible for rendering all output. This lets any statusline decide where and how to show cost data:

```jsonc
{
  "model": { "id": "gpt-5.5" },
  "cost": { "total_premium_requests": 7.5 },
  "context_window": { "...": "..." },
  "copilot_cost": {
    "schema_version": 1,
    "status_line": "💸 Cost ~$0.7742 (77.4 cr) · 7.5 PRU · last 42K in/3K out",
    "usage_based": {
      "billingModel": "usage-based",
      "totalUsd": 0.774159,
      "aiCredits": 77.4159
    },
    "premium_requests": {
      "billingModel": "premium-requests",
      "totalPremiumRequests": 7.5,
      "overageEquivalentUsd": 0.3
    }
  }
}
```

To keep the old behavior where this bridge appends/prepends its own cost segment to the inner statusline output, set decorate mode:

```powershell
$env:COPILOT_COST_STATUSLINE_MODE = "decorate"
$env:COPILOT_COST_STATUSLINE_POSITION = "right" # right = existing statusline first, cost appended
copilot
```

Decorator options:

| Variable | Default | Meaning |
| --- | --- | --- |
| `COPILOT_COST_STATUSLINE_PASSTHROUGH` | unset | Command to invoke with enriched statusline JSON on stdin. |
| `COPILOT_COST_STATUSLINE_MODE` | `passthrough` when passthrough is set, otherwise `standalone` | `passthrough`, `decorate`, or `standalone`. |
| `COPILOT_COST_STATUSLINE_POSITION` | `right` | In `decorate` mode: `right`, `left`, `replace`, or `passthrough`. |
| `COPILOT_COST_STATUSLINE_SEPARATOR` | ` · ` | In `decorate` mode: text between the passthrough output and cost segment. |
| `COPILOT_COST_STATUSLINE_PASSTHROUGH_TIMEOUT_MS` | `1000` | Maximum time to wait for the passthrough command. |
| `COPILOT_COST_STATUSLINE_HIDE_COST` | `false` | Cache live data but do not print the cost segment. |
| `COPILOT_COST_STATUSLINE_COLOR` | `true` | Set to `false` to disable ANSI color in the rendered cost segment. |

The statusline payload currently provides cumulative session totals:

```json
{
  "session_id": "session-id",
  "model": {
    "id": "gpt-5.5",
    "display_name": "GPT-5.5"
  },
  "cost": {
    "total_premium_requests": 7.5
  },
  "context_window": {
    "total_input_tokens": 135659,
    "total_output_tokens": 1333,
    "total_cache_read_tokens": 91648,
    "total_cache_write_tokens": 12000,
    "total_reasoning_tokens": 335,
    "last_call_input_tokens": 42000,
    "last_call_output_tokens": 3000
  }
}
```

Because the payload has cumulative token totals and the current model, not a full historical per-model breakdown, the bridge caches successive payloads and attributes new token deltas to the active model for each refresh. The first payload seen for a session attributes existing totals to the active model.

## Distribution model

Copilot CLI plugins are not packaged as npm extensions. In the current CLI, they are installed with `copilot plugin install` from a GitHub repository, repository subdirectory, Git URL, or marketplace entry. For unpublished local development, register a local marketplace with `copilot plugin marketplace add`.

After this repository is published to GitHub, users should be able to install directly:

```powershell
copilot plugin install DamianEdwards/copilot-cli-cost
```

To make it discoverable as a marketplace:

```powershell
copilot plugin marketplace add DamianEdwards/copilot-cli-cost
copilot plugin marketplace browse copilot-cli-cost-marketplace
copilot plugin install copilot-cli-cost@copilot-cli-cost-marketplace
```

## Session usage JSON

For completed local Copilot CLI sessions, the calculator can read actual counters from `~/.copilot/session-state/<session-id>/events.jsonl`:

```powershell
npm run cost -- --session aba582fa-1b08-472e-a69b-54228d95803b --plan pro
```

The session event parser reads the latest metrics event, typically `session.shutdown`, and extracts:

- `totalPremiumRequests`
- per-model request count and premium request cost
- input tokens
- output tokens
- cached input tokens
- cache write tokens
- reasoning tokens

If newer events exist after the latest metrics event, the calculator marks the metrics as stale. For live sessions, prefer the statusline bridge above.

For premium-request billing from the same local session:

```powershell
npm run cost -- --session aba582fa-1b08-472e-a69b-54228d95803b --billing-model premium-requests --plan pro
```

For usage-based billing, the calculator expects session usage shaped like this:

```json
{
  "sessionId": "sample-session-001",
  "plan": "pro",
  "currency": "USD",
  "modelUsage": [
    {
      "model": "gpt-5.5",
      "requests": 3,
      "inputTokens": 180000,
      "cachedInputTokens": 420000,
      "cacheWriteTokens": 0,
      "outputTokens": 36000
    }
  ]
}
```

For current premium-request billing, Copilot CLI already surfaces a current-session premium request count. You can calculate from that already-multiplied PRU count directly:

```powershell
npm run cost -- --premium-requests 12.5 --plan pro
```

If you also know how many monthly premium requests remained before the session, pass that to estimate the incremental billable charge:

```powershell
npm run cost -- --premium-requests 12.5 --plan pro --remaining-premium-requests 10
```

Without the remaining monthly allowance, the calculator shows the session's overage-equivalent value at the documented $0.04 USD per PRU rate, but it cannot know whether those PRUs are actually billable or simply consumed included allowance.

## Currency

USD is canonical because GitHub's model rates and AI Credits are documented in USD. Non-USD currencies are display estimates:

```powershell
npm run cost -- --sample --currency GBP --exchange-rate 0.79
```

You can also set an environment variable:

```powershell
$env:COPILOT_COST_FX_EUR = "0.9"
npm run cost -- --sample --currency EUR
```

## Important limitations

- The current plugin scaffold records lifecycle events, not token counts. Current premium-request costing can use Copilot CLI's session PRU count.
- Completed local CLI sessions include per-model counters in `events.jsonl`; live in-session status uses the experimental statusline payload.
- Statusline live usage is strongest when the bridge starts with the session. If enabled mid-session, the first captured cumulative token totals are attributed to the currently active model.
- Business and Enterprise included credits are pooled, so a session cost is not always an incremental charge.
- Taxes, regional billing rules, and GitHub billing-account currency handling are not modeled.
- Rate tables are hardcoded and should be versioned whenever GitHub updates published pricing.

## License

MIT. See [LICENSE](LICENSE).

