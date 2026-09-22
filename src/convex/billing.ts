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
import type { Id } from "./_generated/dataModel";
import { userCtx, cascadeDeleteProject } from "./dal";
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
  checkoutConfigured,
  planCatalog,
  planForSubscription,
  priceIdForPlan,
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
 *  top tier for free, so it is OFF unless explicitly enabled. Set
 *  PLAN_SELF_SERVE=true through the Keys / API keys UI to demo it locally. */
export const SELF_SERVE_PLAN_CHANGES = process.env.PLAN_SELF_SERVE === "true";

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

function assertHttpUrl(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("A valid return URL is required.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("A valid return URL is required.");
  }
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

/** The billing catalog: which plans are really purchasable, and in which mode. */
export const catalog = orgQuery({
  args: {},
  handler: async (_ctx, _args, access) => {
    await access.requireUser();
    return {
      configured: checkoutConfigured(),
      mode: stripeMode(),
      plans: planCatalog(),
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
      .collect();
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
      checkoutConfigured: checkoutConfigured(),
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
  },
  handler: async (
    ctx: ActionCtx,
    { organizationId, plan, successUrl, cancelUrl },
    access: OrgAccess,
  ): Promise<{ url: string }> => {
    const scope = await access.requireOrganization(organizationId);
    if (!roleCan(scope.membership.role, "organization.update")) {
      throw new Error("Your role in this organization does not allow billing changes.");
    }
    if (!isPlan(plan) || plan === DEFAULT_PLAN) {
      throw new Error("Choose a paid plan to start checkout.");
    }
    const priceId = priceIdForPlan(plan);
    if (!priceId) {
      throw new Error(
        `${plan} is not available for purchase yet — its Stripe price is not configured.`,
      );
    }
    assertHttpUrl(successUrl);
    assertHttpUrl(cancelUrl);
    assertStripeModeAllowed();

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
        idempotencyKey: `mosai-checkout-${organizationId}-${plan}-${dayBucket()}`,
        params: {
          mode: "subscription",
          customer: customerId,
          client_reference_id: organizationId,
          line_items: [{ price: priceId, quantity: 1 }],
          success_url: successUrl,
          cancel_url: cancelUrl,
          // Owner decision: Stripe Tax is enabled for MOSAI's own billing.
          automatic_tax: { enabled: true },
          allow_promotion_codes: true,
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
    assertHttpUrl(returnUrl);
    assertStripeModeAllowed();
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
        idempotencyKey: `mosai-portal-${organizationId}-${minuteBucket()}`,
        params: { customer: customerId, return_url: returnUrl },
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

/** Local plan mirror change. When STRIPE_SECRET_KEY is configured this should
 *  be replaced by a Stripe Checkout + webhook path.
 *
 *  Locked down by default: a signed-in user must NOT be able to raise their
 *  own plan (that is the abuse the review flagged). It only works when
 *  SELF_SERVE_PLAN_CHANGES is explicitly enabled for a local demo. */
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

/** TODO (review G4): this is an instant switch-off. It must become a
 *  wind-down — obligations (running campaigns, open orders, scheduled posts)
 *  resolved or explicitly accepted before the plan actually drops. */
export const cancelPlan = mutation({
  args: {},
  handler: async (ctx) => {
    const { userId } = await userCtx(ctx);
    await ctx.db.patch(userId, { planStatus: "canceled", plan: "free" });
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
