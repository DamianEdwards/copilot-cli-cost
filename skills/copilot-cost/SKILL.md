---
name: copilot-cost
description: Estimate Copilot CLI session cost from model usage, token counts, subscription plan, and display currency.
---

Use this skill when the user asks about Copilot CLI session cost, AI credits, plan comparison, or currency conversion.

Cost principles:

- Treat USD as canonical because GitHub model rates and AI Credits are documented in USD.
- Usage-based billing uses input, cached input, cache write, and output token buckets multiplied by per-model USD rates.
- AI Credits are derived from USD at 1 AI Credit = $0.01 USD.
- Currency conversion is a display layer. For non-USD currencies, use a supplied exchange-rate snapshot and label the result as an estimate.
- Business and Enterprise included credits are pooled, so a session cost is not necessarily an incremental billable charge.

If exact session token data is not available, explain that limitation and avoid presenting an estimate as an actual bill.

For live Copilot CLI sessions, prefer the cached statusline bridge data:

```powershell
node src/cli/cost.js --live
```

Use completed-session event metrics when the user asks for a finished session:

```powershell
node src/cli/cost.js --session <session-id>
```
