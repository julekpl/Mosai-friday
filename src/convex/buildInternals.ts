import {
  internalQuery,
  internalMutation,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { projectAccessFor } from "./guards";
import {
  sanitizeDocument,
  validateDocument,
  type PageDocument,
} from "../lib/cms/blocks";
import {
  normalizeSitePath,
  normalizeSlugSegment,
  parentSitePath,
  slugForSitePath,
} from "./lib/sitePaths";

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

/** The page at `path` on the project's own site (null when absent). */
export const getPageByPath = internalQuery({
  args: { projectId: v.id("projects"), path: v.string() },
  handler: async (ctx, { projectId, path }) => {
    const site = await ctx.db
      .query("sites")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .first();
    if (!site) return null;
    const page = await ctx.db
      .query("cmsPages")
      .withIndex("by_site_path", (q) =>
        q.eq("siteId", site._id).eq("fullPath", path),
      )
      .first();
    return page && page.projectId === projectId ? page : null;
  },
});

type SnapshotPage = {
  pageId: Id<"cmsPages">;
  title: string;
  slug: string;
  fullPath: string;
  draft: string;
};

/** Every page's current draft on the project's site, as version rows. */
async function snapshotPagesFor(
  ctx: QueryCtx,
  projectId: Id<"projects">,
): Promise<SnapshotPage[]> {
  const site = await ctx.db
    .query("sites")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .first();
  if (!site) return [];
  const pages = await ctx.db
    .query("cmsPages")
    .withIndex("by_site", (q) => q.eq("siteId", site._id))
    .collect();
  const out: SnapshotPage[] = [];
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
}

function sameSnapshot(a: SnapshotPage[], b: SnapshotPage[]): boolean {
  if (a.length !== b.length) return false;
  const key = (p: SnapshotPage) =>
    JSON.stringify([p.pageId, p.fullPath, p.title, p.slug, p.draft]);
  const left = a.map(key).sort();
  const right = b.map(key).sort();
  return left.every((value, index) => value === right[index]);
}

/** Snapshot of every page's current draft for version history. */
export const collectSnapshot = internalQuery({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => snapshotPagesFor(ctx, projectId),
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

/**
 * Create the site (idempotent) and any planned pages that don't exist yet.
 * Paths go through the one shared normalizer (`lib/sitePaths.ts`), so the
 * path the generator writes to is exactly the path created here; nested
 * paths keep their `/`. Returns the resolved `{ path → pageId }` map so the
 * caller never has to re-derive a path to find the page it planned.
 */
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

    let site = await ctx.db
      .query("sites")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .first();
    const now = Date.now();
    if (!site) {
      const siteId = await ctx.db.insert("sites", {
        projectId,
        name: projectName,
        slug: normalizeSlugSegment(projectName) || "site",
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
    const byPath = new Map<string, Id<"cmsPages">>(
      existing.map((page) => [page.fullPath, page._id]),
    );

    // Parents before children, so a nested page can link to its parent.
    const planned = pages
      .map((p) => ({ ...p, fullPath: normalizeSitePath(p.path, p.name) }))
      .sort(
        (a, b) =>
          a.fullPath.split("/").length - b.fullPath.split("/").length,
      );

    const resolved: { path: string; pageId: Id<"cmsPages"> }[] = [];
    for (const p of planned) {
      const fullPath = p.fullPath;
      const found = byPath.get(fullPath);
      if (found) {
        resolved.push({ path: fullPath, pageId: found });
        continue;
      }
      const slug = slugForSitePath(fullPath);
      const parentPath = parentSitePath(fullPath);
      const parentId =
        parentPath && parentPath !== "/" ? byPath.get(parentPath) : undefined;

      const pageId = await ctx.db.insert("cmsPages", {
        siteId: site._id,
        projectId,
        title: p.name.trim() || slug,
        slug,
        fullPath,
        ...(parentId ? { parentId } : {}),
        pageType: fullPath === "/" ? "homepage" : "standard",
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
      if (fullPath === "/" && !site.homepageId) {
        await ctx.db.patch(site._id, { homepageId: pageId });
      }
      byPath.set(fullPath, pageId);
      resolved.push({ path: fullPath, pageId });
    }
    return { siteId: site._id, pages: resolved };
  },
});

/**
 * Write an AI-authored draft document into a page (patch the current draft
 * or create a new one). Rich text is sanitized on save with the same
 * allow-list `cms.saveDraft` uses (T0.7): AI HTML never reaches the database
 * unsanitized. Callers take a checkpoint (`checkpointBeforeAiWrite`) first.
 */
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
  handler: async (ctx, { pageId, document: input }) => {
    const document = sanitizeDocument(input as PageDocument);
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
        document,
        createdBy: page.createdBy,
        createdAt: Date.now(),
      });
      await ctx.db.patch(pageId, { latestDraftRevisionId: revId });
    }
    await ctx.db.patch(pageId, { updatedAt: Date.now() });
  },
});

async function insertVersion(
  ctx: MutationCtx,
  args: {
    projectId: Id<"projects">;
    buildId: Id<"builds">;
    label: string;
    pages: SnapshotPage[];
  },
): Promise<number> {
  const existing = await ctx.db
    .query("buildVersions")
    .withIndex("by_build", (q) => q.eq("buildId", args.buildId))
    .collect();
  const nextVersion = existing.reduce((m, ver) => Math.max(m, ver.version), 0) + 1;
  await ctx.db.insert("buildVersions", {
    buildId: args.buildId,
    projectId: args.projectId,
    version: nextVersion,
    label: args.label.slice(0, 80) || `Version ${nextVersion}`,
    pages: args.pages,
    createdAt: Date.now(),
  });
  return nextVersion;
}

async function authorizeBuildWrite(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  buildId: Id<"builds">,
) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Not authenticated");
  if (!(await projectAccessFor(ctx, projectId, userId as Id<"users">))) {
    throw new Error("Not found");
  }
  // Version the build the caller is working in, not whichever build of the
  // project happens to come first.
  const build = await ctx.db.get(buildId);
  if (!build || build.projectId !== projectId) throw new Error("Build not found");
  return build;
}

/**
 * Pre-operation checkpoint (build backend review C5). Called immediately
 * before every AI write: it snapshots the site's current drafts — including
 * manual editor changes made since the last AI operation — as a version the
 * user can restore. Collected inside this mutation, so the snapshot is
 * consistent. Skipped (returns null) when the site has no pages yet or when
 * the drafts are identical to the build's latest version, so an unchanged
 * site does not grow duplicate versions.
 */
export const checkpointBeforeAiWrite = internalMutation({
  args: {
    projectId: v.id("projects"),
    buildId: v.id("builds"),
    label: v.string(),
  },
  handler: async (ctx, { projectId, buildId, label }) => {
    await authorizeBuildWrite(ctx, projectId, buildId);
    const pages = await snapshotPagesFor(ctx, projectId);
    if (!pages.length) return null;
    const versions = await ctx.db
      .query("buildVersions")
      .withIndex("by_build", (q) => q.eq("buildId", buildId))
      .collect();
    const latest = versions.reduce<(typeof versions)[number] | null>(
      (best, row) => (!best || row.version > best.version ? row : best),
      null,
    );
    if (latest && sameSnapshot(latest.pages, pages)) return null;
    return insertVersion(ctx, {
      projectId,
      buildId,
      label: `Before: ${label}`,
      pages,
    });
  },
});

/** Snapshot the site's current drafts (after an AI write) as a new version. */
export const snapshotVersion = internalMutation({
  args: {
    projectId: v.id("projects"),
    buildId: v.id("builds"),
    label: v.string(),
  },
  handler: async (ctx, { projectId, buildId, label }) => {
    await authorizeBuildWrite(ctx, projectId, buildId);
    const pages = await snapshotPagesFor(ctx, projectId);
    return insertVersion(ctx, { projectId, buildId, label, pages });
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
    await authorizeBuildWrite(ctx, projectId, buildId);
    return insertVersion(ctx, {
      projectId,
      buildId,
      label: versionLabel,
      pages: snapshotPages,
    });
  },
});
