import { query, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { hasRowAccess, moduleMutation, moduleQuery, requireUser } from "./guards";
import type { Id, Doc } from "./_generated/dataModel";
import {
  sanitizeDocument,
  validateDocument,
  type PageDocument,
} from "../lib/cms/blocks";
import { selectConfirmedRelease } from "./lib/deliveryGate";

/* ── Website / CMS module (W1) — see WEBSITE-ARCHITECTURE.md ─────────────
 *
 * Canonical rules enforced here:
 *  - editing never mutates a published revision; it creates a draft
 *  - publish promotes the draft atomically and supersedes the prior one
 *  - public resolution (getPublishedByPath) can never return a draft
 *  - URLs are normalized, hierarchical and unique within a site
 *  - path changes on published pages create 301 redirects; loops rejected
 */

const documentValidator = v.object({
  schemaVersion: v.number(),
  blocks: v.array(
    v.object({
      id: v.string(),
      type: v.string(),
      version: v.number(),
      props: v.any(),
    }),
  ),
});

const seoValidator = v.object({
  title: v.optional(v.string()),
  metaDescription: v.optional(v.string()),
  noindex: v.optional(v.boolean()),
  ogImageUrl: v.optional(v.string()),
});

const RESERVED_SLUGS = new Set(["api", "app", "auth", "dashboard", "_generated"]);
const MAX_DEPTH = 5;

function normalizeSlug(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/** Type-preserving ownership guard: keeps the concrete Doc type. */
async function requireOwned<T extends { projectId: Id<"projects"> }>(
  ctx: MutationCtx,
  row: T | null,
  userId: Id<"users">,
): Promise<T> {
  if (!row) throw new Error("Not found");
  if (!(await hasRowAccess(ctx, row, userId))) throw new Error("Not found");
  return row;
}

/* ── Sites ─────────────────────────────────────────────────────────────── */

export const getSite = moduleQuery("build", {
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }, access) => {
    const scope = await access.ownedProject(projectId);
    if (!scope) return null;
    return (
      (await ctx.db
        .query("sites")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .first()) ?? null
    );
  },
});

export const createSite = moduleMutation("build", {
  // Creating the site is `manage` (organization-level setup), not ordinary
  // editing: a member keeps editing pages, an admin/owner brings the site up.
  capability: "build.manage",
  args: { projectId: v.id("projects"), name: v.string() },
  handler: async (ctx, { projectId, name }, access) => {
    const { userId, project } = await access.requireProject(projectId);
    const existing = await ctx.db
      .query("sites")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .first();
    if (existing) return existing._id;
    const now = Date.now();
    const siteId = await ctx.db.insert("sites", {
      projectId,
      name: name.trim() || project.name,
      slug: normalizeSlug(name || project.name) || "site",
      status: "draft",
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    });
    // Bootstrap: homepage + contact so the site is never rootless (§133.1)
    const homeId = await ctx.db.insert("cmsPages", {
      siteId,
      projectId,
      title: "Home",
      slug: "home",
      fullPath: "/",
      pageType: "homepage",
      status: "draft",
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("cmsPages", {
      siteId,
      projectId,
      title: "Contact",
      slug: "contact",
      fullPath: "/contact",
      status: "draft",
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(siteId, { homepageId: homeId });
    return siteId;
  },
});

export const updateSite = moduleMutation("build", {
  capability: "build.manage",
  args: {
    id: v.id("sites"),
    name: v.optional(v.string()),
    seoDefaults: v.optional(
      v.object({
        siteName: v.optional(v.string()),
        titleTemplate: v.optional(v.string()),
        metaDescription: v.optional(v.string()),
        socialImageUrl: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, { id, ...patch }) => {
    const userId = await requireUser(ctx);
    const site = await requireOwned(ctx, await ctx.db.get(id), userId);
    const clean = Object.fromEntries(
      Object.entries(patch).filter(([, v]) => v !== undefined),
    );
    if (Object.keys(clean).length)
      await ctx.db.patch(site._id, { ...clean, updatedAt: Date.now() });
  },
});

/* ── Pages ─────────────────────────────────────────────────────────────── */

export const listPages = moduleQuery("build", {
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }, access) => {
    const site = await ctx.db.get(siteId);
    if (!site) return [];
    const scope = await access.ownedProject(site.projectId);
    if (!scope) return [];
    return await ctx.db
      .query("cmsPages")
      .withIndex("by_site", (q) => q.eq("siteId", siteId))
      .collect();
  },
});

export const getPage = moduleQuery("build", {
  args: { id: v.id("cmsPages") },
  handler: async (ctx, { id }, access) => {
    return await access.ownedRow(await ctx.db.get(id));
  },
});

/**
 * The one public read path (§158): approved revision only, never draft.
 * BP-03: approved content alone is NOT externally delivered — serving is
 * gated on a server-verified deployment receipt (audit phase `verified` +
 * deployment `succeeded`, both written exclusively by server code with the
 * provider receipt). Until BP-13's verifier exists nothing is served after
 * a mere preparation; owner preview is unaffected (the workspace reads
 * drafts directly). A failed later deployment supersedes the gate, so the
 * last *confirmed* release is what keeps serving.
 */
export const getPublishedByPath = query({
  args: { siteId: v.id("sites"), fullPath: v.string() },
  handler: async (ctx, { siteId, fullPath }) => {
    const site = await ctx.db.get(siteId);
    if (!site || site.status === "suspended") return null;
    const gate = await selectConfirmedRelease(ctx, site.projectId);
    if (!gate.allowed) return null;
    const path = fullPath === "" ? "/" : fullPath;
    // Resolve through the confirmed release's ROUTE snapshot, not the live
    // by_site_path index: a slug move performed for a later, unverified
    // release must not cut off or rewrite the confirmed routes, and B's new
    // path must stay hidden until B verifies. When the confirmed audit has
    // a route snapshot it is AUTHORITATIVE — a page-pin fallback would
    // otherwise serve A's pinned revision under B's new path (the page row
    // moved, but a pin maps by page id). Audits written before snapshots
    // existed fail closed because their former route/metadata is unknowable.
    const route = gate.routesByPath.get(path);
    const pinnedId: Id<"pageRevisions"> | undefined = route?.revisionId;
    if (!pinnedId || !route?.title) return null;
    const revision = await ctx.db.get(pinnedId);
    if (!revision || revision.state !== "published") return null;
    // Metadata comes from the snapshot frozen at preparation — a title/SEO
    // edit belonging to a later, unverified release must not appear before
    // that release verifies (follow-up 4). No mutable page.status check:
    // the snapshot is authoritative for what the confirmed release serves.
    return {
      page: {
        _id: revision.pageId,
        title: route.title,
        seo: route.seo ?? null,
        fullPath: path,
      },
      revision,
    };
  },
});

function joinPath(parentPath: string, slug: string): string {
  return parentPath === "/" ? `/${slug}` : `${parentPath}/${slug}`;
}

async function assertUniquePath(
  ctx: MutationCtx,
  siteId: Id<"sites">,
  fullPath: string,
  excludePageId?: Id<"cmsPages">,
) {
  const all = await ctx.db
    .query("cmsPages")
    .withIndex("by_site", (q) => q.eq("siteId", siteId))
    .collect();
  const clash = all.find(
    (p) => p.fullPath === fullPath && p._id !== excludePageId,
  );
  if (clash) throw new Error(`A page already exists at ${fullPath}`);
}

export const createPage = moduleMutation("build", {
  args: {
    siteId: v.id("sites"),
    title: v.string(),
    slug: v.string(),
    parentId: v.optional(v.id("cmsPages")),
    pageType: v.optional(v.string()),
  },
  handler: async (ctx, { siteId, title, slug, parentId, pageType }, access) => {
    const site = await ctx.db.get(siteId);
    if (!site) throw new Error("Not found");
    const { userId } = await access.requireProject(site.projectId);

    const cleanSlug = normalizeSlug(slug);
    if (!cleanSlug) throw new Error("Slug is required");
    if (RESERVED_SLUGS.has(cleanSlug))
      throw new Error(`"${cleanSlug}" is a reserved path`);

    // depth check (cycle-safe by construction: walk existing ancestors)
    let depth = 1;
    let cursor = parentId;
    while (cursor) {
      depth += 1;
      if (depth > MAX_DEPTH) throw new Error("Page tree is too deep (max 5)");
      const parent = await ctx.db.get(cursor);
      if (!parent) throw new Error("Parent page not found");
      cursor = parent.parentId;
    }

    let fullPath = "/";
    if (parentId) {
      const parent = await ctx.db.get(parentId);
      fullPath = joinPath(parent?.fullPath ?? "/", cleanSlug);
    }
    await assertUniquePath(ctx, siteId, fullPath);

    const now = Date.now();
    const pageId = await ctx.db.insert("cmsPages", {
      siteId,
      projectId: site.projectId,
      title: title.trim() || cleanSlug,
      slug: cleanSlug,
      fullPath,
      parentId,
      pageType,
      status: "draft",
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    });
    const revId = await ctx.db.insert("pageRevisions", {
      pageId,
      projectId: site.projectId,
      version: 1,
      state: "draft",
      document: { schemaVersion: 1, blocks: [] },
      createdBy: userId,
      createdAt: now,
    });
    await ctx.db.patch(pageId, { latestDraftRevisionId: revId });
    return pageId;
  },
});

export const updatePage = moduleMutation("build", {
  args: {
    id: v.id("cmsPages"),
    title: v.optional(v.string()),
    slug: v.optional(v.string()),
    parentId: v.optional(v.id("cmsPages")),
    seo: v.optional(seoValidator),
    setHomepage: v.optional(v.boolean()),
  },
  handler: async (ctx, { id, slug, parentId, title, seo, setHomepage }) => {
    const userId = await requireUser(ctx);
    const page = await requireOwned(
      ctx,
      await ctx.db.get(id) as Doc<"cmsPages"> | null,
      userId,
    );

    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    const oldPath = page.fullPath;

    if (title !== undefined) patch.title = title.trim() || page.title;

    if (slug !== undefined || parentId !== undefined) {
      const cleanSlug = slug !== undefined ? normalizeSlug(slug) : page.slug;
      if (!cleanSlug) throw new Error("Slug is required");
      if (cleanSlug !== page.slug && RESERVED_SLUGS.has(cleanSlug))
        throw new Error(`"${cleanSlug}" is a reserved path`);
      if (parentId === page._id)
        throw new Error("A page cannot be its own parent");

      // prevent cycles: walk up from the (possibly new) parent
      let cursor = parentId !== undefined ? parentId : page.parentId;
      let depth = 1;
      while (cursor) {
        if (cursor === page._id)
          throw new Error("Cannot move a page under its own descendant");
        depth += 1;
        if (depth > MAX_DEPTH)
          throw new Error("Page tree is too deep (max 5)");
        const p = await ctx.db.get(cursor);
        cursor = p?.parentId;
      }

      const newParentId = parentId !== undefined ? parentId : page.parentId;
      const parentDoc = newParentId
        ? await ctx.db.get(newParentId)
        : null;
      const fullPath = joinPath(parentDoc?.fullPath ?? "/", cleanSlug);
      await assertUniquePath(ctx, page.siteId, fullPath, page._id);

      patch.slug = cleanSlug;
      patch.parentId = newParentId;
      patch.fullPath = fullPath;

      // repath descendants breadth-first
      const all = await ctx.db
        .query("cmsPages")
        .withIndex("by_site", (q) => q.eq("siteId", page.siteId))
        .collect();
      const childrenOf = (pid: Id<"cmsPages">) =>
        all.filter((p) => p.parentId === pid);
      const queue = [...childrenOf(page._id)];
      while (queue.length) {
        const child = queue.shift()!;
        const parentPath =
          child.parentId === page._id ? fullPath : undefined;
        const resolved = parentPath ?? child.fullPath;
        void resolved;
        // recompute against the *new* tree: parent's current fullPath
        const parentNow = child.parentId
          ? child.parentId === page._id
            ? fullPath
            : (await ctx.db.get(child.parentId))?.fullPath ?? "/"
          : "/";
        const childPath = joinPath(parentNow, child.slug);
        if (childPath !== child.fullPath) {
          await ctx.db.patch(child._id, {
            fullPath: childPath,
            updatedAt: Date.now(),
          });
        }
        queue.push(...childrenOf(child._id));
      }

      // published path changed → auto 301 so nothing 404s (§33, §133.8)
      if (page.status === "published" && oldPath !== fullPath && oldPath !== "/") {
        const existing = await ctx.db
          .query("cmsRedirects")
          .withIndex("by_site_path", (q) =>
            q.eq("siteId", page.siteId).eq("fromPath", oldPath),
          )
          .first();
        if (!existing) {
          await ctx.db.insert("cmsRedirects", {
            siteId: page.siteId,
            projectId: page.projectId,
            fromPath: oldPath,
            to: fullPath,
            statusCode: 301,
            source: "auto_path_change",
            createdAt: Date.now(),
          });
        }
      }
    }

    if (seo !== undefined) patch.seo = seo;

    await ctx.db.patch(page._id, patch);

    if (setHomepage) {
      await ctx.db.patch(page.siteId, { homepageId: page._id, updatedAt: Date.now() });
    }
  },
});

export const archivePage = moduleMutation("build", {
  capability: "build.publish",
  args: { id: v.id("cmsPages") },
  handler: async (ctx, { id }) => {
    const userId = await requireUser(ctx);
    const page = await requireOwned(
      ctx,
      await ctx.db.get(id) as Doc<"cmsPages"> | null,
      userId,
    );
    const site = await ctx.db.get(page.siteId);
    if (page.pageType === "homepage" || site?.homepageId === page._id)
      throw new Error("Set another page as homepage before archiving this one");
    const siblings = await ctx.db
      .query("cmsPages")
      .withIndex("by_site", (q) => q.eq("siteId", page.siteId))
      .collect();
    if (siblings.some((c) => c.parentId === page._id))
      throw new Error("Move or archive child pages first");
    await ctx.db.patch(page._id, { status: "archived", updatedAt: Date.now() });
  },
});

export const deletePage = moduleMutation("build", {
  args: { id: v.id("cmsPages") },
  handler: async (ctx, { id }) => {
    const userId = await requireUser(ctx);
    const page = await requireOwned(
      ctx,
      await ctx.db.get(id) as Doc<"cmsPages"> | null,
      userId,
    );
    const site = await ctx.db.get(page.siteId);
    if (page.pageType === "homepage" || page.fullPath === "/" || site?.homepageId === page._id)
      throw new Error("The homepage cannot be deleted");
    const siblings = await ctx.db
      .query("cmsPages")
      .withIndex("by_site", (q) => q.eq("siteId", page.siteId))
      .collect();
    if (siblings.some((c) => c.parentId === page._id))
      throw new Error("Move or delete child pages first");
    const revisions = await ctx.db
      .query("pageRevisions")
      .withIndex("by_page", (q) => q.eq("pageId", page._id))
      .collect();
    for (const r of revisions) await ctx.db.delete(r._id);
    await ctx.db.delete(page._id);
  },
});

/* ── Revisions: draft autosave, publish, restore ───────────────────────── */

export const listRevisions = moduleQuery("build", {
  args: { pageId: v.id("cmsPages") },
  handler: async (ctx, { pageId }, access) => {
    const page = await access.ownedRow(await ctx.db.get(pageId));
    if (!page) return [];
    const revs = await ctx.db
      .query("pageRevisions")
      .withIndex("by_page", (q) => q.eq("pageId", pageId))
      .collect();
    return revs.sort((a, b) => b.version - a.version);
  },
});

export const getRevision = moduleQuery("build", {
  args: { id: v.id("pageRevisions") },
  handler: async (ctx, { id }, access) => {
    return await access.ownedRow(await ctx.db.get(id));
  },
});

/** Autosave: writes the draft revision in place. Never publishes (§10). */
export const saveDraft = moduleMutation("build", {
  args: {
    pageId: v.id("cmsPages"),
    document: documentValidator,
  },
  handler: async (ctx, { pageId, document: input }) => {
    const userId = await requireUser(ctx);
    const page = await requireOwned(
      ctx,
      await ctx.db.get(pageId) as Doc<"cmsPages"> | null,
      userId,
    );

    // T0.7: rich text is sanitized on SAVE with the same isomorphic
    // allow-list the renderer uses — stored HTML must be clean HTML, not
    // "clean only when a particular sink remembers to clean it".
    const document = sanitizeDocument(input);
    const errors = validateDocument(document);
    if (errors.length) throw new Error(errors[0]);

    if (page.latestDraftRevisionId) {
      const draft = await ctx.db.get(page.latestDraftRevisionId);
      // a *published* row is immutable — only live drafts are patched (§45)
      if (draft && draft.state === "draft") {
        await ctx.db.patch(draft._id, { document, createdAt: Date.now() });
        await ctx.db.patch(page._id, { updatedAt: Date.now() });
        return draft._id;
      }
    }
    const revs = await ctx.db
      .query("pageRevisions")
      .withIndex("by_page", (q) => q.eq("pageId", pageId))
      .collect();
    const nextVersion = revs.reduce((m, r) => Math.max(m, r.version), 0) + 1;
    const revId = await ctx.db.insert("pageRevisions", {
      pageId,
      projectId: page.projectId,
      version: nextVersion,
      state: "draft",
      document,
      createdBy: userId,
      createdAt: Date.now(),
    });
    await ctx.db.patch(pageId, {
      latestDraftRevisionId: revId,
      updatedAt: Date.now(),
    });
    return revId;
  },
});

/** Publish diagnostics: blocking issues + recommendations (§43, §115). */
export const getPublishChecks = moduleQuery("build", {
  args: { pageId: v.id("cmsPages") },
  handler: async (ctx, { pageId }, access) => {
    const page = await access.ownedRow(await ctx.db.get(pageId));
    if (!page) return null;
    const project = (await access.ownedProject(page.projectId))?.project;

    const blocking: string[] = [];
    const recommendations: string[] = [];

    const draft = page.latestDraftRevisionId
      ? await ctx.db.get(page.latestDraftRevisionId)
      : null;
    const doc = draft?.document;

    if (!doc || doc.blocks.length === 0)
      blocking.push("This page has no content yet — add at least one section.");
    if (doc) {
      for (const b of doc.blocks) {
        if (b.type === "image" && !b.props.assetId)
          blocking.push("Image block is missing an image — pick one from Assets.");
        if (b.type === "image" && !b.props.alt)
          recommendations.push("Image block has no alt text (accessibility).");
        if (b.type === "productGrid") {
          if (!b.props.collectionId) {
            blocking.push("Product grid has no collection — choose one.");
          } else {
            const col = await ctx.db.get(b.props.collectionId as Id<"collections">);
            if (!col)
              blocking.push(
                "Product grid points at a collection that no longer exists — choose another collection.",
              );
          }
        }
      }
    }
    const seoDesc =
      page.seo?.metaDescription ?? project?.description ?? undefined;
    if (!seoDesc) recommendations.push("Add a meta description (SEO).");
    if (page.title.length > 60)
      recommendations.push("Page title is long — search engines may truncate it.");

    return { blocking, recommendations };
  },
});

/** Publish: promote draft → approved atomically; prior revision superseded. */
export const publishPage = moduleMutation("build", {
  // `publish`: promoting a page's approved revision is the state change the
  // product promises is real, so it is gated separately from editing it.
  capability: "build.publish",
  args: { pageId: v.id("cmsPages") },
  handler: async (ctx, { pageId }) => {
    const userId = await requireUser(ctx);
    const page = await requireOwned(
      ctx,
      await ctx.db.get(pageId) as Doc<"cmsPages"> | null,
      userId,
    );

    const draft = page.latestDraftRevisionId
      ? await ctx.db.get(page.latestDraftRevisionId)
      : null;
    const doc = draft?.document;
    if (!doc || doc.blocks.length === 0)
      throw new Error("This page has no content yet — add at least one section.");
    for (const b of doc.blocks) {
      if (b.type === "image" && !b.props.assetId)
        throw new Error("Image block is missing an image — pick one from Assets.");
      if (b.type === "productGrid" && b.props.collectionId) {
        const col = await ctx.db.get(b.props.collectionId as Id<"collections">);
        if (!col)
          throw new Error(
            "Product grid points at a collection that no longer exists — choose another collection.",
          );
      }
    }

    const { revisionId } = await promotePageRevision(ctx, {
      page,
      document: doc,
      userId,
      now: Date.now(),
    });
    // BP-03: a database edit is not a deployment. The page's approved
    // revision is stored, but the site keeps no externally published status
    // until the BP-13 deployment adapter holds a verified receipt.
    return revisionId;
  },
});

/**
 * The one canonical promotion path for a page revision (WEBSITE-ARCHITECTURE
 * rule 7), shared by `cms.publishPage` and `buildWorkspace.publishSite`:
 *
 *  - the document is sanitized server-side (T0.7) before it is stored;
 *    content checks stay with each caller (they differ and are unchanged),
 *  - the new row takes `max(version) + 1` for the page, so revision numbers
 *    are unique and monotonic,
 *  - the prior promoted revision is marked `superseded` (never mutated
 *    otherwise), and the page pointer moves to the new row.
 *
 * The state names written here are unchanged (`pageRevisions.state` and
 * `cmsPages.status` = "published"); renaming them is an owner decision (build
 * review T1). Not a registered function — callers are authorized mutations.
 */
export async function promotePageRevision(
  ctx: MutationCtx,
  args: {
    page: Doc<"cmsPages">;
    document: PageDocument;
    userId: Id<"users">;
    now: number;
  },
): Promise<{ revisionId: Id<"pageRevisions">; version: number }> {
  const { page, userId, now } = args;
  const document = sanitizeDocument(args.document);

  const revs = await ctx.db
    .query("pageRevisions")
    .withIndex("by_page", (q) => q.eq("pageId", page._id))
    .collect();
  const version = revs.reduce((m, r) => Math.max(m, r.version), 0) + 1;

  // Supersede every still-promoted row of this page, not only the pointer
  // (older code paths could leave more than one `published` row behind) —
  // EXCEPT a revision pinned by the last confirmed public release. BP-03:
  // "continue serving the last confirmed public release" until the next one
  // verifies, and the public readers only serve a pinned row whose state is
  // still `published`. Such a row is superseded by the next promotion after
  // a newer release has been confirmed.
  const gate = await selectConfirmedRelease(ctx, page.projectId);
  const pinned = new Set<Id<"pageRevisions">>(
    gate.allowed ? gate.audit.revisionIds : [],
  );
  for (const r of revs) {
    if (r.state === "published" && !pinned.has(r._id)) {
      await ctx.db.patch(r._id, { state: "superseded" });
    }
  }
  const revisionId = await ctx.db.insert("pageRevisions", {
    pageId: page._id,
    projectId: page.projectId,
    version,
    state: "published",
    document,
    createdBy: userId,
    createdAt: now,
    publishedAt: now,
  });
  await ctx.db.patch(page._id, {
    publishedRevisionId: revisionId,
    status: "published",
    updatedAt: now,
  });
  return { revisionId, version };
}

/** Restore = new draft from an old revision; history is never overwritten. */
export const restoreRevision = moduleMutation("build", {
  args: { revisionId: v.id("pageRevisions") },
  handler: async (ctx, { revisionId }) => {
    const userId = await requireUser(ctx);
    const rev = await ctx.db.get(revisionId);
    if (!rev) throw new Error("Not found");
    await requireOwned(
      ctx,
      await ctx.db.get(rev.pageId) as Doc<"cmsPages"> | null,
      userId,
    );
    const revs = await ctx.db
      .query("pageRevisions")
      .withIndex("by_page", (q) => q.eq("pageId", rev.pageId))
      .collect();
    const nextVersion = revs.reduce((m, r) => Math.max(m, r.version), 0) + 1;
    // T0.7 / build review S1: an old revision may predate sanitize-on-save
    // (or have been written by an unsanitized path), so the restored draft
    // is sanitized and validated like any other write.
    const document = sanitizeDocument(rev.document);
    const errors = validateDocument(document);
    if (errors.length) throw new Error(errors[0]);
    const newId = await ctx.db.insert("pageRevisions", {
      pageId: rev.pageId,
      projectId: rev.projectId,
      version: nextVersion,
      state: "draft",
      document,
      createdBy: userId,
      createdAt: Date.now(),
    });
    await ctx.db.patch(rev.pageId, {
      latestDraftRevisionId: newId,
      updatedAt: Date.now(),
    });
    return newId;
  },
});

/* ── Assets ────────────────────────────────────────────────────────────── */

export const listAssets = moduleQuery("build", {
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }, access) => {
    const scope = await access.ownedProject(projectId);
    if (!scope) return [];
    return await ctx.db
      .query("cmsAssets")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
  },
});

export const createAsset = moduleMutation("build", {
  args: {
    projectId: v.id("projects"),
    type: v.union(
      v.literal("image"),
      v.literal("video"),
      v.literal("document"),
      v.literal("logo"),
    ),
    filename: v.string(),
    url: v.string(),
    mimeType: v.optional(v.string()),
    altText: v.optional(v.string()),
    title: v.optional(v.string()),
    source: v.optional(v.string()),
  },
  handler: async (ctx, args, access) => {
    const { userId } = await access.requireProject(args.projectId);
    if (!/^https?:\/\//.test(args.url))
      throw new Error("Asset URL must be http(s)");
    const { projectId, ...rest } = args;
    return await ctx.db.insert("cmsAssets", {
      projectId,
      ...rest,
      createdBy: userId,
      createdAt: Date.now(),
    });
  },
});

export const updateAsset = moduleMutation("build", {
  args: {
    id: v.id("cmsAssets"),
    altText: v.optional(v.string()),
    title: v.optional(v.string()),
  },
  handler: async (ctx, { id, ...patch }) => {
    const userId = await requireUser(ctx);
    const row = await requireOwned(
      ctx,
      await ctx.db.get(id) as Doc<"cmsAssets"> | null,
      userId,
    );
    const clean = Object.fromEntries(
      Object.entries(patch).filter(([, v]) => v !== undefined),
    );
    if (Object.keys(clean).length) await ctx.db.patch(row._id, clean);
  },
});

/** Deletion is blocked while any revision references the asset (§28). */
export const deleteAsset = moduleMutation("build", {
  args: { id: v.id("cmsAssets") },
  handler: async (ctx, { id }) => {
    const userId = await requireUser(ctx);
    const asset = await requireOwned(
      ctx,
      await ctx.db.get(id) as Doc<"cmsAssets"> | null,
      userId,
    );

    const pages = await ctx.db
      .query("cmsPages")
      .withIndex("by_project", (q) => q.eq("projectId", asset.projectId))
      .collect();
    for (const p of pages) {
      const revs = await ctx.db
        .query("pageRevisions")
        .withIndex("by_page", (q) => q.eq("pageId", p._id))
        .collect();
      const used = revs.some((r) =>
        r.document.blocks.some(
          (b) => b.props.imageAssetId === id || b.props.assetId === id,
        ),
      );
      if (used)
        throw new Error(
          `This asset is used on "${p.title}" — remove it there before deleting.`,
        );
    }
    await ctx.db.delete(asset._id);
  },
});

/* ── Commerce block resolution (W5) — §50, §137 ─────────────────────────
 *
 * ProductGrid stores only a collectionId. At render time the block resolves
 * live product data from canonical Sell tables — price and availability are
 * never copied into page content.
 */

export const resolveCollection = moduleQuery("build", {
  args: { id: v.id("collections") },
  handler: async (ctx, { id }, access) => {
    return await access.ownedRow(await ctx.db.get(id));
  },
});

export type ResolvedProduct = {
  productId: Id<"products">;
  title: string;
  priceCents: number | null;
  currency: string;
  availability: string | null;
  imageUrl: string | null;
  externalUrl: string | null;
  provider: string | null;
};

/** Live product facts for a productGrid block. Never stored on the page. */
export const resolveProducts = moduleQuery("build", {
  args: { collectionId: v.id("collections"), limit: v.optional(v.number()) },
  handler: async (ctx, { collectionId, limit }, access) => {
    const col = await access.ownedRow(await ctx.db.get(collectionId));
    if (!col) return [];

    const products = await ctx.db
      .query("products")
      .withIndex("by_project", (q) => q.eq("projectId", col.projectId))
      .collect();
    const members = products
      .filter((p) => p.collectionIds?.includes(collectionId))
      .filter((p) => p.status !== "archived")
      .slice(0, Math.min(limit ?? 12, 48));

    const resolved: ResolvedProduct[] = [];
    for (const p of members) {
      const variants = await ctx.db
        .query("productVariants")
        .withIndex("by_product", (q) => q.eq("productId", p._id))
        .collect();
      const def = variants.find((v) => v.isDefault) ?? variants[0];
      const media = await ctx.db
        .query("productMedia")
        .withIndex("by_product", (q) => q.eq("productId", p._id))
        .collect();
      const primary = media.sort((a, b) => (a.position ?? 0) - (b.position ?? 0))[0];
      resolved.push({
        productId: p._id,
        title: p.title,
        priceCents: def?.priceCents ?? null,
        currency: def?.currency ?? "USD",
        availability: def?.availability ?? null,
        imageUrl: primary?.url ?? null,
        externalUrl: p.externalUrl ?? null,
        provider: p.provider ?? null,
      });
    }
    return resolved;
  },
});

/* ── Navigation ────────────────────────────────────────────────────────── */

export const listNavigations = moduleQuery("build", {
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }, access) => {
    const site = await ctx.db.get(siteId);
    if (!site) return [];
    const scope = await access.ownedProject(site.projectId);
    if (!scope) return [];
    return await ctx.db
      .query("cmsNavigations")
      .withIndex("by_site", (q) => q.eq("siteId", siteId))
      .collect();
  },
});

export const saveNavigation = moduleMutation("build", {
  capability: "build.manage",
  args: {
    siteId: v.id("sites"),
    name: v.string(),
    items: v.array(
      v.object({
        id: v.string(),
        label: v.string(),
        type: v.string(),
        referenceId: v.optional(v.id("cmsPages")),
        url: v.optional(v.string()),
        openInNewTab: v.optional(v.boolean()),
      }),
    ),
  },
  handler: async (ctx, { siteId, name, items }, access) => {
    const site = await ctx.db.get(siteId);
    if (!site) throw new Error("Not found");
    await access.requireProject(site.projectId);

    // navigation must reference real pages (§133.12)
    const pages = await ctx.db
      .query("cmsPages")
      .withIndex("by_site", (q) => q.eq("siteId", siteId))
      .collect();
    for (const item of items) {
      if (item.type === "page") {
        if (!item.referenceId || !pages.some((p) => p._id === item.referenceId))
          throw new Error(`Menu item "${item.label}" points at a missing page`);
      } else if (item.type === "external" && !/^https?:\/\//.test(item.url ?? "")) {
        throw new Error(`Menu item "${item.label}" needs a valid https link`);
      }
    }

    const existing = await ctx.db
      .query("cmsNavigations")
      .withIndex("by_site", (q) => q.eq("siteId", siteId))
      .filter((q) => q.eq(q.field("name"), name))
      .first();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, { items, updatedAt: now });
      return existing._id;
    }
    return await ctx.db.insert("cmsNavigations", {
      siteId,
      projectId: site.projectId,
      name,
      items,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/* ── Redirects ─────────────────────────────────────────────────────────── */

export const listRedirects = moduleQuery("build", {
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }, access) => {
    const site = await ctx.db.get(siteId);
    if (!site) return [];
    const scope = await access.ownedProject(site.projectId);
    if (!scope) return [];
    return await ctx.db
      .query("cmsRedirects")
      .withIndex("by_project", (q) => q.eq("projectId", site.projectId))
      .collect();
  },
});

export const createRedirect = moduleMutation("build", {
  capability: "build.manage",
  args: {
    siteId: v.id("sites"),
    fromPath: v.string(),
    to: v.string(),
    statusCode: v.union(v.literal(301), v.literal(302)),
  },
  handler: async (ctx, { siteId, fromPath, to, statusCode }, access) => {
    const site = await ctx.db.get(siteId);
    if (!site) throw new Error("Not found");
    await access.requireProject(site.projectId);

    const from = fromPath.startsWith("/") ? fromPath : `/${fromPath}`;
    const toPath = to.startsWith("/") ? to : `/${to}`;
    if (from === toPath) throw new Error("A redirect cannot point at itself");
    const all = await ctx.db
      .query("cmsRedirects")
      .withIndex("by_project", (q) => q.eq("projectId", site.projectId))
      .collect();
    if (all.some((r) => r.fromPath === toPath && r.to === from))
      throw new Error("That redirect would create a loop");

    const existing = await ctx.db
      .query("cmsRedirects")
      .withIndex("by_site_path", (q) =>
        q.eq("siteId", siteId).eq("fromPath", from),
      )
      .first();
    if (existing) throw new Error(`A redirect from ${from} already exists`);
    return await ctx.db.insert("cmsRedirects", {
      siteId,
      projectId: site.projectId,
      fromPath: from,
      to: toPath,
      statusCode,
      source: "manual",
      createdAt: Date.now(),
    });
  },
});

export const deleteRedirect = moduleMutation("build", {
  capability: "build.manage",
  args: { id: v.id("cmsRedirects") },
  handler: async (ctx, { id }) => {
    const userId = await requireUser(ctx);
    const row = await requireOwned(
      ctx,
      await ctx.db.get(id) as Doc<"cmsRedirects"> | null,
      userId,
    );
    await ctx.db.delete(row._id);
  },
});
