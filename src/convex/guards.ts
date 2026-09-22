import { getAuthUserId } from "@convex-dev/auth/server";
import { internalQuery } from "./_generated/server";
import type { ActionCtx, MutationCtx, QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { PLAN_MODULES, DEFAULT_PLAN, type Plan } from "./billing";

/**
 * True when the account is a leftover anonymous (guest) session.
 *
 * The Anonymous provider was removed from `auth.ts` (MOSAI pack T0.2), but
 * accounts minted before that change still exist in the database. Treating
 * them as signed in would keep every module and the paid AI actions reachable
 * for free — the exact abuse chain the review flagged. So identity is only
 * established for a real account, everywhere, not just at sign-in.
 */
async function isAnonymousAccount(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
): Promise<boolean> {
  const user = await ctx.db.get(userId);
  return user?.isAnonymous === true;
}

/** Internal probe so actions (which have no `ctx.db`) can run the same check. */
export const isAnonymousUser = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get(userId);
    return user?.isAnonymous === true;
  },
});

/** Returns the signed-in user's id, or null (anonymous users included). */
export async function maybeUser(ctx: QueryCtx | MutationCtx) {
  const userId = await getAuthUserId(ctx);
  if (!userId) return null;
  if (await isAnonymousAccount(ctx, userId)) return null;
  return userId;
}

/** Throws "Not signed in" when unauthenticated or an anonymous guest. */
export async function requireUser(ctx: QueryCtx | MutationCtx) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Not signed in");
  if (await isAnonymousAccount(ctx, userId)) throw new Error("Not signed in");
  return userId;
}

/** Sign-in guard for Convex actions. Actions have no `ctx.db`, so this only
 *  establishes identity — it is the gate every paid AI / scraping action runs
 *  BEFORE spending a provider call. Pair with `internal.billing.checkModule`
 *  via `ctx.runQuery` when the action also needs an entitlement check. */
export async function requireActionUser(ctx: ActionCtx): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Not signed in");
  const anonymous = await ctx.runQuery(internal.guards.isAnonymousUser, {
    userId: userId as Id<"users">,
  });
  if (anonymous) throw new Error("Not signed in");
  return userId as Id<"users">;
}

/** Loads any project-scoped row and verifies the owning project belongs to
 *  the current user. Standard guard for every module CRUD mutation. */
export async function ownedRow(
  ctx: QueryCtx | MutationCtx,
  row: { projectId: Id<"projects"> } | null,
) {
  if (!row) return null;
  const project = await ctx.db.get(row.projectId);
  if (!project) return null;
  const userId = await getAuthUserId(ctx);
  if (!userId || project.ownerId !== userId) return null;
  return row;
}

/** Authenticate + authorize a project id. Throws "Not signed in" or
 *  "Not found" (never reveals whether a foreign project id exists).
 *  Every mutation that accepts a `projectId` argument must call this before
 *  writing anything — `assertModule` checks the plan, NOT ownership. */
export async function requireProject(
  ctx: QueryCtx | MutationCtx,
  projectId: Id<"projects">,
) {
  const userId = await requireUser(ctx);
  const project = await ctx.db.get(projectId);
  if (!project || project.ownerId !== userId) throw new Error("Not found");
  return { userId, project };
}

/** Entitlement check for module mutations. Reads plan from user record —
 *  single source of truth is PLAN_MODULES in billing.ts. This is the ONLY
 *  assertModule in the codebase (review finding: two copies had drifted and
 *  disagreed on the default plan). */
export async function assertModule(
  ctx: MutationCtx,
  moduleName: string,
): Promise<Id<"users">> {
  const userId = (await requireUser(ctx)) as Id<"users">;
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
