import { describe, expect, it } from "vitest";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { newBackend, seedUser, type TestBackend } from "./helpers";

/**
 * FR-M (owner decision O4): the wizard records when it started and how far
 * it got on the project; the operator reads a bounded count per last step.
 */

async function operator(t: TestBackend) {
  const admin = await seedUser(t, { email: "ops@example.test" });
  await t.run((ctx) => ctx.db.patch(admin.userId as Id<"users">, { isPlatformAdmin: true }));
  return admin;
}

describe("recordFirstRunStep", () => {
  it("records the start and only moves the step forward", async () => {
    const t = newBackend();
    const owner = await seedUser(t, { email: "owner@example.test" });
    const id = (await owner.as.mutation(api.projects.create, { name: "Cafe" })) as Id<"projects">;
    const startedAt = Date.now() - 60_000;

    await owner.as.mutation(api.projects.recordFirstRunStep, { id, step: "created", startedAt });
    await owner.as.mutation(api.projects.recordFirstRunStep, { id, step: "name", startedAt: 1 });

    const project = await t.run((ctx) => ctx.db.get(id));
    expect(project?.firstRunLastStep).toBe("created");
    expect(project?.firstRunStartedAt).toBe(startedAt);
  });

  it("clamps a start time from the far past", async () => {
    const t = newBackend();
    const owner = await seedUser(t, { email: "owner@example.test" });
    const id = (await owner.as.mutation(api.projects.create, { name: "Cafe" })) as Id<"projects">;
    await owner.as.mutation(api.projects.recordFirstRunStep, { id, step: "type", startedAt: 1 });
    const project = await t.run((ctx) => ctx.db.get(id));
    expect(project?.firstRunStartedAt).toBeGreaterThan(Date.now() - 25 * 60 * 60_000);
  });

  it("refuses a caller from another organization and writes nothing", async () => {
    const t = newBackend();
    const owner = await seedUser(t, { email: "owner@example.test" });
    const stranger = await seedUser(t, { email: "stranger@example.test" });
    const id = (await owner.as.mutation(api.projects.create, { name: "Cafe" })) as Id<"projects">;

    await expect(
      stranger.as.mutation(api.projects.recordFirstRunStep, { id, step: "created" }),
    ).rejects.toThrow();
    const project = await t.run((ctx) => ctx.db.get(id));
    expect(project?.firstRunLastStep).toBeUndefined();
    expect(project?.firstRunStartedAt).toBeUndefined();
  });

  it("refuses a signed-out caller", async () => {
    const t = newBackend();
    const owner = await seedUser(t, { email: "owner@example.test" });
    const id = (await owner.as.mutation(api.projects.create, { name: "Cafe" })) as Id<"projects">;
    await expect(t.mutation(api.projects.recordFirstRunStep, { id, step: "created" })).rejects.toThrow();
  });
});

describe("admin firstRunDropOff", () => {
  it("counts recent projects per last step and leaves out old ones", async () => {
    const t = newBackend();
    const admin = await operator(t);
    const owner = await seedUser(t, { email: "owner@example.test" });
    const a = (await owner.as.mutation(api.projects.create, { name: "A" })) as Id<"projects">;
    const b = (await owner.as.mutation(api.projects.create, { name: "B" })) as Id<"projects">;
    await owner.as.mutation(api.projects.create, { name: "C" });
    await owner.as.mutation(api.projects.recordFirstRunStep, { id: a, step: "created" });
    await owner.as.mutation(api.projects.recordFirstRunStep, { id: b, step: "created" });

    const result = await admin.as.query(api.admin.firstRunDropOff, { days: 7 });
    expect(result.counts).toEqual({ created: 2, none: 1 });
    expect(result.sampled).toBe(3);
    expect(result.capped).toBe(false);
  });

  it("is for operators only", async () => {
    const t = newBackend();
    const owner = await seedUser(t, { email: "owner@example.test" });
    await expect(owner.as.query(api.admin.firstRunDropOff, {})).rejects.toThrow();
  });
});
