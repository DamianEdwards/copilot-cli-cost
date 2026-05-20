---
description: Show Copilot CLI session cost estimates and what-if plan comparisons.
argument-hint: "[update|session <session-id>] [--plan PLAN] [--billing-model MODEL] [--currency CODE]"
---

Show the Copilot CLI cost for the requested session.

Use this workflow:

1. If the user asks for the current session, first try `node src/cli/cost.js --live`.
2. If the user asks to update the statusline plan cache, use `/cost update` in the extension session.
3. If the user asks for `session <session-id>`, look for live statusline data with `node src/cli/cost.js --live-session <session-id>` or completed-session data with `node src/cli/cost.js --session <session-id>`.
4. If a premium request count is available, use `node src/cli/cost.js --premium-requests <count> --billing-model premium-requests`.
5. If exact token data is unavailable, explain whether the statusline bridge has not been enabled yet or whether completed-session metrics are missing.
6. Use `node src/cli/cost.js --file <usage-json>` when a session usage JSON file is available.
7. Support what-if comparisons by rerunning the calculator with `--plan`, `--billing-model`, `--multiplier-set`, `--currency`, and `--exchange-rate`.

Prefer a concise breakdown with:

- total USD cost
- selected display currency
- AI credits or premium request units
- per-model breakdown
- whether the result is actual, reconciled, or estimated

