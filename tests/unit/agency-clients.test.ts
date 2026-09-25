import { describe, expect, it } from "vitest";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { projectCapability } from "@/convex/guards";
import { newBackend, seedUser, type TestBackend } from "./helpers";
import { buildFunctionRegistry } from "./function-registry";

/**
 * U9 — agency path, first slice: "I do marketing for clients" creates the
 * agency, the client and the link in one call, and `/app` lists the clients.
 */

async function orgsOwnedBy(t: TestBackend, userId: string) {
  return await t.run((ctx) =>
    ctx.db
      .query("organizations")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId as Id<"users">))
      .collect(),
  );
}

describe("projects.createClientProject", () => {
  it("creates one agency on first use and reuses it; one client org and active link per client", async () => {
    const t = newBackend();
    const ada = await seedUser(t, { plan: "starter", name: "Ada" });

    const first = await ada.as.mutation(api.projects.createClientProject, {
      clientName: "  Northside   Coffee ",
      businessType: "walk_in",
      primaryGoal: "visits",
    });
    const second = await ada.as.mutation(api.projects.createClientProject, {
      clientName: "Physio Plus",
    });

    const orgs = await orgsOwnedBy(t, ada.userId);
    const agencies = orgs.filter((o) => o.kind === "agency");
    const clients = orgs.filter((o) => o.kind === "business");
    expect(agencies).toHaveLength(1);
    expect(agencies[0].name).toBe("Ada's agency");
    expect(clients.map((c) => c.name).sort()).toEqual(["Northside Coffee", "Physio Plus"]);

    const links = await t.run((ctx) =>
      ctx.db
        .query("agencyClientLinks")
        .withIndex("by_agency", (q) => q.eq("agencyId", agencies[0]._id))
        .collect(),
    );
    expect(links).toHaveLength(2);
    expect(links.every((l) => l.status === "active" && l.createdBy === ada.userId)).toBe(true);
    expect(new Set(links.map((l) => l.clientId))).toEqual(new Set(clients.map((c) => c._id)));

    const [p1, p2] = await t.run(async (ctx) => [await ctx.db.get(first), await ctx.db.get(second)]);
    const northside = clients.find((c) => c.name === "Northside Coffee")!;
    expect(p1?.organizationId).toBe(northside._id);
    expect(p1?.name).toBe("Northside Coffee");
    expect(p1?.businessType).toBe("walk_in");
    expect(p1?.primaryGoal).toBe("visits");
    expect(p2?.organizationId).toBe(clients.find((c) => c.name === "Physio Plus")!._id);

    // The caller owns both organizations.
    const memberships = await t.run((ctx) =>
      ctx.db
        .query("memberships")
        .withIndex("by_user", (q) => q.eq("userId", ada.userId as Id<"users">))
        .collect(),
    );
    for (const org of [agencies[0], ...clients]) {
      const m = memberships.find((row) => row.organizationId === org._id);
      expect(m?.role).toBe("owner");
      expect(m?.status).toBe("active");
    }
  });

  it("refuses a signed-out caller, an empty client name and an agency as the client type", async () => {
    const t = newBackend();
    await expect(t.mutation(api.projects.createClientProject, { clientName: "X" })).rejects.toThrow();
    const ada = await seedUser(t);
    await expect(
      ada.as.mutation(api.projects.createClientProject, { clientName: "   " }),
    ).rejects.toThrow("Give your client a name.");
    await expect(
      ada.as.mutation(api.projects.createClientProject, {
        clientName: "Other agency",
        businessType: "agency" as never,
      }),
    ).rejects.toThrow();
    expect(await orgsOwnedBy(t, ada.userId)).toEqual([]);
  });

  it("gives a client project the agency user's plan", async () => {
    const t = newBackend();
    const ada = await seedUser(t, { plan: "starter" });
    const projectId = await ada.as.mutation(api.projects.createClientProject, { clientName: "Shop A" });
    const resolution = await t.run(async (ctx) => {
      const project = await ctx.db.get(projectId);
      return await projectCapability(ctx, project!, ada.userId as Id<"users">, "build.edit");
    });
    expect(resolution?.plan).toBe("starter");
    expect(resolution?.state).toBe("included");

    // The same path for a free user: the client project follows that plan.
    const free = await seedUser(t, { plan: "free" });
    const freeProject = await free.as.mutation(api.projects.createClientProject, { clientName: "Shop B" });
    const locked = await t.run(async (ctx) => {
      const project = await ctx.db.get(freeProject);
      return await projectCapability(ctx, project!, free.userId as Id<"users">, "build.edit");
    });
    expect(locked?.plan).toBe("free");
    expect(locked?.state).toBe("locked");
  });
});

describe("projects.agencyClientProjects", () => {
  it("lists every client of an agency with three clients, newest first", async () => {
    const t = newBackend();
    const ada = await seedUser(t, { plan: "starter" });
    for (const clientName of ["One", "Two", "Three"]) {
      await ada.as.mutation(api.projects.createClientProject, { clientName });
    }
    // Ada's own (non-client) project is not a client.
    await ada.as.mutation(api.projects.create, { name: "Ada's own" });

    const entries = await ada.as.query(api.projects.agencyClientProjects, {});
    expect(entries).toHaveLength(3);
    expect(entries.map((e) => e.clientName).sort()).toEqual(["One", "Three", "Two"]);
    for (let i = 1; i < entries.length; i += 1) {
      expect(entries[i - 1].updatedAt).toBeGreaterThanOrEqual(entries[i].updatedAt);
    }
  });

  it("returns [] for a user with no agency and never shows another user's clients", async () => {
    const t = newBackend();
    const ada = await seedUser(t, { email: "ada@example.com" });
    const bob = await seedUser(t, { email: "bob@example.com" });
    await ada.as.mutation(api.projects.createClientProject, { clientName: "Ada client" });
    await bob.as.mutation(api.projects.create, { name: "Bob's shop" });

    expect(await bob.as.query(api.projects.agencyClientProjects, {})).toEqual([]);
    expect(await t.query(api.projects.agencyClientProjects, {})).toEqual([]);

    // Bob gets an agency of his own: still only his clients.
    await bob.as.mutation(api.projects.createClientProject, { clientName: "Bob client" });
    const bobs = await bob.as.query(api.projects.agencyClientProjects, {});
    expect(bobs.map((e) => e.clientName)).toEqual(["Bob client"]);
  });

  it("drops a client once the caller is no longer an active member of it", async () => {
    const t = newBackend();
    const ada = await seedUser(t);
    await ada.as.mutation(api.projects.createClientProject, { clientName: "Kept" });
    await ada.as.mutation(api.projects.createClientProject, { clientName: "Suspended" });
    await t.run(async (ctx) => {
      const org = (await ctx.db.query("organizations").collect()).find((o) => o.name === "Suspended")!;
      const m = await ctx.db
        .query("memberships")
        .withIndex("by_organization", (q) => q.eq("organizationId", org._id))
        .first();
      await ctx.db.patch(m!._id, { status: "suspended" });
    });
    const entries = await ada.as.query(api.projects.agencyClientProjects, {});
    expect(entries.map((e) => e.clientName)).toEqual(["Kept"]);
  });
});

describe("cross-tenant coverage", () => {
  it("lists the new functions in the registry as not record-scoped (no id argument)", () => {
    const registry = buildFunctionRegistry();
    for (const name of ["projects:createClientProject", "projects:agencyClientProjects"]) {
      const entry = registry.find((e) => e.name === name);
      expect(entry, name).toBeDefined();
      // No record id is taken, so there is no foreign record to cross; the
      // tests above prove a second user sees none of the first user's clients.
      expect(entry?.tenantScoped).toBe(false);
    }
  });
});
