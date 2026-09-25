import { internalMutation, internalQuery, mutation } from "./_generated/server";
import { anyApi } from "convex/server";
import { v } from "convex/values";
import { orgMutation, orgQuery, projectAccessFor, requireUser } from "./guards";
import { brandProfileFields, businessProfileFields } from "./schema";
import { boundBrandProfile, brandProfileProblems, describeVoice } from "./lib/brandProfile";
import type { Doc } from "./_generated/dataModel";
import { getOrCreatePersonalOrganization } from "./organizations";
import { businessTypeValidator, primaryGoalValidator } from "../shared/starterKit";

const privacyInternal = anyApi.modules.privacy;

/**
 * The projects the caller may open: every project owned by one of their active
 * organizations (T2.2 — tenancy is the organization, not the creator), plus any
 * legacy row that predates the T2.1 organization backfill and is therefore
 * still keyed on its owner. Returns [] for a signed-out or anonymous caller, so
 * a foreign-organization caller sees nothing.
 */
export const list = orgQuery({
  args: {},
  handler: async (ctx, _args, access) => {
    if (!access.userId) return [];
    const byId = new Map<string, Doc<"projects">>();
    for (const organizationId of access.organizationIds) {
      const rows = await ctx.db
        .query("projects")
        .withIndex("by_organization", (q) =>
          q.eq("organizationId", organizationId),
        )
        .collect();
      for (const row of rows) byId.set(row._id, row);
    }
    const legacyOwned = await ctx.db
      .query("projects")
      .withIndex("by_owner", (q) => q.eq("ownerId", access.userId!))
      .collect();
    for (const row of legacyOwned) byId.set(row._id, row);
    return [...byId.values()];
  },
});

export const get = orgQuery({
  args: { id: v.id("projects") },
  handler: async (ctx, { id }, access) => {
    const scope = await access.ownedProject(id);
    return scope?.project ?? null;
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    businessName: v.optional(v.string()),
    description: v.optional(v.string()),
    websiteUrl: v.optional(v.string()),
    industry: v.optional(v.string()),
    competitors: v.optional(v.array(v.string())),
    competitorEntries: v.optional(
      v.array(
        v.object({
          type: v.union(v.literal("website"), v.literal("gmb")),
          value: v.string(),
        }),
      ),
    ),
    googleBusinessName: v.optional(v.string()),
    productsServices: v.optional(v.array(v.string())),
    goals: v.optional(v.array(v.string())),
    kpis: v.optional(v.array(v.string())),
    channels: v.optional(v.array(v.string())),
    targetAudience: v.optional(v.array(v.string())),
    customerPains: v.optional(v.array(v.string())),
    marketingChallenges: v.optional(v.array(v.string())),
    serviceArea: v.optional(v.string()),
    // First-run answers (U2, first-run blueprint §2): Q1 and Q3.
    businessType: v.optional(businessTypeValidator),
    primaryGoal: v.optional(primaryGoalValidator),
  },
  handler: async (ctx, rawArgs) => {
    const userId = await requireUser(ctx);
    const args = boundProjectFields(rawArgs);
    if (!args.name) throw new Error("Give the project a name.");
    // Every new project lands in the owner's personal organization (T2.1).
    // Idempotent, so a user who already has a personal workspace reuses it.
    const organizationId = await getOrCreatePersonalOrganization(ctx, userId);
    return await ctx.db.insert("projects", {
      ...args,
      ownerId: userId,
      organizationId,
      createdAt: Date.now(),
    });
  },
});

/**
 * Called after the wizard's scan step finishes — stores scrape + SerpApi
 * findings on the project so every module can reuse the enriched context.
 */
/** Platform-wide project count for the admin panel (T2.4). Internal on
 *  purpose: the projects table is only read here and in the data-access layer,
 *  so the admin module never touches it directly. */
export const platformCount = internalQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const take = Math.min(Math.max(limit ?? 5000, 1), 10_000);
    const rows = await ctx.db.query("projects").take(take);
    return { count: rows.length, capped: rows.length === take };
  },
});

const scanFields = {
    status: v.union(
      v.literal("pending"),
      v.literal("scraped"),
      v.literal("partial"),
      v.literal("failed"),
    ),
    sitemapUrls: v.optional(v.array(v.string())),
    titles: v.optional(v.array(v.string())),
    metaDescription: v.optional(v.string()),
    headings: v.optional(v.array(v.string())),
    productsServices: v.optional(v.array(v.string())),
    pages: v.optional(v.array(v.object({
      url: v.string(),
      title: v.optional(v.string()),
      description: v.optional(v.string()),
      headings: v.array(v.string()),
      productsServices: v.array(v.string()),
      excerpt: v.string(),
    }))),
    socialChannels: v.optional(v.array(v.string())),
    businessDetails: v.optional(v.object({
      name: v.optional(v.string()),
      address: v.optional(v.string()),
      country: v.optional(v.string()),
      phone: v.optional(v.string()),
      email: v.optional(v.string()),
      footerExcerpt: v.optional(v.string()),
    })),
    coverage: v.optional(v.object({
      sitemapCount: v.number(),
      sitemapFailureCount: v.number(),
      discoveredPageCount: v.number(),
      scannedPageCount: v.number(),
      failedPageCount: v.number(),
      skippedByRobotsCount: v.number(),
      pageLimit: v.number(),
      truncated: v.boolean(),
    })),
    gmb: v.optional(
      v.object({
        title: v.optional(v.string()),
        address: v.optional(v.string()),
        phone: v.optional(v.string()),
        website: v.optional(v.string()),
        rating: v.optional(v.number()),
        reviews: v.optional(v.number()),
        category: v.optional(v.string()),
        openHours: v.optional(v.string()),
      }),
    ),
};

export const saveScan = orgMutation({
  args: { id: v.id("projects"), ...scanFields },
  handler: async (ctx, { id, ...scan }, access) => {
    const { project } = await access.requireProject(id);
    await ctx.db.patch(id, scanPatch(project, scan));
  },
});

/** Server-side scan writer (scraping.rescanProjectWebsite). Keeps the last
 *  Google Business result, which a website re-scan does not refresh. */
export const storeServerScan = internalMutation({
  args: {
    projectId: v.id("projects"),
    userId: v.id("users"),
    scan: v.object(scanFields),
  },
  handler: async (ctx, { projectId, userId, scan }) => {
    if (!(await projectAccessFor(ctx, projectId, userId))) throw new Error("Not found");
    const project = await ctx.db.get(projectId);
    if (!project) throw new Error("Not found");
    await ctx.db.patch(projectId, scanPatch(project, { ...scan, gmb: scan.gmb ?? project.websiteScan?.gmb }));
  },
});

type ScanInput = Omit<NonNullable<Doc<"projects">["websiteScan"]>, "scannedAt">;

function scanPatch(project: Doc<"projects">, scan: ScanInput) {
  // The owner's own words win; the scan only fills an empty description.
  const description =
    project.description ??
    scan.metaDescription ??
    (scan.titles?.length ? scan.titles[0] : undefined);

  // Products/services from scan (or GMB category) enrich the project.
  const mergedProducts = [
    ...new Set([...(project.productsServices ?? []), ...(scan.productsServices ?? [])]),
  ];
  const industry = project.industry ?? scan.gmb?.category ?? undefined;

  return {
    websiteScan: { ...scan, scannedAt: Date.now() },
    description,
    productsServices: mergedProducts.length ? mergedProducts.slice(0, 40) : undefined,
    industry,
    // If GMB found a website and none was provided, backfill it.
    websiteUrl: project.websiteUrl ?? scan.gmb?.website ?? undefined,
  };
}

export const update = orgMutation({
  args: {
    id: v.id("projects"),
    name: v.optional(v.string()),
    businessName: v.optional(v.string()),
    description: v.optional(v.string()),
    websiteUrl: v.optional(v.string()),
    industry: v.optional(v.string()),
    competitors: v.optional(v.array(v.string())),
    competitorEntries: v.optional(
      v.array(
        v.object({
          type: v.union(v.literal("website"), v.literal("gmb")),
          value: v.string(),
        }),
      ),
    ),
    googleBusinessName: v.optional(v.string()),
    productsServices: v.optional(v.array(v.string())),
    goals: v.optional(v.array(v.string())),
    kpis: v.optional(v.array(v.string())),
    channels: v.optional(v.array(v.string())),
    targetAudience: v.optional(v.array(v.string())),
    customerPains: v.optional(v.array(v.string())),
    marketingChallenges: v.optional(v.array(v.string())),
    serviceArea: v.optional(v.string()),
  },
  handler: async (ctx, { id, ...patch }, access) => {
    await access.requireProject(id);
    const bounded = boundProjectFields(patch);
    if (patch.name !== undefined && !bounded.name) throw new Error("The project name can't be empty.");
    // An explicitly cleared optional text field ("") is removed, not stored.
    const clean: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(bounded)) {
      if (patch[key as keyof typeof patch] === undefined) continue;
      clean[key] = value === "" ? undefined : value;
    }
    if (Object.keys(clean).length) await ctx.db.patch(id, clean);
  },
});

/** Choose the project's AI model from the operator's enabled list, or clear
 *  the choice (null) to follow the platform default. */
export const setAiModel = orgMutation({
  args: { id: v.id("projects"), modelId: v.union(v.string(), v.null()) },
  handler: async (ctx, { id, modelId }, access) => {
    await access.requireProject(id);
    if (modelId === null) {
      await ctx.db.patch(id, { aiModelId: undefined });
      return;
    }
    const row = await ctx.db
      .query("aiModels")
      .withIndex("by_model", (q) => q.eq("modelId", modelId))
      .unique();
    if (!row?.enabled) throw new Error("That AI model isn't available. Pick one from the list.");
    await ctx.db.patch(id, { aiModelId: modelId });
  },
});

/* ── Business understanding (lib/businessProfile.ts) ─────────────────── */

const businessProfileArgs = v.object(businessProfileFields);

/** Server-only writer for the AI draft (called by ai.generateBusinessProfile
 *  after the caller's access was verified; re-verified here). A profile the
 *  owner already confirmed is never overwritten by a new AI draft unless
 *  `replaceConfirmed` is set by an explicit owner request. */
export const storeBusinessProfileDraft = internalMutation({
  args: {
    projectId: v.id("projects"),
    userId: v.id("users"),
    profile: businessProfileArgs,
    replaceConfirmed: v.optional(v.boolean()),
  },
  handler: async (ctx, { projectId, userId, profile, replaceConfirmed }) => {
    if (!(await projectAccessFor(ctx, projectId, userId))) throw new Error("Not found");
    const project = await ctx.db.get(projectId);
    if (!project) throw new Error("Not found");
    if (project.businessProfile?.status === "confirmed" && !replaceConfirmed) {
      return { stored: false as const };
    }
    await ctx.db.patch(projectId, {
      businessProfile: {
        ...boundBusinessProfile(profile),
        status: "ai_draft",
        updatedAt: Date.now(),
      },
    });
    return { stored: true as const };
  },
});

/** The owner edits and confirms the business understanding. */
export const saveBusinessProfile = orgMutation({
  args: {
    id: v.id("projects"),
    profile: businessProfileArgs,
    confirm: v.boolean(),
  },
  handler: async (ctx, { id, profile, confirm }, access) => {
    const { project } = await access.requireProject(id);
    const bounded = boundBusinessProfile(profile);
    if (!bounded.summary || !bounded.offerings.length || !bounded.customerSegments.length) {
      throw new Error("Add a short summary, at least one offering and at least one customer group.");
    }
    const now = Date.now();
    await ctx.db.patch(id, {
      businessProfile: {
        ...bounded,
        status: confirm ? "confirmed" : project.businessProfile?.status ?? "ai_draft",
        updatedAt: now,
        confirmedAt: confirm ? now : project.businessProfile?.confirmedAt,
      },
    });
  },
});

const brandProfileArgs = v.object(brandProfileFields);

/** Server-only writer for the AI brand draft (ai.generateBrandProfile, after
 *  the caller's access was verified; re-verified here). A kit the owner has
 *  confirmed is only replaced on an explicit owner request. */
export const storeBrandProfileDraft = internalMutation({
  args: {
    projectId: v.id("projects"),
    userId: v.id("users"),
    profile: brandProfileArgs,
    replaceConfirmed: v.optional(v.boolean()),
  },
  handler: async (ctx, { projectId, userId, profile, replaceConfirmed }) => {
    if (!(await projectAccessFor(ctx, projectId, userId))) throw new Error("Not found");
    const project = await ctx.db.get(projectId);
    if (!project) throw new Error("Not found");
    if (project.brandProfile?.status === "confirmed" && !replaceConfirmed) {
      return { stored: false as const };
    }
    await ctx.db.patch(projectId, {
      brandProfile: { ...boundBrandProfile(profile), status: "ai_draft", updatedAt: Date.now() },
    });
    return { stored: true as const };
  },
});

/** The stored brand kit for an already-authorized action (brand voice
 *  check). Access is re-verified; absent or foreign projects read as null. */
export const brandProfileForAction = internalQuery({
  args: { projectId: v.id("projects"), userId: v.id("users") },
  handler: async (ctx, { projectId, userId }) => {
    if (!(await projectAccessFor(ctx, projectId, userId))) return null;
    const project = await ctx.db.get(projectId);
    return project ? { brandProfile: project.brandProfile ?? null } : null;
  },
});

/** The owner chooses which areas of MOSAI use the brand (Brand tab switches).
 *  Stored apart from the kit so an AI redraft never resets it. */
export const setBrandUse = orgMutation({
  args: {
    id: v.id("projects"),
    use: v.union(
      v.literal("content"),
      v.literal("social"),
      v.literal("website"),
      v.literal("shop"),
      v.literal("research"),
    ),
    enabled: v.boolean(),
  },
  handler: async (ctx, { id, use, enabled }, access) => {
    const { project } = await access.requireProject(id);
    await ctx.db.patch(id, { brandUse: { ...project.brandUse, [use]: enabled } });
  },
});

/** The owner edits and (optionally) confirms the brand kit. */
export const saveBrandProfile = orgMutation({
  args: {
    id: v.id("projects"),
    profile: brandProfileArgs,
    confirm: v.boolean(),
  },
  handler: async (ctx, { id, profile, confirm }, access) => {
    const { project } = await access.requireProject(id);
    const bounded = boundBrandProfile(profile);
    const problems = brandProfileProblems(bounded);
    if (confirm && problems.length) throw new Error(problems.join(" "));
    const now = Date.now();
    await ctx.db.patch(id, {
      brandProfile: {
        ...bounded,
        status: confirm ? "confirmed" : project.brandProfile?.status ?? "ai_draft",
        updatedAt: now,
        confirmedAt: confirm ? now : project.brandProfile?.confirmedAt,
      },
    });
  },
});

type ProjectFieldInput = {
  name?: string;
  businessName?: string;
  description?: string;
  websiteUrl?: string;
  industry?: string;
  competitors?: string[];
  competitorEntries?: Array<{ type: "website" | "gmb"; value: string }>;
  googleBusinessName?: string;
  productsServices?: string[];
  goals?: string[];
  kpis?: string[];
  channels?: string[];
  targetAudience?: string[];
  customerPains?: string[];
  marketingChallenges?: string[];
  serviceArea?: string;
};

function text(value: string | undefined, max: number): string | undefined {
  return value === undefined ? undefined : value.replace(/\s+/g, " ").trim().slice(0, max);
}

function items(values: string[] | undefined, maxItems = 20, maxLength = 160): string[] | undefined {
  if (values === undefined) return undefined;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const clean = value.replace(/\s+/g, " ").trim().slice(0, maxLength);
    if (!clean || seen.has(clean.toLowerCase())) continue;
    seen.add(clean.toLowerCase());
    out.push(clean);
    if (out.length >= maxItems) break;
  }
  return out;
}

/** Length/count bounds for owner-entered project fields (they feed every AI
 *  prompt, so unbounded input would crowd out the real evidence). */
function boundProjectFields<T extends ProjectFieldInput>(input: T): T {
  return {
    ...input,
    name: text(input.name, 120),
    businessName: text(input.businessName, 160),
    description: text(input.description, 2_000),
    websiteUrl: text(input.websiteUrl, 500),
    industry: text(input.industry, 120),
    googleBusinessName: text(input.googleBusinessName, 200),
    serviceArea: text(input.serviceArea, 200),
    competitors: items(input.competitors),
    competitorEntries: input.competitorEntries
      ?.map((entry) => ({ type: entry.type, value: entry.value.trim().slice(0, 500) }))
      .filter((entry) => entry.value)
      .slice(0, 20),
    productsServices: items(input.productsServices, 40),
    goals: items(input.goals),
    kpis: items(input.kpis),
    channels: items(input.channels),
    targetAudience: items(input.targetAudience, 12),
    customerPains: items(input.customerPains, 12),
    marketingChallenges: items(input.marketingChallenges, 12),
  };
}

function boundBusinessProfile(profile: {
  summary: string;
  businessModel: NonNullable<Doc<"projects">["businessProfile"]>["businessModel"];
  offerings: string[];
  customerSegments: string[];
  notTheAudience: string[];
  customerProblems: string[];
  primaryGoals: string[];
  market?: string;
  differentiators: string[];
  contentThemes: string[];
}) {
  return {
    summary: text(profile.summary, 600) ?? "",
    businessModel: profile.businessModel,
    offerings: items(profile.offerings, 8) ?? [],
    customerSegments: items(profile.customerSegments, 8) ?? [],
    notTheAudience: items(profile.notTheAudience, 8) ?? [],
    customerProblems: items(profile.customerProblems, 8) ?? [],
    primaryGoals: items(profile.primaryGoals, 8) ?? [],
    market: text(profile.market, 120) || undefined,
    differentiators: items(profile.differentiators, 6) ?? [],
    contentThemes: items(profile.contentThemes, 8) ?? [],
  };
}

export const exportPack = orgQuery({
  args: { id: v.id("projects") },
  handler: async (ctx, { id }, access) => {
    const scope = await access.ownedProject(id);
    if (!scope) return null;
    const project = scope.project;

    const [personas, content, comms, files] = await Promise.all([
      ctx.db.query("personas").withIndex("by_project", (q) => q.eq("projectId", id)).collect(),
      ctx.db.query("contentPieces").withIndex("by_project", (q) => q.eq("projectId", id)).collect(),
      ctx.db.query("communications").withIndex("by_project", (q) => q.eq("projectId", id)).collect(),
      ctx.db.query("projectFiles").withIndex("by_project", (q) => q.eq("projectId", id)).collect(),
    ]);

    const md: string[] = [];
    md.push(`# ${project.name}`);
    md.push(`_Exported from MOSAI — ${new Date().toISOString().slice(0, 10)}_\n`);
    if (project.businessName) md.push(`**Business:** ${project.businessName}`);
    if (project.industry) md.push(`**Industry:** ${project.industry}`);
    if (project.websiteUrl) md.push(`**Website:** ${project.websiteUrl}`);
    if (project.googleBusinessName)
      md.push(`**Google Business:** ${project.googleBusinessName}`);
    if (project.description) md.push(`\n${project.description}`);
    if (project.productsServices?.length)
      md.push(`\n## Products / services\n${project.productsServices.map((p) => `- ${p}`).join("\n")}`);
    if (project.goals?.length)
      md.push(`\n## Goals\n${project.goals.map((g) => `- ${g}`).join("\n")}`);
    if (project.competitors?.length)
      md.push(`\n## Competitors\n${project.competitors.map((c) => `- ${c}`).join("\n")}`);
    if (project.websiteScan) {
      const scan = project.websiteScan;
      md.push(`\n## Website scan · ${scan.status}`);
      if (scan.businessDetails?.address) md.push(`**Address candidate:** ${scan.businessDetails.address}`);
      if (scan.businessDetails?.country) md.push(`**Country candidate:** ${scan.businessDetails.country}`);
      if (scan.socialChannels?.length) md.push(`**Social profile links:** ${scan.socialChannels.join(", ")}`);
      if (scan.coverage) md.push(`**Coverage:** ${scan.coverage.scannedPageCount} pages scanned of ${scan.coverage.discoveredPageCount} discovered; ${scan.coverage.truncated ? "first-pass limit reached" : "no discovered page left in this pass"}.`);
      for (const page of scan.pages ?? []) {
        md.push(`\n### ${page.title ?? page.url}\n${page.url}`);
        if (page.description) md.push(page.description);
        if (page.excerpt) md.push(page.excerpt);
      }
    }

    const brand = project.brandProfile;
    if (brand) {
      md.push(`\n## Brand kit · ${brand.status === "confirmed" ? "confirmed" : "AI draft"}`);
      if (brand.positioning) md.push(`**Positioning:** ${brand.positioning}`);
      if (brand.promise) md.push(`**Brand promise:** ${brand.promise}`);
      if (brand.tagline) md.push(`**Tagline:** ${brand.tagline}`);
      if (brand.elevatorPitch) md.push(`\n${brand.elevatorPitch}`);
      for (const pillar of brand.pillars) {
        md.push(`\n### ${pillar.title}\n${pillar.message}`);
        if (pillar.proofPoints.length) md.push(pillar.proofPoints.map((point) => `- ${point}`).join("\n"));
      }
      md.push(`\n### Voice\n${describeVoice(brand.voice)}`);
      if (brand.personality.length) md.push(`**Personality:** ${brand.personality.join(", ")}`);
      if (brand.writeLike.length) md.push(`**Write like this:** ${brand.writeLike.join("; ")}`);
      if (brand.neverLike.length) md.push(`**Never like this:** ${brand.neverLike.join("; ")}`);
      if (brand.preferredWords.length) md.push(`**Preferred words:** ${brand.preferredWords.join(", ")}`);
      if (brand.avoidWords.length) md.push(`**Words to avoid:** ${brand.avoidWords.join(", ")}`);
      const colors = Object.entries(brand.colors).filter(([, hex]) => hex);
      if (colors.length || brand.headingFont || brand.bodyFont) {
        md.push(`\n### Visual identity`);
        if (colors.length) md.push(colors.map(([role, hex]) => `- ${role}: ${hex}`).join("\n"));
        if (brand.headingFont) md.push(`**Heading font:** ${brand.headingFont}`);
        if (brand.bodyFont) md.push(`**Body font:** ${brand.bodyFont}`);
        if (brand.imageryStyle.length) md.push(`**Imagery:** ${brand.imageryStyle.join("; ")}`);
      }
    }

    if (personas.length) {
      md.push(`\n## Personas`);
      for (const p of personas) {
        md.push(`\n### ${p.name}${p.role ? ` — ${p.role}` : ""}`);
        if (p.goals?.length) md.push(`**Goals:** ${p.goals.join(", ")}`);
        if (p.pains?.length) md.push(`**Pains:** ${p.pains.join(", ")}`);
        if (p.objections?.length) md.push(`**Objections:** ${p.objections.join(", ")}`);
        if (p.channels?.length) md.push(`**Channels:** ${p.channels.join(", ")}`);
        if (p.evidence) md.push(`_Evidence: ${p.evidence}_`);
      }
    }

    if (comms.length) {
      md.push(`\n## Marketing communications`);
      for (const c of comms) {
        md.push(`\n### ${c.name} (${c.status})`);
        md.push(`> ${c.message}`);
        if (c.audience) md.push(`**Audience:** ${c.audience}`);
        if (c.proofPoints?.length) md.push(`**Proof:** ${c.proofPoints.join("; ")}`);
        if (c.callToAction) md.push(`**Call to action:** ${c.callToAction}`);
        if (c.channels?.length) md.push(`**Channels:** ${c.channels.join(", ")}`);
        if (c.rationale) md.push(`\n${c.rationale}`);
      }
    }

    if (content.length) {
      md.push(`\n## Content`);
      for (const piece of content) {
        md.push(`\n### ${piece.title} — ${piece.status}${piece.surface ? ` · ${piece.surface}` : ""}`);
        if (piece.topic) md.push(`Topic: ${piece.topic}`);
        if (piece.body) md.push(`\n${piece.body.slice(0, 4000)}`);
      }
    }

    if (files.length) {
      md.push(`\n## Attached files`);
      for (const f of files) {
        md.push(`- **${f.name}**${f.excerpt ? ` — ${f.excerpt.slice(0, 200)}` : ""}`);
      }
    }

    return { project, personas, content, comms, files, markdown: md.join("\n") };
  },
});

export const remove = orgMutation({
  args: { id: v.id("projects") },
  handler: async (ctx, { id }, access) => {
    const { userId, project } = await access.requireProject(id);
    if (project.ownerId !== userId) {
      throw new Error("Only the project owner can delete this project");
    }
    const idempotencyKey = `project-deletion:${id}`;
    const existing = await ctx.db.query("privacyJobs")
      .withIndex("by_idempotency", (q) => q.eq("idempotencyKey", idempotencyKey))
      .first();
    if (existing && ["queued", "running"].includes(existing.status)) {
      return { jobId: existing._id, status: existing.status };
    }
    const jobId = await ctx.db.insert("privacyJobs", {
      kind: "project_deletion", userId, status: "queued", idempotencyKey,
      requestedAt: Date.now(), cursor: JSON.stringify({ projectId: id, cascade: null }),
      completedCount: 0, lastServedAt: Date.now(), createdAt: Date.now(), updatedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, privacyInternal.deletionJobs.processProjectDeletion, { jobId });
    return { jobId, status: "queued" as const };
  },
});
