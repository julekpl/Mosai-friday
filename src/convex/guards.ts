import { getAuthUserId } from "@convex-dev/auth/server";
import { action, internalQuery, mutation, query } from "./_generated/server";
import type { ActionCtx, MutationCtx, QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { ObjectType, PropertyValidators } from "convex/values";
import type {
  RegisteredAction,
  RegisteredMutation,
  RegisteredQuery,
} from "convex/server";
import type { Doc, Id } from "./_generated/dataModel";
import { PLAN_MODULES, DEFAULT_PLAN, type Plan } from "./billing";
import { roleCan, type OrgCapability } from "./lib/roles";

/**
 * Authorization + org-scoped function builders (MOSAI pack T2.1 / T2.2, ADR-2).
 *
 * Tenancy is the organization that owns a project. Two layers keep the tenant
 * boundary in one reviewed place:
 *
 *  1. The helpers (`hasProjectAccess`, `requireProject`, `ownedRow`, …) resolve
 *     the caller's **active organization membership** and authorize a specific
 *     record. `assertModule` is NOT ownership — it only checks the caller's plan.
 *  2. The builders `orgQuery` / `orgMutation` / `orgAction` wrap Convex's
 *     `query` / `mutation` / `action`, resolve the caller's active organization
 *     memberships once, and hand the handler an `OrgAccess` object. A handler
 *     therefore authorizes its record through `access.requireProject(...)` /
 *     `access.ownedProject(...)` / `access.ownedRow(...)` instead of writing an
 *     inline `project.ownerId !== userId` check (the pattern that produced the
 *     `collections.create` cross-tenant write).
 *
 * `scripts/audit-public-functions.mjs` fails on any public function that still
 * authorizes inline, `scripts/lint` bans a direct `ctx.db` project lookup
 * outside this data-access layer, and the generated cross-tenant suite
 * (`tests/unit/cross-tenant.generated.test.ts`) exercises every public function
 * with a foreign-organization caller.
 */

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

// ── Organization tenancy ────────────────────────────────────────────────────

/** Active membership lookup by (organization, user). Returns null when the
 *  user is not an active member — callers must treat that as "Not found". */
export async function membershipFor(
  ctx: QueryCtx | MutationCtx,
  organizationId: Id<"organizations">,
  userId: Id<"users">,
) {
  return await ctx.db
    .query("memberships")
    .withIndex("by_organization_user", (q) =>
      q.eq("organizationId", organizationId).eq("userId", userId),
    )
    .unique();
}

/** The caller's active organization memberships. */
export async function activeOrganizationIdsFor(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
): Promise<Id<"organizations">[]> {
  const rows = await ctx.db
    .query("memberships")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  return rows
    .filter((row) => row.status === "active")
    .map((row) => row.organizationId);
}

/**
 * The one project-authorization rule: the caller must be an **active member**
 * of the organization that owns the project. A project created before T2.1's
 * migration ran has no `organizationId`; for that legacy row only, the owner
 * is the tenant (the migration assigns the organization on its first run).
 */
export async function hasProjectAccess(
  ctx: QueryCtx | MutationCtx,
  project: Doc<"projects">,
  userId: Id<"users">,
): Promise<boolean> {
  if (project.organizationId) {
    const membership = await membershipFor(ctx, project.organizationId, userId);
    return membership?.status === "active";
  }
  return project.ownerId === userId;
}

/** A project-scoped row is readable when its owning project is. */
export async function hasRowAccess(
  ctx: QueryCtx | MutationCtx,
  row: { projectId: Id<"projects"> } | null,
  userId: Id<"users">,
): Promise<boolean> {
  if (!row) return false;
  const project = await ctx.db.get(row.projectId);
  if (!project) return false;
  return hasProjectAccess(ctx, project, userId);
}

/** Boolean project authorization used by internal helpers and action support
 *  queries. The raw project read lives here (the data-access layer) so feature
 *  modules never look a project up to authorize it themselves. */
export async function projectAccessFor(
  ctx: QueryCtx | MutationCtx,
  projectId: Id<"projects">,
  userId: Id<"users">,
): Promise<boolean> {
  const project = await ctx.db.get(projectId);
  return project ? hasProjectAccess(ctx, project, userId) : false;
}

/** The authorized project scope returned by the helpers below. */
export type ProjectScope = {
  userId: Id<"users">;
  project: Doc<"projects">;
  organizationId: Id<"organizations"> | null;
};

/** Loads any project-scoped row and verifies its owning project is reachable
 *  by the caller. Standard guard for every module CRUD mutation. */
export async function ownedRow<T extends { projectId: Id<"projects"> }>(
  ctx: QueryCtx | MutationCtx,
  row: T | null,
): Promise<T | null> {
  if (!row) return null;
  const userId = await getAuthUserId(ctx);
  if (!userId) return null;
  if (!(await hasRowAccess(ctx, row, userId as Id<"users">))) return null;
  return row;
}

/** Authenticate + authorize a project id. Throws "Not signed in" or
 *  "Not found" (never reveals whether a foreign project id exists).
 *  Every mutation that accepts a `projectId` argument must call this before
 *  writing anything — `assertModule` checks the plan, NOT ownership. */
export async function requireProject(
  ctx: QueryCtx | MutationCtx,
  projectId: Id<"projects">,
): Promise<ProjectScope> {
  const userId = await requireUser(ctx);
  const project = await ctx.db.get(projectId);
  if (!project || !(await hasProjectAccess(ctx, project, userId))) {
    throw new Error("Not found");
  }
  return { userId, project, organizationId: project.organizationId ?? null };
}

/** Read-path variant of `requireProject`: returns null instead of throwing so
 *  a reactive query renders an empty state for a signed-out or foreign caller. */
export async function projectForRead(
  ctx: QueryCtx | MutationCtx,
  projectId: Id<"projects">,
): Promise<ProjectScope | null> {
  const raw = await getAuthUserId(ctx);
  if (!raw) return null;
  const userId = raw as Id<"users">;
  if (await isAnonymousAccount(ctx, userId)) return null;
  const project = await ctx.db.get(projectId);
  if (!project) return null;
  if (!(await hasProjectAccess(ctx, project, userId))) return null;
  return { userId, project, organizationId: project.organizationId ?? null };
}

/** Authenticate + authorize an organization id for the current user.
 *  Throws "Not found" for a foreign organization or a caller with no active
 *  membership, so a function can never confirm that a foreign org id exists. */
export async function requireOrganization(
  ctx: QueryCtx | MutationCtx,
  organizationId: Id<"organizations">,
) {
  const userId = await requireUser(ctx);
  const organization = await ctx.db.get(organizationId);
  if (!organization) throw new Error("Not found");
  const membership = await membershipFor(ctx, organizationId, userId);
  if (!membership || membership.status !== "active") {
    throw new Error("Not found");
  }
  return { userId, organization, membership };
}

/** `requireOrganization` plus a capability check. This is the guard every
 *  organization mutation uses — a role that lacks the capability is rejected
 *  here, in one reviewed place, not inline in each handler. */
export async function requireOrgRole(
  ctx: QueryCtx | MutationCtx,
  organizationId: Id<"organizations">,
  capability: OrgCapability,
) {
  const context = await requireOrganization(ctx, organizationId);
  if (!roleCan(context.membership.role, capability)) {
    throw new Error(
      "Your role in this organization does not allow that action.",
    );
  }
  return context;
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

// ── OrgAccess + org-scoped builders ─────────────────────────────────────────

export type OrganizationScope = {
  userId: Id<"users">;
  organization: Doc<"organizations">;
  membership: Doc<"memberships">;
};

/**
 * The authorized context every org-scoped handler receives. It resolves the
 * caller's active organization memberships once and exposes the only
 * supported ways to authorize a specific record.
 */
export type OrgAccess = {
  /** The signed-in user, or null for a signed-out / anonymous caller. */
  userId: Id<"users"> | null;
  /** The caller's active organization memberships. */
  organizationIds: Id<"organizations">[];
  /** Throws "Not signed in" when there is no real identity. */
  requireUser(): Promise<Id<"users">>;
  /** Authorize a project id or throw "Not found". */
  requireProject(projectId: Id<"projects">): Promise<ProjectScope>;
  /** Authorize a project id or return null (read paths). */
  ownedProject(projectId: Id<"projects">): Promise<ProjectScope | null>;
  /** Authorize a project-scoped row or return null. */
  ownedRow<T extends { projectId: Id<"projects"> }>(row: T | null): Promise<T | null>;
  /** Authorize an organization id or throw "Not found". */
  requireOrganization(organizationId: Id<"organizations">): Promise<OrganizationScope>;
};

function makeOrgAccess(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users"> | null,
  organizationIds: Id<"organizations">[],
): OrgAccess {
  return {
    userId,
    organizationIds,
    requireUser: async () => {
      if (!userId) throw new Error("Not signed in");
      return userId;
    },
    requireProject: async (projectId) => {
      if (!userId) throw new Error("Not signed in");
      const project = await ctx.db.get(projectId);
      if (!project || !(await hasProjectAccess(ctx, project, userId))) {
        throw new Error("Not found");
      }
      return { userId, project, organizationId: project.organizationId ?? null };
    },
    ownedProject: async (projectId) => {
      if (!userId) return null;
      const project = await ctx.db.get(projectId);
      if (!project || !(await hasProjectAccess(ctx, project, userId))) return null;
      return { userId, project, organizationId: project.organizationId ?? null };
    },
    ownedRow: async (row) => {
      if (!row || !userId) return null;
      if (!(await hasRowAccess(ctx, row, userId))) return null;
      return row;
    },
    requireOrganization: async (organizationId) =>
      requireOrganization(ctx, organizationId),
  };
}

/** Resolve the caller's active organization memberships for a query/mutation. */
export async function resolveOrgAccess(
  ctx: QueryCtx | MutationCtx,
): Promise<OrgAccess> {
  const raw = await getAuthUserId(ctx);
  if (!raw) return makeOrgAccess(ctx, null, []);
  const userId = raw as Id<"users">;
  if (await isAnonymousAccount(ctx, userId)) return makeOrgAccess(ctx, null, []);
  const organizationIds = await activeOrganizationIdsFor(ctx, userId);
  return makeOrgAccess(ctx, userId, organizationIds);
}

/** Same access object for an action, resolved through internal queries because
 *  actions have no `ctx.db`. */
export async function resolveActionAccess(ctx: ActionCtx): Promise<OrgAccess> {
  const raw = await getAuthUserId(ctx);
  let userId: Id<"users"> | null = null;
  if (raw) {
    const anonymous = await ctx.runQuery(internal.guards.isAnonymousUser, {
      userId: raw as Id<"users">,
    });
    if (!anonymous) userId = raw as Id<"users">;
  }
  const organizationIds = userId
    ? await ctx.runQuery(internal.guards.activeOrganizationIds, { userId })
    : [];
  return {
    userId,
    organizationIds,
    requireUser: async () => {
      if (!userId) throw new Error("Not signed in");
      return userId;
    },
    requireProject: async (projectId) => {
      if (!userId) throw new Error("Not signed in");
      const project = await ctx.runQuery(internal.guards.projectAccessForAction, {
        projectId,
        userId,
      });
      if (!project) throw new Error("Not found");
      return { userId, project, organizationId: project.organizationId ?? null };
    },
    ownedProject: async (projectId) => {
      if (!userId) return null;
      const project = await ctx.runQuery(internal.guards.projectAccessForAction, {
        projectId,
        userId,
      });
      return project
        ? { userId, project, organizationId: project.organizationId ?? null }
        : null;
    },
    ownedRow: async (row) => {
      if (!row || !userId) return null;
      const project = await ctx.runQuery(internal.guards.projectAccessForAction, {
        projectId: row.projectId,
        userId,
      });
      return project ? row : null;
    },
    requireOrganization: async (organizationId) => {
      if (!userId) throw new Error("Not signed in");
      const scope = await ctx.runQuery(internal.guards.organizationAccessForAction, {
        organizationId,
        userId,
      });
      if (!scope) throw new Error("Not found");
      return scope;
    },
  };
}

/** Action-safe project authorization probe. */
export const projectAccessForAction = internalQuery({
  args: { projectId: v.id("projects"), userId: v.id("users") },
  handler: async (ctx, { projectId, userId }) => {
    const project = await ctx.db.get(projectId);
    if (!project) return null;
    if (!(await hasProjectAccess(ctx, project, userId))) return null;
    return project;
  },
});

/** Action-safe organization authorization probe. */
export const organizationAccessForAction = internalQuery({
  args: { organizationId: v.id("organizations"), userId: v.id("users") },
  handler: async (ctx, { organizationId, userId }) => {
    const organization = await ctx.db.get(organizationId);
    if (!organization) return null;
    const membership = await membershipFor(ctx, organizationId, userId);
    if (!membership || membership.status !== "active") return null;
    return { userId, organization, membership };
  },
});

/** Action-safe active-membership probe. */
export const activeOrganizationIds = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => activeOrganizationIdsFor(ctx, userId),
});

/**
 * Define a public query whose handler receives the caller's authorized
 * organization context. Prefer this over `query` for anything that reads a
 * project-scoped record.
 *
 * Convex's builder types the handler as a variadic rest tuple, so the wrapper
 * pins the registered function's argument and return types explicitly (via
 * `RegisteredQuery`) rather than relying on inference through the rest tuple.
 */
export function orgQuery<Args extends PropertyValidators, R>(def: {
  args: Args;
  handler: (ctx: QueryCtx, args: ObjectType<Args>, access: OrgAccess) => Promise<R>;
}): RegisteredQuery<"public", ObjectType<Args>, Promise<R>> {
  const registered = query({
    args: def.args,
    handler: async (ctx: QueryCtx, args: ObjectType<Args>) =>
      def.handler(ctx, args, await resolveOrgAccess(ctx)),
  } as never);
  return registered as unknown as RegisteredQuery<
    "public",
    ObjectType<Args>,
    Promise<R>
  >;
}

/** Define a public mutation with the authorized organization context. */
export function orgMutation<Args extends PropertyValidators, R>(def: {
  args: Args;
  handler: (
    ctx: MutationCtx,
    args: ObjectType<Args>,
    access: OrgAccess,
  ) => Promise<R>;
}): RegisteredMutation<"public", ObjectType<Args>, Promise<R>> {
  const registered = mutation({
    args: def.args,
    handler: async (ctx: MutationCtx, args: ObjectType<Args>) =>
      def.handler(ctx, args, await resolveOrgAccess(ctx)),
  } as never);
  return registered as unknown as RegisteredMutation<
    "public",
    ObjectType<Args>,
    Promise<R>
  >;
}

/** Define a public action with the authorized organization context. */
export function orgAction<Args extends PropertyValidators, R>(def: {
  args: Args;
  handler: (ctx: ActionCtx, args: ObjectType<Args>, access: OrgAccess) => Promise<R>;
}): RegisteredAction<"public", ObjectType<Args>, Promise<R>> {
  const registered = action({
    args: def.args,
    handler: async (ctx: ActionCtx, args: ObjectType<Args>) =>
      def.handler(ctx, args, await resolveActionAccess(ctx)),
  } as never);
  return registered as unknown as RegisteredAction<
    "public",
    ObjectType<Args>,
    Promise<R>
  >;
}
