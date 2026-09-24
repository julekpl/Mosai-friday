import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "@/convex/_generated/api";
import schema from "@/convex/schema";
import { buildChildTables } from "@/convex/dal";
import { newBackend, seedUser, type TestBackend, type Tenant } from "./helpers";

/**
 * Build deletion is complete and owner-only (UX review §1.3 row 21,
 * backend review C13 / P2-3, AGENTS.md rule 12).
 *
 * Red-first record (24 Sep 2026): "removes every row that hangs off the
 * build" failed on the unfixed tree — `builds.remove` deleted only
 * `buildPages`, leaving `buildMessages`, `buildVersions` and
 * `buildReleaseAudits` orphaned. `buildChildTables` did not exist.
 */

type TableDef = {
  validator?: { fields?: Record<string, { tableName?: string } | undefined> };
};

const tables = (schema as unknown as { tables: Record<string, TableDef> }).tables;

/** Tables whose `buildId` field is `v.id("builds")`, read from schema.ts. */
const tablesReferencingBuilds = Object.keys(tables)
  .filter((name) => tables[name]?.validator?.fields?.buildId?.tableName === "builds")
  .sort();

async function seedBuildWithChildren(
  t: TestBackend,
  tenant: Tenant,
  opts: { messages?: number } = {},
) {
  const projectId = await tenant.as.mutation(api.projects.create, { name: "p" });
  const buildId = await tenant.as.mutation(api.builds.create, {
    projectId,
    name: "Website",
    kind: "website",
    idea: "A bakery site",
  });
  const now = Date.now();
  await t.run(async (ctx) => {
    const siteId = await ctx.db.insert("sites", {
      projectId,
      name: "Website",
      slug: "website",
      status: "draft",
      createdBy: tenant.userId as never,
      createdAt: now,
      updatedAt: now,
    });
    for (let i = 0; i < (opts.messages ?? 2); i++) {
      await ctx.db.insert("buildMessages", {
        buildId,
        projectId,
        role: i % 2 === 0 ? "user" : "assistant",
        content: `message ${i}`,
        createdAt: now + i,
      });
    }
    await ctx.db.insert("buildVersions", {
      buildId,
      projectId,
      version: 1,
      label: "first",
      pages: [],
      createdAt: now,
    });
    await ctx.db.insert("buildPages", {
      buildId,
      projectId,
      name: "Home",
      path: "/",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("buildReleaseAudits", {
      projectId,
      buildId,
      siteId,
      phase: "release_prepared",
      revisionIds: [],
      skipped: [],
      ruleVersion: 1,
      createdAt: now,
    });
    await ctx.db.insert("buildDeployments", {
      projectId,
      buildId,
      siteId,
      state: "failed",
      createdAt: now,
      updatedAt: now,
    });
  });
  return { projectId, buildId };
}

async function countChildren(t: TestBackend, buildId: string) {
  return await t.run(async (ctx) => {
    const counts: Record<string, number> = {};
    for (const table of tablesReferencingBuilds) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows = await (ctx.db as any)
        .query(table)
        .withIndex("by_build", (q: { eq: (f: string, v: unknown) => unknown }) =>
          q.eq("buildId", buildId),
        )
        .collect();
      counts[table] = rows.length;
    }
    return counts;
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("build deletion cascade", () => {
  it("covers every schema table that references a build, derived from the registry", () => {
    expect(tablesReferencingBuilds.length).toBeGreaterThanOrEqual(5);
    expect(buildChildTables()).toEqual(tablesReferencingBuilds);
    expect(buildChildTables()).toEqual(
      expect.arrayContaining([
        "buildDeployments",
        "buildMessages",
        "buildPages",
        "buildReleaseAudits",
        "buildVersions",
      ]),
    );
  });

  it("removes every row that hangs off the build, and the build itself", async () => {
    const t = newBackend();
    const tenant = await seedUser(t, { plan: "starter" });
    const { projectId, buildId } = await seedBuildWithChildren(t, tenant);

    const before = await countChildren(t, buildId);
    expect(Object.values(before).every((n) => n > 0)).toBe(true);

    await tenant.as.mutation(api.builds.remove, { id: buildId });

    const after = await countChildren(t, buildId);
    expect(Object.values(after).every((n) => n === 0)).toBe(true);
    expect(await t.run((ctx) => ctx.db.get(buildId))).toBeNull();
    expect(await tenant.as.query(api.builds.list, { projectId })).toEqual([]);
    // Project-level site data is shared, not owned by one build.
    const sites = await t.run((ctx) => ctx.db.query("sites").collect());
    expect(sites).toHaveLength(1);
  });

  it("finishes large builds in scheduled steps", async () => {
    vi.useFakeTimers();
    const t = newBackend();
    const tenant = await seedUser(t, { plan: "starter" });
    const { buildId } = await seedBuildWithChildren(t, tenant, { messages: 230 });

    const result = await tenant.as.mutation(api.builds.remove, { id: buildId });
    expect(result.done).toBe(false);
    expect(await t.run((ctx) => ctx.db.get(buildId))).toBeNull();

    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const after = await countChildren(t, buildId);
    expect(Object.values(after).every((n) => n === 0)).toBe(true);
  });

  it("refuses another tenant and leaves every row in place", async () => {
    const t = newBackend();
    const owner = await seedUser(t, { plan: "starter" });
    const intruder = await seedUser(t, { plan: "starter" });
    const { buildId } = await seedBuildWithChildren(t, owner);

    await expect(
      intruder.as.mutation(api.builds.remove, { id: buildId }),
    ).rejects.toThrow();

    expect(await t.run((ctx) => ctx.db.get(buildId))).not.toBeNull();
    const counts = await countChildren(t, buildId);
    expect(Object.values(counts).every((n) => n > 0)).toBe(true);
  });

  it("refuses a build whose deployment is not failed or canceled", async () => {
    const t = newBackend();
    const tenant = await seedUser(t, { plan: "starter" });
    const { buildId } = await seedBuildWithChildren(t, tenant);
    await t.run(async (ctx) => {
      const deployment = await ctx.db
        .query("buildDeployments")
        .withIndex("by_build", (q) => q.eq("buildId", buildId))
        .first();
      if (deployment) await ctx.db.patch(deployment._id, { state: "running" });
    });

    await expect(
      tenant.as.mutation(api.builds.remove, { id: buildId }),
    ).rejects.toThrow(/deployment on record/);
    expect(await t.run((ctx) => ctx.db.get(buildId))).not.toBeNull();
  });
});
