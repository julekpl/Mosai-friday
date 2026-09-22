/**
 * Billing catalog (MOSAI pack T2.4).
 *
 * The money-side companion to `lib/capabilities.ts`. The capability registry
 * stays the **only** source of what a plan includes; this file only maps a
 * registry plan to the Stripe product/price that sells it and maps a provider
 * status back to the local mirror's honest status.
 *
 * Rules this file exists to enforce:
 *   - Stripe price ids are **configuration**, not code (the owner has not
 *     finalised plans/prices — `STATUS.md` §6). A missing price id is an honest
 *     `needs_setup`, never a fake checkout.
 *   - A plan id is a registry `Plan`. The catalog cannot invent a tier.
 *   - A provider status maps to one of the mirror states; `active`/`trialing`
 *     are the only "entitled" ones, and they are only ever written by verified
 *     server code.
 *
 * Keep this dependency-free (only `lib/capabilities.ts`) so the admin module,
 * the webhook handlers and the tests can all import it.
 */

import { DEFAULT_PLAN, PLANS, isPlan, type ModuleId, type Plan } from "./capabilities";

/** Stripe metadata keys MOSAI sets on a checkout/subscription so a webhook can
 *  resolve the tenant and the plan without a guess or a client hint. */
export const MOSAI_ORG_METADATA_KEY = "mosai_organization";
export const MOSAI_PLAN_METADATA_KEY = "mosai_plan";

/** Plans that actually cost money — every registry plan except the default
 *  (free) one. Derived, so a new plan cannot be forgotten here. */
export const PAID_PLANS: readonly Plan[] = PLANS.filter(
  (plan) => plan !== DEFAULT_PLAN,
);

/** Which deployment env var holds each plan's Stripe price id. Read through
 *  `process.env`, so the owner pastes the ids in the Keys / API keys UI. */
export const PRICE_ENV_BY_PLAN: Record<string, string> = {
  starter: "STRIPE_PRICE_STARTER",
  growth: "STRIPE_PRICE_GROWTH",
  scale: "STRIPE_PRICE_SCALE",
};

/**
 * Optional per-add-on price seam. The launch posture sells the **plan bundle**
 * (one Stripe product per plan); if the owner later chooses per-add-on
 * pricing, these env vars line up with the registry's module ids and no
 * entitlement code changes. Unused today, declared so the mapping is not
 * invented ad hoc later.
 */
export const ADDON_PRICE_ENV_BY_MODULE: Record<ModuleId, string> = {
  understand: "STRIPE_PRICE_ADDON_UNDERSTAND",
  journeys: "STRIPE_PRICE_ADDON_JOURNEYS",
  create: "STRIPE_PRICE_ADDON_CREATE",
  build: "STRIPE_PRICE_ADDON_BUILD",
  customers: "STRIPE_PRICE_ADDON_CUSTOMERS",
  promote: "STRIPE_PRICE_ADDON_PROMOTE",
  sell: "STRIPE_PRICE_ADDON_SELL",
  grow: "STRIPE_PRICE_ADDON_GROW",
};

/** The configured Stripe price id for a plan, or null when not set up. */
export function priceIdForPlan(plan: Plan): string | null {
  const key = PRICE_ENV_BY_PLAN[plan];
  if (!key) return null;
  const value = process.env[key];
  return value && value.trim().length ? value.trim() : null;
}

/** Reverse lookup: which registry plan a Stripe price id sells. */
export function planForPriceId(priceId: string | null | undefined): Plan | null {
  if (!priceId) return null;
  for (const plan of PAID_PLANS) {
    if (priceIdForPlan(plan) === priceId) return plan;
  }
  return null;
}

/** The plan a subscription is entitled to. Prefer Stripe price **metadata**
 *  (`metadata.mosai_plan`), which survives a price id rotation, then fall back
 *  to the env reverse lookup. A price we cannot map is `free` until support
 *  fixes the catalog — never a guessed tier. */
export function planForSubscription(input: {
  priceId?: string | null;
  planMetadata?: string | null;
}): Plan {
  const metadata = input.planMetadata?.trim();
  if (metadata && isPlan(metadata)) return metadata;
  return planForPriceId(input.priceId) ?? DEFAULT_PLAN;
}

/** Statuses a subscription mirror row can hold (a subset of the provider's). */
export const SUBSCRIPTION_STATES = [
  "trialing",
  "active",
  "past_due",
  "unpaid",
  "canceled",
  "incomplete",
  "incomplete_expired",
  "paused",
  "wind_down",
] as const;
export type SubscriptionState = (typeof SUBSCRIPTION_STATES)[number];

/** The local mirror's plan status — the honest states `users.planStatus` holds. */
export type PlanStatus = "active" | "trialing" | "canceled" | "past_due" | "wind_down";

/**
 * Map a provider subscription status to the local mirror status. Only
 * `active` and `trialing` are "good standing". `past_due`/`unpaid` are honest
 * warnings; `canceled`/`incomplete_expired` end entitlement.
 */
export function planStatusForState(state: string): PlanStatus {
  switch (state) {
    case "active":
      return "active";
    case "trialing":
      return "trialing";
    case "past_due":
    case "unpaid":
      return "past_due";
    case "wind_down":
      return "wind_down";
    default:
      return "canceled";
  }
}

/** True when the state still entitles the organization to its paid modules. */
export function stateIsEntitled(state: string): boolean {
  return state === "active" || state === "trialing" || state === "past_due";
}

/** How long a failed payment may stay `past_due` before the wind-down sweep
 *  moves the subscription to `wind_down` (7 days — a support-friendly grace,
 *  deliberately configurable). */
export const WIND_DOWN_GRACE_MS =
  Number(process.env.BILLING_WIND_DOWN_GRACE_DAYS ?? "7") * 24 * 60 * 60 * 1000;

/** The card catalog the UI renders. Prices stay presentation-only until the
 *  owner finalises them; `configured` says whether checkout can really start. */
export interface PlanCatalogEntry {
  plan: Plan;
  /** True when a Stripe price id is configured for this plan. */
  configured: boolean;
  /** The currency the plan will be sold in (Stripe Tax is enabled). */
  currency: string;
}

export function planCatalog(): PlanCatalogEntry[] {
  return PLANS.map((plan) => ({
    plan,
    configured: plan === DEFAULT_PLAN || priceIdForPlan(plan) !== null,
    currency: "eur",
  }));
}

/** True when the deployment can start a Stripe checkout at all. */
export function checkoutConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY) &&
    PAID_PLANS.some((plan) => priceIdForPlan(plan) !== null);
}
