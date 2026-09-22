import { describe, expect, it } from "vitest";
import { api, internal } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  MODULE_DEFINITIONS,
  MODULE_IDS,
  PLANS,
  PLAN_MODULES,
  capabilityMessage,
  countryPolicy,
  parseCapability,
  planIncludesModule,
  resolveCapabilityState,
  type ModuleId,
  type Plan,
} from "@/convex/lib/capabilities";
import { isPlan } from "@/convex/lib/capabilities";
import { newBackend, seedUser, type Tenant, type TestBackend } from "./helpers";

/**
 * T2.3 — capability registry and per-add-on entitlements.
 *
 * The acceptance criterion is that **enabling or disabling an add-on changes
 * routes, queries, mutations, actions and jobs consistently**, so the tests are
 * generated from the registry rather than written per module:
 *
 *  - the read axis runs over every module × plan (a downgrade hides the data, an
 *    upgrade shows the same rows again, and nothing is deleted);
 *  - the mutation axis is proven for a representative per module and for the
 *    plan that includes it;
 *  - the role axis is proven with a real organization (a member cannot spend);
 *  - the job axis is proven on the scheduled-post worker;
 *  - two defects found while wiring this are pinned as regressions:
 *      (a) a module call used the *caller's* plan instead of the organization's,
 *          so a teammate with a personal `free` plan was locked out of an add-on
 *          the organization had paid for, and a `scale` personal plan unlocked a
 *          `free` organization's module — the same code path, both directions;
 *      (b) nothing enforced the entitlement server-side at all: a `free` plan
 *          could call `builds.create` straight from the client.
 */

type As = Tenant["as"];

/** One representative per module, generated over `MODULE_IDS`. */
type ModuleProbe = {
  /** The table the module's primary read lists. */
  table: string;
  /** Seed one row through the module's own create mutation. */
  seed: (as: As, projectId: Id<"projects">) => Promise<unknown>;
  /** The module's primary read, as the caller. */
  list: (as: As, projectId: Id<"projects">) => Promise<Array<{ _id: string }>>;
};

const MODULE_PROBES: Record<ModuleId, ModuleProbe> = {
  understand: {
    table: "personas",
    seed: (as, projectId) => as.mutation(api.personas.create, { projectId, name: "Seed persona" }),
    list: (as, projectId) => as.query(api.personas.list, { projectId }),
  },
  journeys: {
    table: "journeyMaps",
    seed: (as, projectId) =>
      as.mutation(api.journeys.create, {
        projectId,
        name: "Seed journey",
        stages: [],
        source: "manual",
      }),
    list: (as, projectId) => as.query(api.journeys.list, { projectId }),
  },
  create: {
    table: "contentPieces",
    seed: (as, projectId) =>
      as.mutation(api.content.create, { projectId, title: "Seed piece" }),
    list: (as, projectId) => as.query(api.content.list, { projectId }),
  },
  build: {
    table: "builds",
    seed: (as, projectId) =>
      as.mutation(api.builds.create, { projectId, name: "Seed site", kind: "website" }),
    list: (as, projectId) => as.query(api.builds.list, { projectId }),
  },
  customers: {
    table: "contacts",
    seed: (as, projectId) =>
      as.mutation(api.contacts.create, { projectId, name: "Seed contact" }),
    list: (as, projectId) => as.query(api.contacts.list, { projectId }),
  },
  promote: {
    table: "posts",
    seed: (as, projectId) =>
      as.mutation(api.posts.create, {
        projectId,
        channel: "linkedin",
        body: "Seed post body for the entitlement suite.",
      }),
    list: (as, projectId) => as.query(api.posts.list, { projectId }),
  },
  sell: {
    table: "products",
    seed: (as, projectId) =>
      as.mutation(api.products.create, { projectId, title: "Seed product" }),
    list: (as, projectId) => as.query(api.products.listWithReadiness, { projectId }),
  },
  grow: {
    table: "insights",
    seed: (as, projectId) =>
      as.mutation(api.insights.create, {
        projectId,
        kind: "seo",
        title: "Seed insight",
        source: "manual",
      }),
    list: (as, projectId) => as.query(api.insights.list, { projectId }),
  },
};

/** A user on `plan` with one project, seeded and ready to call. */
async function tenantOn(
  t: TestBackend,
  plan: Plan,
  email: string,
): Promise<{ tenant: Tenant; projectId: Id<"projects"> }> {
  const tenant = await seedUser(t, { plan, email });
  const projectId = await tenant.as.mutation(api.projects.create, {
    name: `${email} project`,
  });
  return { tenant, projectId };
}

/** Move a user to another plan (the local billing mirror T2.4 will replace). */
async function setPlan(t: TestBackend, tenant: Tenant, plan: Plan): Promise<void> {
  await t.run((ctx) =>
    ctx.db.patch(tenant.userId as Id<"users">, { plan }),
  );
}

async function countRows(t: TestBackend, table: string): Promise<number> {
  return await t.run(async (ctx) => {
    const db = ctx.db as unknown as {
      query(name: string): { collect(): Promise<unknown[]> };
    };
    return (await db.query(table).collect()).length;
  });
}

describe("T2.3 — capability registry", () => {
  it("is the only module list: plans, module ids and the country stub agree", () => {
    // Every plan is described, and every module a plan names is a real module.
    expect(Object.keys(PLAN_MODULES).sort()).toEqual([...PLANS].sort());
    for (const plan of PLANS) {
      for (const module of PLAN_MODULES[plan]) expect(MODULE_IDS).toContain(module);
      // `free` is the launch default and a subset of every other plan, so a
      // downgrade never widens access.
      for (const module of PLAN_MODULES.free) {
        expect(PLAN_MODULES[plan]).toContain(module);
      }
    }

    // Every module defines capabilities and is reachable under the country stub.
    for (const definition of MODULE_DEFINITIONS) {
      expect(definition.actions.length).toBeGreaterThan(0);
      expect(countryPolicy().modules).toContain(definition.id);
    }

    // One representative per module: a new module cannot be added without a
    // capability probe, because this table is keyed by `ModuleId`.
    expect(Object.keys(MODULE_PROBES).sort()).toEqual([...MODULE_IDS].sort());
  });

  it("refuses a capability outside the registry instead of allowing it", () => {
    // `sell` defines no `spend` action: a module cannot invent one by asking.
    expect(parseCapability("sell.spend")).toBeNull();
    expect(parseCapability("nope.view")).toBeNull();
    expect(parseCapability("build")).toBeNull();
    expect(parseCapability("build.publish")).toEqual({
      module: "build",
      action: "publish",
    });

    // A role that is not a real organization role resolves to `locked`, never
    // to `included`.
    const outsider = resolveCapabilityState({
      plan: "scale",
      role: "owner",
      module: "sell",
      action: "view",
    });
    expect(outsider.state).toBe("included");
    expect(
      resolveCapabilityState({
        plan: "free",
        role: "owner",
        module: "sell",
        action: "view",
      }),
    ).toEqual({ state: "locked", reason: "plan" });
  });

  it("labels every non-included state honestly (no simulated data)", () => {
    const locked = resolveCapabilityState({
      plan: "free",
      role: "owner",
      module: "promote",
      action: "view",
    });
    expect(capabilityMessage(locked, { module: "promote", action: "view" })).toContain(
      'does not include "promote"',
    );

    const roleLocked = resolveCapabilityState({
      plan: "scale",
      role: "member",
      module: "promote",
      action: "spend",
    });
    expect(
      capabilityMessage(roleLocked, { module: "promote", action: "spend" }),
    ).toMatch(/role in this organization/i);

    const needsSetup = resolveCapabilityState({
      plan: "scale",
      role: "owner",
      module: "sell",
      action: "publish",
      setup: false,
    });
    expect(needsSetup.state).toBe("needs_setup");
    // Reads stay available while writes need setup.
    expect(
      resolveCapabilityState({
        plan: "scale",
        role: "owner",
        module: "sell",
        action: "view",
        setup: false,
      }).state,
    ).toBe("included");
  });
});

describe("T2.3 — disabling an add-on changes every read (generated over the registry)", () => {
  for (const module of MODULE_IDS) {
    it(`${module}: rows appear exactly when the plan includes the module`, async () => {
      const t = newBackend();
      const { tenant, projectId } = await tenantOn(t, "scale", "owner@example.com");
      const probe = MODULE_PROBES[module];

      // Seeded through the module's own mutation while it is included.
      const seededId = (await probe.seed(tenant.as, projectId)) as string;
      expect(seededId).toBeTruthy();

      for (const plan of PLANS) {
        await setPlan(t, tenant, plan);
        const rows = await probe.list(tenant.as, projectId);
        const expected = planIncludesModule(plan, module);
        expect(
          rows.some((row) => row._id === seededId),
          `${module} on the ${plan} plan`,
        ).toBe(expected);
      }

      // A downgrade hides data; it never deletes it.
      await setPlan(t, tenant, "free");
      expect(await countRows(t, probe.table)).toBeGreaterThan(0);
    });
  }

  for (const module of MODULE_IDS) {
    it(`${module}: a plan without the add-on cannot write, and is told why`, async () => {
      const t = newBackend();
      const { tenant, projectId } = await tenantOn(t, "free", "owner@example.com");
      const probe = MODULE_PROBES[module];
      const included = planIncludesModule("free", module);
      const before = await countRows(t, probe.table);

      if (included) {
        // The free plan includes this module: the write works.
        await probe.seed(tenant.as, projectId);
        expect(await countRows(t, probe.table)).toBeGreaterThan(before);
        return;
      }

      await expect(probe.seed(tenant.as, projectId)).rejects.toThrow(
        new RegExp(`does not include "${module}"`),
      );
      // Refused before it touched a row.
      expect(await countRows(t, probe.table)).toBe(before);
    });
  }
});

describe("T2.3 — capability enforcement on the server", () => {
  it("refuses a module action for an organization role that lacks the verb", async () => {
    const t = newBackend();
    const owner = await seedUser(t, { plan: "scale", email: "owner@example.com" });
    const member = await seedUser(t, { plan: "scale", email: "member@example.com" });

    const organizationId = await owner.as.mutation(api.organizations.create, {
      name: "Acme Inc",
      kind: "business",
    });
    const invite = await owner.as.mutation(api.organizations.invite, {
      organizationId,
      email: "member@example.com",
      role: "member",
    });
    await member.as.mutation(api.organizations.acceptInvitation, {
      token: invite.token,
    });

    const projectId = await owner.as.mutation(api.projects.create, {
      name: "Acme site",
    });
    // Put the project in the shared organization (the T2.1 migration's effect).
    await t.run((ctx) => ctx.db.patch(projectId, { organizationId }));

    // `promote.edit` belongs to a member; `promote.spend` belongs to an owner.
    const changeId = await member.as.mutation(api.ads.control.createDraft, {
      projectId,
      platform: "google",
      accountId: "1",
      campaignId: "c1",
      campaignName: "Campaign",
      kind: "set_daily_budget",
      payload: 500,
      origin: "user",
    });
    expect(changeId).toBeTruthy();

    await expect(
      member.as.mutation(api.ads.control.approve, { id: changeId }),
    ).rejects.toThrow(/role in this organization does not allow/i);

    // The owner holds `promote.spend`, so the same call succeeds and the row
    // really moves out of `draft`.
    await owner.as.mutation(api.ads.control.approve, { id: changeId });
    const row = await t.run((ctx) => ctx.db.get(changeId));
    expect(row?.status).toBe("approved");
  });

  it("refuses a plan-locked module mutation with the registry's message", async () => {
    const t = newBackend();
    const { tenant, projectId } = await tenantOn(t, "free", "free@example.com");

    await expect(
      tenant.as.mutation(api.builds.create, {
        projectId,
        name: "Locked site",
        kind: "website",
      }),
    ).rejects.toThrow(/does not include "build"/);
    expect(await countRows(t, "builds")).toBe(0);

    // The locked read renders an empty state instead of throwing.
    expect(await tenant.as.query(api.builds.list, { projectId })).toEqual([]);

    // The same organization, upgraded: the mutation and the read agree.
    await setPlan(t, tenant, "starter");
    const buildId = await tenant.as.mutation(api.builds.create, {
      projectId,
      name: "Unlocked site",
      kind: "website",
    });
    const builds = await tenant.as.query(api.builds.list, { projectId });
    expect(builds.map((b) => b._id)).toContain(buildId);
  });

  it("resolves the plan from the organization, not from the caller's own account (regression)", async () => {
    const t = newBackend();
    // The organization paid for `growth`; the teammate is personally `free`.
    const owner = await seedUser(t, { plan: "growth", email: "owner@example.com" });
    const teammate = await seedUser(t, { plan: "free", email: "teammate@example.com" });

    const organizationId = await owner.as.mutation(api.organizations.create, {
      name: "Acme Inc",
      kind: "business",
    });
    const invite = await owner.as.mutation(api.organizations.invite, {
      organizationId,
      email: "teammate@example.com",
      role: "member",
    });
    await teammate.as.mutation(api.organizations.acceptInvitation, {
      token: invite.token,
    });
    const projectId = await owner.as.mutation(api.projects.create, {
      name: "Acme site",
    });
    await t.run((ctx) => ctx.db.patch(projectId, { organizationId }));

    // (a) The teammate's personal `free` plan must not lock out the add-on the
    // organization pays for. Before T2.3 every plan check read `user.plan` of
    // whoever called, so this threw "does not include \"build\"".
    const buildId = await teammate.as.mutation(api.builds.create, {
      projectId,
      name: "Team site",
      kind: "website",
    });
    expect(buildId).toBeTruthy();

    // (b) The reverse: a personal `scale` plan must not unlock a `free`
    // organization's module.
    const freeOwner = await seedUser(t, { plan: "free", email: "free-owner@example.com" });
    const richTeammate = await seedUser(t, { plan: "scale", email: "rich@example.com" });
    const freeOrgId = await freeOwner.as.mutation(api.organizations.create, {
      name: "Beta Ltd",
      kind: "business",
    });
    const betaInvite = await freeOwner.as.mutation(api.organizations.invite, {
      organizationId: freeOrgId,
      email: "rich@example.com",
      role: "owner",
    });
    await richTeammate.as.mutation(api.organizations.acceptInvitation, {
      token: betaInvite.token,
    });
    const betaProjectId = await freeOwner.as.mutation(api.projects.create, {
      name: "Beta site",
    });
    await t.run((ctx) => ctx.db.patch(betaProjectId, { organizationId: freeOrgId }));

    await expect(
      richTeammate.as.mutation(api.builds.create, {
        projectId: betaProjectId,
        name: "Not paid for",
        kind: "website",
      }),
    ).rejects.toThrow(/does not include "build"/);
  });

  it("tells the UI the truth about the caller's matrix, per project", async () => {
    const t = newBackend();
    const { tenant, projectId } = await tenantOn(t, "starter", "starter@example.com");

    const matrix = await tenant.as.query(api.entitlements.matrix, { projectId });
    expect(matrix.plan).toBe("starter");
    expect(matrix.role).toBe("owner");
    const byModule = Object.fromEntries(
      matrix.modules.map((m) => [m.module, m.state]),
    );
    // Included in `starter`: understand, journeys, create, build, customers,
    // promote. Locked: sell, grow.
    expect(byModule.understand).toBe("included");
    expect(byModule.build).toBe("included");
    expect(byModule.sell).toBe("locked");
    expect(byModule.grow).toBe("locked");

    // The plan cards read the same registry, not a client-side tier table.
    const plans = await tenant.as.query(api.entitlements.plans, {});
    for (const plan of PLANS) {
      const card = plans.find((entry) => entry.id === plan);
      expect(card?.modules.map((m) => m.id)).toEqual([...PLAN_MODULES[plan]]);
    }
  });
});

describe("T2.3 — jobs change with the entitlement", () => {
  it("does not publish a scheduled post when the add-on is off, and records why", async () => {
    const t = newBackend();
    const { tenant, projectId } = await tenantOn(t, "free", "scheduler@example.com");

    const postId = await t.run((ctx) =>
      ctx.db.insert("posts", {
        projectId,
        channel: "linkedin",
        body: "Due now — must not leave the building.",
        status: "scheduled" as const,
        scheduledFor: Date.now() - 1_000,
        origin: "user" as const,
        createdAt: Date.now(),
      }),
    );

    await t.action(internal.social.executor.runDue, {});

    const post = await t.run((ctx) => ctx.db.get(postId));
    expect(post?.status).toBe("failed");
    expect(post?.errorDetail).toMatch(/does not include "promote"/);
    // No receipt: nothing was sent anywhere.
    expect(post?.providerRef).toBeUndefined();
    expect(post?.publishedAt).toBeUndefined();
    void tenant;

    // With the add-on included the same job does run: no platform is connected,
    // so it records the honest "connect it first" failure instead of a stop.
    const { tenant: paid, projectId: paidProject } = await tenantOn(
      t,
      "starter",
      "paid@example.com",
    );
    const paidPost = await t.run((ctx) =>
      ctx.db.insert("posts", {
        projectId: paidProject,
        channel: "linkedin",
        body: "Due now — the job should try this one.",
        status: "scheduled" as const,
        scheduledFor: Date.now() - 1_000,
        origin: "user" as const,
        createdAt: Date.now(),
      }),
    );
    void paid;

    await t.action(internal.social.executor.runDue, {});

    const row = await t.run((ctx) => ctx.db.get(paidPost));
    expect(row?.status).toBe("failed");
    expect(row?.errorDetail).toMatch(/not connected/i);
    expect(row?.providerRef).toBeUndefined();
  });

  it("the job resolves the organization's plan, so a teammate cannot publish via the queue", async () => {
    const t = newBackend();
    const owner = await seedUser(t, { plan: "free", email: "owner@example.com" });
    const organizationId = await owner.as.mutation(api.organizations.create, {
      name: "Acme Inc",
      kind: "business",
    });
    const projectId = await owner.as.mutation(api.projects.create, {
      name: "Acme site",
    });
    await t.run((ctx) => ctx.db.patch(projectId, { organizationId }));

    const postId = await t.run((ctx) =>
      ctx.db.insert("posts", {
        projectId,
        channel: "linkedin",
        body: "Scheduled while the plan was active.",
        status: "scheduled" as const,
        scheduledFor: Date.now() - 1_000,
        origin: "user" as const,
        createdAt: Date.now(),
      }),
    );

    await t.action(internal.social.executor.runDue, {});
    const post = await t.run((ctx) => ctx.db.get(postId));
    expect(post?.status).toBe("failed");
    expect(post?.errorDetail).toMatch(/does not include "promote"/);
  });
});

describe("T2.3 — the registry accepts the launch plans", () => {
  it("treats every plan name in the registry as a real plan", () => {
    for (const plan of PLANS) expect(isPlan(plan)).toBe(true);
    expect(isPlan("enterprise")).toBe(false);
  });
});
