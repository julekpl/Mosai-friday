import { describe, expect, it } from "vitest";
import { api, internal } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import schema from "@/convex/schema";
import { DATA_REGISTRY } from "@/convex/lib/dataRegistry";
import { newBackend, seedProject, seedUser, type TestBackend } from "./helpers";

/**
 * T2.1 — organizations, memberships, roles and invitations.
 *
 * These are the two acceptance criteria the ticket names, plus the supporting
 * lifecycle:
 *
 *  - "existing projects appear under a personal organization" — a pre-T2.1
 *    project (ownerId set, no organizationId) is moved into its owner's
 *    personal organization by the idempotent migration.
 *  - "roles are enforced" — an owner/admin/member matrix where a member can
 *    do nothing administrative, an admin cannot grant ownership, and the last
 *    owner can never be removed or demoted.
 *
 * The tests drive the real functions through `convex-test`; they never fake an
 * identity — each user is a real `users` row with an identity-scoped backend.
 */

async function orgWithMembers(t: TestBackend) {
  const owner = await seedUser(t, { name: "Owner", email: "owner@example.com" });
  const admin = await seedUser(t, { name: "Admin", email: "admin@example.com" });
  const member = await seedUser(t, { name: "Member", email: "member@example.com" });
  const outsider = await seedUser(t, { name: "Outsider", email: "outsider@example.com" });

  const organizationId = await owner.as.mutation(api.organizations.create, {
    name: "Acme Inc",
    kind: "business",
  });

  const adminInvite = await owner.as.mutation(api.organizations.invite, {
    organizationId,
    email: "admin@example.com",
    role: "admin",
  });
  await admin.as.mutation(api.organizations.acceptInvitation, {
    token: adminInvite.token,
  });

  const memberInvite = await owner.as.mutation(api.organizations.invite, {
    organizationId,
    email: "member@example.com",
    role: "member",
  });
  await member.as.mutation(api.organizations.acceptInvitation, {
    token: memberInvite.token,
  });

  return { owner, admin, member, outsider, organizationId };
}

describe("T2.1 — existing projects appear under a personal organization", () => {
  it("moves every pre-organization project into its owner's personal organization, idempotently", async () => {
    const t = newBackend();
    const alice = await seedUser(t, { name: "Alice", email: "alice@example.com" });
    const bob = await seedUser(t, { name: "Bob", email: "bob@example.com" });

    // Pre-T2.1 state: a project with an owner but no organization.
    const aliceProjectId = await seedProject(t, alice.userId, "Alice site");
    const bobProjectId = await seedProject(t, bob.userId, "Bob site");
    expect(await t.run((ctx) => ctx.db.query("organizations").collect())).toEqual([]);

    const first = await t.mutation(
      internal.organizations.migrateProjectsToPersonalOrganizations,
      {},
    );
    expect(first.organizationsCreated).toBe(2);
    expect(first.projectsAssigned).toBe(2);

    const aliceOrg = await t.run((ctx) =>
      ctx.db
        .query("organizations")
        .withIndex("by_personal_for", (q) =>
          q.eq("personalFor", alice.userId as Id<"users">),
        )
        .unique(),
    );
    expect(aliceOrg?.kind).toBe("personal");
    expect(aliceOrg?.personalFor).toBe(alice.userId);

    const aliceProject = await t.run((ctx) =>
      ctx.db.get(aliceProjectId as Id<"projects">),
    );
    const bobProject = await t.run((ctx) =>
      ctx.db.get(bobProjectId as Id<"projects">),
    );
    expect(aliceProject?.organizationId).toBe(aliceOrg?._id);
    expect(bobProject?.organizationId).not.toBe(aliceOrg?._id);
    expect(bobProject?.organizationId).toBeDefined();

    // The owner is an active owner member of their own personal organization.
    const memberships = await t.run((ctx) =>
      ctx.db
        .query("memberships")
        .withIndex("by_organization", (q) =>
          q.eq("organizationId", aliceOrg!._id),
        )
        .collect(),
    );
    expect(memberships).toHaveLength(1);
    expect(memberships[0]).toMatchObject({
      userId: alice.userId,
      role: "owner",
      status: "active",
    });

    // Idempotent: a second run creates nothing and reassigns nothing.
    const second = await t.mutation(
      internal.organizations.migrateProjectsToPersonalOrganizations,
      {},
    );
    expect(second.organizationsCreated).toBe(0);
    expect(second.projectsAssigned).toBe(0);
    expect(
      await t.run((ctx) => ctx.db.query("organizations").collect()),
    ).toHaveLength(2);
  });

  it("creates a new project under the owner's personal organization", async () => {
    const t = newBackend();
    const alice = await seedUser(t, { name: "Alice", email: "alice@example.com" });

    const projectId = await alice.as.mutation(api.projects.create, {
      name: "New project",
    });
    const project = await t.run((ctx) => ctx.db.get(projectId));
    expect(project?.organizationId).toBeDefined();

    const org = await t.run((ctx) => ctx.db.get(project!.organizationId!));
    expect(org?.kind).toBe("personal");
    expect(org?.personalFor).toBe(alice.userId);
  });

  it("ensurePersonal is idempotent and returns the same organization", async () => {
    const t = newBackend();
    const alice = await seedUser(t, { name: "Alice", email: "alice@example.com" });

    const first = await alice.as.mutation(api.organizations.ensurePersonal, {});
    const second = await alice.as.mutation(api.organizations.ensurePersonal, {});
    expect(first).toBe(second);

    const orgs = await t.run((ctx) => ctx.db.query("organizations").collect());
    expect(orgs).toHaveLength(1);
    const mine = await alice.as.query(api.organizations.listMine, {});
    expect(mine).toHaveLength(1);
    expect(mine[0].role).toBe("owner");
  });
});

describe("T2.1 — roles are enforced", () => {
  it("seeds the role registry from the canonical definitions", async () => {
    const t = newBackend();
    const { owner } = await orgWithMembers(t);
    await owner.as.query(api.organizations.listMine, {});

    const roles = await t.run((ctx) => ctx.db.query("roles").collect());
    expect(roles.map((r) => r.key).sort()).toEqual(["admin", "member", "owner"]);
    const ownerRole = roles.find((r) => r.key === "owner");
    const memberRole = roles.find((r) => r.key === "member");
    expect(ownerRole!.rank).toBeGreaterThan(memberRole!.rank);
    expect(memberRole!.capabilities).toEqual([]);
  });

  it("a member cannot invite, remove or change roles, and cannot read a foreign org", async () => {
    const t = newBackend();
    const { member, outsider, organizationId } = await orgWithMembers(t);

    await expect(
      member.as.mutation(api.organizations.invite, {
        organizationId,
        email: "new@example.com",
        role: "member",
      }),
    ).rejects.toThrow(/does not allow/i);

    await expect(
      member.as.mutation(api.organizations.updateMemberRole, {
        organizationId,
        userId: outsider.userId as Id<"users">,
        role: "admin",
      }),
    ).rejects.toThrow(/does not allow/i);

    await expect(
      member.as.mutation(api.organizations.removeMember, {
        organizationId,
        userId: outsider.userId as Id<"users">,
      }),
    ).rejects.toThrow(/does not allow/i);

    // A non-member cannot even confirm the organization exists.
    await expect(
      outsider.as.query(api.organizations.get, { organizationId }),
    ).rejects.toThrow(/Not found/);
  });

  it("an admin can invite members but cannot grant ownership or remove an owner", async () => {
    const t = newBackend();
    const { admin, owner, organizationId } = await orgWithMembers(t);

    await expect(
      admin.as.mutation(api.organizations.invite, {
        organizationId,
        email: "new@example.com",
        role: "member",
      }),
    ).resolves.toBeDefined();

    await expect(
      admin.as.mutation(api.organizations.invite, {
        organizationId,
        email: "would-be-owner@example.com",
        role: "owner",
      }),
    ).rejects.toThrow(/Only an owner can invite another owner/i);

    await expect(
      admin.as.mutation(api.organizations.removeMember, {
        organizationId,
        userId: owner.userId as Id<"users">,
      }),
    ).rejects.toThrow(/Only an owner can remove an owner/i);
  });

  it("an owner can promote a member, and the last owner cannot be demoted or removed", async () => {
    const t = newBackend();
    const { owner, member, organizationId } = await orgWithMembers(t);

    await owner.as.mutation(api.organizations.updateMemberRole, {
      organizationId,
      userId: member.userId as Id<"users">,
      role: "admin",
    });
    const members = await owner.as.query(api.organizations.members, {
      organizationId,
    });
    expect(members.find((m) => m.userId === member.userId)?.role).toBe("admin");

    // Demoting the only owner is refused (last-owner protection).
    await expect(
      owner.as.mutation(api.organizations.updateMemberRole, {
        organizationId,
        userId: owner.userId as Id<"users">,
        role: "member",
      }),
    ).rejects.toThrow(/at least one owner/i);

    // The sole owner cannot remove themselves; they must leave (also refused).
    await expect(
      owner.as.mutation(api.organizations.removeMember, {
        organizationId,
        userId: owner.userId as Id<"users">,
      }),
    ).rejects.toThrow(/leave/i);
    await expect(
      owner.as.mutation(api.organizations.leave, { organizationId }),
    ).rejects.toThrow(/at least one owner/i);

    // A non-owner can leave, and the membership is gone afterwards.
    await member.as.mutation(api.organizations.leave, { organizationId });
    const after = await owner.as.query(api.organizations.members, {
      organizationId,
    });
    expect(after.find((m) => m.userId === member.userId)).toBeUndefined();
  });

  it("links and revokes agency client organizations, and rejects a non-agency or a non-client caller", async () => {
    const t = newBackend();
    const agencyOwner = await seedUser(t, {
      name: "Agency",
      email: "agency@example.com",
    });
    const agencyAdmin = await seedUser(t, {
      name: "Admin",
      email: "agency-admin@example.com",
    });

    const agencyId = await agencyOwner.as.mutation(api.organizations.create, {
      name: "Studio",
      kind: "agency",
    });
    const clientId = await agencyOwner.as.mutation(api.organizations.create, {
      name: "Client Co",
      kind: "business",
    });

    const linkId = await agencyOwner.as.mutation(
      api.organizations.linkAgencyClient,
      { agencyId, clientId },
    );
    const clients = await agencyOwner.as.query(api.organizations.agencyClients, {
      agencyId,
    });
    expect(clients).toHaveLength(1);
    expect(clients[0].client.name).toBe("Client Co");

    // A business organization can never act as an agency.
    await expect(
      agencyOwner.as.mutation(api.organizations.linkAgencyClient, {
        agencyId: clientId,
        clientId,
      }),
    ).rejects.toThrow(/agency/i);

    // An agency admin who does not administer the client cannot link it.
    const invite = await agencyOwner.as.mutation(api.organizations.invite, {
      organizationId: agencyId,
      email: "agency-admin@example.com",
      role: "admin",
    });
    await agencyAdmin.as.mutation(api.organizations.acceptInvitation, {
      token: invite.token,
    });
    await expect(
      agencyAdmin.as.mutation(api.organizations.linkAgencyClient, {
        agencyId,
        clientId,
      }),
    ).rejects.toThrow(/client organization/i);

    // Revoking keeps the row (audit trail) but removes it from the active list.
    await agencyOwner.as.mutation(api.organizations.unlinkAgencyClient, {
      linkId,
    });
    const active = await agencyOwner.as.query(api.organizations.agencyClients, {
      agencyId,
    });
    expect(active).toEqual([]);
    const all = await t.run((ctx) =>
      ctx.db.query("agencyClientLinks").collect(),
    );
    expect(all).toHaveLength(1);
    expect(all[0].status).toBe("revoked");
  });
});

describe("T2.1 — the new tables are registered", () => {
  it("registers every organization table with a tenancy field and lifecycle policy", () => {
    const tables = (
      schema as unknown as { tables: Record<string, unknown> }
    ).tables;
    for (const name of [
      "organizations",
      "memberships",
      "invitations",
      "roles",
      "agencyClientLinks",
    ]) {
      expect(DATA_REGISTRY[name], `${name} is missing from DATA_REGISTRY`).toBeDefined();
      expect(tables[name], `${name} is missing from schema.ts`).toBeDefined();
      expect(DATA_REGISTRY[name].tenantField.length).toBeGreaterThan(0);
      expect(DATA_REGISTRY[name].authorization.length).toBeGreaterThan(0);
    }
    expect(DATA_REGISTRY.organizations.scope).toBe("organization");
    expect(DATA_REGISTRY.roles.scope).toBe("global");
  });
});
