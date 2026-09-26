import { beforeEach, describe, expect, it } from "vitest";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  mergeBusinessProfileDraft,
  parseBusinessProfile,
  type BusinessProfile,
} from "@/convex/lib/businessProfile";
import {
  AUTHORITIES,
  canOverwrite,
  decideWrite,
  type Authority,
} from "@/shared/contracts/provenance";
import { resetCompletionStub, stubCompletionContent } from "./stubs/vly-integrations";
import { newBackend, seedUser } from "./helpers";

/**
 * CT-1 + KIT-2: owner-confirmed profile fields win over AI drafts. The metric
 * is "0 overwrites of confirmed fields": a rerun of the AI draft after the
 * owner confirmed or typed a field keeps the owner's value and reports the
 * AI's different value as a suggestion.
 */

const PROFILE: BusinessProfile = parseBusinessProfile(JSON.stringify({
  summary: "Residential architecture practice in Krakow.",
  businessModel: "b2c",
  offerings: ["House extensions", "New family homes"],
  customerSegments: ["Homeowners planning an extension"],
  notTheAudience: [],
  customerProblems: ["Unclear planning rules"],
  primaryGoals: ["More enquiries"],
  market: "Krakow",
  differentiators: [],
  contentThemes: ["Planning permission"],
}));

beforeEach(() => resetCompletionStub());

describe("authority ladder", () => {
  it("never lets a machine source replace an owner-confirmed or locked value", () => {
    for (const incoming of ["first_party", "provider", "external", "inferred"] as Authority[]) {
      expect(canOverwrite("user_confirmed", incoming)).toBe(false);
      expect(canOverwrite("user_locked", incoming)).toBe(false);
      expect(decideWrite("user_confirmed", incoming)).toBe("suggest");
      expect(decideWrite("user_locked", incoming)).toBe("keep");
    }
    expect(canOverwrite("user_locked", "user_confirmed")).toBe(false);
    expect(canOverwrite("user_locked", "user_locked")).toBe(true);
    expect(canOverwrite("user_confirmed", "user_confirmed")).toBe(true);
  });

  it("lets an equal or stronger source win and never a weaker one", () => {
    expect(canOverwrite(undefined, "inferred")).toBe(true);
    expect(canOverwrite("inferred", "inferred")).toBe(true);
    expect(canOverwrite("inferred", "first_party")).toBe(true);
    expect(canOverwrite("first_party", "inferred")).toBe(false);
    expect(canOverwrite("provider", "external")).toBe(true);
    expect(canOverwrite("first_party", "provider")).toBe(false);
    expect(AUTHORITIES[0]).toBe("user_locked");
  });
});

describe("mergeBusinessProfileDraft", () => {
  it("keeps a confirmed field and reports the draft's value as a suggestion", () => {
    const result = mergeBusinessProfileDraft({
      stored: { ...PROFILE, status: "ai_draft", updatedAt: 1 },
      authority: { summary: { authority: "user_confirmed", confirmedAt: 1 } },
      draft: { ...PROFILE, summary: "An AI guess", offerings: ["Interiors"] },
      incoming: "inferred",
    });
    expect(result.profile.summary).toBe(PROFILE.summary);
    expect(result.profile.offerings).toEqual(["Interiors"]);
    expect(result.suggested).toEqual(["summary"]);
    expect(result.written).not.toContain("summary");
    expect(result.authority.summary.authority).toBe("user_confirmed");
  });

  it("an owner redraft releases whole-profile confirmation but not typed fields", () => {
    const result = mergeBusinessProfileDraft({
      stored: { ...PROFILE, status: "confirmed", updatedAt: 1 },
      authority: { market: { authority: "user_locked" } },
      draft: { ...PROFILE, summary: "Redrafted", market: "Warsaw" },
      incoming: "inferred",
      ownerRequestedRedraft: true,
    });
    expect(result.profile.summary).toBe("Redrafted");
    expect(result.profile.market).toBe("Krakow");
    expect(result.kept).toEqual(["market"]);
  });
});

describe("AI draft writers respect confirmed fields", () => {
  it("a rerun after confirming a field keeps it and returns a suggestion", async () => {
    const t = newBackend();
    const owner = await seedUser(t, { plan: "starter" });
    const projectId = await owner.as.mutation(api.projects.create, { name: "Studio" });
    stubCompletionContent(JSON.stringify(PROFILE));
    await owner.as.action(api.ai.generateBusinessProfile, { projectId });

    await owner.as.mutation(api.projects.confirmProfileFields, { id: projectId, fields: ["summary"] });

    stubCompletionContent(JSON.stringify({ ...PROFILE, summary: "A different AI guess", offerings: ["Interiors"] }));
    const rerun = await owner.as.action(api.ai.generateBusinessProfile, { projectId });
    expect(rerun.stored).toBe(true);
    expect(rerun.suggested).toEqual(["summary"]);
    const project = await t.run((ctx) => ctx.db.get(projectId));
    expect(project?.businessProfile?.summary).toBe(PROFILE.summary);
    expect(project?.businessProfile?.offerings).toEqual(["Interiors"]);
    expect(project?.profileAuthority?.summary.authority).toBe("user_confirmed");
    expect(project?.profileAuthority?.offerings.authority).toBe("inferred");
  });

  it("a field the owner typed survives even an explicit redraft", async () => {
    const t = newBackend();
    const owner = await seedUser(t, { plan: "starter" });
    const projectId = await owner.as.mutation(api.projects.create, { name: "Studio" });
    stubCompletionContent(JSON.stringify(PROFILE));
    await owner.as.action(api.ai.generateBusinessProfile, { projectId });
    await owner.as.mutation(api.projects.saveBusinessProfile, {
      id: projectId,
      profile: { ...PROFILE, summary: "Owner's own words" },
      confirm: true,
    });

    stubCompletionContent(JSON.stringify({ ...PROFILE, summary: "AI rewrite", offerings: ["Interiors"] }));
    const rerun = await owner.as.action(api.ai.generateBusinessProfile, { projectId, replaceConfirmed: true });
    expect(rerun.suggested).toEqual(["summary"]);
    const project = await t.run((ctx) => ctx.db.get(projectId));
    expect(project?.businessProfile?.summary).toBe("Owner's own words");
    expect(project?.businessProfile?.offerings).toEqual(["Interiors"]);
    expect(project?.businessProfile?.status).toBe("ai_draft");
  });

  it("only the owner can confirm fields", async () => {
    const t = newBackend();
    const owner = await seedUser(t, { plan: "starter" });
    const other = await seedUser(t, { plan: "starter" });
    const member = await seedUser(t, { plan: "starter" });
    const projectId = await owner.as.mutation(api.projects.create, { name: "Studio" });
    stubCompletionContent(JSON.stringify(PROFILE));
    await owner.as.action(api.ai.generateBusinessProfile, { projectId });
    const organizationId = await t.run(async (ctx) => (await ctx.db.get(projectId))?.organizationId);
    await t.run(async (ctx) => {
      const at = Date.now();
      await ctx.db.insert("memberships", {
        organizationId: organizationId as Id<"organizations">,
        userId: member.userId as Id<"users">,
        role: "member",
        status: "active",
        createdAt: at,
        updatedAt: at,
      });
    });

    await expect(
      other.as.mutation(api.projects.confirmProfileFields, { id: projectId, fields: ["summary"] }),
    ).rejects.toThrow();
    await expect(
      member.as.mutation(api.projects.confirmProfileFields, { id: projectId, fields: ["summary"] }),
    ).rejects.toThrow(/Only the business owner/);
    await expect(
      owner.as.mutation(api.projects.confirmProfileFields, { id: projectId, fields: ["status"] }),
    ).rejects.toThrow();
    const project = await t.run((ctx) => ctx.db.get(projectId));
    expect(project?.profileAuthority?.summary?.authority).toBe("inferred");
  });
});
