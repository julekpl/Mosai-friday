import { describe, expect, it } from "vitest";
import { api } from "@/convex/_generated/api";
import { newBackend, seedUser } from "./helpers";

describe("app requirements review", () => {
  it("saves project-owned source provenance, records review actor/time, and clears review on edit", async () => {
    const t = newBackend();
    const owner = await seedUser(t, { plan: "starter" });
    const projectId = await owner.as.mutation(api.projects.create, { name: "Alpha" });
    const personaId = await owner.as.mutation(api.personas.create, {
      projectId,
      name: "Studio owner",
    });
    const buildId = await owner.as.mutation(api.builds.create, {
      projectId,
      name: "Booking app",
      kind: "app",
    });
    const requirements = {
      audience: "customer_facing" as const,
      goal: "Let clients book sessions",
      targetUsers: "Existing and prospective clients",
      coreWorkflows: ["Choose a slot", "Confirm a booking"],
      constraints: ["Staff approve changes"],
      sourceRefs: [{ kind: "persona" as const, id: personaId }],
    };

    await owner.as.mutation(api.builds.saveAppRequirements, { buildId, requirements });
    await owner.as.mutation(api.builds.reviewAppRequirements, { buildId });
    let row = await t.run((ctx) => ctx.db.get(buildId));
    expect(row?.appRequirements).toMatchObject({
      state: "reviewed",
      sourceRefs: [{ kind: "persona", id: personaId, label: "Studio owner" }],
      reviewedBy: owner.userId,
    });
    expect(row?.appRequirements?.reviewedAt).toBeTypeOf("number");

    await owner.as.mutation(api.builds.saveAppRequirements, {
      buildId,
      requirements: { ...requirements, goal: "Updated goal" },
    });
    row = await t.run((ctx) => ctx.db.get(buildId));
    expect(row?.appRequirements?.state).toBe("draft");
    expect(row?.appRequirements?.reviewedAt).toBeUndefined();
    expect(row?.appRequirements?.reviewedBy).toBeUndefined();
  });

  it("rejects wrong-kind builds and source records from another project", async () => {
    const t = newBackend();
    const owner = await seedUser(t, { plan: "starter" });
    const projectA = await owner.as.mutation(api.projects.create, { name: "A" });
    const projectB = await owner.as.mutation(api.projects.create, { name: "B" });
    const foreignPersona = await owner.as.mutation(api.personas.create, {
      projectId: projectB,
      name: "Foreign persona",
    });
    const appId = await owner.as.mutation(api.builds.create, {
      projectId: projectA,
      name: "App",
      kind: "app",
    });
    const websiteId = await owner.as.mutation(api.builds.create, {
      projectId: projectA,
      name: "Website",
      kind: "website",
    });
    const requirements = {
      audience: "customer_facing" as const,
      goal: "Goal",
      targetUsers: "Users",
      coreWorkflows: [],
      constraints: [],
      sourceRefs: [{ kind: "persona" as const, id: foreignPersona }],
    };

    await expect(owner.as.mutation(api.builds.saveAppRequirements, {
      buildId: appId,
      requirements,
    })).rejects.toThrow("Source must belong to this app project's context");
    await expect(owner.as.mutation(api.builds.saveAppRequirements, {
      buildId: websiteId,
      requirements: { ...requirements, sourceRefs: [] },
    })).rejects.toThrow("App build not found");
  });

  it("does not accept client-supplied review metadata", async () => {
    const t = newBackend();
    const owner = await seedUser(t, { plan: "starter" });
    const projectId = await owner.as.mutation(api.projects.create, { name: "A" });
    const buildId = await owner.as.mutation(api.builds.create, {
      projectId,
      name: "App",
      kind: "app",
    });
    await expect(owner.as.mutation(api.builds.saveAppRequirements, {
      buildId,
      // @ts-expect-error review state and actor are server-owned
      requirements: { audience: "customer_facing", state: "reviewed", reviewedBy: owner.userId, goal: "g", targetUsers: "u", coreWorkflows: [], constraints: [], sourceRefs: [] },
    })).rejects.toThrow();
  });

  it("keeps requirements behind build tenant ownership", async () => {
    const t = newBackend();
    const owner = await seedUser(t, { plan: "starter" });
    const other = await seedUser(t, { plan: "starter" });
    const projectId = await owner.as.mutation(api.projects.create, { name: "Private" });
    const buildId = await owner.as.mutation(api.builds.create, {
      projectId,
      name: "Private app",
      kind: "app",
    });
    await expect(other.as.mutation(api.builds.saveAppRequirements, {
      buildId,
      requirements: { audience: "internal_team", goal: "x", targetUsers: "y", coreWorkflows: [], constraints: [], sourceRefs: [] },
    })).rejects.toThrow();
    expect(await other.as.query(api.builds.getAppRequirementsStatus, { buildId })).toBeNull();
    const row = await t.run((ctx) => ctx.db.get(buildId));
    expect(row?.appRequirements).toBeUndefined();
  });

  it("requires meaningful requirements for review and rejects website plans on apps", async () => {
    const t = newBackend();
    const owner = await seedUser(t, { plan: "starter" });
    const projectId = await owner.as.mutation(api.projects.create, { name: "A" });
    const buildId = await owner.as.mutation(api.builds.create, {
      projectId,
      name: "App",
      kind: "app",
    });
    await owner.as.mutation(api.builds.saveAppRequirements, {
      buildId,
      requirements: { audience: "internal_team", goal: "", targetUsers: "", coreWorkflows: [], constraints: [], sourceRefs: [] },
    });
    await expect(owner.as.mutation(api.builds.reviewAppRequirements, { buildId }))
      .rejects.toThrow("Add a goal, target users, and at least one core workflow before review");
    await expect(owner.as.mutation(api.builds.update, {
      id: buildId,
      // @ts-expect-error website-only field cannot be written on an app build
      pages: ["/home"],
    })).rejects.toThrow("App builds cannot receive website plans or generated status");
  });

  it("rejects duplicate provenance refs and app creation with website plan fields", async () => {
    const t = newBackend();
    const owner = await seedUser(t, { plan: "starter" });
    const projectId = await owner.as.mutation(api.projects.create, { name: "A" });
    const personaId = await owner.as.mutation(api.personas.create, {
      projectId,
      name: "A persona",
    });
    await expect(owner.as.mutation(api.builds.create, {
      projectId,
      name: "Bad app",
      kind: "app",
      // @ts-expect-error app builds cannot be created with website plan data
      pages: ["/home"],
    })).rejects.toThrow("App builds cannot contain website plan fields");
    const buildId = await owner.as.mutation(api.builds.create, { projectId, name: "App", kind: "app" });
    await expect(owner.as.mutation(api.builds.saveAppRequirements, {
      buildId,
      requirements: {
        audience: "both",
        goal: "Goal",
        targetUsers: "Users",
        coreWorkflows: ["Book"],
        constraints: [],
        sourceRefs: [
          { kind: "persona" as const, id: personaId },
          { kind: "persona" as const, id: personaId },
        ],
      },
    })).rejects.toThrow("Duplicate context records are not allowed");
  });

  it("refuses to review if a selected project source changed since the brief was saved", async () => {
    const t = newBackend();
    const owner = await seedUser(t, { plan: "starter" });
    const projectId = await owner.as.mutation(api.projects.create, { name: "A" });
    const personaId = await owner.as.mutation(api.personas.create, {
      projectId,
      name: "Original persona",
    });
    const buildId = await owner.as.mutation(api.builds.create, {
      projectId,
      name: "App",
      kind: "app",
    });
    const requirements = {
      audience: "customer_facing" as const,
      goal: "Serve clients",
      targetUsers: "Clients",
      coreWorkflows: ["Request service"],
      constraints: [],
      sourceRefs: [{ kind: "persona" as const, id: personaId }],
    };
    await owner.as.mutation(api.builds.saveAppRequirements, { buildId, requirements });
    await owner.as.mutation(api.personas.update, { id: personaId, name: "Changed persona" });
    await expect(owner.as.mutation(api.builds.reviewAppRequirements, { buildId }))
      .rejects.toThrow("A selected source changed; save requirements again before review");
  });

  it("reports an already-reviewed brief as stale after its selected source changes", async () => {
    const t = newBackend();
    const owner = await seedUser(t, { plan: "starter" });
    const projectId = await owner.as.mutation(api.projects.create, { name: "A" });
    const personaId = await owner.as.mutation(api.personas.create, { projectId, name: "Before" });
    const buildId = await owner.as.mutation(api.builds.create, { projectId, name: "App", kind: "app" });
    await owner.as.mutation(api.builds.saveAppRequirements, {
      buildId,
      requirements: {
        audience: "both", goal: "Serve people", targetUsers: "People",
        coreWorkflows: ["Use app"], constraints: [],
        sourceRefs: [{ kind: "persona" as const, id: personaId }],
      },
    });
    await owner.as.mutation(api.builds.reviewAppRequirements, { buildId });
    expect(await owner.as.query(api.builds.getAppRequirementsStatus, { buildId })).toMatchObject({ status: "fresh" });
    await owner.as.mutation(api.personas.update, { id: personaId, name: "After" });
    expect(await owner.as.query(api.builds.getAppRequirementsStatus, { buildId })).toMatchObject({ status: "stale" });
  });

  it("reports an already-reviewed brief as stale after a selected source is deleted", async () => {
    const t = newBackend();
    const owner = await seedUser(t, { plan: "starter" });
    const projectId = await owner.as.mutation(api.projects.create, { name: "A" });
    const personaId = await owner.as.mutation(api.personas.create, { projectId, name: "Before" });
    const buildId = await owner.as.mutation(api.builds.create, { projectId, name: "App", kind: "app" });
    await owner.as.mutation(api.builds.saveAppRequirements, {
      buildId,
      requirements: {
        audience: "internal_team", goal: "Serve team", targetUsers: "Team",
        coreWorkflows: ["Use app"], constraints: [],
        sourceRefs: [{ kind: "persona" as const, id: personaId }],
      },
    });
    await owner.as.mutation(api.builds.reviewAppRequirements, { buildId });
    await owner.as.mutation(api.personas.remove, { id: personaId });
    expect(await owner.as.query(api.builds.getAppRequirementsStatus, { buildId })).toMatchObject({ status: "stale" });
  });
});
