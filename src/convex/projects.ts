import { internalQuery, mutation } from "./_generated/server";
import { anyApi } from "convex/server";
import { v } from "convex/values";
import { orgMutation, orgQuery, requireUser } from "./guards";
import type { Doc } from "./_generated/dataModel";
import { getOrCreatePersonalOrganization } from "./organizations";

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
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
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

export const saveScan = orgMutation({
  args: {
    id: v.id("projects"),
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
  },
  handler: async (ctx, { id, ...scan }, access) => {
    const { project } = await access.requireProject(id);

    // Auto-populate description from the best evidence we got.
    const description =
      scan.metaDescription ??
      project.description ??
      (scan.titles?.length ? scan.titles[0] : undefined);

    // Products/services from scan (or GMB category) enrich the project.
    const mergedProducts = [
      ...new Set([...(project.productsServices ?? []), ...(scan.productsServices ?? [])]),
    ];
    const industry =
      project.industry ?? scan.gmb?.category ?? undefined;

    await ctx.db.patch(id, {
      websiteScan: { ...scan, scannedAt: Date.now() },
      description,
      productsServices: mergedProducts.length ? mergedProducts : undefined,
      industry,
      // If GMB found a website and none was provided, backfill it.
      websiteUrl: project.websiteUrl ?? scan.gmb?.website ?? undefined,
    });
  },
});

export const update = orgMutation({
  args: {
    id: v.id("projects"),
    name: v.optional(v.string()),
    businessName: v.optional(v.string()),
    description: v.optional(v.string()),
    websiteUrl: v.optional(v.string()),
    industry: v.optional(v.string()),
    competitors: v.optional(v.array(v.string())),
    goals: v.optional(v.array(v.string())),
    kpis: v.optional(v.array(v.string())),
    channels: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { id, ...patch }, access) => {
    await access.requireProject(id);
    const clean = Object.fromEntries(
      Object.entries(patch).filter(([, v]) => v !== undefined),
    );
    if (Object.keys(clean).length) await ctx.db.patch(id, clean);
  },
});

/**
 * Everything in the project, serialized — used by the Overview "download
 * pack" to produce one markdown file with all important details, personas,
 * content, communications and attached-file excerpts.
 */
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
    const { userId } = await access.requireProject(id);
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
