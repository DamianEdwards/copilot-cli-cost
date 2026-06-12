# Copilot CLI Cost

Copilot CLI Cost adds estimated session-cost reporting to GitHub Copilot CLI.

It estimates usage-based billing with GitHub AI Credits.

The calculator stores canonical cost in USD and converts to a selected display currency with cached exchange rates from Frankfurter or an explicit exchange-rate override.

![Copilot Cost panel showing session estimates and token bucket breakdown](docs/session-cost-panel.png)

## Features

- `/cost` command for active-session estimates
- `/cost session <session-id>` for completed local sessions
- Session Cost canvas in the GitHub Copilot app and native cost panel with token bucket breakdowns
- What-if subscription comparison for Copilot Free, Pro, Pro+, Max, Business, Enterprise, and Student
- Display currency selector backed by cached Frankfurter USD exchange rates
- Statusline cost segment with optional passthrough to another statusline
- Standalone calculator CLI for sample data, JSON files, completed session events, and live snapshots
- USD-first cost model with optional display currency conversion

## Install

Install by executing the install script for your platform.

Windows PowerShell (`install.ps1`):

```powershell
irm https://raw.githubusercontent.com/DamianEdwards/copilot-cli-cost/main/install.ps1 | iex
```

macOS/Linux (`install.sh`):

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/DamianEdwards/copilot-cli-cost/main/install.sh)"
```

The remote scripts run in isolation and fetch their helper from the same raw-content base URL before configuring Copilot. When run from a checkout, the installer uses the companion files already present under `scripts/` instead of downloading them. To run the installer script from a checkout:

```powershell
.\install.ps1
```

```bash
./install.sh
```

The installer:

- On Copilot CLI 1.0.56-0 or newer, registers this repository's marketplace and installs or updates `copilot-cli-cost@copilot-cli-cost-marketplace`. Older Copilot CLI versions use the direct repository install format.
- Downloads the installer helper from the raw-content base URL.
- Installs the user-scoped extension shim for `/cost`, the GitHub Copilot app canvas, and the native panel.
- Enables the Copilot experimental flags needed for extensions and the status line.
- Configures a stable user-scoped statusline launcher under `~/.copilot/copilot-cli-cost/`.

If you already have a Copilot status line configured, the installer prompts you to replace it, decorate it with the Copilot Cost status line using passthrough mode, or skip statusline configuration. Before changing existing settings that would otherwise be overwritten, it prompts and writes a timestamped `settings.json.bak-*` backup.

Installer options:

| Option | Description |
| --- | --- |
| `--plugin-source <source>` | Use a fork or alternate plugin source. On Copilot CLI 1.0.56-0 or newer, this must be a marketplace source. |
| `--marketplace-name <name>` | Use a custom marketplace name when the marketplace metadata differs from `copilot-cli-cost-marketplace`. |
| `--plugin-name <name>` | Use a custom plugin name when the marketplace metadata differs from `copilot-cli-cost`. |
| `--copilot-home <path>` | Use a custom Copilot home directory instead of `~/.copilot`; useful for isolated verification. |
| `--skip-statusline` | Install the plugin and extension shim without configuring `statusLine`. |
| `--yes` | Accept installer prompts. Existing status lines are decorated, not replaced. |
| `--uninstall` / `-Uninstall` | Remove the plugin, user extension shim, and generated Copilot Cost statusline launchers. |

Set `COPILOT_COST_PLUGIN_SOURCE` or pass `--plugin-source <source>` to install from a fork or alternate plugin source. On Copilot CLI 1.0.56-0 or newer, this source is registered as a plugin marketplace; set `COPILOT_COST_MARKETPLACE_NAME` / `--marketplace-name` and `COPILOT_COST_PLUGIN_NAME` / `--plugin-name` if your fork changes those marketplace identifiers. Set `COPILOT_COST_INSTALL_BASE_URL` or pass `--install-base-url <url>` when running installer scripts from an alternate raw-content location. Set `COPILOT_HOME` or pass `--copilot-home <path>` to isolate installer writes.

The GitHub Copilot app discovers the installed user extension from `~/.copilot/extensions/copilot-cli-cost/` when it starts a session. If the **Session Cost** canvas is not available after installing or updating, start a new app session or restart/reload the app so the extension provider is launched with the new shim. In the interactive `copilot` CLI, use `/extensions` if you need to inspect or reload the user extension.

When you run `copilot` inside this repository, Copilot CLI's extension resolver prefers the repo-local `.github/extensions/copilot-cli-cost` extension over the user-installed extension. The user-scoped shim intentionally stays pointed at the installed plugin copy for sessions outside the repository.

### Uninstall

The uninstall mode removes the installed plugin, deletes the user-scoped extension shim, removes generated statusline launcher files under `~/.copilot/copilot-cli-cost/`, and removes the Copilot Cost `statusLine` setting. If the installer decorated a previous statusline command, uninstall restores that previous command. Restart active Copilot CLI sessions after uninstalling.

Windows PowerShell:

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/DamianEdwards/copilot-cli-cost/main/install.ps1))) -Uninstall
```

macOS/Linux:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/DamianEdwards/copilot-cli-cost/main/install.sh)" -- --uninstall
```

### Manual install

The scripts perform these steps. To do them manually, first install the plugin:

```shell
copilot plugin marketplace add DamianEdwards/copilot-cli-cost # if not already registered
copilot plugin install copilot-cli-cost@copilot-cli-cost-marketplace
```

Then run the extension shim installer from the installed plugin.

PowerShell terminal:

```powershell
$installer = Get-ChildItem "$env:USERPROFILE\.copilot\installed-plugins" -Directory -Recurse |
  Where-Object { Test-Path (Join-Path $_.FullName "scripts\install-extension-shim.mjs") } |
  Select-Object -First 1 -ExpandProperty FullName

if (-not $installer) {
  throw "Could not find installed copilot-cli-cost plugin."
}

node (Join-Path $installer "scripts\install-extension-shim.mjs")
```

Bash terminal:

```bash
installer="$(find "$HOME/.copilot/installed-plugins" -type f -path '*/scripts/install-extension-shim.mjs' | head -n 1)"
if [ -z "$installer" ]; then
  echo "Could not find installed copilot-cli-cost plugin." >&2
  exit 1
fi
node "$installer"
```

Configure `~/.copilot/settings.json`. Do not put `statusLine` in `config.json`; that file is managed by Copilot CLI and user settings may be moved or removed during startup. Use your machine's statusline launcher path:

```jsonc
{
  "experimental": true,
  "experimental_flags": ["EXTENSIONS", "STATUS_LINE"],
  "statusLine": {
    "type": "command",
    "command": "C:\\Users\\alex\\.copilot\\copilot-cli-cost\\statusline.cmd"
  },
  "footer": {
    "showCustom": true
  }
}
```

macOS/Linux:

```jsonc
{
  "experimental": true,
  "experimental_flags": ["EXTENSIONS", "STATUS_LINE"],
  "statusLine": {
    "type": "command",
    "command": "sh \"/Users/alex/.copilot/copilot-cli-cost/statusline.sh\""
  },
  "footer": {
    "showCustom": true
  }
}
```

The statusline bridge prints a compact segment:

```text
💸 Cost ~$0.3059 (30.6 cr, 2% pro) · last 42K in/3K out
```

When the SDK extension can detect your current Copilot subscription, the statusline uses that cached plan for allowance percentages. `COPILOT_COST_PLAN` can still override the plan explicitly. If neither is available, the statusline falls back to `assumed pro` so the percentage is not presented as a detected plan.

The generated statusline launcher is workspace-aware because statusline settings point at a fixed command and do not use the extension resolver. When Copilot sends a statusline payload with `workspace.current_dir` or `cwd` inside a `copilot-cli-cost` checkout or worktree, the launcher runs that checkout's `src/cli/statusline.js`; otherwise it falls back to the installed plugin copy. Set `COPILOT_COST_STATUSLINE_DISABLE_WORKSPACE=true` to always use the installed copy.

## Use

```text
/cost
/cost help
/cost version
/cost update
/cost panel on
/cost panel off
/cost panel refresh
/cost session <session-id>
/cost live-session <session-id>
/cost --plan pro|pro-plus|max|business|enterprise
/cost --currency USD|EUR|GBP|CAD|AUD|JPY|CHF
```

`/cost` is handled by extension JavaScript. It does not ask the model to calculate the result.

Use `/cost update` to force the extension to re-detect your current Copilot subscription and rewrite the shared cache used by the statusline. If the host exposes a statusline refresh hook, the command also requests an immediate refresh; otherwise the updated plan appears on the next normal statusline refresh.

The extension also registers a **Session Cost** canvas in the GitHub Copilot app. It uses the same installed extension shim as `/cost`, so no separate canvas install is required.

The panel command opens a native window:

```text
/cost panel on
```

The panel shows:

- Usage-based estimate
- Percentage of the selected plan's allowance used by the session
- Searchable session picker for current, cached live, and completed sessions
- Selected session ID and data source
- Current or assumed subscription
- Loaded extension version
- What-if subscription selector
- Display currency selector
- Per-model token bucket breakdown
- Collapsed raw JSON payload

## Data sources

The SDK extension reads active-session metrics from Copilot CLI's session RPC API:

```js
await session.rpc.usage.getMetrics()
```

That response includes:

- Per-model request counts
- Copilot-reported AI credit usage (`totalNanoAiu`) when available
- Input, cached input, cache write, output, and reasoning token buckets
- Active model
- Last-call input/output token counts
- API duration
- Code-change counters

The extension normalizes each read and writes a live snapshot to the platform cache folder:

```text
Windows: %LOCALAPPDATA%\copilot-cli-cost\live-sessions
macOS:   ~/Library/Caches/copilot-cli-cost/live-sessions
Linux:   ${XDG_CACHE_HOME:-~/.cache}/copilot-cli-cost/live-sessions
```

Completed local sessions can be read from:

```text
Windows: %USERPROFILE%\.copilot\session-state\<session-id>\events.jsonl
macOS/Linux: ~/.copilot/session-state/<session-id>/events.jsonl
```

The parser reads the latest metrics event and extracts Copilot-reported AI credit usage and per-model token buckets.

For usage-based billing, Copilot-reported AI credits are preferred because they match the CLI's own **AI Credits** counter. Token-rate estimates are retained as a fallback when Copilot does not provide AI credit totals, and the panel labels which method was used.

When statusline payloads include `transcript_path`, live snapshots are also grouped into a logical session. This keeps each resumed Copilot CLI instance as its own snapshot while letting `/cost`, the statusline segment, and the panel show the total cost across resumed instances.

## Statusline passthrough

Set `COPILOT_COST_STATUSLINE_PASSTHROUGH` to call another statusline command. The default passthrough mode enriches the stdin JSON with `copilot_cost` and lets the inner statusline render all output.

PowerShell:

```powershell
$env:COPILOT_COST_STATUSLINE_PASSTHROUGH = "C:\Users\alex\.copilot\statusline\statusline.cmd"
copilot
```

macOS/Linux:

```sh
export COPILOT_COST_STATUSLINE_PASSTHROUGH="$HOME/.copilot/statusline/statusline.sh"
copilot
```

The enriched payload includes:

```jsonc
{
  "copilot_cost": {
    "schema_version": 2,
    "status_line": "💸 Cost ~$0.3059 (30.6 cr, 2% pro) · last 42K in/3K out",
    "aggregate_usage_based": {
      "billingModel": "usage-based",
      "totalUsd": 0.305869,
      "aiCredits": 30.5869,
      "creditCalculationSource": "copilot-cli-session-aiu"
    },
    "usage_based": {
      "billingModel": "usage-based",
      "totalUsd": 0.305869,
      "aiCredits": 30.5869,
      "creditCalculationSource": "copilot-cli-session-aiu"
    }
  }
}
```

Set decorate mode to combine this bridge's output with the passthrough output:

PowerShell:

```powershell
$env:COPILOT_COST_STATUSLINE_MODE = "decorate"
$env:COPILOT_COST_STATUSLINE_POSITION = "right"
copilot
```

macOS/Linux:

```sh
export COPILOT_COST_STATUSLINE_MODE=decorate
export COPILOT_COST_STATUSLINE_POSITION=right
copilot
```

Statusline environment variables:

| Variable | Default | Meaning |
| --- | --- | --- |
| `COPILOT_COST_STATUSLINE_PASSTHROUGH` | unset | Command to invoke with enriched statusline JSON on stdin. |
| `COPILOT_COST_STATUSLINE_MODE` | `passthrough` when passthrough is set, otherwise `standalone` | `passthrough`, `decorate`, or `standalone`. |
| `COPILOT_COST_STATUSLINE_POSITION` | `right` | In `decorate` mode: `right`, `left`, `replace`, or `passthrough`. |
| `COPILOT_COST_STATUSLINE_SEPARATOR` | ` · ` | In `decorate` mode: text between the passthrough output and cost segment. |
| `COPILOT_COST_STATUSLINE_PASSTHROUGH_TIMEOUT_MS` | `1000` | Maximum time to wait for the passthrough command. |
| `COPILOT_COST_STATUSLINE_HIDE_COST` | `false` | Cache live data but do not print the cost segment. |
| `COPILOT_COST_STATUSLINE_COLOR` | `true` | Set to `false` to disable ANSI color in the rendered cost segment. |

## Configuration

Set these environment variables before launching `copilot`:

PowerShell:

```powershell
$env:COPILOT_COST_PLAN = "enterprise"
$env:COPILOT_COST_CURRENCY = "EUR"
copilot
```

macOS/Linux:

```sh
export COPILOT_COST_PLAN=enterprise
export COPILOT_COST_CURRENCY=EUR
copilot
```

| Variable | Meaning |
| --- | --- |
| `COPILOT_COST_PLAN` | Default plan when subscription detection is unavailable. |
| `COPILOT_COST_CURRENCY` | Display currency code. USD is canonical. Non-USD values use Frankfurter unless an override is configured. |
| `COPILOT_COST_EXCHANGE_RATE` | USD-to-display-currency exchange rate override for `COPILOT_COST_CURRENCY`. |
| `COPILOT_COST_FX_<CODE>` | USD-to-currency exchange rate override for a specific currency, for example `COPILOT_COST_FX_EUR=0.9`. |
| `COPILOT_COST_FX_CACHE` | Exchange-rate cache folder. Defaults to `%LOCALAPPDATA%\copilot-cli-cost\fx-rates` on Windows, `~/Library/Caches/copilot-cli-cost/fx-rates` on macOS, or `${XDG_CACHE_HOME:-~/.cache}/copilot-cli-cost/fx-rates` on Linux. |
| `COPILOT_COST_SUBSCRIPTION_CACHE` | Current subscription cache file used by the statusline. Defaults to `current-subscription.json` under the platform cache root. |
| `COPILOT_COST_PROMOTIONAL_ALLOWANCE` | Override promotional Business/Enterprise AI Credit allowances. During the June 1-September 1, 2026 transition this defaults on; set `false` to disable or `true` to force on. |
| `COPILOT_COST_BILL_REASONING_TOKENS` | Set to `true` to include reasoning tokens as output-priced cost. By default they are shown as informational only. |

The live session cache can be overridden with `COPILOT_COST_LIVE_STORE`. By default it uses the same platform cache root as `COPILOT_COST_FX_CACHE`.

### Native panel notes

The `/cost` command and calculator are pure Node.js. The native panel uses `@webviewjs/webview`, which installs a platform-specific optional package for Windows, macOS, and Linux x64. The extension bootstrap runs `npm install --include=optional --no-audit --no-fund` when those panel dependencies are missing.

On Linux, the native webview package still depends on system GTK/WebKit libraries supplied by your distribution, such as WebKitGTK and GTK. If `/cost panel on` fails to open, install your distribution's WebKitGTK/GTK runtime packages and reload the extension.

## Standalone calculator

Clone the repository when you want to run tests or use the calculator directly:

```powershell
git clone https://github.com/DamianEdwards/copilot-cli-cost.git
cd copilot-cli-cost
npm test
```

Examples:

```powershell
npm run cost -- --sample
npm run cost -- --session <session-id> --plan pro
npm run cost -- --live --plan max
npm run cost -- --sample --currency EUR
npm run cost -- --sample --currency EUR --exchange-rate 0.9
```

Usage JSON shape:

```json
{
  "sessionId": "sample-session-001",
  "plan": "pro",
  "currency": "USD",
  "modelUsage": [
    {
      "model": "gpt-5.5",
      "requests": 3,
      "inputTokens": 600000,
      "cachedInputTokens": 420000,
      "cacheWriteTokens": 0,
      "outputTokens": 36000,
      "reasoningTokens": 1200
    }
  ]
}
```

## How estimates are calculated

Usage-based billing uses published per-1M-token rates. `inputTokens` is the total input token count from Copilot metrics, and `cachedInputTokens` is the cached subset, so only uncached input tokens use the regular input rate:

```text
uncachedInputTokens = max(inputTokens - cachedInputTokens, 0)
inputUsd            = uncachedInputTokens / 1,000,000 * inputPerMillionUsd
cachedInputUsd      = cachedInputTokens   / 1,000,000 * cachedInputPerMillionUsd
cacheWriteUsd       = cacheWriteTokens    / 1,000,000 * cacheWritePerMillionUsd
outputUsd           = outputTokens        / 1,000,000 * outputPerMillionUsd
reasoningUsd        = 0 unless COPILOT_COST_BILL_REASONING_TOKENS=true
aiCredits           = totalUsd / 0.01
includedAiCredits   = baseAiCredits + current flexAiCredits + current promotionalAiCredits
```

Some published model rates include a higher long-context tier. The calculator selects that tier when the model's total `inputTokens` exceeds the documented threshold, or when Copilot reports a model name that explicitly indicates an extended context variant such as `Long Context`, `Large Context`, or `1M Context`.

For individual usage-based billing, Pro and Pro+ include a fixed base credit amount plus a variable flex allotment. The calculator reports the current published total as included credits and preserves the base/flex split in machine-readable output.

During GitHub's June 1-September 1, 2026 usage-based billing transition, existing Copilot Business and Enterprise customers receive promotional included credits. The calculator applies those promotional credits by default during that window and preserves them as a separate `promotionalAiCredits` component, for example `7,000 included (3,900 base + 3,100 promotional)` for Copilot Enterprise.

Non-USD currency values are display estimates. USD remains canonical because GitHub model rates and AI Credits are documented in USD. Non-USD `/cost` and panel requests fetch USD exchange rates from [Frankfurter](https://www.frankfurter.dev/) and cache them for reuse; explicit environment or CLI exchange-rate overrides take precedence.

## Limitations

- Rate tables are hardcoded in `src/core/rates.js` and should be checked against GitHub billing docs.
- Reasoning tokens are shown as informational only unless `COPILOT_COST_BILL_REASONING_TOKENS=true`, because GitHub's published Copilot pricing table does not list a separate reasoning-token bucket.
- Business and Enterprise included credits are pooled at the billing entity level, so a session estimate is not always incremental billable spend.
- Taxes, regional billing rules, and GitHub billing-account currency handling are not modeled.
- Statusline per-model attribution depends on successive cumulative payloads and the active model at each refresh. Resumed-session aggregation depends on `transcript_path`; without it, live snapshots fall back to the current `session_id` and cannot be linked to previous instances.

## License

MIT. See [LICENSE](LICENSE).
