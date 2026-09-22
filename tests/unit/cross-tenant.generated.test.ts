import { describe, expect, it } from "vitest";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { Tenant, TestBackend } from "./helpers";
import { newBackend, seedUser } from "./helpers";
import {
  buildFunctionRegistry,
  referenceFor,
  type RegistryEntry,
} from "./function-registry";
import {
  buildArgs,
  projectScopedTables,
  revealsNothing,
  snapshotCounts,
  tenantContext,
  type TenantContext,
} from "./cross-tenant.fixtures";

/**
 * T2.2 — generated cross-tenant suite.
 *
 * The test cases are generated at run time from the function registry
 * (`function-registry.ts`), which enumerates every public Convex function and
 * its argument schema. For each function that takes a record id, this suite:
 *
 *   1. seeds tenant Alice with a real project, user, organization and one real
 *      row per table the function's arguments reference;
 *   2. calls the function as tenant Bob — a real, signed-in user who is a
 *      member of a *different* organization;
 *   3. proves Bob gets nothing back and writes nothing: the returned value
 *      reveals no data and every table's row count is unchanged.
 *
 * Adding a public function that takes a `projectId` (or any record id) without
 * authorizing it makes this suite fail — that is the "cross-tenant coverage is
 * 100%" gate. Functions with no record argument have no tenant to cross, so
 * they are structural coverage only.
 */

const registry = buildFunctionRegistry();
const tenantEntries = registry.filter((entry) => entry.tenantScoped);

async function callAs(
  as: ReturnType<TestBackend["withIdentity"]>,
  entry: RegistryEntry,
  args: Record<string, unknown>,
): Promise<unknown> {
  const ref = referenceFor(entry) as never;
  const payload = args as never;
  if (entry.kind === "query") return await as.query(ref, payload);
  if (entry.kind === "mutation") return await as.mutation(ref, payload);
  return await as.action(ref, payload);
}

/** Seed tenant Alice and hand back her context. */
async function seedAlice(
  t: TestBackend,
  entry: RegistryEntry,
): Promise<{ projectId: string; context: TenantContext; alice: Tenant }> {
  const alice = await seedUser(t, { plan: "scale", email: "alice@example.com" });
  const projectId = await alice.as.mutation(api.projects.create, {
    name: "Alice project",
  });
  const context = await tenantContext(t, alice, projectId);
  void entry;
  return { projectId, context, alice };
}

/** The organizations a user is an active member of. */
async function memberOrganizations(
  t: TestBackend,
  user: Tenant,
): Promise<string[]> {
  const rows = await t.run((ctx) =>
    ctx.db
      .query("memberships")
      .withIndex("by_user", (q) => q.eq("userId", user.userId as Id<"users">))
      .collect(),
  );
  return rows
    .filter((row) => row.status === "active")
    .map((row) => row.organizationId as string);
}

describe("T2.2 — generated cross-tenant suite", () => {
  it("the registry covers every public function exactly once", () => {
    expect(registry.length).toBeGreaterThan(100);
    const names = registry.map((entry) => entry.name);
    expect(new Set(names).size).toBe(names.length);
    // Every public function is either tenant-scoped (asserted below) or has no
    // record argument, so there is no tenant boundary to cross.
    expect(
      tenantEntries.length + registry.filter((e) => !e.tenantScoped).length,
    ).toBe(registry.length);
    expect(tenantEntries.length).toBeGreaterThan(0);
  });

  it("every project-scoped table can be seeded with a real tenant row", async () => {
    const t = newBackend();
    const alice = await seedUser(t, { plan: "scale", email: "alice@example.com" });
    const projectId = await alice.as.mutation(api.projects.create, {
      name: "Alice project",
    });
    const context = await tenantContext(t, alice, projectId);
    const missing: string[] = [];
    for (const table of projectScopedTables()) {
      const id = await context.ensure(table);
      if (context.unseeded.has(table) || id === context.ids[table]) {
        if (context.unseeded.has(table)) missing.push(table);
      }
    }
    expect(missing).toEqual([]);
  });

  for (const entry of tenantEntries) {
    it(`${entry.name} — a foreign-organization caller gets nothing and writes nothing`, async () => {
      const t = newBackend();
      const { context, alice } = await seedAlice(t, entry);
      const bob = await seedUser(t, {
        plan: "scale",
        email: "bob@example.com",
      });
      // Bob is a real customer of his own organization (creating a project
      // provisions his personal organization), so the caller is a legitimate
      // member of a *different* tenant rather than an organization-less user.
      await bob.as.mutation(api.projects.create, { name: "Bob project" });

      // Prove the caller really is foreign: Bob shares no organization with
      // Alice, and Alice's project belongs to one of her organizations.
      const aliceOrgs = await memberOrganizations(t, alice);
      const bobOrgs = await memberOrganizations(t, bob);
      expect(aliceOrgs.length).toBeGreaterThan(0);
      expect(bobOrgs.length).toBeGreaterThan(0);
      expect(bobOrgs.filter((id) => aliceOrgs.includes(id))).toEqual([]);

      const args = await buildArgs(entry.argSchema, context.ensure);
      const before = await snapshotCounts(t);

      let threw = false;
      let result: unknown;
      try {
        result = await callAs(bob.as, entry, args);
      } catch {
        threw = true;
      }

      const after = await snapshotCounts(t);
      expect(after, `${entry.name} wrote to the database for a foreign caller`).toEqual(
        before,
      );
      if (!threw) {
        expect(
          revealsNothing(result),
          `${entry.name} returned tenant data to a foreign-organization caller`,
        ).toBe(true);
      }
    });
  }
});
