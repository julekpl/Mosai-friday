/**
 * Organizations, memberships, roles and invitations (MOSAI pack T2.1).
 *
 * Tenancy moves from "project.ownerId === user" to "user is an active member of
 * the organization that owns the project". This module is the single place that
 * writes those records:
 *
 *  - `getOrCreatePersonalOrganization` — one personal workspace per user, the
 *    default home for every project. Idempotent.
 *  - `migrateProjectsToPersonalOrganizations` — the internal, idempotent
 *    migration that puts every pre-T2.1 project under its owner's personal
 *    organization and seeds the role registry.
 *  - invitation / membership / agency-link mutations, every one of which is
 *    guarded by a role capability (`guards.requireOrgRole`).
 *  - last-owner protection: an organization can never be left without an owner.
 *
 * T2.2 (org-scoped function builders and the cross-tenant generator) is
 * deliberately NOT started here: `guards.requireProject` remains owner-based,
 * so this ticket only adds organizations on top of the existing tenancy.
 */

import { internalMutation, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  membershipFor,
  requireOrganization,
  requireOrgRole,
  requireUser,
} from "./guards";
import {
  ORG_ROLES,
  ROLE_CAPABILITIES,
  ROLE_RANK,
  orgRoleValidator,
  roleCan,
  type OrgRole,
} from "./lib/roles";

const INVITATION_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Server-generated, single-use invitation token. Never taken from input. */
function randomToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

/** Idempotently seed/refresh the role registry from lib/roles.ts. */
export async function seedRoles(ctx: MutationCtx) {
  const now = Date.now();
  for (const role of ORG_ROLES) {
    const capabilities = [...ROLE_CAPABILITIES[role]];
    const existing = await ctx.db
      .query("roles")
      .withIndex("by_key", (q) => q.eq("key", role))
      .unique();
    if (!existing) {
      await ctx.db.insert("roles", {
        key: role,
        name: role,
        rank: ROLE_RANK[role],
        capabilities,
        createdAt: now,
        updatedAt: now,
      });
      continue;
    }
    const drifted =
      existing.rank !== ROLE_RANK[role] ||
      existing.capabilities.join(",") !== capabilities.join(",");
    if (drifted) {
      await ctx.db.patch(existing._id, { rank: ROLE_RANK[role], capabilities, updatedAt: now });
    }
  }
}

async function ensureMembership(
  ctx: MutationCtx,
  organizationId: Id<"organizations">,
  userId: Id<"users">,
  role: OrgRole,
  status: "active" | "invited" | "suspended",
  invitedBy?: Id<"users">,
): Promise<Id<"memberships">> {
  const existing = await membershipFor(ctx, organizationId, userId);
  const now = Date.now();
  if (!existing) {
    return await ctx.db.insert("memberships", {
      organizationId,
      userId,
      role,
      status,
      invitedBy,
      createdAt: now,
      updatedAt: now,
    });
  }
  // Never silently downgrade: only an explicit ownership promotion is applied.
  if (role === "owner" && existing.role !== "owner") {
    await ctx.db.patch(existing._id, { role, status, updatedAt: now });
  } else if (existing.status !== status) {
    await ctx.db.patch(existing._id, { status, updatedAt: now });
  }
  return existing._id;
}

/** The one personal organization per user, created on first use. Idempotent:
 *  resolves through the `by_personal_for` index, so running it twice (or after
 *  a partial migration) never creates a second workspace. */
export async function getOrCreatePersonalOrganization(
  ctx: MutationCtx,
  userId: Id<"users">,
): Promise<Id<"organizations">> {
  const existing = await ctx.db
    .query("organizations")
    .withIndex("by_personal_for", (q) => q.eq("personalFor", userId))
    .first();
  if (existing) {
    await ensureMembership(ctx, existing._id, userId, "owner", "active");
    return existing._id;
  }
  const user = await ctx.db.get(userId);
  const now = Date.now();
  const organizationId = await ctx.db.insert("organizations", {
    name: user?.name ? `${user.name}'s workspace` : "Personal workspace",
    kind: "personal",
    ownerId: userId,
    personalFor: userId,
    createdAt: now,
    updatedAt: now,
  });
  await ensureMembership(ctx, organizationId, userId, "owner", "active");
  return organizationId;
}

async function activeMembers(
  ctx: QueryCtx | MutationCtx,
  organizationId: Id<"organizations">,
) {
  return await ctx.db
    .query("memberships")
    .withIndex("by_organization", (q) =>
      q.eq("organizationId", organizationId),
    )
    .collect();
}

/** Last-owner protection: refuse to remove or demote the only remaining owner. */
async function assertNotLastOwner(
  ctx: QueryCtx | MutationCtx,
  organizationId: Id<"organizations">,
  target: Doc<"memberships">,
) {
  if (target.role !== "owner") return;
  const owners = (await activeMembers(ctx, organizationId)).filter(
    (member) => member.status === "active" && member.role === "owner",
  );
  if (owners.length <= 1) {
    throw new Error("An organization must keep at least one owner.");
  }
}

/* ── Organizations ─────────────────────────────────────────────────────── */

export const create = mutation({
  args: {
    name: v.string(),
    kind: v.union(v.literal("business"), v.literal("agency")),
  },
  handler: async (ctx, { name, kind }) => {
    const userId = await requireUser(ctx);
    await seedRoles(ctx);
    const now = Date.now();
    const organizationId = await ctx.db.insert("organizations", {
      name: name.trim() || "Untitled organization",
      kind,
      ownerId: userId,
      createdAt: now,
      updatedAt: now,
    });
    await ensureMembership(ctx, organizationId, userId, "owner", "active");
    return organizationId;
  },
});

export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const active = memberships.filter((m) => m.status === "active");
    const resolved = await Promise.all(
      active.map(async (membership) => {
        const organization = await ctx.db.get(membership.organizationId);
        return organization ? { organization, role: membership.role } : null;
      }),
    );
    return resolved.filter(
      (entry): entry is NonNullable<typeof entry> => entry !== null,
    );
  },
});

export const get = query({
  args: { organizationId: v.id("organizations") },
  handler: async (ctx, { organizationId }) => {
    const { organization, membership } = await requireOrganization(
      ctx,
      organizationId,
    );
    return { organization, role: membership.role };
  },
});

/** The caller's personal organization, or null before the migration has run. */
export const personal = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    return await ctx.db
      .query("organizations")
      .withIndex("by_personal_for", (q) => q.eq("personalFor", userId))
      .first();
  },
});

/** Self-service idempotent personal-org creation (used by the client and by
 *  tests). Safe to call repeatedly. */
export const ensurePersonal = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    await seedRoles(ctx);
    return await getOrCreatePersonalOrganization(ctx, userId);
  },
});

export const members = query({
  args: { organizationId: v.id("organizations") },
  handler: async (ctx, { organizationId }) => {
    await requireOrganization(ctx, organizationId);
    const rows = await activeMembers(ctx, organizationId);
    return await Promise.all(
      rows.map(async (membership) => {
        const user = await ctx.db.get(membership.userId);
        return {
          membershipId: membership._id,
          userId: membership.userId,
          role: membership.role,
          status: membership.status,
          name: user?.name,
          email: user?.email,
        };
      }),
    );
  },
});

/* ── Invitations ───────────────────────────────────────────────────────── */

export const invite = mutation({
  args: {
    organizationId: v.id("organizations"),
    email: v.string(),
    role: orgRoleValidator,
  },
  handler: async (ctx, { organizationId, email, role }) => {
    const { userId, membership } = await requireOrgRole(
      ctx,
      organizationId,
      "member.invite",
    );
    if (role === "owner" && membership.role !== "owner") {
      throw new Error("Only an owner can invite another owner.");
    }
    const normalized = normalizeEmail(email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      throw new Error("Enter a valid email address.");
    }

    // Already a member? Nothing to invite.
    const existingUser = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", normalized))
      .first();
    if (existingUser) {
      const existingMembership = await membershipFor(
        ctx,
        organizationId,
        existingUser._id,
      );
      if (existingMembership && existingMembership.status === "active") {
        throw new Error("That person is already a member.");
      }
    }

    // Idempotent: reuse the pending invitation for this email + organization.
    const existingPending = await ctx.db
      .query("invitations")
      .withIndex("by_organization", (q) =>
        q.eq("organizationId", organizationId),
      )
      .collect()
      .then((rows) =>
        rows.find((row) => row.email === normalized && row.status === "pending"),
      );
    if (existingPending) {
      if (existingPending.role !== role) {
        await ctx.db.patch(existingPending._id, { role });
      }
      return {
        invitationId: existingPending._id,
        token: existingPending.token,
        email: normalized,
        role,
      };
    }

    const now = Date.now();
    const invitationId = await ctx.db.insert("invitations", {
      organizationId,
      email: normalized,
      role,
      token: randomToken(),
      status: "pending",
      invitedBy: userId,
      createdAt: now,
      expiresAt: now + INVITATION_TTL_MS,
    });
    const invitation = await ctx.db.get(invitationId);
    return {
      invitationId,
      token: invitation?.token ?? "",
      email: normalized,
      role,
    };
  },
});

export const invitations = query({
  args: { organizationId: v.id("organizations") },
  handler: async (ctx, { organizationId }) => {
    await requireOrganization(ctx, organizationId);
    const rows = await ctx.db
      .query("invitations")
      .withIndex("by_organization", (q) =>
        q.eq("organizationId", organizationId),
      )
      .collect();
    return rows.sort((a, b) => b.createdAt - a.createdAt);
  },
});

export const acceptInvitation = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const userId = await requireUser(ctx);
    const invitation = await ctx.db
      .query("invitations")
      .withIndex("by_token", (q) => q.eq("token", token))
      .unique();
    if (!invitation) throw new Error("Invitation not found");
    if (invitation.status !== "pending") {
      throw new Error("This invitation is no longer valid.");
    }
    if (invitation.expiresAt < Date.now()) {
      await ctx.db.patch(invitation._id, { status: "expired" });
      throw new Error("This invitation has expired.");
    }
    const user = await ctx.db.get(userId);
    const email = normalizeEmail(user?.email ?? "");
    if (!email || email !== invitation.email) {
      throw new Error("This invitation was sent to a different email address.");
    }
    await ensureMembership(
      ctx,
      invitation.organizationId,
      userId,
      invitation.role,
      "active",
      invitation.invitedBy,
    );
    await ctx.db.patch(invitation._id, {
      status: "accepted",
      acceptedAt: Date.now(),
      acceptedBy: userId,
    });
    return invitation.organizationId;
  },
});

export const revokeInvitation = mutation({
  args: { invitationId: v.id("invitations") },
  handler: async (ctx, { invitationId }) => {
    const invitation = await ctx.db.get(invitationId);
    if (!invitation) throw new Error("Not found");
    await requireOrgRole(ctx, invitation.organizationId, "member.invite");
    if (invitation.status === "accepted") {
      throw new Error("An accepted invitation cannot be revoked.");
    }
    await ctx.db.patch(invitationId, { status: "revoked" });
  },
});

/* ── Membership + role administration ──────────────────────────────────── */

export const updateMemberRole = mutation({
  args: {
    organizationId: v.id("organizations"),
    userId: v.id("users"),
    role: orgRoleValidator,
  },
  handler: async (ctx, { organizationId, userId, role }) => {
    const { membership: actor } = await requireOrgRole(
      ctx,
      organizationId,
      "member.update_role",
    );
    const target = await membershipFor(ctx, organizationId, userId);
    if (!target || target.status !== "active") throw new Error("Not found");
    if (target.role === role) return;
    if (role === "owner" && actor.role !== "owner") {
      throw new Error("Only an owner can grant the owner role.");
    }
    if (
      actor.role !== "owner" &&
      ROLE_RANK[role] >= ROLE_RANK[actor.role]
    ) {
      throw new Error("You cannot grant a role equal to or above your own.");
    }
    if (role !== "owner") {
      await assertNotLastOwner(ctx, organizationId, target);
    }
    await ctx.db.patch(target._id, { role, updatedAt: Date.now() });
  },
});

export const removeMember = mutation({
  args: {
    organizationId: v.id("organizations"),
    userId: v.id("users"),
  },
  handler: async (ctx, { organizationId, userId }) => {
    const { membership: actor } = await requireOrgRole(
      ctx,
      organizationId,
      "member.remove",
    );
    const target = await membershipFor(ctx, organizationId, userId);
    if (!target || target.status !== "active") throw new Error("Not found");
    if (target._id === actor._id) {
      throw new Error("Use leave to remove yourself from the organization.");
    }
    if (target.role === "owner" && actor.role !== "owner") {
      throw new Error("Only an owner can remove an owner.");
    }
    await assertNotLastOwner(ctx, organizationId, target);
    await ctx.db.delete(target._id);
  },
});

export const leave = mutation({
  args: { organizationId: v.id("organizations") },
  handler: async (ctx, { organizationId }) => {
    const { userId, organization, membership } = await requireOrganization(
      ctx,
      organizationId,
    );
    if (organization.personalFor === userId) {
      throw new Error("You cannot leave your personal organization.");
    }
    await assertNotLastOwner(ctx, organizationId, membership);
    await ctx.db.delete(membership._id);
  },
});

/* ── Agency client links ───────────────────────────────────────────────── */

export const linkAgencyClient = mutation({
  args: {
    agencyId: v.id("organizations"),
    clientId: v.id("organizations"),
  },
  handler: async (ctx, { agencyId, clientId }) => {
    const { userId, organization: agency } = await requireOrgRole(
      ctx,
      agencyId,
      "agency.link",
    );
    if (agency.kind !== "agency") {
      throw new Error("Only an agency organization can link client organizations.");
    }
    const client = await ctx.db.get(clientId);
    if (!client || client.kind === "agency" || clientId === agencyId) {
      throw new Error("Not found");
    }
    // Safe interpretation until the E3.9 client-consent handshake exists: the
    // caller must also administer the client organization, so an agency cannot
    // silently attach an arbitrary tenant.
    const clientMembership = await membershipFor(ctx, clientId, userId);
    if (!clientMembership || !roleCan(clientMembership.role, "agency.link")) {
      throw new Error(
        "You must be an owner or admin of the client organization to link it.",
      );
    }
    const existing = await ctx.db
      .query("agencyClientLinks")
      .withIndex("by_agency_client", (q) =>
        q.eq("agencyId", agencyId).eq("clientId", clientId),
      )
      .unique();
    if (existing) {
      if (existing.status !== "active") {
        await ctx.db.patch(existing._id, {
          status: "active",
          revokedAt: undefined,
        });
      }
      return existing._id;
    }
    return await ctx.db.insert("agencyClientLinks", {
      agencyId,
      clientId,
      status: "active",
      createdBy: userId,
      createdAt: Date.now(),
    });
  },
});

export const unlinkAgencyClient = mutation({
  args: { linkId: v.id("agencyClientLinks") },
  handler: async (ctx, { linkId }) => {
    const link = await ctx.db.get(linkId);
    if (!link) throw new Error("Not found");
    await requireOrgRole(ctx, link.agencyId, "agency.unlink");
    await ctx.db.patch(linkId, { status: "revoked", revokedAt: Date.now() });
  },
});

export const agencyClients = query({
  args: { agencyId: v.id("organizations") },
  handler: async (ctx, { agencyId }) => {
    await requireOrganization(ctx, agencyId);
    const links = await ctx.db
      .query("agencyClientLinks")
      .withIndex("by_agency", (q) => q.eq("agencyId", agencyId))
      .collect();
    const active = links.filter((link) => link.status === "active");
    const resolved = await Promise.all(
      active.map(async (link) => {
        const client = await ctx.db.get(link.clientId);
        return client ? { link, client } : null;
      }),
    );
    return resolved.filter(
      (entry): entry is NonNullable<typeof entry> => entry !== null,
    );
  },
});

/* ── Idempotent migration ──────────────────────────────────────────────── */

/**
 * Put every pre-organization project under its owner's personal organization
 * and seed the role registry.
 *
 * Idempotent by construction: personal organizations are resolved through the
 * `by_personal_for` index (one per user), and a project is only patched while
 * `organizationId` is unset. Running it twice changes nothing and reports zero.
 * Run it once per deployment; it is an `internalMutation` so only server code
 * (a migration job or the Convex dashboard) can invoke it.
 */
export const migrateProjectsToPersonalOrganizations = internalMutation({
  args: {},
  handler: async (ctx) => {
    await seedRoles(ctx);
    const users = await ctx.db.query("users").collect();
    let organizationsCreated = 0;
    let projectsAssigned = 0;

    for (const user of users) {
      const existingOrganization = await ctx.db
        .query("organizations")
        .withIndex("by_personal_for", (q) => q.eq("personalFor", user._id))
        .first();
      const organizationId = await getOrCreatePersonalOrganization(ctx, user._id);
      if (!existingOrganization) organizationsCreated += 1;

      const projects = await ctx.db
        .query("projects")
        .withIndex("by_owner", (q) => q.eq("ownerId", user._id))
        .collect();
      for (const project of projects) {
        if (project.organizationId === undefined) {
          await ctx.db.patch(project._id, { organizationId });
          projectsAssigned += 1;
        }
      }
    }

    return { users: users.length, organizationsCreated, projectsAssigned };
  },
});
