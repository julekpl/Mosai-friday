import { beforeEach, describe, expect, it } from "vitest";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { bigFivePromptLine, bigFiveSourceOf, cleanBigFive } from "@/shared/bigFive";
import { completionCalls, resetCompletionStub, stubCompletionContent } from "./stubs/vly-integrations";
import { newBackend, seedUser } from "./helpers";

/**
 * Big Five honesty (country blueprint: never present model-invented
 * personality as fact). AI scores are labelled as an AI hypothesis, a trait
 * the model did not give stays missing instead of becoming 50, and prompts
 * call AI scores unverified.
 */

beforeEach(() => resetCompletionStub());

async function setup() {
  const t = newBackend();
  const owner = await seedUser(t, { plan: "starter" });
  const projectId = await owner.as.mutation(api.projects.create, { name: "Studio", industry: "Architecture" });
  return { t, owner, projectId };
}

describe("Big Five helpers", () => {
  it("keeps only real traits, clamped, and never invents a middle value", () => {
    expect(cleanBigFive({ openness: 140, extraversion: "high" })).toEqual({ openness: 100 });
    expect(cleanBigFive({})).toBeUndefined();
    expect(cleanBigFive(null)).toBeUndefined();
  });

  it("treats rows without a source as an AI hypothesis and says so in prompts", () => {
    expect(bigFiveSourceOf({})).toBe("ai_hypothesis");
    expect(bigFivePromptLine({ openness: 70 }, undefined)).toContain("unverified AI hypothesis");
    expect(bigFivePromptLine({ openness: 70 }, "user_assessed")).not.toContain("AI hypothesis");
    expect(bigFivePromptLine(undefined, "ai_hypothesis")).toBe("");
  });
});

describe("persona generation", () => {
  it("leaves traits the model did not give missing and marks the rest ai_hypothesis", async () => {
    const { owner, projectId } = await setup();
    stubCompletionContent(JSON.stringify({
      name: "Anna, homeowner",
      role: "Homeowner planning an extension",
      goals: [],
      pains: [],
      objections: [],
      channels: [],
      bigFive: { openness: 72 },
    }));
    const persona = await owner.as.action(api.ai.generatePersona, { projectId });
    expect(persona.bigFive).toEqual({ openness: 72 });
    expect(persona.bigFiveSource).toBe("ai_hypothesis");

    stubCompletionContent(JSON.stringify({ name: "Ben", goals: [], pains: [] }));
    const without = await owner.as.action(api.ai.generatePersona, { projectId });
    expect(without.bigFive).toBeUndefined();
    expect(without.bigFiveSource).toBeUndefined();
  });
});

describe("persona storage", () => {
  it("stores scores without a source as an AI guess, and the owner can edit or clear them", async () => {
    const { t, owner, projectId } = await setup();
    const id = await owner.as.mutation(api.personas.create, {
      projectId: projectId as Id<"projects">,
      name: "Anna",
      bigFive: { openness: 60, neuroticism: 30 },
    });
    let row = await t.run((ctx) => ctx.db.get(id));
    expect(row?.bigFiveSource).toBe("ai_hypothesis");

    await owner.as.mutation(api.personas.update, { id, bigFive: { openness: 40 }, bigFiveSource: "user_assessed" });
    row = await t.run((ctx) => ctx.db.get(id));
    expect(row?.bigFive).toEqual({ openness: 40 });
    expect(row?.bigFiveSource).toBe("user_assessed");

    await owner.as.mutation(api.personas.update, { id, clearBigFive: true });
    row = await t.run((ctx) => ctx.db.get(id));
    expect(row?.bigFive).toBeUndefined();
    expect(row?.bigFiveSource).toBeUndefined();
  });

  it("persona chat calls legacy AI scores an unverified hypothesis", async () => {
    const { t, owner, projectId } = await setup();
    const personaId = await t.run((ctx) =>
      ctx.db.insert("personas", {
        projectId: projectId as Id<"projects">,
        name: "Legacy persona",
        bigFive: { openness: 50, conscientiousness: 50, extraversion: 50, agreeableness: 50, neuroticism: 50 },
        createdBy: owner.userId as Id<"users">,
        createdAt: Date.now(),
      }),
    );
    stubCompletionContent("Hello");
    await owner.as.action(api.ai.personaChat, {
      mode: "analyst",
      projectId: projectId as Id<"projects">,
      personaId,
      message: "What matters to them?",
    });
    const user = completionCalls.at(-1)?.messages.find((m) => m.role === "user")?.content ?? "";
    expect(user).toContain("unverified AI hypothesis");
  });
});
