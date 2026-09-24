import { beforeEach, describe, expect, it } from "vitest";
import { api } from "@/convex/_generated/api";
import {
  AUDIENCE_AND_SUBJECT_RULES,
  businessBriefLines,
  parseBusinessProfile,
} from "@/convex/lib/businessProfile";
import { completionCalls, resetCompletionStub, stubCompletionContent } from "./stubs/vly-integrations";
import { newBackend, seedUser } from "./helpers";

/**
 * Owner report (24 Sep 2026): for an architecture practice the persona
 * generator returned one of the practice's employees, and the content tools
 * returned marketing-agency content. The fix grounds every prompt in a business
 * brief that names the customers, lists who is NOT the audience, and forbids
 * writing about marketing unless the business sells it.
 *
 * These tests pin the prompt contract (what reaches the model), the profile
 * parser, and the draft/confirmed lifecycle. Model replies are stubbed; no
 * network is used (tests/unit/setup.ts routes openrouter.ai to the stub).
 */

const ARCHITECT_PROFILE = {
  summary: "Residential architecture practice in Kraków designing extensions and new family homes.",
  businessModel: "b2c",
  offerings: ["House extensions", "New family homes", "Planning permission drawings"],
  customerSegments: ["Homeowners planning an extension", "Families building a new home"],
  notTheAudience: ["Architecture graduates applying for jobs"],
  customerProblems: ["Unclear planning rules", "Budget overruns"],
  primaryGoals: ["More enquiries for residential projects"],
  market: "Kraków and Lesser Poland",
  differentiators: ["Fixed-fee design packages"],
  contentThemes: ["Planning permission", "Extension costs", "Energy-efficient homes"],
};

beforeEach(() => resetCompletionStub());

describe("business profile parsing", () => {
  it("accepts a complete profile and normalises the model enum", () => {
    const profile = parseBusinessProfile(JSON.stringify({ ...ARCHITECT_PROFILE, businessModel: "B2C" }));
    expect(profile.businessModel).toBe("b2c");
    expect(profile.customerSegments).toContain("Homeowners planning an extension");
  });

  it("rejects a profile without offerings or customers", () => {
    expect(() => parseBusinessProfile(JSON.stringify({ ...ARCHITECT_PROFILE, customerSegments: [] }))).toThrow();
    expect(() => parseBusinessProfile(JSON.stringify({ ...ARCHITECT_PROFILE, offerings: [] }))).toThrow();
    expect(() => parseBusinessProfile("not json")).toThrow();
  });
});

describe("business brief", () => {
  it("always names the customers and excludes staff and applicants", () => {
    const lines = businessBriefLines({
      name: "Studio",
      industry: "Architecture",
      targetAudience: ["Homeowners"],
    }).join("\n");
    expect(lines).toContain("Customers (the audience): Homeowners");
    expect(lines).toMatch(/Not the audience: .*employees and job applicants/);
    expect(lines).toContain("owner-entered project details only");
  });

  it("marks an AI draft as unconfirmed", () => {
    const lines = businessBriefLines({
      name: "Studio",
      businessProfile: { ...parseBusinessProfile(JSON.stringify(ARCHITECT_PROFILE)), status: "ai_draft", updatedAt: 1 },
    }).join("\n");
    expect(lines).toContain("AI draft, not yet confirmed");
    expect(lines).toContain("What customers pay for: House extensions");
  });
});

describe("prompts are grounded in the business, not the team or marketing", () => {
  it("persona generation sends the brief, the customer rule and the owner's audience", async () => {
    const t = newBackend();
    const owner = await seedUser(t, { plan: "starter" });
    const projectId = await owner.as.mutation(api.projects.create, {
      name: "Studio Forma",
      industry: "Architecture",
      description: "We design homes. Meet our team of 12 architects.",
      targetAudience: ["Homeowners planning an extension"],
      customerPains: ["Unclear planning rules"],
    });
    stubCompletionContent(JSON.stringify({
      name: "Anna, homeowner",
      role: "Homeowner planning a house extension",
      goals: ["Get planning approved"],
      pains: ["Unclear planning rules"],
      objections: [],
      channels: [],
      evidence: "Owner-described audience",
    }));

    await owner.as.action(api.ai.generatePersona, { projectId });

    const call = completionCalls.at(-1);
    const system = call?.messages.find((m) => m.role === "system")?.content ?? "";
    const user = call?.messages.find((m) => m.role === "user")?.content ?? "";
    expect(system).toContain(AUDIENCE_AND_SUBJECT_RULES);
    expect(system).toMatch(/never be an employee, founder, job applicant or supplier/);
    expect(user.indexOf("BUSINESS BRIEF")).toBeGreaterThanOrEqual(0);
    expect(user.indexOf("BUSINESS BRIEF")).toBeLessThan(user.indexOf("Authorized ContextPack"));
    expect(user).toContain("Customers (the audience): Homeowners planning an extension");
    expect(user).toContain("Customer problems this business solves: Unclear planning rules");
  });

  it("content gaps forbid marketing-tactic gaps", async () => {
    const t = newBackend();
    const owner = await seedUser(t, { plan: "starter" });
    const projectId = await owner.as.mutation(api.projects.create, { name: "Studio", industry: "Architecture" });
    stubCompletionContent(JSON.stringify({ gaps: [{ title: "Planning permission timeline", severity: "high" }] }));

    await owner.as.action(api.ai.detectContentGaps, { projectId });

    const system = completionCalls.at(-1)?.messages.find((m) => m.role === "system")?.content ?? "";
    expect(system).toMatch(/never a marketing tactic/);
    expect(system).toMatch(/Do not write about marketing, content strategy, SEO/);
  });
});

describe("business profile lifecycle", () => {
  it("stores an AI draft on the server and never overwrites a confirmed profile", async () => {
    const t = newBackend();
    const owner = await seedUser(t, { plan: "starter" });
    const projectId = await owner.as.mutation(api.projects.create, { name: "Studio", industry: "Architecture" });

    stubCompletionContent(JSON.stringify(ARCHITECT_PROFILE));
    const first = await owner.as.action(api.ai.generateBusinessProfile, { projectId });
    expect(first.stored).toBe(true);
    let project = await t.run((ctx) => ctx.db.get(projectId));
    expect(project?.businessProfile?.status).toBe("ai_draft");

    await owner.as.mutation(api.projects.saveBusinessProfile, {
      id: projectId,
      profile: { ...parseBusinessProfile(JSON.stringify(ARCHITECT_PROFILE)), summary: "Owner-corrected summary" },
      confirm: true,
    });

    stubCompletionContent(JSON.stringify({ ...ARCHITECT_PROFILE, summary: "A different AI guess" }));
    const second = await owner.as.action(api.ai.generateBusinessProfile, { projectId });
    expect(second.stored).toBe(false);
    project = await t.run((ctx) => ctx.db.get(projectId));
    expect(project?.businessProfile?.status).toBe("confirmed");
    expect(project?.businessProfile?.summary).toBe("Owner-corrected summary");
  });

  it("another tenant cannot read or write the profile", async () => {
    const t = newBackend();
    const owner = await seedUser(t, { plan: "starter" });
    const other = await seedUser(t, { plan: "starter" });
    const projectId = await owner.as.mutation(api.projects.create, { name: "Studio" });
    stubCompletionContent(JSON.stringify(ARCHITECT_PROFILE));

    await expect(other.as.action(api.ai.generateBusinessProfile, { projectId })).rejects.toThrow();
    await expect(
      other.as.mutation(api.projects.saveBusinessProfile, {
        id: projectId,
        profile: { ...ARCHITECT_PROFILE, businessModel: "b2c" },
        confirm: true,
      }),
    ).rejects.toThrow();
    const project = await t.run((ctx) => ctx.db.get(projectId));
    expect(project?.businessProfile).toBeUndefined();
  });
});

describe("project edits", () => {
  it("keeps the owner's description when a scan is saved later", async () => {
    const t = newBackend();
    const owner = await seedUser(t, { plan: "starter" });
    const projectId = await owner.as.mutation(api.projects.create, {
      name: "Studio",
      description: "Owner's own words",
    });
    await owner.as.mutation(api.projects.saveScan, {
      id: projectId,
      status: "scraped",
      metaDescription: "Scraped meta description",
    });
    const project = await t.run((ctx) => ctx.db.get(projectId));
    expect(project?.description).toBe("Owner's own words");
  });

  it("updates audience fields, clears emptied text and refuses an empty name", async () => {
    const t = newBackend();
    const owner = await seedUser(t, { plan: "starter" });
    const projectId = await owner.as.mutation(api.projects.create, { name: "Studio", industry: "Architecture" });
    await owner.as.mutation(api.projects.update, {
      id: projectId,
      targetAudience: ["Homeowners", " homeowners ", ""],
      industry: "",
      serviceArea: "Kraków",
    });
    const project = await t.run((ctx) => ctx.db.get(projectId));
    expect(project?.targetAudience).toEqual(["Homeowners"]);
    expect(project?.industry).toBeUndefined();
    expect(project?.serviceArea).toBe("Kraków");
    await expect(owner.as.mutation(api.projects.update, { id: projectId, name: "  " })).rejects.toThrow();
  });
});
