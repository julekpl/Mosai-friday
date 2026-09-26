import { describe, expect, it } from "vitest";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { newBackend, seedUser, type TestBackend } from "./helpers";

/**
 * FR-M (owner decision O4): each first-run wizard visit records the furthest
 * step reached under a random key, before and after the project exists, so
 * the operator can see where owners stop. Nothing about the business is kept.
 */

const KEY = "a1b2c3d4e5f6a7b8c9d0e1f2";

async function operator(t: TestBackend) {
  const admin = await seedUser(t, { email: "ops@example.test" });
  await t.run((ctx) => ctx.db.patch(admin.userId as Id<"users">, { isPlatformAdmin: true }));
  return admin;
}

async function sessions(t: TestBackend) {
  return await t.run((ctx) => ctx.db.query("firstRunSessions").collect());
}

describe("firstRun.record", () => {
  it("counts an owner who stops before the project exists, and only moves forward", async () => {
    const t = newBackend();
    const owner = await seedUser(t, { email: "owner@example.test" });
    await owner.as.mutation(api.firstRun.record, { sessionKey: KEY, step: "type" });
    await owner.as.mutation(api.firstRun.record, { sessionKey: KEY, step: "goals" });
    await owner.as.mutation(api.firstRun.record, { sessionKey: KEY, step: "name" });
    const rows = await sessions(t);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: owner.userId, lastStep: "goals" });
    expect(rows[0].projectId).toBeUndefined();
  });

  it("records the owner making it through", async () => {
    const t = newBackend();
    const owner = await seedUser(t, { email: "owner@example.test" });
    await owner.as.mutation(api.firstRun.record, { sessionKey: KEY, step: "summary" });
    await owner.as.mutation(api.firstRun.record, { sessionKey: KEY, step: "created" });
    const rows = await sessions(t);
    expect(rows[0]).toMatchObject({ lastStep: "created" });
  });

  it("refuses a signed-out caller", async () => {
    const t = newBackend();
    await expect(t.mutation(api.firstRun.record, { sessionKey: KEY, step: "type" })).rejects.toThrow();
    expect(await sessions(t)).toHaveLength(0);
  });

  it("keeps two users' visits apart even with the same key", async () => {
    const t = newBackend();
    const a = await seedUser(t, { email: "a@example.test" });
    const b = await seedUser(t, { email: "b@example.test" });
    await a.as.mutation(api.firstRun.record, { sessionKey: KEY, step: "customers" });
    await b.as.mutation(api.firstRun.record, { sessionKey: KEY, step: "type" });
    const rows = await sessions(t);
    expect(rows.map((r) => r.lastStep).sort()).toEqual(["customers", "type"]);
  });

  it("rejects a malformed key", async () => {
    const t = newBackend();
    const owner = await seedUser(t, { email: "owner@example.test" });
    await expect(owner.as.mutation(api.firstRun.record, { sessionKey: "x", step: "type" })).rejects.toThrow(/Invalid/);
  });
});

describe("admin firstRunDropOff", () => {
  it("counts visits per furthest step, including owners who never made a project", async () => {
    const t = newBackend();
    const admin = await operator(t);
    const owner = await seedUser(t, { email: "owner@example.test" });
    await owner.as.mutation(api.firstRun.record, { sessionKey: `${KEY}01`, step: "name" });
    await owner.as.mutation(api.firstRun.record, { sessionKey: `${KEY}02`, step: "name" });
    await owner.as.mutation(api.firstRun.record, { sessionKey: `${KEY}03`, step: "created" });

    const result = await admin.as.query(api.admin.firstRunDropOff, { days: 7 });
    expect(result.counts).toEqual({ name: 2, created: 1 });
    expect(result.sampled).toBe(3);
    expect(result.capped).toBe(false);
  });

  it("is for operators only", async () => {
    const t = newBackend();
    const owner = await seedUser(t, { email: "owner@example.test" });
    await expect(owner.as.query(api.admin.firstRunDropOff, {})).rejects.toThrow();
  });
});
