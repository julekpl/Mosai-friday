/**
 * AI cost budget — pure configuration and arithmetic (no Convex imports), so
 * the gateway, the ledger mutations, the Billing page and the unit tests all
 * read the same numbers.
 *
 * Money rule (AGENTS.md §5.7): every amount is an integer number of
 * micro-US-dollars (1 USD = 1_000_000 µUSD) plus the currency code. Prices in
 * the model catalog are USD per million tokens, so `tokens x usdPerMillion`
 * is already a micro-USD amount.
 *
 * Two independent caps are enforced BEFORE any provider call:
 *  - a monthly cap per organization, per plan (calendar month, UTC);
 *  - a platform-wide daily cap (calendar day, UTC) — the kill switch. Set
 *    `MOSAI_AI_DAILY_CAP_MICROUSD=0` on the deployment to stop all AI calls.
 */

import type { Plan } from "./capabilities";

export const AI_BUDGET_CURRENCY = "USD" as const;
export type AiBudgetCurrency = typeof AI_BUDGET_CURRENCY;

export type ModelPrice = {
  promptUsdPerMillion: number;
  completionUsdPerMillion: number;
};

/**
 * The owner-editable budget table. Change a number here and redeploy.
 * Defaults (owner ask, 24 Sep 2026: "an AI budget that will not cost me a
 * fortune"): free US$0.25, starter US$2, growth US$5, scale US$15 per
 * organization per month; the whole platform stops at US$10 per day.
 */
export const AI_BUDGET_CONFIG = {
  monthlyMicrousdByPlan: {
    free: 250_000,
    starter: 2_000_000,
    growth: 5_000_000,
    scale: 15_000_000,
  } satisfies Record<Plan, number>,
  /** Budget for a run that cannot be attributed to any organization. */
  unattributedMonthlyMicrousd: 250_000,
  /** Platform-wide daily cap; overridden by the env var below. */
  platformDailyMicrousd: 10_000_000,
  platformDailyEnvVar: "MOSAI_AI_DAILY_CAP_MICROUSD",
  /**
   * Used when the operator has not recorded a model's price. Deliberately
   * expensive (frontier-model list prices) so an unknown model reserves too
   * much rather than too little.
   */
  unknownModelPrice: { promptUsdPerMillion: 15, completionUsdPerMillion: 75 } satisfies ModelPrice,
  /** Conservative prompt-size estimate: English averages ~4 characters per
   *  token; 3 over-counts, so the reservation errs on the safe side. */
  charsPerPromptToken: 3,
  /** Every chat message carries a few tokens of framing. */
  tokensPerMessageOverhead: 8,
} as const;

/**
 * Published OpenRouter list prices for models the platform may use before an
 * operator records a price in admin > AI models (checked 24 Sep 2026). A price
 * stored on the `aiModels` row always wins over this table.
 */
export const KNOWN_MODEL_PRICES: Readonly<Record<string, ModelPrice>> = {
  "openai/gpt-4o-mini": { promptUsdPerMillion: 0.15, completionUsdPerMillion: 0.6 },
};

export function monthlyBudgetMicrousd(plan: Plan | null): number {
  return plan === null
    ? AI_BUDGET_CONFIG.unattributedMonthlyMicrousd
    : AI_BUDGET_CONFIG.monthlyMicrousdByPlan[plan];
}

/**
 * The platform-wide daily cap. A non-negative integer from the environment
 * wins (0 disables AI entirely); anything else falls back to the default so a
 * typo can never lift the cap. The value is never logged or returned.
 */
export function platformDailyCapMicrousd(raw: string | undefined): number {
  const trimmed = raw?.trim() ?? "";
  if (/^\d{1,15}$/.test(trimmed)) return Number(trimmed);
  return AI_BUDGET_CONFIG.platformDailyMicrousd;
}

export type BudgetPeriod = { key: string; start: number; resetsAt: number };

/** Calendar month in UTC, e.g. `2026-09`. */
export function monthPeriod(now: number): BudgetPeriod {
  const date = new Date(now);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  return {
    key: `${year}-${String(month + 1).padStart(2, "0")}`,
    start: Date.UTC(year, month, 1),
    resetsAt: Date.UTC(year, month + 1, 1),
  };
}

/** Calendar day in UTC, e.g. `2026-09-24`. */
export function dayPeriod(now: number): BudgetPeriod {
  const date = new Date(now);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();
  return {
    key: `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    start: Date.UTC(year, month, day),
    resetsAt: Date.UTC(year, month, day + 1),
  };
}

/** Price for a model: operator-recorded price, else a known list price, else
 *  the conservative fallback. Partial operator prices are completed from the
 *  same fallback chain, never from zero. */
export function resolveModelPrice(
  modelId: string,
  stored?: { promptUsdPerMillion?: number; completionUsdPerMillion?: number } | null,
): ModelPrice {
  const known = KNOWN_MODEL_PRICES[modelId] ?? AI_BUDGET_CONFIG.unknownModelPrice;
  const valid = (value: number | undefined) =>
    value !== undefined && Number.isFinite(value) && value >= 0 ? value : undefined;
  return {
    promptUsdPerMillion: valid(stored?.promptUsdPerMillion) ?? known.promptUsdPerMillion,
    completionUsdPerMillion: valid(stored?.completionUsdPerMillion) ?? known.completionUsdPerMillion,
  };
}

/** Upper-bound prompt tokens for a request from its character count. */
export function estimatePromptTokens(promptChars: number, messageCount = 1): number {
  const chars = Number.isFinite(promptChars) && promptChars > 0 ? promptChars : 0;
  return (
    Math.ceil(chars / AI_BUDGET_CONFIG.charsPerPromptToken) +
    Math.max(1, messageCount) * AI_BUDGET_CONFIG.tokensPerMessageOverhead
  );
}

function tokenCostMicrousd(promptTokens: number, completionTokens: number, price: ModelPrice): number {
  return Math.ceil(
    Math.max(0, promptTokens) * price.promptUsdPerMillion +
      Math.max(0, completionTokens) * price.completionUsdPerMillion,
  );
}

/** Worst-case cost of one request: the full prompt estimate plus every
 *  output token it may produce, rounded up to a whole micro-dollar. */
export function worstCaseCostMicrousd(input: {
  promptTokens: number;
  maxOutputTokens: number;
  price: ModelPrice;
}): number {
  return tokenCostMicrousd(input.promptTokens, input.maxOutputTokens, input.price);
}

/**
 * What a finished run counts against the budget:
 *  - no provider call happened (`billable: false`): 0;
 *  - the provider reported a cost: that cost;
 *  - the provider reported tokens: tokens x catalog price;
 *  - otherwise (unknown outcome, credits-only provider): the full reservation.
 */
export function chargedCostMicrousd(input: {
  billable: boolean;
  costMicrousd: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
  price: ModelPrice;
  reservedMicrousd: number;
}): number {
  if (!input.billable) return 0;
  if (input.costMicrousd !== null && Number.isFinite(input.costMicrousd)) {
    return Math.max(0, Math.ceil(input.costMicrousd));
  }
  if (input.promptTokens !== null || input.completionTokens !== null) {
    return tokenCostMicrousd(input.promptTokens ?? 0, input.completionTokens ?? 0, input.price);
  }
  return Math.max(0, input.reservedMicrousd);
}

export type AiBudgetScope = "organization" | "user" | "platform";

export type BudgetDecision =
  | { ok: true }
  | { ok: false; scope: AiBudgetScope; resetsAt: number };

/** Would this request fit? `spent + reserved + request <= limit`. */
export function fitsBudget(input: {
  spentMicrousd: number;
  reservedMicrousd: number;
  requestMicrousd: number;
  limitMicrousd: number;
}): boolean {
  return input.spentMicrousd + input.reservedMicrousd + input.requestMicrousd <= input.limitMicrousd;
}

/** Stable prefix of the refusal message; UI matches it to show a `locked`
 *  state with an upgrade path instead of a generic failure. */
export const AI_BUDGET_REACHED_PREFIX = "AI budget reached";

export function aiBudgetRefusalMessage(scope: AiBudgetScope, resetsAt: number): string {
  const when = new Date(resetsAt).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  if (scope === "platform") {
    return `${AI_BUDGET_REACHED_PREFIX} for today across MOSAI — AI features are paused until ${when} (UTC). Nothing was generated or charged.`;
  }
  return `${AI_BUDGET_REACHED_PREFIX} for this month — it resets on ${when} (UTC). Upgrade your plan for a larger AI budget. Nothing was generated or charged.`;
}

export function isAiBudgetReached(error: unknown): boolean {
  const data = (error as { data?: unknown } | null)?.data;
  const text =
    typeof data === "string" ? data : error instanceof Error ? error.message : "";
  return text.includes(AI_BUDGET_REACHED_PREFIX);
}

/** "$0.12" for 120_000 µUSD. Rounds up to the cent so spend is never
 *  under-stated. */
export function formatMicrousd(microusd: number, currency: AiBudgetCurrency = AI_BUDGET_CURRENCY): string {
  const cents = Math.ceil(Math.max(0, microusd) / 10_000);
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}

/** What `aiBudget.usage` returns — one organization's month at a glance. */
export type AiBudgetUsage = {
  scope: "organization" | "user";
  plan: Plan | null;
  /** Booked cost of finished runs this month. */
  spentMicrousd: number;
  /** Worst-case cost held for runs still in flight. */
  reservedMicrousd: number;
  budgetMicrousd: number;
  currency: AiBudgetCurrency;
  periodStart: number;
  resetsAt: number;
  /** `locked` once spent + reserved reaches the budget. */
  state: "available" | "locked";
  /** True when the platform-wide daily cap has stopped all AI for today. */
  platformPaused: boolean;
};
