export const AI_CREDIT_USD = 0.01;
export const TOKENS_PER_MILLION = 1_000_000;

export const planIds = Object.freeze({
  free: "free",
  pro: "pro",
  proPlus: "pro-plus",
  max: "max",
  business: "business",
  enterprise: "enterprise",
  student: "student"
});

export const planAiCreditAllotments = Object.freeze({
  [planIds.free]: aiCreditAllotment({ base: 0 }),
  [planIds.pro]: aiCreditAllotment({ base: 1000, flex: 500 }),
  [planIds.proPlus]: aiCreditAllotment({ base: 3900, flex: 3100 }),
  [planIds.max]: aiCreditAllotment({ base: 10000, flex: 10000 }),
  [planIds.business]: aiCreditAllotment({ base: 1900 }),
  [planIds.enterprise]: aiCreditAllotment({ base: 3900 }),
  [planIds.student]: aiCreditAllotment({ base: 0 })
});

export const planAllowances = Object.freeze({
  aiCredits: Object.freeze(Object.fromEntries(
    Object.entries(planAiCreditAllotments).map(([plan, allotment]) => [plan, allotment.totalAiCredits])
  )),
  promotionalAiCredits: {
    [planIds.business]: 1100,
    [planIds.enterprise]: 3100
  }
});

export const promotionalAllowancePeriod = Object.freeze({
  startsAt: "2026-06-01T00:00:00.000Z",
  endsBefore: "2026-09-01T00:00:00.000Z"
});

export const usageBasedRates = Object.freeze({
  "gpt-5-mini": rate({ input: 0.25, cachedInput: 0.025, output: 2 }),
  "gpt-5.3-codex": rate({ input: 1.75, cachedInput: 0.175, output: 14 }),
  "gpt-5.4": rate({
    input: 2.5,
    cachedInput: 0.25,
    output: 15,
    longContext: { thresholdInputTokens: 272_000, input: 5, cachedInput: 0.5, output: 22.5 }
  }),
  "gpt-5.4-mini": rate({ input: 0.75, cachedInput: 0.075, output: 4.5 }),
  "gpt-5.4-nano": rate({ input: 0.2, cachedInput: 0.02, output: 1.25 }),
  "gpt-5.5": rate({
    input: 5,
    cachedInput: 0.5,
    output: 30,
    longContext: { thresholdInputTokens: 272_000, input: 10, cachedInput: 1, output: 45 }
  }),
  "claude-haiku-4.5": rate({ input: 1, cachedInput: 0.1, cacheWrite: 1.25, output: 5 }),
  "claude-sonnet-4": rate({ input: 3, cachedInput: 0.3, cacheWrite: 3.75, output: 15 }),
  "claude-sonnet-4.5": rate({ input: 3, cachedInput: 0.3, cacheWrite: 3.75, output: 15 }),
  "claude-sonnet-4.6": rate({ input: 3, cachedInput: 0.3, cacheWrite: 3.75, output: 15 }),
  "claude-opus-4.5": rate({ input: 5, cachedInput: 0.5, cacheWrite: 6.25, output: 25 }),
  "claude-opus-4.6": rate({ input: 5, cachedInput: 0.5, cacheWrite: 6.25, output: 25 }),
  "claude-opus-4.7": rate({ input: 5, cachedInput: 0.5, cacheWrite: 6.25, output: 25 }),
  "claude-opus-4.8": rate({ input: 5, cachedInput: 0.5, cacheWrite: 6.25, output: 25 }),
  "claude-fable-5": rate({ input: 10, cachedInput: 1, cacheWrite: 12.5, output: 50 }),
  "gemini-2.5-pro": rate({ input: 1.25, cachedInput: 0.125, output: 10 }),
  "gemini-3-flash": rate({ input: 0.5, cachedInput: 0.05, output: 3 }),
  "gemini-3.1-pro": rate({
    input: 2,
    cachedInput: 0.2,
    output: 12,
    longContext: { thresholdInputTokens: 200_000, input: 4, cachedInput: 0.4, output: 18 }
  }),
  "gemini-3.5-flash": rate({ input: 1.5, cachedInput: 0.15, output: 9 }),
  "mai-code-1-flash": rate({ input: 0.75, cachedInput: 0.075, output: 4.5 }),
  "raptor-mini": rate({ input: 0.25, cachedInput: 0.025, output: 2 }),
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
  "claude opus 4.8": "claude-opus-4.8",
  "claude fable 5": "claude-fable-5",
  "gemini 2.5 pro": "gemini-2.5-pro",
  "gemini 3 flash": "gemini-3-flash",
  "gemini 3.1 pro": "gemini-3.1-pro",
  "gemini 3.5 flash": "gemini-3.5-flash",
  "goldeneye": "mai-code-1-flash",
  "mai code 1 flash": "mai-code-1-flash",
  "raptor mini": "raptor-mini"
});

function rate({ input, cachedInput, cacheWrite = 0, output, longContext }) {
  const defaultRate = Object.freeze({
    tier: "default",
    inputPerMillionUsd: input,
    cachedInputPerMillionUsd: cachedInput,
    cacheWritePerMillionUsd: cacheWrite,
    outputPerMillionUsd: output
  });
  if (!longContext) {
    return defaultRate;
  }
  return Object.freeze({
    ...defaultRate,
    longContext: Object.freeze({
      tier: "long-context",
      thresholdInputTokens: longContext.thresholdInputTokens,
      inputPerMillionUsd: longContext.input,
      cachedInputPerMillionUsd: longContext.cachedInput,
      cacheWritePerMillionUsd: longContext.cacheWrite ?? cacheWrite,
      outputPerMillionUsd: longContext.output
    })
  });
}

function aiCreditAllotment({ base, flex = 0 }) {
  return Object.freeze({
    baseAiCredits: base,
    flexAiCredits: flex,
    totalAiCredits: base + flex
  });
}
