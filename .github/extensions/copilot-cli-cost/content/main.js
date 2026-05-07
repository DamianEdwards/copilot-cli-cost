const elements = {
  breakdown: document.getElementById("breakdown"),
  currency: document.getElementById("currency"),
  currencyNote: document.getElementById("currency-note"),
  currentPlan: document.getElementById("current-plan"),
  plan: document.getElementById("plan"),
  pruSubtitle: document.getElementById("pru-subtitle"),
  pruTotal: document.getElementById("pru-total"),
  raw: document.getElementById("raw"),
  refresh: document.getElementById("refresh"),
  sessionId: document.getElementById("session-id"),
  source: document.getElementById("source"),
  status: document.getElementById("status"),
  usageSubtitle: document.getElementById("usage-subtitle"),
  usageTotal: document.getElementById("usage-total"),
  whatIfNote: document.getElementById("what-if-note")
};
let selectedCurrency;
let selectedPlan;
const planAllowances = {
  free: { aiCredits: 0, premiumRequests: 50 },
  pro: { aiCredits: 1000, premiumRequests: 300 },
  "pro-plus": { aiCredits: 3900, premiumRequests: 1500 },
  business: { aiCredits: 1900, premiumRequests: 300 },
  enterprise: { aiCredits: 3900, premiumRequests: 1000 },
  student: { aiCredits: 0, premiumRequests: 300 }
};
const planLabels = {
  free: "Copilot Free",
  pro: "Copilot Pro",
  "pro-plus": "Copilot Pro+",
  business: "Copilot Business",
  enterprise: "Copilot Enterprise",
  student: "Copilot Student"
};

elements.refresh.addEventListener("click", refresh);
elements.plan.addEventListener("change", () => {
  selectedPlan = elements.plan.value;
  refresh();
});
elements.currency.addEventListener("change", () => {
  selectedCurrency = elements.currency.value;
  refresh();
});
document.addEventListener("click", openExternalLink);
setInterval(refresh, 2000);
refresh();

async function refresh() {
  try {
    const data = await copilot.getCostData({
      ...(selectedPlan ? { plan: selectedPlan } : {}),
      ...(selectedCurrency ? { currency: selectedCurrency } : {})
    });
    render(data);
  } catch (error) {
    elements.status.textContent = `Unable to read live cost data: ${error.message}`;
    elements.status.className = "status error";
  }
}

function render(data) {
  const usageBased = data.usageBased;
  const premiumRequests = data.premiumRequests;
  const sessionUsage = data.sessionUsage ?? {};
  const currentSubscription = data.currentSubscription ?? inferCurrentSubscription(data);
  const currentPlan = currentSubscription?.plan;
  const activePlan = selectedPlan ?? usageBased?.plan ?? premiumRequests?.plan ?? currentPlan;
  renderCurrentPlan(currentSubscription, activePlan);
  renderCurrency(data);
  if (!selectedPlan && activePlan && elements.plan.value !== activePlan) {
    elements.plan.value = activePlan;
  }

  elements.status.textContent = `Updated ${new Date(data.generatedAt).toLocaleTimeString()}`;
  elements.status.className = "status";
  elements.sessionId.textContent = sessionUsage.sessionId ?? "(unknown)";
  elements.source.textContent = sessionUsage.source ?? data.source ?? "-";

  if (usageBased?.error) {
    elements.usageTotal.textContent = "Unavailable";
    elements.usageSubtitle.textContent = usageBased.error;
  } else {
    const usagePlan = selectedPlan ?? usageBased.plan;
    const includedAiCredits = planAllowances[usagePlan]?.aiCredits ?? usageBased.includedAiCredits;
    elements.usageTotal.textContent = formatCurrency(usageBased.displayTotal, usageBased.currency.code);
    elements.usageSubtitle.textContent = `${formatNumber(usageBased.aiCredits, 1)} AI credits · ${formatNumber(includedAiCredits, 1)} included · ${usagePlan}`;
  }

  if (premiumRequests?.error) {
    elements.pruTotal.textContent = "Unavailable";
    elements.pruSubtitle.textContent = premiumRequests.error;
  } else {
    const pruPlan = selectedPlan ?? premiumRequests.plan;
    const includedPremiumRequests = planAllowances[pruPlan]?.premiumRequests ?? premiumRequests.includedPremiumRequests;
    elements.pruTotal.textContent = `${formatNumber(premiumRequests.totalPremiumRequests, 2)} PRU`;
    elements.pruSubtitle.textContent = `${formatCurrency(premiumRequests.displayOverageEquivalent, premiumRequests.currency.code)} overage-equivalent · ${formatNumber(includedPremiumRequests, 0)} included · ${pruPlan}`;
  }

  renderBreakdown(usageBased);
  elements.raw.textContent = JSON.stringify(data, null, 2);
}

function renderCurrency(data) {
  const currency = data.usageBased?.currency ?? data.premiumRequests?.currency;
  const currencyCode = currency?.code ?? data.exchangeRate?.quote ?? "USD";
  if (!selectedCurrency && elements.currency.value !== currencyCode) {
    elements.currency.value = currencyCode;
  }

  const rateInfo = data.exchangeRate ?? currency;
  if (currencyCode === "USD") {
    elements.currencyNote.textContent = "Currency: USD (canonical)";
    return;
  }

  const rate = Number(rateInfo?.rate ?? currency?.exchangeRate);
  const source = rateInfo?.source ?? currency?.source ?? "exchange rate";
  const date = rateInfo?.date ? ` · ${rateInfo.date}` : "";
  elements.currencyNote.textContent = `Currency: 1 USD = ${formatNumber(rate, 6)} ${currencyCode} · ${source}${date}`;
}

async function openExternalLink(event) {
  const link = event.target.closest("a[data-external]");
  if (!link) {
    return;
  }

  event.preventDefault();
  try {
    await copilot.openExternal(link.href);
  } catch (error) {
    elements.status.textContent = `Unable to open link: ${error.message}`;
    elements.status.className = "status error";
  }
}

function inferCurrentSubscription(data) {
  const inferredPlan = data.usageBased?.plan ?? data.premiumRequests?.plan;
  return inferredPlan
    ? {
        inferred: true,
        plan: inferredPlan,
        source: "calculated default plan"
      }
    : undefined;
}

function renderCurrentPlan(currentSubscription, activePlan) {
  const currentPlan = currentSubscription?.plan;
  updatePlanOptionLabels(currentPlan);

  if (currentPlan) {
    const currentLabel = planLabels[currentPlan] ?? currentPlan;
    const qualifier = currentSubscription.inferred ? "assumed" : "current";
    elements.currentPlan.textContent = `${capitalize(qualifier)} subscription: ${currentLabel}${currentSubscription.login ? ` (${currentSubscription.login})` : ""}`;
  } else {
    const rawPlan = currentSubscription?.rawPlan ? ` (${currentSubscription.rawPlan})` : "";
    elements.currentPlan.textContent = `Current subscription: unavailable${rawPlan}`;
  }

  if (currentPlan && activePlan && activePlan !== currentPlan) {
    elements.whatIfNote.textContent = `Showing what-if costs for ${planLabels[activePlan] ?? activePlan}. Select ${planLabels[currentPlan] ?? currentPlan} (current) to switch back.`;
  } else if (currentPlan) {
    elements.whatIfNote.textContent = "Showing your current subscription. Select another plan to compare allowances.";
  } else {
    elements.whatIfNote.textContent = "Recalculates allowances for the selected plan. Token usage and model are kept as observed.";
  }
}

function capitalize(value) {
  const text = String(value);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function updatePlanOptionLabels(currentPlan) {
  for (const option of elements.plan.options) {
    const label = planLabels[option.value] ?? option.value;
    option.textContent = option.value === currentPlan ? `${label} (current)` : label;
  }
}

function renderBreakdown(usageBased) {
  if (!usageBased?.modelBreakdown?.length) {
    elements.breakdown.innerHTML = "<p class=\"empty\">No model breakdown available.</p>";
    return;
  }

  const currency = usageBased.currency ?? { code: "USD", exchangeRate: 1 };
  elements.breakdown.innerHTML = usageBased.modelBreakdown.map((item) => {
    const uncachedInputTokens = item.uncachedInputTokens ?? Math.max(Number(item.inputTokens ?? 0) - Number(item.cachedInputTokens ?? 0), 0);
    return `
      <div class="model-card">
        <div class="model-card-header">
          <strong>${escapeHtml(item.model)}</strong>
          <span>${formatCurrency(item.displayTotal, currency.code)} · ${formatNumber(item.aiCredits, 1)} credits</span>
        </div>
        <table>
          <thead>
            <tr>
              <th>Bucket</th>
              <th>Tokens</th>
              <th>Rate / 1M (${escapeHtml(currency.code)})</th>
              <th>Cost (${escapeHtml(currency.code)})</th>
            </tr>
          </thead>
          <tbody>
            ${renderBucket("Uncached input", uncachedInputTokens, item.rates?.inputPerMillionUsd, item.inputUsd, currency)}
            ${renderBucket("Cached input", item.cachedInputTokens, item.rates?.cachedInputPerMillionUsd, item.cachedInputUsd, currency)}
            ${renderBucket("Cache write", item.cacheWriteTokens, item.rates?.cacheWritePerMillionUsd, item.cacheWriteUsd, currency)}
            ${renderBucket("Output", item.outputTokens, item.rates?.outputPerMillionUsd, item.outputUsd, currency)}
            ${renderBucket("Reasoning", item.reasoningTokens, item.rates?.reasoningPerMillionUsd, item.reasoningUsd, currency)}
          </tbody>
        </table>
      </div>
    `;
  }).join("");
}

function renderBucket(label, tokens, rate, cost, currency) {
  const displayedRate = rate ?? inferRatePerMillion(tokens, cost);
  const exchangeRate = Number(currency?.exchangeRate ?? 1);
  return `
    <tr>
      <td>${escapeHtml(label)}</td>
      <td>${formatInteger(tokens)}</td>
      <td>${formatCurrency(displayedRate * exchangeRate, currency?.code ?? "USD")}</td>
      <td>${formatCurrency(Number(cost ?? 0) * exchangeRate, currency?.code ?? "USD")}</td>
    </tr>
  `;
}

function inferRatePerMillion(tokens, cost) {
  const tokenCount = Number(tokens ?? 0);
  const bucketCost = Number(cost ?? 0);
  if (!Number.isFinite(tokenCount) || tokenCount <= 0 || !Number.isFinite(bucketCost)) {
    return 0;
  }
  return (bucketCost / tokenCount) * 1_000_000;
}

function formatCurrency(value, currencyCode = "USD") {
  return `~${new Intl.NumberFormat(undefined, {
    currency: currencyCode,
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
    style: "currency"
  }).format(Number(value ?? 0))}`;
}

function formatInteger(value) {
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 0
  }).format(Number(value ?? 0));
}

function formatNumber(value, maximumFractionDigits = 1) {
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits
  }).format(Number(value ?? 0));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;"
  })[char]);
}
