import { internalQuery, internalMutation } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { projectAccessFor } from "./guards";
import { validateDocument, type PageDocument } from "../lib/cms/blocks";

/* ── Build workspace internals (shared by buildChat actions) ──────────────
 *
 * Queries and mutations must live outside "use node" files (Convex only
 * allows actions there). The AI actions in buildChat.ts call these via
 * internal.buildInternals.*.
 */

/* Reads */

export const getBuild = internalQuery({
  args: { id: v.id("builds") },
  handler: async (ctx, { id }) => ctx.db.get(id),
});

export const getProject = internalQuery({
  args: { id: v.id("projects") },
  handler: async (ctx, { id }) => ctx.db.get(id),
});

export const getPageById = internalQuery({
  args: { id: v.id("cmsPages") },
  handler: async (ctx, { id }) => ctx.db.get(id),
});

export const getRevision = internalQuery({
  args: { id: v.id("pageRevisions") },
  handler: async (ctx, { id }) => ctx.db.get(id),
});

export const getSiteByProject = internalQuery({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) =>
    ctx.db
      .query("sites")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .first(),
});

export const getPagesBySite = internalQuery({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) =>
    ctx.db
      .query("cmsPages")
      .withIndex("by_site", (q) => q.eq("siteId", siteId))
      .collect(),
});

export const getPageByPath = internalQuery({
  args: { projectId: v.id("projects"), path: v.string() },
  handler: async (ctx, { projectId, path }) => {
    const site = await ctx.db
      .query("sites")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .first();
    if (!site) return null;
    return ctx.db
      .query("cmsPages")
      .withIndex("by_site_path", (q) =>
        q.eq("siteId", site._id).eq("fullPath", path),
      )
      .first();
  },
});

/** Snapshot of every page's current draft for version history. */
export const collectSnapshot = internalQuery({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const site = await ctx.db
      .query("sites")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .first();
    if (!site) return [];
    const pages = await ctx.db
      .query("cmsPages")
      .withIndex("by_site", (q) => q.eq("siteId", site._id))
      .collect();
    const out: {
      pageId: Id<"cmsPages">;
      title: string;
      slug: string;
      fullPath: string;
      draft: string;
    }[] = [];
    for (const p of pages) {
      const rev = p.latestDraftRevisionId
        ? await ctx.db.get(p.latestDraftRevisionId)
        : null;
      out.push({
        pageId: p._id,
        title: p.title,
        slug: p.slug,
        fullPath: p.fullPath,
        draft: JSON.stringify(
          rev?.document ?? { schemaVersion: 1, blocks: [] },
        ),
      });
    }
    return out;
  },
});

export const listMessagesInternal = internalQuery({
  args: { buildId: v.id("builds") },
  handler: async (ctx, { buildId }) =>
    ctx.db
      .query("buildMessages")
      .withIndex("by_build", (q) => q.eq("buildId", buildId))
      .collect(),
});

/* Writes */

export const insertMessage = internalMutation({
  args: {
    buildId: v.id("builds"),
    projectId: v.id("projects"),
    role: v.union(v.literal("user"), v.literal("assistant")),
    content: v.string(),
    mode: v.optional(v.union(v.literal("plan"), v.literal("build"))),
    suggestions: v.optional(
      v.array(v.object({ name: v.string(), goal: v.optional(v.string()) })),
    ),
    changedPaths: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) =>
    ctx.db.insert("buildMessages", { ...args, createdAt: Date.now() }),
});

export const patchBuild = internalMutation({
  args: {
    id: v.id("builds"),
    status: v.optional(
      v.union(v.literal("draft"), v.literal("generated"), v.literal("published")),
    ),
  },
  handler: async (ctx, { id, status }) => {
    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (status !== undefined) patch.status = status;
    await ctx.db.patch(id, patch);
  },
});

/** Create the site (idempotent) and any planned pages that don't exist yet. */
export const ensureSiteWithPages = internalMutation({
  args: {
    projectId: v.id("projects"),
    projectName: v.string(),
    pages: v.array(
      v.object({
        name: v.string(),
        path: v.string(),
        goal: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, { projectId, projectName, pages }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    if (!(await projectAccessFor(ctx, projectId, userId as Id<"users">))) {
      throw new Error("Not found");
    }

    const norm = (raw: string) =>
      raw
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80);

    let site = await ctx.db
      .query("sites")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .first();
    const now = Date.now();
    if (!site) {
      const siteId = await ctx.db.insert("sites", {
        projectId,
        name: projectName,
        slug: norm(projectName) || "site",
        status: "draft",
        createdBy: userId,
        createdAt: now,
        updatedAt: now,
      });
      site = await ctx.db.get(siteId);
    }
    if (!site) throw new Error("Site creation failed");

    const existing = await ctx.db
      .query("cmsPages")
      .withIndex("by_site", (q) => q.eq("siteId", site._id))
      .collect();

    for (const p of pages) {
      const cleanSlug = p.path === "/" ? "home" : norm(p.path);
      if (!cleanSlug) continue;
      const fullPath = p.path === "/" ? "/" : `/${cleanSlug}`;
      if (existing.some((e) => e.fullPath === fullPath)) continue;

      const pageId = await ctx.db.insert("cmsPages", {
        siteId: site._id,
        projectId,
        title: p.name.trim() || cleanSlug,
        slug: cleanSlug,
        fullPath,
        pageType: p.path === "/" ? "homepage" : "standard",
        status: "draft",
        createdBy: userId,
        createdAt: now,
        updatedAt: now,
      });
      const revId = await ctx.db.insert("pageRevisions", {
        pageId,
        projectId,
        version: 1,
        state: "draft",
        document: { schemaVersion: 1, blocks: [] },
        createdBy: userId,
        createdAt: now,
      });
      await ctx.db.patch(pageId, { latestDraftRevisionId: revId });
      if (p.path === "/" && !site.homepageId) {
        await ctx.db.patch(site._id, { homepageId: pageId });
      }
    }
    return site._id;
  },
});

/** Write a draft document into a page (patch live draft or create new one). */
export const saveDraftInternal = internalMutation({
  args: {
    pageId: v.id("cmsPages"),
    document: v.object({
      schemaVersion: v.number(),
      blocks: v.array(
        v.object({
          id: v.string(),
          type: v.string(),
          version: v.number(),
          props: v.any(),
        }),
      ),
    }),
  },
  handler: async (ctx, { pageId, document }) => {
    const errors = validateDocument(document);
    if (errors.length) throw new Error(errors[0]);
    const page = await ctx.db.get(pageId);
    if (!page) throw new Error("Page not found");

    const currentDraft = page.latestDraftRevisionId
      ? await ctx.db.get(page.latestDraftRevisionId)
      : null;
    if (currentDraft && currentDraft.state === "draft") {
      await ctx.db.patch(currentDraft._id, { document, createdAt: Date.now() });
    } else {
      const revs = await ctx.db
        .query("pageRevisions")
        .withIndex("by_page", (q) => q.eq("pageId", pageId))
        .collect();
      const nextRev = revs.reduce((m, r) => Math.max(m, r.version), 0) + 1;
      const revId = await ctx.db.insert("pageRevisions", {
        pageId,
        projectId: page.projectId,
        version: nextRev,
        state: "draft",
        document: document as PageDocument,
        createdBy: page.createdBy,
        createdAt: Date.now(),
      });
      await ctx.db.patch(pageId, { latestDraftRevisionId: revId });
    }
    await ctx.db.patch(pageId, { updatedAt: Date.now() });
  },
});

/** Snapshot the whole site as one build version; returns the version number. */
export const applyEditWithSnapshot = internalMutation({
  args: {
    projectId: v.id("projects"),
    buildId: v.id("builds"),
    versionLabel: v.string(),
    snapshotPages: v.array(
      v.object({
        pageId: v.id("cmsPages"),
        title: v.string(),
        slug: v.string(),
        fullPath: v.string(),
        draft: v.string(),
      }),
    ),
  },
  handler: async (ctx, { projectId, buildId, versionLabel, snapshotPages }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    if (!(await projectAccessFor(ctx, projectId, userId as Id<"users">))) {
      throw new Error("Not found");
    }

    // Version the build the caller is working in, not whichever build of the
    // project happens to come first.
    const build = await ctx.db.get(buildId);
    if (!build || build.projectId !== projectId) throw new Error("Build not found");

    const existing = await ctx.db
      .query("buildVersions")
      .withIndex("by_build", (q) => q.eq("buildId", build._id))
      .collect();
    const nextVersion = existing.reduce((m, ver) => Math.max(m, ver.version), 0) + 1;
    await ctx.db.insert("buildVersions", {
      buildId: build._id,
      projectId,
      version: nextVersion,
      label: versionLabel.slice(0, 80) || `Version ${nextVersion}`,
      pages: snapshotPages,
      createdAt: Date.now(),
    });
    return nextVersion;
  },
});
