import fs from "node:fs";
import path from "node:path";
import { getAppCacheSubdirectory } from "./app-cache-dir.js";
import { normalizeCurrency } from "./currency.js";

const DEFAULT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const FRANKFURTER_API_BASE = "https://api.frankfurter.dev";

export async function getUsdExchangeRate(currency, options = {}) {
  const code = normalizeCurrency(currency);
  if (code === "USD") {
    return {
      base: "USD",
      fetchedAt: new Date(now(options)).toISOString(),
      quote: "USD",
      rate: 1,
      source: "native-usd"
    };
  }

  const cached = readCachedUsdExchangeRate(code, options);
  if (cached) {
    return cached;
  }

  try {
    return await fetchUsdExchangeRate(code, options);
  } catch (error) {
    const stale = readCachedUsdExchangeRate(code, {
      ...options,
      allowStale: true
    });
    if (stale) {
      return {
        ...stale,
        error: error.message,
        source: "frankfurter-cache-stale",
        stale: true
      };
    }
    throw error;
  }
}

export function getFxRateCacheDirectory(options = {}) {
  const env = options.env ?? process.env;
  return options.cacheDirectory
    ?? env.COPILOT_COST_FX_CACHE
    ?? getAppCacheSubdirectory("fx-rates", options);
}

export function readCachedUsdExchangeRate(currency, options = {}) {
  const code = normalizeCurrency(currency);
  const cachePath = getUsdExchangeRateCachePath(code, options);
  if (!fs.existsSync(cachePath)) {
    return null;
  }

  const cached = JSON.parse(fs.readFileSync(cachePath, "utf8"));
  const rate = Number(cached.rate);
  const fetchedAtMs = Date.parse(cached.fetchedAt);
  const ttlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  if (!Number.isFinite(rate) || rate <= 0 || !Number.isFinite(fetchedAtMs)) {
    return null;
  }
  if (!options.allowStale && now(options) - fetchedAtMs > ttlMs) {
    return null;
  }

  return {
    base: "USD",
    date: cached.date,
    fetchedAt: cached.fetchedAt,
    quote: code,
    rate,
    source: "frankfurter-cache",
    url: cached.url
  };
}

export async function fetchUsdExchangeRate(currency, options = {}) {
  const code = normalizeCurrency(currency);
  const url = `${options.apiBase ?? FRANKFURTER_API_BASE}/v2/rate/USD/${encodeURIComponent(code)}`;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error("No fetch implementation available for currency exchange rates.");
  }

  const response = await fetchImpl(url, {
    headers: {
      accept: "application/json"
    }
  });
  if (!response.ok) {
    throw new Error(`Frankfurter exchange-rate request failed: HTTP ${response.status}`);
  }

  const payload = await response.json();
  const rate = Number(payload.rate ?? payload.rates?.[code]);
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error(`Frankfurter did not return a valid USD-to-${code} rate.`);
  }

  const result = {
    base: "USD",
    date: payload.date,
    fetchedAt: new Date(now(options)).toISOString(),
    quote: code,
    rate,
    source: "frankfurter",
    url
  };
  writeCachedUsdExchangeRate(result, options);
  return result;
}

export function writeCachedUsdExchangeRate(rateInfo, options = {}) {
  const directory = getFxRateCacheDirectory(options);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(getUsdExchangeRateCachePath(rateInfo.quote, options), JSON.stringify(rateInfo, null, 2));
}

function getUsdExchangeRateCachePath(currency, options = {}) {
  return path.join(getFxRateCacheDirectory(options), `USD-${normalizeCurrency(currency)}.json`);
}

function now(options = {}) {
  return options.now === undefined ? Date.now() : Number(options.now);
}
