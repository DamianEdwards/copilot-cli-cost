# Copilot instructions for this repository

## Build, test, and lint commands

- Use Node.js 22 or newer; the package is ESM (`"type": "module"`).
- Run all tests: `npm test`
- Run a single test file: `node --test test/calculate.test.js`
- Run a single named test: `node --test --test-name-pattern "calculates usage-based billing" test/calculate.test.js`
- Run syntax checks: `npm run check`
- Run the calculator against sample data: `npm run cost -- --sample`
- Run the statusline bridge manually by piping a payload: `Get-Content fixtures\statusline-payload.sample.json | npm run statusline` on Windows PowerShell, or `cat fixtures/statusline-payload.sample.json | npm run statusline` on macOS/Linux.

## Architecture overview

This is a Node.js Copilot CLI plugin and SDK extension for estimating Copilot CLI session cost. The central flow is:

1. Collect or load usage data from one of several sources.
2. Normalize it into the canonical `sessionUsage` shape with `sessionId`, optional metadata, `premiumRequests`, and `modelUsage` token buckets.
3. Pass it to `calculateSessionCost()` in `src/core/calculate.js`.
4. Render the result through the standalone CLI, `/cost` extension command, native panel, statusline bridge, or SDK tool.

The calculation core is in `src/core/`:

- `calculate.js` computes both billing models. Usage-based billing multiplies token buckets by per-1M-token rates; premium-request billing prefers an already-multiplied PRU total when present and only falls back to local model multipliers when necessary.
- `rates.js` is the single source for model rates, model aliases, premium-request multiplier sets, plan IDs, and plan allowances. Re-check GitHub billing docs before changing these tables.
- `currency.js`, `fx-rates.js`, and `app-cache-dir.js` keep USD canonical and add display-currency estimates from explicit exchange rates, environment overrides, cached Frankfurter rates, or fresh Frankfurter requests.
- `usage-metrics.js`, `session-events.js`, and `statusline-payload.js` adapt external Copilot data shapes into `sessionUsage`.
- `live-session-store.js` persists live snapshots in the platform cache folder so independent surfaces can share the same normalized data.

There are three presentation/integration layers:

- `src/cli/cost.js` is the standalone `copilot-cost` CLI. It reads sample JSON, files, completed session events, live snapshots, raw statusline payloads, or direct premium-request counts.
- `src/cli/statusline.js` reads a Copilot CLI statusline JSON payload from stdin, updates the live snapshot cache, optionally enriches a passthrough statusline payload with `copilot_cost`, and renders a compact cost segment.
- `.github/extensions/copilot-cli-cost/main.mjs` is the SDK extension. It registers `/cost`, the `copilot_cost_get` tool, and the webview panel. Live data comes from `session.rpc.usage.getMetrics()` first, then falls back to cached live snapshots.

The native panel lives under `.github/extensions/copilot-cli-cost/`. `extension.mjs` bootstraps dependencies before importing `main.mjs`; `lib/copilot-webview.js` starts a local HTTP/WebSocket bridge and launches `@webviewjs/webview`; `content/` contains the browser UI.

Plugin installation has two parts: `plugin.json` exposes plugin metadata and skills from `skills/`, while `scripts/install-extension-shim.mjs` installs a user-scoped SDK extension shim under `~/.copilot/extensions/copilot-cli-cost/extension.mjs` that imports the installed plugin's `.github/extensions/copilot-cli-cost/extension.mjs`.

## Key conventions

- Keep new source as ESM and follow the existing named-export style in `src/core/`. CLI entrypoints call `main()` at top level and set `process.exitCode` instead of throwing uncaught errors for user-facing failures.
- Preserve the canonical `sessionUsage` fields when adding data sources: `modelUsage` entries should use `model`, `requests`, `inputTokens`, `cachedInputTokens`, `cacheWriteTokens`, `outputTokens`, and `reasoningTokens`.
- Treat USD as canonical. Non-USD values are display estimates; pass exchange-rate metadata through calculation output so UI surfaces can label the source accurately.
- Reasoning tokens are informational by default; only bill them as output-priced when `billReasoningTokens` or `COPILOT_COST_BILL_REASONING_TOKENS=true` opts in.
- For premium-request billing, do not double-apply multipliers. If Copilot supplies `premiumRequests`, `totalPremiumRequests`, or `currentSessionPremiumRequests`, use that direct value.
- Statusline payloads contain cumulative token totals, not historical per-model buckets. `mergeStatusLinePayload()` attributes deltas to the active model and resets when counters decrease.
- Keep the statusline wrappers paired across platforms: Windows uses `scripts/statusline.cmd`; macOS/Linux use `scripts/statusline.sh`, which should stay LF-normalized through `.gitattributes`.
- Use `getAppCacheDirectory()` / `getAppCacheSubdirectory()` for new cache files. Respect existing env overrides such as `COPILOT_COST_LIVE_STORE`, `COPILOT_COST_FX_CACHE`, `XDG_CACHE_HOME`, and Windows `%LOCALAPPDATA%`.
- The extension package has its own `package.json` and native optional dependencies. Keep panel-only dependencies under `.github/extensions/copilot-cli-cost/`, not the root package.
- `hooks.json` and `scripts/hooks/record-event.js` are legacy/sample hook support and are not registered by `plugin.json`; do not rely on hooks for token-level usage.
- Fixture JSON/JSONL files under `fixtures/` are used by tests. Root `.gitignore` intentionally unignores `fixtures/*.jsonl`.
