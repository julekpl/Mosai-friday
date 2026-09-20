import { getAuthUserId } from "@convex-dev/auth/server";
import { internalQuery, mutation, query, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { userCtx, cascadeDeleteProject } from "./dal";

export const PLANS = ["free", "starter", "growth", "scale"] as const;
export type Plan = (typeof PLANS)[number];

/** Launch posture: new / plan-less users start on "free" — the same fallback
 *  every read AND write path uses, so the UI can never show a module the
 *  server would deny. Demo/testing mode: use the plan switcher in Billing.
 *  (Blueprint review §8.4: the old split — "scale" on reads, "free" on
 *  writes — rendered modules the server refused.) */
export const DEFAULT_PLAN: Plan = "free";

/** What each plan unlocks. Single source of truth for entitlements —
 *  module UIs and mutations must call hasModule, never hardcode plan names. */
export const PLAN_MODULES: Record<Plan, string[]> = {
  free: ["understand", "journeys", "create"],
  starter: ["understand", "journeys", "create", "build", "customers", "promote"],
  growth: [
    "understand",
    "journeys",
    "create",
    "build",
    "customers",
    "promote",
    "sell",
  ],
  scale: [
    "understand",
    "journeys",
    "create",
    "build",
    "customers",
    "promote",
    "sell",
    "grow",
  ],
};

export const currentPlan = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const user = await ctx.db.get(userId);
    const plan = (user?.plan ?? DEFAULT_PLAN) as Plan;
    return {
      plan,
      status: user?.planStatus ?? "active",
      modules: PLAN_MODULES[plan] ?? PLAN_MODULES.free,
      stripeCustomerId: user?.stripeCustomerId,
    };
  },
});

/** Entitlement check for mutations. Throws when the plan lacks the module. */
export async function assertModule(ctx: MutationCtx, moduleName: string) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Not signed in");
  const user = await ctx.db.get(userId);
  const plan = (user?.plan ?? DEFAULT_PLAN) as Plan;
  const mods = PLAN_MODULES[plan] ?? PLAN_MODULES.free;
  if (!mods.includes(moduleName)) {
    throw new Error(
      `Your current plan does not include "${moduleName}". Upgrade to unlock it.`,
    );
  }
  return userId;
}

/** Entitlement check callable from actions (which have no ctx.db).
 *  Throws when the user's plan lacks the module. */
export const checkModule = internalQuery({
  args: { userId: v.id("users"), module: v.string() },
  handler: async (ctx, { userId, module }) => {
    const user = await ctx.db.get(userId);
    const plan = (user?.plan ?? DEFAULT_PLAN) as Plan;
    const mods = PLAN_MODULES[plan] ?? PLAN_MODULES.free;
    if (!mods.includes(module)) {
      throw new Error(
        `Your current plan does not include "${module}". Upgrade to unlock it.`,
      );
    }
    return true;
  },
});

/** Local plan mirror change. When STRIPE_SECRET_KEY is configured this should
 *  be replaced by a Stripe Checkout + webhook path; until then plans switch
 *  locally so the whole flow is demonstrable end to end. */
export const changePlan = mutation({
  args: { plan: v.union(...PLANS.map((p) => v.literal(p))) },
  handler: async (ctx, { plan }) => {
    const { userId } = await userCtx(ctx);
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
