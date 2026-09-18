import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

/** Metadata list of files attached to a project. */
export const list = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const project = await ctx.db.get(projectId);
    if (!project || project.ownerId !== userId) return [];
    return await ctx.db
      .query("projectFiles")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
  },
});

/** Short-lived upload URL the client PUTs the raw file bytes to. */
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await getAuthUserId(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

/** Register an uploaded file on the project (after client upload finished). */
export const attach = mutation({
  args: {
    projectId: v.id("projects"),
    storageId: v.id("_storage"),
    name: v.string(),
    mimeType: v.optional(v.string()),
    sizeBytes: v.optional(v.number()),
    excerpt: v.optional(v.string()),
  },
  handler: async (ctx, { projectId, ...rest }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    const project = await ctx.db.get(projectId);
    if (!project || project.ownerId !== userId) throw new Error("Not found");
    return await ctx.db.insert("projectFiles", {
      projectId,
      ...rest,
      uploadedBy: userId,
      createdAt: Date.now(),
    });
  },
});

/** Read URL for previewing / downloading an attached file. */
export const getFileUrl = query({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, { storageId }) => {
    await getAuthUserId(ctx);
    return await ctx.storage.getUrl(storageId);
  },
});

export const remove = mutation({
  args: { id: v.id("projectFiles") },
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    const file = await ctx.db.get(id);
    if (!file) throw new Error("Not found");
    const project = await ctx.db.get(file.projectId);
    if (!project || project.ownerId !== userId) throw new Error("Not found");
    await ctx.storage.delete(file.storageId);
    await ctx.db.delete(id);
  },
});
