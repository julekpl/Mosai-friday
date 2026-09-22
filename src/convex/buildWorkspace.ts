import { orgMutation, orgQuery } from "./guards";
import { v } from "convex/values";
import { validateDocument, type PageDocument } from "../lib/cms/blocks";

/* ── Build workspace: chat history, versions, restore, publish ────────────
 *
 * Public (non-Node) half of the build brain — the AI actions live in
 * buildChat.ts ("use node"). Publishing here walks the same canonical
 * revision path as cms.publishPage: draft → published, prior superseded,
 * published rows never mutated.
 */

/* ── Live preview data: site + pages + current draft documents ─────────── */

export const getPreviewData = orgQuery({
  args: { buildId: v.id("builds") },
  handler: async (ctx, { buildId }, access) => {
    const build = await ctx.db.get(buildId);
    if (!build) return null;
    const scope = await access.ownedProject(build.projectId);
    if (!scope) return null;

    const site = await ctx.db
      .query("sites")
      .withIndex("by_project", (q) => q.eq("projectId", build.projectId))
      .first();
    if (!site) return { site: null, pages: [] };

    const pages = await ctx.db
      .query("cmsPages")
      .withIndex("by_site", (q) => q.eq("siteId", site._id))
      .collect();
    pages.sort((a, b) =>
      a.fullPath === "/"
        ? -1
        : b.fullPath === "/"
          ? 1
          : a.fullPath.localeCompare(b.fullPath),
    );
    const withDocs = [];
    for (const p of pages) {
      const rev = p.latestDraftRevisionId
        ? await ctx.db.get(p.latestDraftRevisionId)
        : null;
      withDocs.push({
        _id: p._id,
        title: p.title,
        fullPath: p.fullPath,
        status: p.status,
        doc: rev?.document ?? { schemaVersion: 1, blocks: [] },
      });
    }
    return {
      site: { _id: site._id, name: site.name, status: site.status },
      pages: withDocs,
    };
  },
});

export const listMessages = orgQuery({
  args: { buildId: v.id("builds") },
  handler: async (ctx, { buildId }, access) => {
    const build = await ctx.db.get(buildId);
    if (!build) return [];
    const scope = await access.ownedProject(build.projectId);
    if (!scope) return [];
    return await ctx.db
      .query("buildMessages")
      .withIndex("by_build", (q) => q.eq("buildId", buildId))
      .collect();
  },
});

export const clearChat = orgMutation({
  args: { buildId: v.id("builds") },
  handler: async (ctx, { buildId }, access) => {
    const build = await ctx.db.get(buildId);
    if (!build) throw new Error("Not found");
    await access.requireProject(build.projectId);
    const msgs = await ctx.db
      .query("buildMessages")
      .withIndex("by_build", (q) => q.eq("buildId", buildId))
      .collect();
    for (const m of msgs) await ctx.db.delete(m._id);
  },
});

export const listVersions = orgQuery({
  args: { buildId: v.id("builds") },
  handler: async (ctx, { buildId }, access) => {
    const build = await ctx.db.get(buildId);
    if (!build) return [];
    const scope = await access.ownedProject(build.projectId);
    if (!scope) return [];
    const versions = await ctx.db
      .query("buildVersions")
      .withIndex("by_build", (q) => q.eq("buildId", buildId))
      .collect();
    return versions.sort((a, b) => b.version - a.version);
  },
});

/** Restore = copy every snapshot page back into fresh draft revisions. */
export const restoreVersion = orgMutation({
  args: { versionId: v.id("buildVersions") },
  handler: async (ctx, { versionId }, access) => {
    const version = await access.ownedRow(await ctx.db.get(versionId));
    if (!version) throw new Error("Not found");
    const userId = await access.requireUser();

    let restored = 0;
    for (const p of version.pages) {
      const page = await ctx.db.get(p.pageId);
      if (!page) continue;
      let doc: PageDocument;
      try {
        doc = JSON.parse(p.draft) as PageDocument;
      } catch {
        continue;
      }
      const errors = validateDocument(doc);
      if (errors.length) continue;

      const currentDraft = page.latestDraftRevisionId
        ? await ctx.db.get(page.latestDraftRevisionId)
        : null;
      if (currentDraft && currentDraft.state === "draft") {
        await ctx.db.patch(currentDraft._id, {
          document: doc,
          createdAt: Date.now(),
        });
      } else {
        const revs = await ctx.db
          .query("pageRevisions")
          .withIndex("by_page", (q) => q.eq("pageId", p.pageId))
          .collect();
        const nextRev = revs.reduce((m, r) => Math.max(m, r.version), 0) + 1;
        const revId = await ctx.db.insert("pageRevisions", {
          pageId: p.pageId,
          projectId: version.projectId,
          version: nextRev,
          state: "draft",
          document: doc,
          createdBy: userId,
          createdAt: Date.now(),
        });
        await ctx.db.patch(p.pageId, { latestDraftRevisionId: revId });
      }
      await ctx.db.patch(p.pageId, { updatedAt: Date.now() });
      restored += 1;
    }
    return restored;
  },
});

/** Publish: promote every page draft through the canonical revision path. */
export const publishSite = orgMutation({
  args: { buildId: v.id("builds") },
  handler: async (ctx, { buildId }, access) => {
    const build = await ctx.db.get(buildId);
    if (!build) throw new Error("Not found");
    const { userId } = await access.requireProject(build.projectId);

    const site = await ctx.db
      .query("sites")
      .withIndex("by_project", (q) => q.eq("projectId", build.projectId))
      .first();
    if (!site) throw new Error("No site to publish — generate one first.");

    const pages = await ctx.db
      .query("cmsPages")
      .withIndex("by_site", (q) => q.eq("siteId", site._id))
      .collect();
    if (!pages.length) throw new Error("No pages to publish.");

    const now = Date.now();
    let published = 0;
    const skipped: string[] = [];
    for (const page of pages) {
      const draft = page.latestDraftRevisionId
        ? await ctx.db.get(page.latestDraftRevisionId)
        : null;
      const doc = draft?.document;
      if (!doc || doc.blocks.length === 0) {
        skipped.push(page.title);
        continue;
      }
      const errors = validateDocument(doc);
      if (errors.length) {
        skipped.push(`${page.title} (invalid content)`);
        continue;
      }

      const revs = await ctx.db
        .query("pageRevisions")
        .withIndex("by_page", (q) => q.eq("pageId", page._id))
        .collect();
      const nextVersion = revs.reduce((m, r) => Math.max(m, r.version), 0) + 1;

      if (page.publishedRevisionId) {
        await ctx.db.patch(page.publishedRevisionId, { state: "superseded" });
      }
      const publishedId = await ctx.db.insert("pageRevisions", {
        pageId: page._id,
        projectId: page.projectId,
        version: nextVersion,
        state: "published",
        document: doc,
        createdBy: userId,
        createdAt: now,
        publishedAt: now,
      });
      await ctx.db.patch(page._id, {
        publishedRevisionId: publishedId,
        status: "published",
        updatedAt: now,
      });
      published += 1;
    }

    if (site.status === "draft") {
      await ctx.db.patch(site._id, { status: "live", updatedAt: now });
    }
    await ctx.db.patch(buildId, { status: "published", updatedAt: now });

    // mark the newest snapshot as the published version (Lovable parity)
    const versions = await ctx.db
      .query("buildVersions")
      .withIndex("by_build", (q) => q.eq("buildId", buildId))
      .collect();
    for (const ver of versions) {
      if (ver.isPublished) await ctx.db.patch(ver._id, { isPublished: false });
    }
    const newest = versions.sort((a, b) => b.version - a.version)[0];
    if (newest) await ctx.db.patch(newest._id, { isPublished: true });

    return { published, skipped };
  },
});
