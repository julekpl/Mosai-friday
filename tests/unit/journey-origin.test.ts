import { describe, expect, it } from "vitest";
import { api } from "@/convex/_generated/api";
import { journeySourceForNewMap } from "@/lib/journey-origin";
import { newBackend, seedUser } from "./helpers";

describe("journey source", () => {
  it("keeps a completed AI draft marked as AI after generation is no longer busy", () => {
    // The persisted origin is selected from completed-draft state, not the
    // transient spinner state used while the generation request is running.
    expect(journeySourceForNewMap(true)).toBe("ai");
  });

  it("keeps a journey created without an AI draft marked as manual", () => {
    expect(journeySourceForNewMap(false)).toBe("manual");
  });

  it("stores the selected origin and keeps it when the journey is edited", async () => {
    const t = newBackend();
    const owner = await seedUser(t);
    const projectId = await owner.as.mutation(api.projects.create, {
      name: "Origin test project",
    });
    const origins = [
      { name: "AI journey", source: journeySourceForNewMap(true) },
      { name: "Manual journey", source: journeySourceForNewMap(false) },
      { name: "Imported journey", source: "csv" as const },
    ];

    for (const origin of origins) {
      const id = await owner.as.mutation(api.journeys.create, {
        projectId,
        name: origin.name,
        stages: [{ stage: "Discover", cells: ["Search"] }],
        source: origin.source,
      });
      await owner.as.mutation(api.journeys.update, {
        id,
        name: `${origin.name} edited`,
      });

      const saved = await owner.as.query(api.journeys.get, { id });
      expect(saved?.source).toBe(origin.source);
    }
  });
});
