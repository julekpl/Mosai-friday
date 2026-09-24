import { describe, expect, it } from "vitest";

import { getNextActionModel } from "@/components/app/next-action-model";

const allModules = ["understand", "journeys", "create"];

describe("Overview next action", () => {
  it("starts with a manually grounded audience profile when none is saved", () => {
    const model = getNextActionModel({
      personaCount: 0,
      journeyCount: 0,
      contentCount: 0,
      modules: allModules,
    });

    expect(model.module).toBe("understand");
    expect(model.title).toBe("Write your first audience profile");
    expect(model.steps[0]).toMatchObject({ state: "not_started", detail: "No profile saved yet" });
  });

  it("moves to a journey only after an audience profile row exists, while calling it saved work to review", () => {
    const model = getNextActionModel({
      personaCount: 1,
      journeyCount: 0,
      contentCount: 0,
      modules: allModules,
    });

    expect(model.module).toBe("journeys");
    expect(model.title).toBe("Review an audience, then map its journey");
    expect(model.description).toMatch(/saved, not verified/);
    expect(model.steps[0]).toMatchObject({ state: "saved", detail: "1 saved · review details" });
    expect(model.steps[0].detail).not.toMatch(/complete|verified/i);
  });

  it("reports a missing locked prerequisite and routes to plan options", () => {
    const model = getNextActionModel({
      personaCount: 0,
      journeyCount: 0,
      contentCount: 0,
      modules: ["journeys", "create"],
    });

    expect(model.locked).toBe(true);
    expect(model.module).toBe("understand");
    expect(model.steps[0].state).toBe("locked");
  });

  it("keeps review as the next step when rows exist instead of calling the setup complete", () => {
    const model = getNextActionModel({
      personaCount: 1,
      journeyCount: 2,
      contentCount: 3,
      modules: allModules,
    });

    expect(model.module).toBe("create");
    expect(model.title).toBe("Review your saved content");
    expect(model.steps.map((step) => step.state)).toEqual(["saved", "saved", "saved"]);
  });

  it("shows a locked step as locked even if saved rows remain", () => {
    const model = getNextActionModel({
      personaCount: 1,
      journeyCount: 0,
      contentCount: 0,
      modules: ["understand", "create"],
    });
    expect(model.module).toBe("journeys");
    expect(model.locked).toBe(true);
    expect(model.steps[1]).toMatchObject({ state: "locked", detail: "Access locked" });
  });
});
