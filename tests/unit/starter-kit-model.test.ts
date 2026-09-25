import { describe, expect, it } from "vitest";
import schema from "@/convex/schema";
import { DATA_REGISTRY } from "@/convex/lib/dataRegistry";
import {
  BUSINESS_TYPES,
  PRIMARY_GOALS,
  STARTER_KIT_STATUSES,
  defaultGoalFor,
  emptyStarterKitPart,
  starterKitPartValidator,
  starterKitStatusValidator,
  type StarterKitStatus,
} from "@/shared/starterKit";
import type { Id } from "@/convex/_generated/dataModel";
import { newBackend, seedProject, seedUser } from "./helpers";

// U2a: the schema foundation for the first-run starter kit
// (docs/ux/first-run-blueprint.md §2 and §4).

describe("starter kit vocabulary", () => {
  it("maps each business type to its default goal, and agencies to none", () => {
    expect(defaultGoalFor("appointments")).toBe("bookings");
    expect(defaultGoalFor("shop")).toBe("sales");
    expect(defaultGoalFor("walk_in")).toBe("visits");
    expect(defaultGoalFor("agency")).toBeUndefined();
    expect(defaultGoalFor(undefined)).toBeUndefined();
    for (const type of BUSINESS_TYPES) {
      const goal = defaultGoalFor(type);
      if (goal) expect(PRIMARY_GOALS).toContain(goal);
    }
  });

  it("uses exactly the standard job states (AGENTS.md rule 13)", () => {
    expect([...STARTER_KIT_STATUSES]).toEqual([
      "queued",
      "running",
      "waiting_for_user",
      "succeeded",
      "partially_succeeded",
      "failed",
      "canceled",
    ]);
  });
});

describe("starterKits table", () => {
  it("is registered as project data that cascades with the project", () => {
    expect(Object.keys(schema.tables)).toContain("starterKits");
    expect(DATA_REGISTRY.starterKits).toMatchObject({
      scope: "project",
      retention: "cascade-with-project",
      deletion: { kind: "project-cascade", index: "by_project", field: "projectId" },
    });
  });

  it("stores the first-run answers on a project", async () => {
    const t = newBackend();
    const owner = await seedUser(t);
    const projectId = (await seedProject(t, owner.userId)) as Id<"projects">;
    await t.run((ctx) => ctx.db.patch(projectId, { businessType: "walk_in", primaryGoal: "visits" }));
    const project = await t.run((ctx) => ctx.db.get(projectId));
    expect(project).toMatchObject({ businessType: "walk_in", primaryGoal: "visits" });
  });

  it("stores a queued kit with three empty parts", async () => {
    const t = newBackend();
    const owner = await seedUser(t);
    const projectId = (await seedProject(t, owner.userId)) as Id<"projects">;
    const now = Date.now();
    const kitId = await t.run((ctx) =>
      ctx.db.insert("starterKits", {
        projectId,
        requestedBy: owner.userId as Id<"users">,
        idempotencyKey: String(projectId),
        status: "queued",
        parts: { plan: emptyStarterKitPart(now), site: emptyStarterKitPart(now), posts: emptyStarterKitPart(now) },
        attempts: 0,
        budgetMicrousd: 500_000,
        spentMicrousd: 0,
        budgetCurrency: "USD",
        createdAt: now,
        updatedAt: now,
      }),
    );
    expect(await t.run((ctx) => ctx.db.get(kitId))).toMatchObject({ status: "queued", attempts: 0 });
  });

  // The schema runs with `schemaValidation: false`, so these unions are a
  // type-level contract, not a database check. Prove the contract itself: no
  // kit or part state can say published, scheduled or sent (AGENTS.md rule 5).
  it("has no published, scheduled or sent state for a kit or a part", () => {
    const literals = (validator: { members: { value: unknown }[] }) =>
      validator.members.map((member) => member.value);
    const kitStates = literals(starterKitStatusValidator);
    const partStates = literals(starterKitPartValidator.fields.status);
    expect(kitStates).toEqual([...STARTER_KIT_STATUSES]);
    for (const state of [...kitStates, ...partStates]) {
      expect(["published", "scheduled", "sent", "live"]).not.toContain(state);
    }
    // @ts-expect-error "published" is not a kit status
    const invalid: StarterKitStatus = "published";
    expect(STARTER_KIT_STATUSES).not.toContain(invalid);
  });
});
