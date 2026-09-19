import { getAuthUserId } from "@convex-dev/auth/server";
import { internalMutation, internalQuery, mutation, query, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";

export const PLANS = ["free", "starter", "growth", "scale"] as const;
export type Plan = (typeof PLANS)[number];

/** TESTING PHASE: default plan is "scale" so every module is reachable.
 *  Switch back to "free" here for launch — the plan switcher in Billing
 *  still demonstrates gating for every tier. */
export const DEFAULT_PLAN: Plan = "scale";

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
  const plan = (user?.plan ?? "free") as Plan;
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
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    await ctx.db.patch(userId, { plan, planStatus: "active" });
  },
});

export const cancelPlan = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    await ctx.db.patch(userId, { planStatus: "canceled", plan: "free" });
  },
});

export const requestAccountDeletion = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    await ctx.db.patch(userId, { deletionRequestedAt: Date.now() });
  },
});

export const cancelAccountDeletion = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    await ctx.db.patch(userId, { deletionRequestedAt: undefined });
  },
});

/** Hard delete: projects cascade via projects.remove, then the user record. */
export const deleteAccount = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    const projects = await ctx.db
      .query("projects")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();
    for (const p of projects) {
      for (const table of [
        "personas",
        "contentPieces",
        "connections",
        "contacts",
        "campaigns",
        "posts",
        "products",
        "builds",
        "insights",
        "adsAccounts",
        "adsCampaigns",
        "adsMetrics",
        "adsCopilotMessages",
        "adsChangeRequests",
        "adsExecutions",
        "adsCredentials",
        "socialCredentials",
      ] as const) {
        const rows = await ctx.db
          .query(table)
          .withIndex("by_project", (q) => q.eq("projectId", p._id))
          .collect();
        for (const row of rows) await ctx.db.delete(row._id);
      }
      await ctx.db.delete(p._id);
    }
    await ctx.db.delete(userId);
  },
});
