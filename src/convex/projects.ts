import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireUser } from "./guards";
import { cascadeDeleteProject } from "./dal";

export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    return await ctx.db
      .query("projects")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();
  },
});

export const get = query({
  args: { id: v.id("projects") },
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const project = await ctx.db.get(id);
    if (!project || project.ownerId !== userId) return null;
    return project;
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
    return await ctx.db.insert("projects", {
      ...args,
      ownerId: userId,
      createdAt: Date.now(),
    });
  },
});

/**
 * Called after the wizard's scan step finishes — stores scrape + SerpApi
 * findings on the project so every module can reuse the enriched context.
 */
export const saveScan = mutation({
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
  handler: async (ctx, { id, ...scan }) => {
    const userId = await requireUser(ctx);
    const project = await ctx.db.get(id);
    if (!project || project.ownerId !== userId) throw new Error("Not found");

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

export const update = mutation({
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
  handler: async (ctx, { id, ...patch }) => {
    const userId = await requireUser(ctx);
    const project = await ctx.db.get(id);
    if (!project || project.ownerId !== userId) throw new Error("Not found");
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
export const exportPack = query({
  args: { id: v.id("projects") },
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const project = await ctx.db.get(id);
    if (!project || project.ownerId !== userId) return null;

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

export const remove = mutation({
  args: { id: v.id("projects") },
  handler: async (ctx, { id }) => {
    const userId = await requireUser(ctx);
    const project = await ctx.db.get(id);
    if (!project || project.ownerId !== userId) throw new Error("Not found");
    // One shared cascade (dal.ts) — never maintain a second table list here.
    await cascadeDeleteProject(ctx, id);
  },
});
