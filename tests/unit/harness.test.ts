import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "@/convex/schema";
import { modules } from "@/convex/test.setup";

/**
 * Harness smoke test (MOSAI pack T1.5).
 *
 * This is deliberately not one of the R1–R12 Phase 0 regression tests — T1.7
 * owns those. It only proves that the tooling itself works: the `convex-test`
 * mock backend boots from the real schema, and `src/convex/test.setup.ts`
 * registers the Convex function modules that the regression tests will call.
 * If this fails, every later test is meaningless, so it is the first test to
 * write and the cheapest to keep.
 */
describe("convex-test harness", () => {
  it("boots an in-memory backend from the real schema", async () => {
    const t = convexTest(schema, modules);
    const projects = await t.run((ctx) => ctx.db.query("projects").collect());
    expect(projects).toEqual([]);
  });

  it("registers the Convex function modules from src/convex", () => {
    const keys = Object.keys(modules);
    expect(keys.some((key) => key.endsWith("projects.ts"))).toBe(true);
    expect(keys.some((key) => key.endsWith("schema.ts"))).toBe(true);
    // `convex-test` locates the generated bindings through this registry.
    expect(keys.some((key) => key.endsWith("_generated/server.js"))).toBe(true);
    expect(keys.some((key) => key.endsWith(".test.ts"))).toBe(false);
  });
});
