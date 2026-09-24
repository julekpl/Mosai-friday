import { describe, expect, it } from "vitest";
import schema from "@/convex/schema";
import { DATA_REGISTRY } from "@/convex/lib/dataRegistry";
import { validateDataRegistry } from "../../scripts/data-registry-audit.mjs";

describe("BP-05 privacy data registry", () => {
  it("registers every schema table with validated deletion and export rules", () => {
    expect(validateDataRegistry(schema.tables, DATA_REGISTRY)).toEqual([]);
    expect(Object.keys(DATA_REGISTRY)).toHaveLength(Object.keys(schema.tables).length);
  });

  it("fails closed when a new schema table is unregistered", () => {
    const extra = { validator: { fields: { projectId: {} } }, indexes: [{ indexDescriptor: "by_project" }] };
    expect(validateDataRegistry({ ...schema.tables, unregisteredFixture: extra }, DATA_REGISTRY))
      .toContain("unregistered schema table: unregisteredFixture");
  });

  it("fails closed when user or organization data has no account cleanup policy", () => {
    const registry = { ...DATA_REGISTRY, authSessions: { ...DATA_REGISTRY.authSessions, accountCleanup: undefined } };
    expect(validateDataRegistry(schema.tables, registry)).toContain("authSessions: account cleanup policy is missing");
  });

  it("fails closed on stale entries and invalid rules", () => {
    expect(validateDataRegistry(schema.tables, { ...DATA_REGISTRY, staleFixture: DATA_REGISTRY.users }))
      .toContain("stale registry entry: staleFixture");
    const invalid = { ...DATA_REGISTRY, products: { ...DATA_REGISTRY.products, deletion: { kind: "project-cascade", index: "missing_index", field: "projectId" } } };
    expect(validateDataRegistry(schema.tables, invalid).some((error) => error.includes("products: deletion index missing_index is missing"))).toBe(true);
  });

  it("excludes auth and provider credentials from exports", () => {
    for (const [table, entry] of Object.entries(DATA_REGISTRY)) {
      if (/credential|auth|oauth|token/i.test(table)) expect(entry.export, table).toBe("excluded");
    }
  });
});
