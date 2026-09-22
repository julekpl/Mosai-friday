import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { userCtx, cascadeDeleteProject } from "./dal";
import {
  DEFAULT_PLAN,
  PLANS,
  PLAN_MODULES,
  isPlan,
  modulesForPlan,
  type Plan,
} from "./lib/capabilities";

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
