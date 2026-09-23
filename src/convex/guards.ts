import { getAuthUserId } from "@convex-dev/auth/server";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
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
import { roleCan, type OrgCapability, type OrgRole } from "./lib/roles";
import {
  isPlatformAdminEmail,
  normalizeEmail,
} from "./lib/platformAdmin";
import {
  DEFAULT_PLAN,
  MODULE_BY_ID,
  capabilityKey,
  capabilityMessage,
  isPlan,
  parseCapability,
  planIncludesModule,
  resolveCapabilityState,
  type CapabilityAction,
  type CapabilityKey,
  type CapabilityReason,
  type CapabilityState,
  type ModuleId,
  type Plan,
} from "./lib/capabilities";

/**
 * Authorization, capability and org-scoped function builders
 * (MOSAI pack T2.1 / T2.2 / T2.3, ADR-2).
 *
 * Three layers keep the tenant boundary in one reviewed place:
 *
 *  1. The helpers (`hasProjectAccess`, `requireProject`, `ownedRow`, …) resolve
 *     the caller's **active organization membership** and authorize a specific
 *     record. `assertModule` is NOT ownership — it only checked the plan, and
 *     since T2.3 it is gone entirely: a plan is one half of a capability.
 *  2. The capability registry (`lib/capabilities.ts`) is the single source of
 *     truth for which module an action belongs to and who may perform it
 *     (plan × module × role, plus the country stub and the capability states).
 *  3. The builders. `orgQuery` / `orgMutation` / `orgAction` resolve the
 *     caller's organizations and hand the handler an `OrgAccess` object.
 *     `moduleQuery` / `moduleMutation` / `moduleAction` add the module's
 *     capability: every authorization inside the handler — and, for writes,
 *     the call itself (before the handler runs) — must satisfy
 *     `resolveCapabilityState`, so a `free` plan or a `member` role is refused
 *     for the module action it lacks instead of merely being hidden in the UI.
 *     The **module capability resolves the tenant from the function's record
 *     argument**, so a module write is refused before it can touch a row.
 *
 * `scripts/audit-public-functions.mjs` fails on a public function that
 * authorizes inline or never authorizes a record; `scripts/audit-module-capabilities.mjs`
 * fails on a module function that is reachable without a capability check or a
 * documented exemption in the registry; the generated suites
 * (`tests/unit/cross-tenant.generated.test.ts`, `tests/unit/entitlements.test.ts`)
 * are the behaviour proof.
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
 *  BEFORE spending a provider call. Pair with `moduleAction`, which enforces
 *  the module capability through `internal.guards` probes. */
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
 *  writing anything — a plan check is NOT ownership. */
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

/** `requireOrganization` plus an organization-administration capability check.
 *  This is the guard every organization mutation uses — a role that lacks the
 *  capability is rejected here, in one reviewed place, not inline in each
 *  handler. (`lib/roles.ts` is the canonical map for these admin capabilities;
 *  module capabilities live in `lib/capabilities.ts`.) */
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

// ── Platform operators (T2.4 admin) ─────────────────────────────────────────

/**
 * True when the account may act as a MOSAI platform operator.
 *
 * Server-side only: the flag on the user, the pre-existing `admin` role, the
 * deployment email allow-list (`lib/platformAdmin.ts`) or an active
 * `platformAdmins` row. A client can never grant this.
 */
export async function resolvePlatformAdmin(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
): Promise<boolean> {
  const user = await ctx.db.get(userId);
  if (!user) return false;
  if (user.isPlatformAdmin === true) return true;
  if (user.role === "admin") return true;

  const email = normalizeEmail(user.email);
  if (email && isPlatformAdminEmail(email)) return true;

  if (email) {
    const byEmail = await ctx.db
      .query("platformAdmins")
      .withIndex("by_email", (q) => q.eq("email", email))
      .first();
    if (byEmail?.status === "active") return true;
  }
  const byUser = await ctx.db
    .query("platformAdmins")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .first();
  return byUser?.status === "active";
}

/** Authenticate and require operator access — the guard every admin-panel
 *  function uses. Throws "Platform admin only" for everyone else. */
export async function requirePlatformAdmin(
  ctx: QueryCtx | MutationCtx,
): Promise<Id<"users">> {
  const userId = await requireUser(ctx);
  if (!(await resolvePlatformAdmin(ctx, userId))) {
    throw new Error("Platform admin only");
  }
  return userId;
}

/** The organization an operator is acting on behalf of, for audit metadata. */
export async function operatorEmailFor(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
): Promise<string | null> {
  const user = await ctx.db.get(userId);
  return normalizeEmail(user?.email);
}

// ── Module capabilities (T2.3) ──────────────────────────────────────────────

/** The resolved capability for one (plan, role, module, action) triple, with
 *  the tenant values that produced it (so a caller can explain the state). */
export type CapabilityResolution = {
  state: CapabilityState;
  reason: CapabilityReason;
  capability: CapabilityKey;
  module: ModuleId;
  action: CapabilityAction;
  plan: Plan;
  role: OrgRole;
};

/** The organization that owns a project, or null for a pre-T2.1 row. */
async function organizationForProject(
  ctx: QueryCtx | MutationCtx,
  project: Doc<"projects">,
) {
  if (!project.organizationId) return null;
  return await ctx.db.get(project.organizationId);
}

/** The plan a user acts on when there is no organization (legacy rows). */
async function planForUser(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
): Promise<Plan> {
  const user = await ctx.db.get(userId);
  return user?.plan && isPlan(user.plan) ? user.plan : DEFAULT_PLAN;
}

/**
 * The plan an **organization** acts on: its owner's plan.
 *
 * Deliberately not the caller's plan. Before T2.3 every plan check read
 * `user.plan` of whoever called, so a teammate with a personal `free` plan was
 * locked out of the add-ons the organization had paid for — a defect the
 * regression test in `tests/unit/entitlements.test.ts` pins down.
 */
async function planForOrganization(
  ctx: QueryCtx | MutationCtx,
  organization: Doc<"organizations">,
): Promise<Plan> {
  return await planForUser(ctx, organization.ownerId);
}

function finalizeResolution(
  resolution: { state: CapabilityState; reason: CapabilityReason },
  parsed: { module: ModuleId; action: CapabilityAction },
  capability: CapabilityKey,
  plan: Plan,
  role: OrgRole,
): CapabilityResolution {
  return {
    ...resolution,
    capability,
    module: parsed.module,
    action: parsed.action,
    plan,
    role,
  };
}

/**
 * The tenant a project acts as: the organization's plan and the caller's role
 * in it. Null when the caller cannot reach the project at all (signed out,
 * foreign org, no active membership) — the same "Not found" posture as
 * `hasProjectAccess`, so a capability probe never confirms that a foreign
 * project exists.
 */
export async function projectTenant(
  ctx: QueryCtx | MutationCtx,
  project: Doc<"projects">,
  userId: Id<"users">,
): Promise<{ plan: Plan; role: OrgRole } | null> {
  const organization = await organizationForProject(ctx, project);
  if (!organization) {
    if (project.ownerId !== userId) return null;
    return { plan: await planForUser(ctx, userId), role: "owner" };
  }
  const membership = await membershipFor(ctx, organization._id, userId);
  if (!membership || membership.status !== "active") return null;
  return {
    plan: await planForOrganization(ctx, organization),
    role: membership.role,
  };
}

/**
 * Capability resolution for a project: the organization's plan × the caller's
 * role in it. Returns null when the caller cannot reach the project at all.
 */
export async function projectCapability(
  ctx: QueryCtx | MutationCtx,
  project: Doc<"projects">,
  userId: Id<"users">,
  capability: CapabilityKey,
): Promise<CapabilityResolution | null> {
  const parsed = parseCapability(capability);
  if (!parsed) throw new Error(`Unknown capability "${capability}"`);
  const tenant = await projectTenant(ctx, project, userId);
  if (!tenant) return null;
  return finalizeResolution(
    resolveCapabilityState({
      plan: tenant.plan,
      role: tenant.role,
      module: parsed.module,
      action: parsed.action,
    }),
    parsed,
    capability,
    tenant.plan,
    tenant.role,
  );
}

/** Same resolution for an organization-scoped record (no project). */
export async function organizationCapability(
  ctx: QueryCtx | MutationCtx,
  organization: Doc<"organizations">,
  userId: Id<"users">,
  capability: CapabilityKey,
): Promise<CapabilityResolution | null> {
  const parsed = parseCapability(capability);
  if (!parsed) throw new Error(`Unknown capability "${capability}"`);
  const membership = await membershipFor(ctx, organization._id, userId);
  if (!membership || membership.status !== "active") return null;
  const plan = await planForOrganization(ctx, organization);
  return finalizeResolution(
    resolveCapabilityState({
      plan,
      role: membership.role,
      module: parsed.module,
      action: parsed.action,
    }),
    parsed,
    capability,
    plan,
    membership.role,
  );
}

/** Throws the honest capability error (or "Not found") — never silently allows. */
export function assertIncluded(
  resolution: CapabilityResolution | null,
): CapabilityResolution {
  if (!resolution) throw new Error("Not found");
  const message = capabilityMessage(resolution, resolution);
  if (message) throw new Error(message);
  return resolution;
}

/** Authenticate + authorize a project **and** enforce a module capability. */
export async function assertProjectCapability(
  ctx: QueryCtx | MutationCtx,
  project: Doc<"projects">,
  userId: Id<"users">,
  capability: CapabilityKey,
): Promise<CapabilityResolution> {
  return assertIncluded(await projectCapability(ctx, project, userId, capability));
}

/** `requireProject` + a module capability, in one call. */
export async function requireProjectCapability(
  ctx: QueryCtx | MutationCtx,
  projectId: Id<"projects">,
  capability: CapabilityKey,
): Promise<ProjectScope & { capability: CapabilityResolution }> {
  const scope = await requireProject(ctx, projectId);
  const resolution = await assertProjectCapability(
    ctx,
    scope.project,
    scope.userId,
    capability,
  );
  return { ...scope, capability: resolution };
}

// ── Record → owning project (the module gate's resolver) ────────────────────

/** Fields that point at a parent row when a table has no `projectId` of its
 *  own (only `contentDocs` today, via `pieceId`). */
const PARENT_FIELDS = [
  "siteId",
  "buildId",
  "pageId",
  "pieceId",
  "productId",
  "personaId",
  "collectionId",
  "campaignId",
  "contentId",
  "topicId",
  "gapId",
  "variantId",
  "changeId",
] as const;

/** Untyped row read: the id's table is not known statically when the gate
 *  resolves a function's record argument by convention. Lives in the
 *  data-access layer on purpose. */
async function getRecordRow(
  ctx: QueryCtx | MutationCtx,
  recordId: string,
): Promise<Record<string, unknown> | null> {
  const row = await ctx.db.get(recordId as unknown as Id<"projects">);
  return (row ?? null) as unknown as Record<string, unknown> | null;
}

/**
 * The project that owns a record, resolved by following `projectId` (or a
 * known parent reference) for up to three hops. Returns null when the id does
 * not resolve to project-scoped data — callers must treat that as "Not found".
 */
export async function projectForRecord(
  ctx: QueryCtx | MutationCtx,
  recordId: string,
): Promise<Doc<"projects"> | null> {
  let currentId: string | null = recordId;
  for (let hop = 0; hop < 3 && currentId; hop++) {
    const row = await getRecordRow(ctx, currentId);
    if (!row) return null;
    const projectId = row.projectId;
    if (typeof projectId === "string") {
      return await ctx.db.get(projectId as Id<"projects">);
    }
    currentId =
      PARENT_FIELDS.map((field) => row[field]).find(
        (value) => typeof value === "string",
      ) ?? null;
  }
  return null;
}

/** Action-safe record → project probe. */
export const recordProjectForAction = internalQuery({
  args: { recordId: v.string(), table: v.optional(v.string()) },
  handler: async (ctx, { recordId, table }) => {
    if (table === "projects") {
      return await ctx.db.get(recordId as Id<"projects">);
    }
    if (table === "_storage") return null;
    return await projectForRecord(ctx, recordId);
  },
});

/** Action-safe capability probe for a project-scoped call. */
export const capabilityStateForAction = internalQuery({
  args: {
    projectId: v.id("projects"),
    userId: v.id("users"),
    capability: v.string(),
  },
  handler: async (ctx, { projectId, userId, capability }) => {
    const project = await ctx.db.get(projectId);
    if (!project) return null;
    if (!(await hasProjectAccess(ctx, project, userId))) return null;
    const parsed = parseCapability(capability);
    if (!parsed) throw new Error(`Unknown capability "${capability}"`);
    return await projectCapability(
      ctx,
      project,
      userId,
      capabilityKey(parsed.module, parsed.action),
    );
  },
});

/** Action-safe capability probe for an organization-scoped call. */
export const capabilityStateForOrganizationAction = internalQuery({
  args: {
    organizationId: v.id("organizations"),
    userId: v.id("users"),
    capability: v.string(),
  },
  handler: async (ctx, { organizationId, userId, capability }) => {
    const organization = await ctx.db.get(organizationId);
    if (!organization) return null;
    const parsed = parseCapability(capability);
    if (!parsed) throw new Error(`Unknown capability "${capability}"`);
    return await organizationCapability(
      ctx,
      organization,
      userId,
      capabilityKey(parsed.module, parsed.action),
    );
  },
});

/**
 * Job-side capability probe (T2.3).
 *
 * A scheduled job has no user in the loop, so the axis is the **tenant's plan**
 * with the tenant's own authority — the role was already checked when the user
 * scheduled or published. Returns null when the project does not exist.
 */
export const capabilityStateForProject = internalQuery({
  args: { projectId: v.id("projects"), capability: v.string() },
  handler: async (ctx, { projectId, capability }) => {
    const project = await ctx.db.get(projectId);
    if (!project) return null;
    const parsed = parseCapability(capability);
    if (!parsed) throw new Error(`Unknown capability "${capability}"`);
    const organization = await organizationForProject(ctx, project);
    const plan = organization
      ? await planForOrganization(ctx, organization)
      : await planForUser(ctx, project.ownerId);
    return resolveCapabilityState({
      plan,
      role: "owner",
      module: parsed.module,
      action: parsed.action,
    });
  },
});

/**
 * Action-side capability enforcement as a plain function.
 *
 * `moduleAction` cannot be used from a `"use node"` action file, so node
 * actions (Build chat, Sell AI, social copilot) call this instead — same rule,
 * same messages, resolved through `internal.guards` probes.
 */
export async function requireActionCapability(
  ctx: ActionCtx,
  args: {
    projectId: Id<"projects">;
    capability: CapabilityKey;
    userId?: Id<"users">;
  },
): Promise<CapabilityResolution> {
  const userId = args.userId ?? (await requireActionUser(ctx));
  const resolution = await ctx.runQuery(
    internal.guards.capabilityStateForAction,
    { projectId: args.projectId, userId, capability: args.capability },
  );
  return assertIncluded(resolution);
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
 * supported ways to authorize a specific record. A module-scoped handler
 * (`moduleQuery` / `moduleMutation` / `moduleAction`) receives a version whose
 * authorizations also enforce the module capability.
 */
export type OrgAccess = {
  /** The signed-in user, or null for a signed-out / anonymous caller. */
  userId: Id<"users"> | null;
  /** The caller's active organization memberships. */
  organizationIds: Id<"organizations">[];
  /** The module capability every authorization here enforces — null for the
   *  base spine (`orgQuery` / `orgMutation` / `orgAction`). */
  capability: CapabilityKey | null;
  /** Throws "Not signed in" when there is no real identity. */
  requireUser(): Promise<Id<"users">>;
  /** Authorize a project id or throw "Not found". */
  requireProject(projectId: Id<"projects">): Promise<ProjectScope>;
  /** Authorize a project id or return null (read paths). An explicit
   *  capability overrides this call's module default (used by the storefront's
   *  CMS page read, which belongs to Build inside the Sell-owned file). */
  ownedProject(
    projectId: Id<"projects">,
    capability?: CapabilityKey,
  ): Promise<ProjectScope | null>;
  /** Authorize a project-scoped row or return null. */
  ownedRow<T extends { projectId: Id<"projects"> }>(row: T | null): Promise<T | null>;
  /** Authorize an organization id or throw "Not found". */
  requireOrganization(organizationId: Id<"organizations">): Promise<OrganizationScope>;
  /** Authorize a project for a specific capability (defaults to this call's
   *  module capability), or throw. */
  requireCapability(
    projectId: Id<"projects">,
    capability?: CapabilityKey,
  ): Promise<ProjectScope>;
  /** The capability state for a project without throwing — for read paths that
   *  render a `locked` / `needs_setup` state. */
  capabilityState(
    projectId: Id<"projects">,
    capability?: CapabilityKey,
  ): Promise<CapabilityState>;
};

function makeOrgAccess(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users"> | null,
  organizationIds: Id<"organizations">[],
): OrgAccess {
  return {
    userId,
    organizationIds,
    capability: null,
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
    ownedProject: async (projectId, capability) => {
      if (!userId) return null;
      const project = await ctx.db.get(projectId);
      if (!project || !(await hasProjectAccess(ctx, project, userId))) return null;
      if (capability) {
        const resolution = await projectCapability(
          ctx,
          project,
          userId,
          capability,
        );
        if (resolution?.state !== "included") return null;
      }
      return { userId, project, organizationId: project.organizationId ?? null };
    },
    ownedRow: async (row) => {
      if (!row || !userId) return null;
      if (!(await hasRowAccess(ctx, row, userId))) return null;
      return row;
    },
    requireOrganization: async (organizationId) =>
      requireOrganization(ctx, organizationId),
    requireCapability: async (projectId, capability) => {
      if (!capability) {
        throw new Error(
          "requireCapability needs a capability here — declare the module with moduleQuery/moduleMutation/moduleAction.",
        );
      }
      const scope = await requireProjectCapability(ctx, projectId, capability);
      return scope;
    },
    capabilityState: async (projectId, capability) => {
      if (!userId || !capability) return "unavailable";
      const project = await ctx.db.get(projectId);
      if (!project) return "unavailable";
      const resolution = await projectCapability(
        ctx,
        project,
        userId,
        capability,
      );
      return resolution?.state ?? "unavailable";
    },
  };
}

/**
 * Wrap an access object so every record authorization also enforces a module
 * capability: `require*` throws the honest state message, `owned*` returns
 * null (a locked module reads nothing rather than showing data the plan does
 * not include).
 */
function withCapability(
  ctx: QueryCtx | MutationCtx,
  access: OrgAccess,
  capability: CapabilityKey,
): OrgAccess {
  return {
    ...access,
    capability,
    requireProject: async (projectId) => {
      const scope = await access.requireProject(projectId);
      await assertProjectCapability(ctx, scope.project, scope.userId, capability);
      return scope;
    },
    ownedProject: async (projectId, override) => {
      const scope = await access.ownedProject(projectId);
      if (!scope) return null;
      const resolution = await projectCapability(
        ctx,
        scope.project,
        scope.userId,
        override ?? capability,
      );
      return resolution?.state === "included" ? scope : null;
    },
    ownedRow: async (row) => {
      const resolved = await access.ownedRow(row);
      if (!resolved) return null;
      const project = await ctx.db.get(resolved.projectId);
      if (!project) return null;
      const resolution = await projectCapability(
        ctx,
        project,
        access.userId ?? ("" as Id<"users">),
        capability,
      );
      return resolution?.state === "included" ? resolved : null;
    },
    requireOrganization: async (organizationId) => {
      const scope = await access.requireOrganization(organizationId);
      const resolution = await organizationCapability(
        ctx,
        scope.organization,
        scope.userId,
        capability,
      );
      assertIncluded(resolution);
      return scope;
    },
    requireCapability: async (projectId, override) =>
      requireProjectCapability(ctx, projectId, override ?? capability),
    capabilityState: async (projectId, override) => {
      if (!access.userId) return "unavailable";
      const project = await ctx.db.get(projectId);
      if (!project) return "unavailable";
      const resolution = await projectCapability(
        ctx,
        project,
        access.userId,
        override ?? capability,
      );
      return resolution?.state ?? "unavailable";
    },
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
  const build: OrgAccess = {
    userId,
    organizationIds,
    capability: null,
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
    ownedProject: async (projectId, capability) => {
      if (!userId) return null;
      const project = await ctx.runQuery(internal.guards.projectAccessForAction, {
        projectId,
        userId,
      });
      if (!project) return null;
      if (capability) {
        const probe = await ctx.runQuery(
          internal.guards.capabilityStateForAction,
          { projectId, userId, capability },
        );
        if (probe?.state !== "included") return null;
      }
      return { userId, project, organizationId: project.organizationId ?? null };
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
    requireCapability: async (projectId, capability) => {
      if (!capability) {
        throw new Error(
          "requireCapability needs a capability here — declare the module with moduleQuery/moduleMutation/moduleAction.",
        );
      }
      return await requireActionProjectCapability(ctx, projectId, capability);
    },
    capabilityState: async (projectId, capability) => {
      if (!userId || !capability) return "unavailable";
      const probe = await ctx.runQuery(
        internal.guards.capabilityStateForAction,
        { projectId, userId, capability },
      );
      return probe?.state ?? "unavailable";
    },
  };

  // The action access object is finished here; module capabilities are layered
  // on by `moduleAction`.
  return build;
}

/** Action-side capability enforcement for a project. */
async function requireActionProjectCapability(
  ctx: ActionCtx,
  projectId: Id<"projects">,
  capability: CapabilityKey,
): Promise<ProjectScope> {
  const userId = await requireActionUser(ctx);
  const scope = await ctx.runQuery(internal.guards.projectAccessForAction, {
    projectId,
    userId,
  });
  if (!scope) throw new Error("Not found");
  const resolution = await ctx.runQuery(
    internal.guards.capabilityStateForAction,
    { projectId, userId, capability },
  );
  assertIncluded(resolution);
  return { userId, project: scope, organizationId: scope.organizationId ?? null };
}

/** Action-side capability enforcement layered over an action's access object. */
function withActionCapability(
  ctx: ActionCtx,
  access: OrgAccess,
  capability: CapabilityKey,
): OrgAccess {
  return {
    ...access,
    capability,
    requireProject: async (projectId) => {
      const scope = await access.requireProject(projectId);
      await requireActionProjectCapability(ctx, projectId, capability);
      return scope;
    },
    ownedProject: async (projectId, override) => {
      const scope = await access.ownedProject(projectId);
      if (!scope) return null;
      const probe = await ctx.runQuery(
        internal.guards.capabilityStateForAction,
        { projectId, userId: scope.userId, capability: override ?? capability },
      );
      return probe?.state === "included" ? scope : null;
    },
    ownedRow: async (row) => {
      const resolved = await access.ownedRow(row);
      if (!resolved) return null;
      const probe = await ctx.runQuery(
        internal.guards.capabilityStateForAction,
        { projectId: resolved.projectId, userId: access.userId!, capability },
      );
      return probe?.state === "included" ? resolved : null;
    },
    requireOrganization: async (organizationId) => {
      const scope = await access.requireOrganization(organizationId);
      const probe = await ctx.runQuery(
        internal.guards.capabilityStateForOrganizationAction,
        { organizationId, userId: scope.userId, capability },
      );
      assertIncluded(probe);
      return scope;
    },
    requireCapability: async (projectId, override) =>
      requireActionProjectCapability(ctx, projectId, override ?? capability),
    capabilityState: async (projectId, override) => {
      if (!access.userId) return "unavailable";
      const probe = await ctx.runQuery(
        internal.guards.capabilityStateForAction,
        { projectId, userId: access.userId, capability: override ?? capability },
      );
      return probe?.state ?? "unavailable";
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

// ── AI context + per-user quota (T0.4) ─────────────────────────────────────

/** The business context an AI prompt is built from. Loaded **server-side**
 *  from the database (project row + attached-file excerpts + active products)
 *  after the caller's access to the project is verified — never accepted from
 *  the client (AGENTS.md §5 rule 3; pack T0.4). */
export type ProjectSnapshot = {
  name: string;
  industry?: string;
  description?: string;
  websiteUrl?: string;
  productsServices?: string[];
  goals?: string[];
  competitors?: string[];
  gmbTitle?: string;
  gmbCategory?: string;
  gmbRating?: number;
  gmbReviews?: number;
  fileExcerpts?: string[];
  // Level-1 context integration (M1-BLUEPRINT §13): active products give
  // every AI action commerce context. References only — never copied truth.
  products?: Array<{
    title: string;
    price?: string;
    description?: string;
  }>;
};

/** Build the snapshot for an authorized project. Returns null for a foreign
 *  or missing project so the caller can answer "Not found" without leaking
 *  whether the id exists. Mirrors the shape the client used to assemble in
 *  the old `use-project-snapshot` hook (deleted with T0.4), so prompts are
 *  unchanged except that they are now truthful about their source. */
export const projectSnapshotForAction = internalQuery({
  args: { projectId: v.id("projects"), userId: v.id("users") },
  handler: async (ctx, { projectId, userId }) => {
    const project = await ctx.db.get(projectId);
    if (!project || !(await hasProjectAccess(ctx, project, userId))) return null;

    const files = await ctx.db
      .query("projectFiles")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
    const activeProducts = await ctx.db
      .query("products")
      .withIndex("by_project_status", (q) =>
        q.eq("projectId", projectId).eq("status", "active"),
      )
      .collect();
    const variants = await ctx.db
      .query("productVariants")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();

    const snapshot: ProjectSnapshot = {
      name: project.name,
      industry: project.industry,
      description: project.description,
      websiteUrl: project.websiteUrl,
      productsServices: project.productsServices,
      goals: project.goals,
      competitors: project.competitors,
      gmbTitle: project.websiteScan?.gmb?.title,
      gmbCategory: project.websiteScan?.gmb?.category,
      gmbRating: project.websiteScan?.gmb?.rating,
      gmbReviews: project.websiteScan?.gmb?.reviews,
      fileExcerpts: files
        .slice(0, 8)
        .map((f) => `- ${f.name}: ${(f.excerpt ?? "(no text extracted)").slice(0, 600)}`),
      products: activeProducts.slice(0, 50).map((p) => {
        const def = variants.find((vr) => vr.productId === p._id && vr.isDefault);
        return {
          title: p.title,
          price:
            def?.priceCents != null
              ? `${(def.priceCents / 100).toFixed(2)} ${def.currency}`
              : undefined,
          description: p.description,
        };
      }),
    };
    return snapshot;
  },
});

/** Action-side loader: authenticate (already done), authorize the project
 *  and return the server-built snapshot. Throws "Not found" for a missing or
 *  foreign project — the same answer every guard gives, so an action can
 *  never be used to probe for someone else's project id. */
export async function actionProjectSnapshot(
  ctx: ActionCtx,
  userId: Id<"users">,
  projectId: Id<"projects">,
): Promise<ProjectSnapshot> {
  const snapshot = await ctx.runQuery(
    internal.guards.projectSnapshotForAction,
    { projectId, userId },
  );
  if (!snapshot) throw new Error("Not found");
  return snapshot;
}

/** Per-user AI/scraping budget: this many requests per rolling window.
 *  Exported for the regression test that proves the limit bites. */
export const AI_QUOTA_WINDOW_MS = 10 * 60_000;
export const AI_QUOTA_LIMIT = 30;

/** Consume one unit of the caller's AI quota. Internal — only server code
 *  holding an already-authorized caller can reach it, so a client can never
 *  grant itself budget or reset a window. */
export const consumeAiQuota = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const windowStart = Math.floor(Date.now() / AI_QUOTA_WINDOW_MS) * AI_QUOTA_WINDOW_MS;
    const bucket = await ctx.db
      .query("aiRateLimits")
      .withIndex("by_user_window", (q) =>
        q.eq("userId", userId).eq("windowStart", windowStart),
      )
      .unique();
    if (bucket) {
      if (bucket.count >= AI_QUOTA_LIMIT) {
        throw new Error(
          "AI request limit reached — wait a few minutes and try again.",
        );
      }
      await ctx.db.patch(bucket._id, { count: bucket.count + 1 });
      return;
    }
    await ctx.db.insert("aiRateLimits", { userId, windowStart, count: 1 });
    // Opportunistic cleanup: keep this user's rows down to the current
    // window plus the last hour (registry: `ephemeral`).
    const rows = await ctx.db
      .query("aiRateLimits")
      .withIndex("by_user_window", (q) => q.eq("userId", userId))
      .collect();
    for (const row of rows) {
      if (row.windowStart < windowStart - 60 * 60_000) await ctx.db.delete(row._id);
    }
  },
});

/** Action-side quota gate. Call it AFTER the project is authorized (so a
 *  foreign caller's refused request writes nothing) and BEFORE the provider
 *  call (so a runaway loop is stopped before it costs money). */
export async function consumeAiQuotaForAction(
  ctx: ActionCtx,
  userId: Id<"users">,
): Promise<void> {
  await ctx.runMutation(internal.guards.consumeAiQuota, { userId });
}

const aiRunUsageArgs = {
  promptTokens: v.union(v.number(), v.null()),
  completionTokens: v.union(v.number(), v.null()),
  totalTokens: v.union(v.number(), v.null()),
  providerCredits: v.union(v.number(), v.null()),
  costMicrousd: v.union(v.number(), v.null()),
  costCurrency: v.union(v.literal("USD"), v.null()),
};

/** Internal run creation used only by the centralized ModelGateway. */
export const startAiRun = internalMutation({
  args: {
    userId: v.id("users"),
    projectId: v.optional(v.id("projects")),
    agentId: v.string(),
    promptVersion: v.string(),
    provider: v.union(v.literal("vly"), v.literal("openrouter")),
    model: v.string(),
    autonomy: v.union(v.literal("assistive"), v.literal("draft")),
    maxOutputTokens: v.number(),
    contextSources: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const project = args.projectId ? await ctx.db.get(args.projectId) : null;
    if (args.projectId && !project) throw new Error("Not found");
    return await ctx.db.insert("aiRuns", {
      ...args,
      organizationId: project?.organizationId,
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
      providerCredits: null,
      costMicrousd: null,
      costCurrency: null,
      status: "running",
      errorCategory: null,
      startedAt: Date.now(),
    });
  },
});

/** Internal completion update; callers cannot supply raw prompt or output data. */
export const finishAiRun = internalMutation({
  args: {
    runId: v.id("aiRuns"),
    status: v.union(v.literal("succeeded"), v.literal("failed")),
    ...aiRunUsageArgs,
    errorCategory: v.union(
      v.null(),
      v.literal("provider_error"),
      v.literal("empty_response"),
      v.literal("invalid_request"),
      v.literal("invalid_output"),
    ),
    finishedAt: v.number(),
    latencyMs: v.number(),
  },
  handler: async (ctx, { runId, ...patch }) => {
    const run = await ctx.db.get(runId);
    if (!run || run.status !== "running") return;
    await ctx.db.patch(runId, patch);
  },
});

// ── Builders ────────────────────────────────────────────────────────────────

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

// ── Module-scoped builders (T2.3) ───────────────────────────────────────────

/** Validator shape needed to find a `v.id(...)` argument by convention. */
type InspectorValidator = {
  kind?: string;
  tableName?: string;
  isOptional?: string;
};

/** The first `v.id(...)` argument, preferring required ones. A function that
 *  names a record must authorize it — this is how a module call finds the
 *  tenant it has to check **before** the handler can touch a row. */
function firstRecordArgument(
  args: Record<string, unknown>,
): { name: string; table: string } | null {
  const entries = Object.entries(args);
  const ordered = [
    ...entries.filter(
      ([, validator]) =>
        (validator as InspectorValidator | undefined)?.isOptional !== "optional",
    ),
    ...entries,
  ];
  for (const [name, validator] of ordered) {
    const inspected = validator as InspectorValidator | undefined;
    if (inspected?.kind === "id") {
      return { name, table: inspected.tableName ?? "" };
    }
  }
  return null;
}

type ModuleDef<Args extends PropertyValidators, R, Ctx> = {
  args: Args;
  /** Override the default action (`view` for queries, `edit` for writes). Must
   *  belong to the declared module — the registry rejects anything else. */
  capability?: CapabilityKey;
  /** The argument naming the record that carries the tenant. Defaults to the
   *  first `v.id(...)` argument. */
  recordArg?: string;
  handler: (ctx: Ctx, args: ObjectType<Args>, access: OrgAccess) => Promise<R>;
};

function resolveModuleCapability<M extends ModuleId>(
  module: M,
  def: { capability?: CapabilityKey; recordArg?: string; args: PropertyValidators },
  fallbackAction: CapabilityAction,
): { capability: CapabilityKey; record: { name: string; table: string } | null } {
  const capability = def.capability ?? capabilityKey(module, fallbackAction);
  const parsed = parseCapability(capability);
  if (!parsed) {
    throw new Error(
      `moduleX("${module}", …): "${capability}" is not in the capability registry.`,
    );
  }
  if (parsed.module !== module) {
    throw new Error(
      `moduleX("${module}", …): capability "${capability}" belongs to "${parsed.module}".`,
    );
  }
  const record = firstRecordArgument(def.args as Record<string, unknown>);
  if (def.recordArg) {
    if (!record || record.name !== def.recordArg) {
      const table = (def.args as Record<string, InspectorValidator>)[
        def.recordArg
      ]?.tableName;
      if (!table) {
        throw new Error(
          `moduleX("${module}", …): recordArg "${def.recordArg}" is not a v.id(...) argument.`,
        );
      }
      return { capability, record: { name: def.recordArg, table } };
    }
  }
  return { capability, record };
}

/** Enforce a module capability for a record argument, before the handler runs. */
async function enforceRecordCapability(
  ctx: QueryCtx | MutationCtx,
  args: Record<string, unknown>,
  record: { name: string; table: string },
  capability: CapabilityKey,
): Promise<void> {
  const raw = args[record.name];
  if (typeof raw !== "string") throw new Error("Not found");
  const project =
    record.table === "projects"
      ? await ctx.db.get(raw as Id<"projects">)
      : await projectForRecord(ctx, raw);
  if (!project) throw new Error("Not found");
  const userId = await requireUser(ctx);
  await assertProjectCapability(ctx, project, userId, capability);
}

/**
 * Define a public query owned by a module. Reads authorize through
 * `access.ownedProject` / `access.ownedRow`, which enforce the module
 * capability: a plan without the add-on (or a role without the action) reads
 * nothing, and a foreign organization still sees "Not found".
 */
export function moduleQuery<M extends ModuleId, Args extends PropertyValidators, R>(
  module: M,
  def: ModuleDef<Args, R, QueryCtx>,
): RegisteredQuery<"public", ObjectType<Args>, Promise<R>> {
  const { capability } = resolveModuleCapability(module, def, "view");
  void def.recordArg;
  const registered = query({
    args: def.args,
    handler: async (ctx: QueryCtx, args: ObjectType<Args>) => {
      const access = await resolveOrgAccess(ctx);
      return def.handler(ctx, args, withCapability(ctx, access, capability));
    },
  } as never);
  return registered as unknown as RegisteredQuery<
    "public",
    ObjectType<Args>,
    Promise<R>
  >;
}

/** Define a public mutation owned by a module. The module capability is
 *  enforced **before** the handler runs, resolved from the record argument, so
 *  a lacking caller cannot write anything. */
export function moduleMutation<
  M extends ModuleId,
  Args extends PropertyValidators,
  R,
>(
  module: M,
  def: ModuleDef<Args, R, MutationCtx>,
): RegisteredMutation<"public", ObjectType<Args>, Promise<R>> {
  const { capability, record } = resolveModuleCapability(module, def, "edit");
  const registered = mutation({
    args: def.args,
    handler: async (ctx: MutationCtx, args: ObjectType<Args>) => {
      if (record) {
        await enforceRecordCapability(
          ctx,
          args as Record<string, unknown>,
          record,
          capability,
        );
      }
      const access = await resolveOrgAccess(ctx);
      return def.handler(ctx, args, withCapability(ctx, access, capability));
    },
  } as never);
  return registered as unknown as RegisteredMutation<
    "public",
    ObjectType<Args>,
    Promise<R>
  >;
}

/** Define a public action owned by a module. Actions have no `ctx.db`, so the
 *  same enforcement runs through `internal.guards` probes. */
export function moduleAction<M extends ModuleId, Args extends PropertyValidators, R>(
  module: M,
  def: ModuleDef<Args, R, ActionCtx>,
): RegisteredAction<"public", ObjectType<Args>, Promise<R>> {
  const { capability, record } = resolveModuleCapability(module, def, "edit");
  const registered = action({
    args: def.args,
    handler: async (ctx: ActionCtx, args: ObjectType<Args>) => {
      const access = await resolveActionAccess(ctx);
      if (record) {
        const userId = await access.requireUser();
        const raw = (args as Record<string, unknown>)[record.name];
        if (typeof raw !== "string") throw new Error("Not found");
        const project = await ctx.runQuery(
          internal.guards.recordProjectForAction,
          { recordId: raw, table: record.table },
        );
        if (!project) throw new Error("Not found");
        const resolution = await ctx.runQuery(
          internal.guards.capabilityStateForAction,
          { projectId: project._id, userId, capability },
        );
        assertIncluded(resolution);
      }
      return def.handler(ctx, args, withActionCapability(ctx, access, capability));
    },
  } as never);
  return registered as unknown as RegisteredAction<
    "public",
    ObjectType<Args>,
    Promise<R>
  >;
}

/** Module metadata for a resolved capability (used by the entitlements query
 *  and the audit report). */
export function moduleLabel(module: ModuleId): string {
  return MODULE_BY_ID[module].label;
}

export { planIncludesModule };
