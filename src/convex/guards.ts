import { getAuthUserId } from "@convex-dev/auth/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { PLAN_MODULES, DEFAULT_PLAN, type Plan } from "./billing";

/** Returns the signed-in user's id, or null. */
export async function maybeUser(ctx: QueryCtx | MutationCtx) {
  return await getAuthUserId(ctx);
}

/** Throws "Not signed in" when unauthenticated. */
export async function requireUser(ctx: QueryCtx | MutationCtx) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Not signed in");
  return userId;
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

/** Entitlement check for module mutations. Reads plan from user record —
 *  single source of truth is PLAN_MODULES in billing.ts. */
export async function assertModule(
  ctx: MutationCtx,
  moduleName: string,
): Promise<Id<"users">> {
  const userId = await requireUser(ctx) as Id<"users">;
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
