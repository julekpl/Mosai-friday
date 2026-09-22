import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation, query } from "./_generated/server";
import { orgMutation, orgQuery } from "./guards";
import { v } from "convex/values";

/** Metadata list of files attached to a project. */
export const list = orgQuery({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }, access) => {
    const scope = await access.ownedProject(projectId);
    if (!scope) return [];
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
export const attach = orgMutation({
  args: {
    projectId: v.id("projects"),
    storageId: v.id("_storage"),
    name: v.string(),
    mimeType: v.optional(v.string()),
    sizeBytes: v.optional(v.number()),
    excerpt: v.optional(v.string()),
  },
  handler: async (ctx, { projectId, ...rest }, access) => {
    const { userId } = await access.requireProject(projectId);
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

export const remove = orgMutation({
  args: { id: v.id("projectFiles") },
  handler: async (ctx, { id }, access) => {
    const file = await access.ownedRow(await ctx.db.get(id));
    if (!file) throw new Error("Not found");
    await ctx.storage.delete(file.storageId);
    await ctx.db.delete(id);
  },
});
