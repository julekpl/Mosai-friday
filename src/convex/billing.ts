import { getAuthUserId } from "@convex-dev/auth/server";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import type { ActionCtx, QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { userCtx, cascadeDeleteProject, cascadeDeleteAiUserData } from "./dal";
import { orgAction, orgQuery, type OrgAccess } from "./guards";
import { roleCan } from "./lib/roles";
import {
  DEFAULT_PLAN,
  PLANS,
  PLAN_MODULES,
  isPlan,
  modulesForPlan,
  type Plan,
} from "./lib/capabilities";
import {
  MOSAI_ORG_METADATA_KEY,
  MOSAI_PLAN_METADATA_KEY,
  PAID_PLANS,
  assertTrustedBillingReturnUrl,
  checkoutConfigured,
  planCatalog,
  planForSubscription,
  priceIdForPlan,
  type PlanCatalogEntry,
} from "./lib/billingCatalog";
import {
  assertStripeModeAllowed,
  stripeMode,
  stripeRequest,
} from "./lib/stripe";

/* Plans and the plan→module matrix live in the capability registry
 * (`lib/capabilities.ts`) since T2.3 — one source of truth shared by the
 * guards, the audit, the tests and the UI. Re-exported here so existing import
 * sites (and the Phase 0 regressions that assert against `PLAN_MODULES.free`)
 * keep working. */
export { DEFAULT_PLAN, PLANS, PLAN_MODULES };
export type { Plan };

/** Self-serve plan switching is a local demo stand-in for Stripe Checkout.
 *  On a public deployment it would let any signed-in user grant themselves the
 *  top tier for free, so it is OFF unless explicitly enabled — and, since the
 *  T0.3 review, enabling the flag alone is not enough: the runtime must also
 *  be a development/test one. A production Convex deployment never reports
 *  `development`/`test`, so PLAN_SELF_SERVE=true cannot open self-serve plan
 *  changes there even if the variable is set (fail closed).
 *
 *  Local demo: set PLAN_SELF_SERVE=true through the Keys / API keys UI AND
 *  run the deployment with NODE_ENV=development. */
const SELF_SERVE_REQUESTED = process.env.PLAN_SELF_SERVE === "true";
const NON_PRODUCTION_RUNTIME =
  process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test";
export const SELF_SERVE_PLAN_CHANGES =
  SELF_SERVE_REQUESTED && NON_PRODUCTION_RUNTIME;

export const currentPlan = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const user = await ctx.db.get(userId);
    const plan = (user?.plan && isPlan(user.plan) ? user.plan : DEFAULT_PLAN) satisfies Plan;
    return {
      plan,
      status: user?.planStatus ?? "active",
      // The plan's modules, straight from the registry — the client never
      // hardcodes a tier list (that duplication is what T2.3 removed).
      modules: [...modulesForPlan(plan)],
      stripeCustomerId: user?.stripeCustomerId,
      selfServePlanChanges: SELF_SERVE_PLAN_CHANGES,
    };
  },
});

// ── Stripe billing (T2.4) ───────────────────────────────────────────────────
// Truth lives in Stripe. These functions start a checkout, open the portal and
// read the local mirror; none of them may write a paid state — only the
// verified webhook (`billingWebhooks.applyEvent`) does.

function trustedAppOrigin(): string {
  const configured = process.env.MOSAI_APP_ORIGIN?.trim();
  if (!configured) {
    throw new Error("Billing needs MOSAI_APP_ORIGIN configured for this app.");
  }
  let parsed: URL;
  try {
    parsed = new URL(configured);
  } catch {
    throw new Error("MOSAI_APP_ORIGIN must be a trusted HTTPS app origin.");
  }
  const localHttp =
    parsed.protocol === "http:" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
  if (
    (parsed.protocol !== "https:" && !localHttp) ||
    parsed.origin !== configured.replace(/\/$/, "") ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error("MOSAI_APP_ORIGIN must be a trusted HTTPS app origin.");
  }
  return parsed.origin;
}

function billingReturnUrl(value: string): string {
  return assertTrustedBillingReturnUrl(value, trustedAppOrigin());
}

interface StripeCatalogPrice {
  id: string;
  active: boolean;
  livemode: boolean;
  unit_amount: number | null;
  currency: string;
  tax_behavior: "inclusive" | "exclusive" | null;
  metadata?: Record<string, string>;
  recurring: { interval: string; interval_count: number } | null;
  product: string | { id: string; name: string; active: boolean };
}

interface StripeCatalogProduct {
  id: string;
  name: string;
  active: boolean;
}

interface StripePortalConfiguration {
  id: string;
  active: boolean;
  livemode: boolean;
  features?: {
    subscription_cancel?: { enabled?: boolean; mode?: string };
  };
}

async function confirmedPortalConfiguration(): Promise<StripePortalConfiguration | null> {
  const configurationId = process.env.STRIPE_BILLING_PORTAL_CONFIGURATION?.trim();
  if (!configurationId || stripeMode() !== "test") return null;
  try {
    const configuration = await stripeRequest<StripePortalConfiguration>(
      `/billing_portal/configurations/${encodeURIComponent(configurationId)}`,
    );
    const cancellation = configuration.features?.subscription_cancel;
    const cancellationIsSafe =
      cancellation !== undefined &&
      (cancellation.enabled === false ||
        (cancellation.enabled === true && cancellation.mode === "at_period_end"));
    return configuration.id === configurationId &&
      configuration.active &&
      !configuration.livemode &&
      cancellationIsSafe
      ? configuration
      : null;
  } catch {
    return null;
  }
}

async function providerPlanPrice(plan: Plan): Promise<PlanCatalogEntry> {
  const priceId = priceIdForPlan(plan);
  if (!priceId) return { plan, configured: false };
  const price = await stripeRequest<StripeCatalogPrice>(
    `/prices/${encodeURIComponent(priceId)}`,
    { params: { expand: ["product"] } },
  );
  const product =
    typeof price.product === "string"
      ? await stripeRequest<StripeCatalogProduct>(
          `/products/${encodeURIComponent(price.product)}`,
        )
      : price.product;
  if (
    price.id !== priceId ||
    price.livemode ||
    !price.active ||
    (price.metadata?.[MOSAI_PLAN_METADATA_KEY] !== undefined &&
      price.metadata[MOSAI_PLAN_METADATA_KEY] !== plan) ||
    !price.recurring ||
    !Number.isSafeInteger(price.unit_amount) ||
    price.unit_amount === null ||
    !/^[a-z]{3}$/.test(price.currency) ||
    !product.active ||
    !product.name.trim()
  ) {
    return { plan, configured: false };
  }
  return {
    plan,
    configured: true,
    productName: product.name,
    priceId: price.id,
    amountMinor: price.unit_amount,
    currency: price.currency.toUpperCase(),
    interval: price.recurring.interval,
    intervalCount: price.recurring.interval_count,
    taxBehavior: price.tax_behavior ?? "unspecified",
  };
}

/** A stable idempotency bucket: retries within the same day reuse the key, so
 *  a double-click cannot open two checkout sessions or two portal sessions
 *  (`AGENTS.md` §5 rule 6 — every external write is idempotent). */
function dayBucket(): number {
  return Math.floor(Date.now() / 86_400_000);
}

function minuteBucket(): number {
  return Math.floor(Date.now() / 60_000);
}

/** The organization the billing screen is for: the caller's first active
 *  organization (their personal workspace for a direct signup). */
export const currentOrganization = orgQuery({
  args: {},
  handler: async (ctx, _args, access) => {
    await access.requireUser();
    const organizationId = access.organizationIds[0];
    if (!organizationId) return null;
    const organization = await ctx.db.get(organizationId);
    if (!organization) return null;
    const owner = await ctx.db.get(organization.ownerId);
    return {
      organizationId,
      name: organization.name,
      kind: organization.kind,
      plan: owner?.plan && isPlan(owner.plan) ? owner.plan : DEFAULT_PLAN,
      planStatus: owner?.planStatus ?? "active",
    };
  },
});

/** Customer-safe display projection of configured Stripe test prices. */
export const catalog = orgAction({
  args: {},
  handler: async (_ctx, _args, access) => {
    await access.requireUser();
    if (stripeMode() !== "test") {
      return {
        configured: false,
        checkoutReady: false,
        portalReady: false,
        setupIssue: "Stripe test mode is not configured.",
        mode: stripeMode(),
        tax: "calculated_at_checkout" as const,
        plans: planCatalog(),
      };
    }
    assertStripeModeAllowed();
    const paidPlans = await Promise.all(PAID_PLANS.map(providerPlanPrice));
    const configured = paidPlans.some((entry) => entry.configured);
    const portalConfiguration = await confirmedPortalConfiguration();
    let appOriginReady = true;
    try {
      trustedAppOrigin();
    } catch {
      appOriginReady = false;
    }
    return {
      configured,
      checkoutReady: configured && appOriginReady,
      portalReady: portalConfiguration !== null,
      ...(!portalConfiguration
        ? { portalSetupIssue: "Billing portal is unavailable until a Stripe test configuration with safe cancellation settings is set up." }
        : {}),
      ...(!appOriginReady
        ? { setupIssue: "MOSAI_APP_ORIGIN is not configured for this app." }
        : !configured
          ? { setupIssue: "No active Stripe test prices are configured." }
          : {}),
      mode: stripeMode(),
      tax: "calculated_at_checkout" as const,
      plans: [
        ...planCatalog().filter((entry) => entry.plan === DEFAULT_PLAN),
        ...paidPlans,
      ],
    };
  },
});

/** The organization's billing state, read side (mirror + dunning + wind-down). */
export const subscription = orgQuery({
  args: { organizationId: v.id("organizations") },
  handler: async (ctx, { organizationId }, access) => {
    const scope = await access.requireOrganization(organizationId);
    const owner = await ctx.db.get(scope.organization.ownerId);
    const rows = await ctx.db
      .query("subscriptions")
      .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
      .take(101);
    if (rows.length > 100) {
      throw new Error("Too many subscription history records to safely determine the current subscription.");
    }
    const rank = (status: string) =>
      status === "active" || status === "trialing"
        ? 0
        : status === "past_due" || status === "unpaid"
          ? 1
          : status === "wind_down"
            ? 2
            : 3;
    const governing = [...rows].sort((a, b) => rank(a.status) - rank(b.status))[0] ?? null;
    const invoices = await ctx.db
      .query("billingInvoices")
      .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
      .collect();
    const customer = await ctx.db
      .query("billingCustomers")
      .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
      .first();

    return {
      organizationId,
      name: scope.organization.name,
      plan: owner?.plan && isPlan(owner.plan) ? owner.plan : DEFAULT_PLAN,
      planStatus: owner?.planStatus ?? "active",
      canManage: roleCan(scope.membership.role, "organization.update"),
      subscription: governing
        ? {
            subscriptionId: governing.subscriptionId,
            plan: governing.plan,
            status: governing.status,
            currentPeriodEnd: governing.currentPeriodEnd,
            cancelAtPeriodEnd: governing.cancelAtPeriodEnd,
            windDownAt: governing.windDownAt,
            dunningStage: governing.dunningStage,
          }
        : null,
      dunning: invoices
        .filter((invoice) => invoice.status === "open" || invoice.status === "uncollectible")
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 5)
        .map((invoice) => ({
          invoiceId: invoice.invoiceId,
          status: invoice.status,
          amountDueMinor: invoice.amountDueMinor,
          currency: invoice.currency,
          attemptCount: invoice.attemptCount,
          nextRetryAt: invoice.nextRetryAt,
          hostedInvoiceUrl: invoice.hostedInvoiceUrl,
        })),
      hasCustomer: Boolean(customer),
      checkoutConfigured: stripeMode() === "test" && checkoutConfigured(),
      mode: stripeMode(),
    };
  },
});

/** Start a Stripe Checkout for a plan. Returns a URL; it does **not** grant the
 *  plan — the browser landing on the success page proves nothing, and only the
 *  verified webhook writes the mirror. */
export const startCheckout = orgAction({
  args: {
    organizationId: v.id("organizations"),
    plan: v.string(),
    successUrl: v.string(),
    cancelUrl: v.string(),
    expectedPriceId: v.string(),
    expectedAmountMinor: v.number(),
    expectedCurrency: v.string(),
  },
  handler: async (
    ctx: ActionCtx,
    {
      organizationId,
      plan,
      successUrl,
      cancelUrl,
      expectedPriceId,
      expectedAmountMinor,
      expectedCurrency,
    },
    access: OrgAccess,
  ): Promise<{ url: string }> => {
    const scope = await access.requireOrganization(organizationId);
    if (!roleCan(scope.membership.role, "organization.update")) {
      throw new Error("Your role in this organization does not allow billing changes.");
    }
    if (!isPlan(plan) || plan === DEFAULT_PLAN) {
      throw new Error("Choose a paid plan to start checkout.");
    }
    const safeSuccessUrl = billingReturnUrl(successUrl);
    const safeCancelUrl = billingReturnUrl(cancelUrl);
    assertStripeModeAllowed();
    if (stripeMode() !== "test") {
      throw new Error("Customer checkout is available only from the Stripe test catalog.");
    }
    const currentPrice = await providerPlanPrice(plan);
    if (!currentPrice.configured || !currentPrice.priceId) {
      throw new Error(`${plan} is not available — its Stripe test price is not configured.`);
    }
    if (
      currentPrice.priceId !== expectedPriceId ||
      currentPrice.amountMinor !== expectedAmountMinor ||
      currentPrice.currency !== expectedCurrency.toUpperCase()
    ) {
      throw new Error("The Stripe catalog changed. Review the updated price before checkout.");
    }
    const priceId = currentPrice.priceId;

    let customerId: string | null = await ctx.runQuery(
      internal.billing.customerForOrganization,
      { organizationId },
    );
    if (!customerId) {
      const created = await stripeRequest<{ id: string }>("/customers", {
        method: "POST",
        idempotencyKey: `mosai-customer-${organizationId}`,
        params: {
          metadata: { [MOSAI_ORG_METADATA_KEY]: organizationId },
        },
      });
      await ctx.runMutation(internal.billing.recordCustomer, {
        organizationId,
        customerId: created.id,
        createdBy: scope.userId,
        livemode: stripeMode() === "live",
      });
      customerId = created.id;
    }

    const session = await stripeRequest<{ id: string; url: string | null }>(
      "/checkout/sessions",
      {
        method: "POST",
        idempotencyKey: `mosai-checkout-${organizationId}-${plan}-${priceId}-${dayBucket()}`,
        params: {
          mode: "subscription",
          customer: customerId,
          client_reference_id: organizationId,
          line_items: [{ price: priceId, quantity: 1 }],
          success_url: safeSuccessUrl,
          cancel_url: safeCancelUrl,
          // Owner decision: Stripe Tax is enabled for MOSAI's own billing.
          automatic_tax: { enabled: true },
          subscription_data: {
            metadata: {
              [MOSAI_ORG_METADATA_KEY]: organizationId,
              [MOSAI_PLAN_METADATA_KEY]: plan,
            },
          },
          metadata: {
            [MOSAI_ORG_METADATA_KEY]: organizationId,
            [MOSAI_PLAN_METADATA_KEY]: plan,
          },
        },
      },
    );
    if (!session.url) throw new Error("Stripe returned no checkout URL.");
    return { url: session.url };
  },
});

/** Open the Stripe billing portal (payment method, invoices, cancel). */
export const openPortal = orgAction({
  args: {
    organizationId: v.id("organizations"),
    returnUrl: v.string(),
  },
  handler: async (
    ctx: ActionCtx,
    { organizationId, returnUrl },
    access: OrgAccess,
  ): Promise<{ url: string }> => {
    const scope = await access.requireOrganization(organizationId);
    if (!roleCan(scope.membership.role, "organization.update")) {
      throw new Error("Your role in this organization does not allow billing changes.");
    }
    const safeReturnUrl = billingReturnUrl(returnUrl);
    assertStripeModeAllowed();
    if (stripeMode() !== "test") {
      throw new Error("Customer billing is available only from the Stripe test catalog.");
    }
    const portalConfiguration = await confirmedPortalConfiguration();
    if (!portalConfiguration) {
      throw new Error("Billing portal is unavailable until its Stripe test configuration confirms period-end or disabled cancellation.");
    }
    const customerId = await ctx.runQuery(internal.billing.customerForOrganization, {
      organizationId,
    });
    if (!customerId) {
      throw new Error("There is no billing account yet — upgrade first.");
    }
    const session = await stripeRequest<{ url: string | null }>(
      "/billing_portal/sessions",
      {
        method: "POST",
        idempotencyKey: `mosai-portal-${organizationId}-${portalConfiguration.id}-${minuteBucket()}`,
        params: {
          customer: customerId,
          return_url: safeReturnUrl,
          configuration: portalConfiguration.id,
        },
      },
    );
    if (!session.url) throw new Error("Stripe returned no portal URL.");
    return { url: session.url };
  },
});

/* `assertModule` used to live in `guards.ts` and `checkModule` here: both read
 * the CALLER's plan, so a teammate on a personal `free` plan was locked out of
 * the add-ons their organization pays for. T2.3 replaced both with the module
 * builders (`moduleQuery`/`moduleMutation`/`moduleAction`) and the org's plan
 * in `lib/capabilities.ts` + `guards.ts`. Nothing callable from a client
 * decides entitlements any more. */

/** Local plan mirror change is available only for explicitly enabled demos. */
export const changePlan = mutation({
  args: { plan: v.union(...PLANS.map((p) => v.literal(p))) },
  handler: async (ctx, { plan }) => {
    const { userId } = await userCtx(ctx);
    if (!SELF_SERVE_PLAN_CHANGES) {
      throw new Error(
        "Plan changes are managed server-side. Use checkout to upgrade.",
      );
    }
    await ctx.db.patch(userId, { plan, planStatus: "active" });
  },
});

/** Set cancel_at_period_end in Stripe; only webhooks change the entitlement. */
export const cancelSubscriptionAtPeriodEnd = orgAction({
  args: { organizationId: v.id("organizations") },
  handler: async (
    ctx,
    { organizationId },
    access,
  ): Promise<{ cancelAtPeriodEnd: boolean; currentPeriodEnd: number | null }> => {
    const scope = await access.requireOrganization(organizationId);
    if (!roleCan(scope.membership.role, "organization.update")) {
      throw new Error("Your role in this organization does not allow billing changes.");
    }
    assertStripeModeAllowed();
    if (stripeMode() !== "test") {
      throw new Error("Customer billing is available only from the Stripe test catalog.");
    }
    const governing = await ctx.runQuery(
      internal.billing.subscriptionForOrganization,
      { organizationId },
    );
    if (!governing || !["active", "trialing", "past_due"].includes(governing.status)) {
      throw new Error("There is no cancellable Stripe subscription for this organization.");
    }
    if (governing.cancelAtPeriodEnd) {
      return {
        cancelAtPeriodEnd: true,
        currentPeriodEnd: governing.currentPeriodEnd ?? null,
      };
    }
    const cancellationRevision = governing.lastEventId ?? String(governing.lastEventCreated);
    const idempotencyKey = `mosai-cancel-period-end-${governing.subscriptionId}-${cancellationRevision}`;
    const confirmed = await stripeRequest<{
      id: string;
      status: string;
      cancel_at_period_end: boolean;
      current_period_end?: number;
    }>(`/subscriptions/${encodeURIComponent(governing.subscriptionId)}`, {
      method: "POST",
      idempotencyKey,
      params: { cancel_at_period_end: true },
    });
    if (confirmed.id !== governing.subscriptionId || !confirmed.cancel_at_period_end) {
      throw new Error("Stripe did not confirm cancellation at the billing period end.");
    }
    if (!["active", "trialing", "past_due"].includes(confirmed.status)) {
      throw new Error(
        `Stripe returned status ${confirmed.status} after the cancellation request; no scheduled-cancellation receipt was recorded. Refresh billing status before retrying.`,
      );
    }
    await ctx.runMutation(internal.billing.recordPeriodEndCancellation, {
      organizationId,
      subscriptionId: confirmed.id,
      currentPeriodEnd: confirmed.current_period_end,
      eventId: idempotencyKey,
    });
    return {
      cancelAtPeriodEnd: true,
      currentPeriodEnd: confirmed.current_period_end ?? null,
    };
  },
});

export const requestAccountDeletion = mutation({
  args: {},
  handler: async (ctx) => {
    const { userId } = await userCtx(ctx);
    await ctx.db.patch(userId, { deletionRequestedAt: Date.now() });
  },
});

export const cancelAccountDeletion = mutation({
  args: {},
  handler: async (ctx) => {
    const { userId } = await userCtx(ctx);
    await ctx.db.patch(userId, { deletionRequestedAt: undefined });
  },
});

/** Hard delete: every project goes through the ONE shared cascade, then the
 *  user record. (Review finding: the old inline list had drifted from
 *  projects.remove and missed the CMS, variants, media and Build tables.) */
export const deleteAccount = mutation({
  args: {},
  handler: async (ctx) => {
    const { userId } = await userCtx(ctx);
    const projects = await ctx.db
      .query("projects")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();
    for (const p of projects) {
      await cascadeDeleteProject(ctx, p._id);
    }
    await cascadeDeleteAiUserData(ctx, userId);
    await ctx.db.delete(userId);
  },
});

// ── Internal billing helpers (server-to-server only) ────────────────────────

/** The Stripe customer id for an organization, or null when none exists yet. */
export const customerForOrganization = internalQuery({
  args: { organizationId: v.id("organizations") },
  handler: async (ctx: QueryCtx, { organizationId }) => {
    const row = await ctx.db
      .query("billingCustomers")
      .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
      .first();
    return row?.customerId ?? null;
  },
});

export const subscriptionForOrganization = internalQuery({
  args: { organizationId: v.id("organizations") },
  handler: async (ctx, { organizationId }): Promise<Doc<"subscriptions"> | null> => {
    const rows = await ctx.db
      .query("subscriptions")
      .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
      .take(101);
    if (rows.length > 100) {
      throw new Error("Too many subscription history records to safely determine the current subscription.");
    }
    const eligible = rows.filter((row) =>
      ["active", "trialing", "past_due"].includes(row.status),
    );
    if (eligible.length > 1) {
      throw new Error(
        "Ambiguous billing state: multiple eligible subscriptions exist for this organization.",
      );
    }
    return eligible[0] ?? null;
  },
});

/** Record Stripe's confirmed period-end flag without changing the entitlement. */
export const recordPeriodEndCancellation = internalMutation({
  args: {
    organizationId: v.id("organizations"),
    subscriptionId: v.string(),
    currentPeriodEnd: v.optional(v.number()),
    eventId: v.string(),
  },
  handler: async (ctx, args) => {
    const subscription = await ctx.db
      .query("subscriptions")
      .withIndex("by_subscription", (q) => q.eq("subscriptionId", args.subscriptionId))
      .unique();
    if (!subscription || subscription.organizationId !== args.organizationId) {
      throw new Error("The confirmed Stripe subscription no longer matches this organization.");
    }
    const existingReceipt = await ctx.db
      .query("billingReceipts")
      .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
      .first();
    if (existingReceipt) return;
    await ctx.db.patch(subscription._id, {
      cancelAtPeriodEnd: true,
      ...(args.currentPeriodEnd === undefined
        ? {}
        : { currentPeriodEnd: args.currentPeriodEnd }),
      updatedAt: Date.now(),
    });
    await ctx.db.insert("billingReceipts", {
      provider: "stripe",
      objectType: "subscription",
      objectId: args.subscriptionId,
      eventId: args.eventId,
      eventType: "subscription.cancel_at_period_end.confirmed",
      organizationId: args.organizationId,
      livemode: false,
      createdAt: Date.now(),
    });
  },
});

/** Persist a freshly created provider customer. */
export const recordCustomer = internalMutation({
  args: {
    organizationId: v.id("organizations"),
    customerId: v.string(),
    createdBy: v.id("users"),
    livemode: v.boolean(),
  },
  handler: async (ctx, { organizationId, customerId, createdBy, livemode }) => {
    const existing = await ctx.db
      .query("billingCustomers")
      .withIndex("by_customer", (q) => q.eq("customerId", customerId))
      .first();
    if (existing) return existing._id;
    return await ctx.db.insert("billingCustomers", {
      organizationId,
      provider: "stripe",
      customerId,
      livemode,
      createdBy,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  },
});

interface StripeSubscriptionSummary {
  id: string;
  status: string;
  metadata?: Record<string, string> | null;
  items?: {
    data?: Array<{
      price?: { id?: string; metadata?: Record<string, string> | null };
    }>;
  };
}

/**
 * Reconciliation job (T2.4). Fetches the provider's subscriptions, maps each
 * to the (organization, plan, status) the entitlement should be, and asks the
 * internal apply to compare + record a run. Target: 0 drift. Safe to run when
 * Stripe is not configured — it records an honest empty run rather than a
 * false success.
 */
export const reconcileNow = internalAction({
  args: { source: v.optional(v.string()) },
  handler: async (ctx, { source }): Promise<{ checked: number; driftCount: number }> => {
    const startedAt = Date.now();
    const runSource = source ?? "cron";
    if (stripeMode() === "unconfigured") {
      return await ctx.runMutation(internal.billingWebhooks.applyReconciliation, {
        source: runSource,
        providerRows: [],
        startedAt,
      });
    }
    assertStripeModeAllowed();

    const providerRows: Array<{
      organizationId: string;
      subscriptionId: string;
      plan: string;
      status: string;
      priceId?: string;
    }> = [];
    let startingAfter: string | undefined;
    for (let page = 0; page < 10; page++) {
      const response = await stripeRequest<{
        data: StripeSubscriptionSummary[];
        has_more: boolean;
      }>("/subscriptions", {
        params: { status: "all", limit: 100, starting_after: startingAfter },
      });
      for (const sub of response.data) {
        const organizationId = sub.metadata?.[MOSAI_ORG_METADATA_KEY];
        if (!organizationId) continue;
        const price = sub.items?.data?.[0]?.price;
        providerRows.push({
          organizationId,
          subscriptionId: sub.id,
          plan: planForSubscription({
            priceId: price?.id,
            planMetadata:
              sub.metadata?.[MOSAI_PLAN_METADATA_KEY] ??
              price?.metadata?.[MOSAI_PLAN_METADATA_KEY],
          }),
          status: sub.status,
          priceId: price?.id,
        });
      }
      if (!response.has_more) break;
      startingAfter = response.data[response.data.length - 1]?.id;
      if (!startingAfter) break;
    }

    return await ctx.runMutation(internal.billingWebhooks.applyReconciliation, {
      source: runSource,
      providerRows,
      startedAt,
    });
  },
});

// Referenced so the plan type stays tied to this module's public surface.
export type BillingPlan = Plan;
export type BillingOrganizationId = Id<"organizations">;
