export const AI_CREDIT_USD = 0.01;
export const PREMIUM_REQUEST_USD = 0.04;
export const TOKENS_PER_MILLION = 1_000_000;

export const planIds = Object.freeze({
  free: "free",
  pro: "pro",
  proPlus: "pro-plus",
  business: "business",
  enterprise: "enterprise",
  student: "student"
});

export const planAllowances = Object.freeze({
  premiumRequests: {
    [planIds.free]: 50,
    [planIds.pro]: 300,
    [planIds.proPlus]: 1500,
    [planIds.business]: 300,
    [planIds.enterprise]: 1000,
    [planIds.student]: 300
  },
  aiCredits: {
    [planIds.free]: 0,
    [planIds.pro]: 1000,
    [planIds.proPlus]: 3900,
    [planIds.business]: 1900,
    [planIds.enterprise]: 3900,
    [planIds.student]: 0
  },
  promotionalAiCredits: {
    [planIds.business]: 3000,
    [planIds.enterprise]: 7000
  }
});

export const usageBasedRates = Object.freeze({
  "gpt-4.1": rate({ input: 2, cachedInput: 0.5, output: 8 }),
  "gpt-5-mini": rate({ input: 0.25, cachedInput: 0.025, output: 2 }),
  "gpt-5.2": rate({ input: 1.75, cachedInput: 0.175, output: 14 }),
  "gpt-5.2-codex": rate({ input: 1.75, cachedInput: 0.175, output: 14 }),
  "gpt-5.3-codex": rate({ input: 1.75, cachedInput: 0.175, output: 14 }),
  "gpt-5.4": rate({ input: 2.5, cachedInput: 0.25, output: 15 }),
  "gpt-5.4-mini": rate({ input: 0.75, cachedInput: 0.075, output: 4.5 }),
  "gpt-5.4-nano": rate({ input: 0.2, cachedInput: 0.02, output: 1.25 }),
  "gpt-5.5": rate({ input: 5, cachedInput: 0.5, output: 30 }),
  "claude-haiku-4.5": rate({ input: 1, cachedInput: 0.1, cacheWrite: 1.25, output: 5 }),
  "claude-sonnet-4": rate({ input: 3, cachedInput: 0.3, cacheWrite: 3.75, output: 15 }),
  "claude-sonnet-4.5": rate({ input: 3, cachedInput: 0.3, cacheWrite: 3.75, output: 15 }),
  "claude-sonnet-4.6": rate({ input: 3, cachedInput: 0.3, cacheWrite: 3.75, output: 15 }),
  "claude-opus-4.5": rate({ input: 5, cachedInput: 0.5, cacheWrite: 6.25, output: 25 }),
  "claude-opus-4.6": rate({ input: 5, cachedInput: 0.5, cacheWrite: 6.25, output: 25 }),
  "claude-opus-4.7": rate({ input: 5, cachedInput: 0.5, cacheWrite: 6.25, output: 25 }),
  "gemini-2.5-pro": rate({ input: 1.25, cachedInput: 0.125, output: 10 }),
  "gemini-3-flash": rate({ input: 0.5, cachedInput: 0.05, output: 3 }),
  "gemini-3.1-pro": rate({ input: 2, cachedInput: 0.2, output: 12 }),
  "grok-code-fast-1": rate({ input: 0.2, cachedInput: 0.02, output: 1.5 }),
  "raptor-mini": rate({ input: 0.25, cachedInput: 0.025, output: 2 }),
  "goldeneye": rate({ input: 1.25, cachedInput: 0.125, output: 10 })
});

export const premiumRequestMultipliers = Object.freeze({
  current: {
    "claude-haiku-4.5": 0.33,
    "claude-opus-4.5": 3,
    "claude-opus-4.6": 3,
    "claude-opus-4.7": 15,
    "claude-sonnet-4": 1,
    "claude-sonnet-4.5": 1,
    "claude-sonnet-4.6": 1,
    "gemini-2.5-pro": 1,
    "gemini-3-flash": 0.33,
    "gemini-3-pro": 1,
    "gemini-3.1-pro": 1,
    "gpt-4o": 0,
    "gpt-4o-mini": 0,
    "gpt-4.1": 0,
    "gpt-5.1": 1,
    "gpt-5.1-codex": 1,
    "gpt-5.1-codex-mini": 0.33,
    "gpt-5.1-codex-max": 1,
    "gpt-5.2": 1,
    "gpt-5.2-codex": 1,
    "gpt-5.3-codex": 1,
    "gpt-5.4": 1,
    "gpt-5.4-mini": 0.33,
    "gpt-5.5": 7.5,
    "gpt-5-mini": 0,
    "grok-code-fast-1": 0.25,
    "raptor-mini": 0
  },
  "annual-after-2026-06-01": {
    "claude-haiku-4.5": 0.33,
    "claude-opus-4.5": 15,
    "claude-opus-4.6": 27,
    "claude-opus-4.7": 27,
    "claude-sonnet-4": 1,
    "claude-sonnet-4.5": 6,
    "claude-sonnet-4.6": 9,
    "gemini-2.5-pro": 1,
    "gemini-3-flash": 0.33,
    "gemini-3-pro": 6,
    "gemini-3.1-pro": 6,
    "gpt-4o": 0.33,
    "gpt-4o-mini": 0.33,
    "gpt-4.1": 1,
    "gpt-5.1": 3,
    "gpt-5.1-codex": 3,
    "gpt-5.1-codex-mini": 0.33,
    "gpt-5.1-codex-max": 3,
    "gpt-5.2": 3,
    "gpt-5.2-codex": 3,
    "gpt-5.3-codex": 6,
    "gpt-5.4": 6,
    "gpt-5.4-mini": 6,
    "gpt-5.5": 7.5,
    "gpt-5-mini": 0.33,
    "grok-code-fast-1": 0.33,
    "raptor-mini": 0.33
  }
});

export const modelAliases = Object.freeze({
  "gpt-5 mini": "gpt-5-mini",
  "gpt-5.4 mini": "gpt-5.4-mini",
  "gpt-5.4 nano": "gpt-5.4-nano",
  "claude haiku 4.5": "claude-haiku-4.5",
  "claude sonnet 4": "claude-sonnet-4",
  "claude sonnet 4.5": "claude-sonnet-4.5",
  "claude sonnet 4.6": "claude-sonnet-4.6",
  "claude opus 4.5": "claude-opus-4.5",
  "claude opus 4.6": "claude-opus-4.6",
  "claude opus 4.7": "claude-opus-4.7",
  "gemini 2.5 pro": "gemini-2.5-pro",
  "gemini 3 flash": "gemini-3-flash",
  "gemini 3.1 pro": "gemini-3.1-pro",
  "grok code fast 1": "grok-code-fast-1",
  "raptor mini": "raptor-mini"
});

function rate({ input, cachedInput, cacheWrite = 0, output }) {
  return Object.freeze({
    inputPerMillionUsd: input,
    cachedInputPerMillionUsd: cachedInput,
    cacheWritePerMillionUsd: cacheWrite,
    outputPerMillionUsd: output
  });
}

