import { moduleMutation, moduleQuery } from "./guards";
import { v } from "convex/values";

/* ── Content gaps ─────────────────────────────────────────────────────── */

export const listGaps = moduleQuery("create", {
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }, access) => {
    const scope = await access.ownedProject(projectId);
    if (!scope) return [];
    return await ctx.db
      .query("contentGaps")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
  },
});

export const createGap = moduleMutation("create", {
  args: {
    projectId: v.id("projects"),
    personaId: v.optional(v.id("personas")),
    journeyMapId: v.optional(v.id("journeyMaps")),
    journeyStage: v.optional(v.string()),
    title: v.string(),
    description: v.optional(v.string()),
    severity: v.optional(
      v.union(v.literal("low"), v.literal("medium"), v.literal("high")),
    ),
    source: v.optional(v.union(v.literal("ai"), v.literal("manual"))),
  },
  handler: async (ctx, { projectId, ...rest }, access) => {
    const { userId } = await access.requireProject(projectId);
    return await ctx.db.insert("contentGaps", {
      projectId,
      ...rest,
      status: "open" as const,
      createdBy: userId,
      createdAt: Date.now(),
    });
  },
});

export const updateGap = moduleMutation("create", {
  args: {
    id: v.id("contentGaps"),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    severity: v.optional(
      v.union(v.literal("low"), v.literal("medium"), v.literal("high")),
    ),
    status: v.optional(
      v.union(v.literal("open"), v.literal("covered"), v.literal("dismissed")),
    ),
  },
  handler: async (ctx, { id, ...patch }, access) => {
    const row = await access.ownedRow(await ctx.db.get(id));
    if (!row) throw new Error("Not found");
    const clean = Object.fromEntries(
      Object.entries(patch).filter(([, v]) => v !== undefined),
    );
    if (Object.keys(clean).length) await ctx.db.patch(id, clean);
  },
});

export const removeGap = moduleMutation("create", {
  args: { id: v.id("contentGaps") },
  handler: async (ctx, { id }, access) => {
    const row = await access.ownedRow(await ctx.db.get(id));
    if (!row) throw new Error("Not found");
    await ctx.db.delete(id);
  },
});

/* ── Researched topics ────────────────────────────────────────────────── */

export const listTopics = moduleQuery("create", {
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }, access) => {
    const scope = await access.ownedProject(projectId);
    if (!scope) return [];
    return await ctx.db
      .query("contentTopics")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
  },
});

export const createTopic = moduleMutation("create", {
  args: {
    projectId: v.id("projects"),
    gapId: v.optional(v.id("contentGaps")),
    title: v.string(),
    angle: v.optional(v.string()),
    contentType: v.optional(v.string()),
    keywords: v.optional(v.array(v.string())),
    status: v.optional(
      v.union(
        v.literal("idea"),
        v.literal("researched"),
        v.literal("in_progress"),
        v.literal("done"),
      ),
    ),
  },
  handler: async (ctx, { projectId, ...rest }, access) => {
    const { userId } = await access.requireProject(projectId);
    return await ctx.db.insert("contentTopics", {
      projectId,
      ...rest,
      status: rest.status ?? ("idea" as const),
      createdBy: userId,
      createdAt: Date.now(),
    });
  },
});

export const updateTopic = moduleMutation("create", {
  args: {
    id: v.id("contentTopics"),
    title: v.optional(v.string()),
    angle: v.optional(v.string()),
    contentType: v.optional(v.string()),
    keywords: v.optional(v.array(v.string())),
    research: v.optional(
      v.array(
        v.object({
          source: v.string(),
          title: v.string(),
          url: v.optional(v.string()),
          snippet: v.optional(v.string()),
        }),
      ),
    ),
    researchedAt: v.optional(v.number()),
    status: v.optional(
      v.union(
        v.literal("idea"),
        v.literal("researched"),
        v.literal("in_progress"),
        v.literal("done"),
      ),
    ),
  },
  handler: async (ctx, { id, ...patch }, access) => {
    const row = await access.ownedRow(await ctx.db.get(id));
    if (!row) throw new Error("Not found");
    const clean = Object.fromEntries(
      Object.entries(patch).filter(([, v]) => v !== undefined),
    );
    if (Object.keys(clean).length) await ctx.db.patch(id, clean);
  },
});

export const removeTopic = moduleMutation("create", {
  args: { id: v.id("contentTopics") },
  handler: async (ctx, { id }, access) => {
    const row = await access.ownedRow(await ctx.db.get(id));
    if (!row) throw new Error("Not found");
    await ctx.db.delete(id);
  },
});

/* ── Collaborative doc snapshots (Yjs state per content piece) ────────── */

export const getDoc = moduleQuery("create", {
  args: { pieceId: v.id("contentPieces") },
  handler: async (ctx, { pieceId }, access) => {
    const piece = await access.ownedRow(await ctx.db.get(pieceId));
    if (!piece) return null;
    const doc = await ctx.db
      .query("contentDocs")
      .withIndex("by_piece", (q) => q.eq("pieceId", pieceId))
      .first();
    return doc ? { snapshot: doc.snapshot, updatedAt: doc.updatedAt } : null;
  },
});

export const saveDoc = moduleMutation("create", {
  args: {
    pieceId: v.id("contentPieces"),
    snapshot: v.bytes(),
    bodyText: v.optional(v.string()),
    bodyHtml: v.optional(v.string()),
  },
  handler: async (ctx, { pieceId, snapshot, bodyHtml }, access) => {
    const piece = await access.ownedRow(await ctx.db.get(pieceId));
    if (!piece) throw new Error("Not found");
    const userId = await access.requireUser();
    const now = Date.now();
    const existing = await ctx.db
      .query("contentDocs")
      .withIndex("by_piece", (q) => q.eq("pieceId", pieceId))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        snapshot,
        updatedAt: now,
        updatedBy: userId,
      });
    } else {
      await ctx.db.insert("contentDocs", {
        pieceId,
        snapshot,
        updatedAt: now,
        updatedBy: userId,
      });
    }
    // Mirror HTML onto the piece so lists/previews/exports work
    await ctx.db.patch(pieceId, {
      updatedAt: now,
      ...(bodyHtml !== undefined ? { body: bodyHtml.slice(0, 200000) } : {}),
    });
  },
});
