import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  args: { projectId: v.id("projects"), personaId: v.id("personas") },
  handler: async (ctx, { projectId, personaId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const project = await ctx.db.get(projectId);
    if (!project || project.ownerId !== userId) return [];
    return await ctx.db
      .query("personaMessages")
      .withIndex("by_project_persona", (q) =>
        q.eq("projectId", projectId).eq("personaId", personaId),
      )
      .collect();
  },
});

/** Persist one user/assistant exchange produced by ai.personaChat. */
export const append = mutation({
  args: {
    projectId: v.id("projects"),
    personaId: v.id("personas"),
    mode: v.union(v.literal("persona"), v.literal("analyst")),
    userMessage: v.string(),
    assistantMessage: v.string(),
  },
  handler: async (ctx, { projectId, personaId, mode, userMessage, assistantMessage }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    const project = await ctx.db.get(projectId);
    if (!project || project.ownerId !== userId) throw new Error("Not found");

    const now = Date.now();
    await ctx.db.insert("personaMessages", {
      projectId,
      personaId,
      mode,
      role: "user",
      content: userMessage,
      createdAt: now,
    });
    await ctx.db.insert("personaMessages", {
      projectId,
      personaId,
      mode,
      role: "assistant",
      content: assistantMessage,
      createdAt: now + 1,
    });
  },
});

export const clear = mutation({
  args: {
    projectId: v.id("projects"),
    personaId: v.id("personas"),
    mode: v.union(v.literal("persona"), v.literal("analyst")),
  },
  handler: async (ctx, { projectId, personaId, mode }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    const project = await ctx.db.get(projectId);
    if (!project || project.ownerId !== userId) throw new Error("Not found");
    const msgs = await ctx.db
      .query("personaMessages")
      .withIndex("by_project_persona", (q) =>
        q.eq("projectId", projectId).eq("personaId", personaId),
      )
      .collect();
    for (const m of msgs) if (m.mode === mode) await ctx.db.delete(m._id);
  },
});
