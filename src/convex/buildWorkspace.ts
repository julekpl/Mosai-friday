import { moduleMutation, moduleQuery } from "./guards";
import { query } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { validateDocument, type PageDocument } from "../lib/cms/blocks";
import { READINESS_RULE_VERSION } from "../shared/contracts/status";

/* ── Build workspace: chat history, versions, restore, publish ────────────
 *
 * Public (non-Node) half of the build brain — the AI actions live in
 * buildChat.ts ("use node"). Preparation here walks the same canonical
 * revision path as cms.publishPage: draft → approved, prior superseded,
 * published rows never mutated. BP-03: this action *prepares a release* —
 * it never writes an external state. A site is `live` only when the BP-13
 * deployment pipeline holds a verified receipt; until then the site carries
 * no externally published status at all.
 */

/* ── Live preview data: site + pages + current draft documents ─────────── */

export const getPreviewData = moduleQuery("build", {
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
      release: {
        releaseState: build.releaseState ?? "none",
        lastReleaseAt: build.lastReleaseAt ?? null,
        seoReady: build.seoReady ?? null,
        wcagReady: build.wcagReady ?? null,
      },
    };
  },
});

export const listMessages = moduleQuery("build", {
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

export const clearChat = moduleMutation("build", {
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

export const listVersions = moduleQuery("build", {
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
export const restoreVersion = moduleMutation("build", {
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

/**
 * Prepare a release: promote every valid page draft through the canonical
 * revision path and record a server-written release audit (BP-03).
 *
 * Before BP-03 this mutation wrote `sites.status = "live"` and
 * `builds.status = "published"` after database edits — a false external
 * claim, since no deployment exists in this package. It now:
 *   1. validates every draft (invalid content fails the whole preparation,
 *      leaving the previously prepared release intact),
 *   2. promotes drafts to the approved revision state (prior pointer
 *      superseded) so the page-level contract is unchanged,
 *   3. writes the `buildReleaseAudits` row pinned to the promoted revision
 *      ids + rule version (readiness and the UI delivery view derive from
 *      it),
 *   4. records the prepared release on the build — and nothing else.
 *
 * The site never becomes `live` here and the build never becomes
 * `published` here; BP-13's deployment adapter is the only writer of those
 * states (holding a provider receipt).
 */
export const publishSite = moduleMutation("build", {
  // `publish`: preparing a release is the state change the product gates
  // separately from editing. The *external* publication remains an
  // exclusively server-side, receipt-backed event (BP-13).
  capability: "build.publish",
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
    // Pass 1 — validate everything BEFORE mutating anything (§4.2 protocol
    // step 1/2: validate first; a failure here leaves the previously
    // prepared release fully intact).
    const promotable: {
      pageId: Id<"cmsPages">;
      projectId: Id<"projects">;
      doc: PageDocument;
      title: string;
    }[] = [];
    const skipped: { title: string; reason: string }[] = [];
    for (const page of pages) {
      const draft = page.latestDraftRevisionId
        ? await ctx.db.get(page.latestDraftRevisionId)
        : null;
      const doc = draft?.document;
      if (!doc || doc.blocks.length === 0) {
        skipped.push({ title: page.title, reason: "empty" });
        continue;
      }
      const errors = validateDocument(doc);
      if (errors.length) {
        skipped.push({ title: page.title, reason: "invalid content" });
        continue;
      }
      promotable.push({
        pageId: page._id,
        projectId: page.projectId,
        doc,
        title: page.title,
      });
    }
    if (promotable.length === 0) {
      throw new Error(
        skipped.length
          ? `Nothing to release — all pages failed checks: ${skipped
              .map((s) => `${s.title} (${s.reason})`)
              .join(", ")}.`
          : "Nothing to release.",
      );
    }

    // Pass 2 — promote: new approved revision first, then flip the pointer
    // (a superseded prior revision stays immutable). If any write fails the
    // mutation aborts atomically; Convex rolls the transaction back, so the
    // previous prepared release stays the served one.
    const promotedRevisionIds: Id<"pageRevisions">[] = [];
    const promotedVersions: number[] = [];
    const promotedPageIds: Id<"cmsPages">[] = [];
    for (const p of promotable) {
      const nextVersion =
        (
          await ctx.db
            .query("pageRevisions")
            .withIndex("by_page", (q) => q.eq("pageId", p.pageId))
            .order("desc")
            .first()
        )?.version ?? 0;
      const approvedId = await ctx.db.insert("pageRevisions", {
        pageId: p.pageId,
        projectId: p.projectId,
        version: nextVersion,
        state: "published",
        document: p.doc,
        createdBy: userId,
        createdAt: now,
        publishedAt: now,
      });
      await ctx.db.patch(p.pageId, {
        publishedRevisionId: approvedId,
        status: "published",
        updatedAt: now,
      });
      promotedRevisionIds.push(approvedId);
      promotedVersions.push(nextVersion);
      promotedPageIds.push(p.pageId);
    }

    // Pass 3 — the server-written audit row everything else derives from.
    const auditId = await ctx.db.insert("buildReleaseAudits", {
      projectId: build.projectId,
      buildId,
      siteId: site._id,
      phase: "release_prepared",
      revisionIds: promotedRevisionIds,
      skipped,
      revisionVersions: promotedVersions,
      ruleVersion: READINESS_RULE_VERSION,
      pagesWithBlocking: [],
      createdBy: userId,
      createdAt: now,
    });

    // Build carries the local lifecycle only: "generated" stays the honest
    // non-external state; the prepared release is recorded separately.
    await ctx.db.patch(buildId, {
      status: "generated",
      releaseState: "prepared",
      lastReleaseAuditId: auditId,
      lastReleaseAt: now,
      updatedAt: now,
    });
    // The newest snapshot is the prepared version (Lovable parity) — a
    // local label, not an external claim.
    const versions = await ctx.db
      .query("buildVersions")
      .withIndex("by_build", (q) => q.eq("buildId", buildId))
      .collect();
    for (const ver of versions) {
      if (ver.isPublished) await ctx.db.patch(ver._id, { isPublished: false });
    }
    const newest = versions.sort((a, b) => b.version - a.version)[0];
    if (newest) await ctx.db.patch(newest._id, { isPublished: true });

    return { published: promotedRevisionIds.length, skipped };
  },
});
