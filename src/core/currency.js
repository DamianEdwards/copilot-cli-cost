export function resolveCurrency(currency, options = {}) {
  const code = normalizeCurrency(currency);
  if (code === "USD") {
    return {
      code,
      exchangeRate: 1,
      source: "native-usd"
    };
  }

  const metadata = options.exchangeRateMetadata?.[code];
  const configuredRate = options.exchangeRates?.[code] ?? readRateFromEnvironment(code);
  if (!configuredRate || Number(configuredRate) <= 0) {
    throw new Error(`No USD-to-${code} exchange rate configured. Pass --exchange-rate <rate> or set COPILOT_COST_FX_${code}.`);
  }

  return {
    code,
    exchangeRate: Number(configuredRate),
    source: metadata?.source ?? (options.exchangeRates?.[code] ? "configured" : "environment"),
    date: metadata?.date,
    fetchedAt: metadata?.fetchedAt,
    url: metadata?.url
  };
}

export function convertUsd(usd, currencyInfo) {
  return roundMoney(usd * currencyInfo.exchangeRate);
}

export function formatMoney(amount, currencyCode = "USD", locale = undefined) {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: normalizeCurrency(currencyCode),
    maximumFractionDigits: amount < 1 ? 4 : 2
  }).format(amount);
}

export function normalizeCurrency(currency = "USD") {
  return String(currency).trim().toUpperCase();
}

function readRateFromEnvironment(code) {
  return process.env[`COPILOT_COST_FX_${code}`];
}

function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 10_000) / 10_000;
}

