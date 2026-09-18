import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

/* ── Content gaps ─────────────────────────────────────────────────────── */

export const listGaps = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const project = await ctx.db.get(projectId);
    if (!project || project.ownerId !== userId) return [];
    return await ctx.db
      .query("contentGaps")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
  },
});

export const createGap = mutation({
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
  handler: async (ctx, { projectId, ...rest }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    const project = await ctx.db.get(projectId);
    if (!project || project.ownerId !== userId) throw new Error("Not found");
    return await ctx.db.insert("contentGaps", {
      projectId,
      ...rest,
      status: "open" as const,
      createdBy: userId,
      createdAt: Date.now(),
    });
  },
});

export const updateGap = mutation({
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
  handler: async (ctx, { id, ...patch }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    const gap = await ctx.db.get(id);
    if (!gap) throw new Error("Not found");
    const project = await ctx.db.get(gap.projectId);
    if (!project || project.ownerId !== userId) throw new Error("Not found");
    const clean = Object.fromEntries(
      Object.entries(patch).filter(([, v]) => v !== undefined),
    );
    if (Object.keys(clean).length) await ctx.db.patch(id, clean);
  },
});

export const removeGap = mutation({
  args: { id: v.id("contentGaps") },
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    const gap = await ctx.db.get(id);
    if (!gap) throw new Error("Not found");
    const project = await ctx.db.get(gap.projectId);
    if (!project || project.ownerId !== userId) throw new Error("Not found");
    await ctx.db.delete(id);
  },
});

/* ── Researched topics ────────────────────────────────────────────────── */

export const listTopics = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const project = await ctx.db.get(projectId);
    if (!project || project.ownerId !== userId) return [];
    return await ctx.db
      .query("contentTopics")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
  },
});

export const createTopic = mutation({
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
  handler: async (ctx, { projectId, ...rest }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    const project = await ctx.db.get(projectId);
    if (!project || project.ownerId !== userId) throw new Error("Not found");
    return await ctx.db.insert("contentTopics", {
      projectId,
      ...rest,
      status: rest.status ?? ("idea" as const),
      createdBy: userId,
      createdAt: Date.now(),
    });
  },
});

export const updateTopic = mutation({
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
  handler: async (ctx, { id, ...patch }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    const topic = await ctx.db.get(id);
    if (!topic) throw new Error("Not found");
    const project = await ctx.db.get(topic.projectId);
    if (!project || project.ownerId !== userId) throw new Error("Not found");
    const clean = Object.fromEntries(
      Object.entries(patch).filter(([, v]) => v !== undefined),
    );
    if (Object.keys(clean).length) await ctx.db.patch(id, clean);
  },
});

export const removeTopic = mutation({
  args: { id: v.id("contentTopics") },
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    const topic = await ctx.db.get(id);
    if (!topic) throw new Error("Not found");
    const project = await ctx.db.get(topic.projectId);
    if (!project || project.ownerId !== userId) throw new Error("Not found");
    await ctx.db.delete(id);
  },
});

/* ── Collaborative doc snapshots (Yjs state per content piece) ────────── */

export const getDoc = query({
  args: { pieceId: v.id("contentPieces") },
  handler: async (ctx, { pieceId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const piece = await ctx.db.get(pieceId);
    if (!piece) return null;
    const project = await ctx.db.get(piece.projectId);
    if (!project || project.ownerId !== userId) return null;
    const doc = await ctx.db
      .query("contentDocs")
      .withIndex("by_piece", (q) => q.eq("pieceId", pieceId))
      .first();
    return doc ? { snapshot: doc.snapshot, updatedAt: doc.updatedAt } : null;
  },
});

export const saveDoc = mutation({
  args: {
    pieceId: v.id("contentPieces"),
    snapshot: v.bytes(),
    bodyText: v.optional(v.string()),
    bodyHtml: v.optional(v.string()),
  },
  handler: async (ctx, { pieceId, snapshot, bodyText, bodyHtml }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    const piece = await ctx.db.get(pieceId);
    if (!piece) throw new Error("Not found");
    const project = await ctx.db.get(piece.projectId);
    if (!project || project.ownerId !== userId) throw new Error("Not found");
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
