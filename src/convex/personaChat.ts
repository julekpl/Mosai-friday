import { moduleMutation, moduleQuery } from "./guards";
import { v } from "convex/values";

export const list = moduleQuery("understand", {
  args: { projectId: v.id("projects"), personaId: v.id("personas") },
  handler: async (ctx, { projectId, personaId }, access) => {
    const scope = await access.ownedProject(projectId);
    if (!scope) return [];
    return await ctx.db
      .query("personaMessages")
      .withIndex("by_project_persona", (q) =>
        q.eq("projectId", projectId).eq("personaId", personaId),
      )
      .collect();
  },
});

/** Persist one user/assistant exchange produced by ai.personaChat. */
export const append = moduleMutation("understand", {
  args: {
    projectId: v.id("projects"),
    personaId: v.id("personas"),
    mode: v.union(v.literal("persona"), v.literal("analyst")),
    userMessage: v.string(),
    assistantMessage: v.string(),
  },
  handler: async (
    ctx,
    { projectId, personaId, mode, userMessage, assistantMessage },
    access,
  ) => {
    await access.requireProject(projectId);

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

export const clear = moduleMutation("understand", {
  args: {
    projectId: v.id("projects"),
    personaId: v.id("personas"),
    mode: v.union(v.literal("persona"), v.literal("analyst")),
  },
  handler: async (ctx, { projectId, personaId, mode }, access) => {
    await access.requireProject(projectId);
    const msgs = await ctx.db
      .query("personaMessages")
      .withIndex("by_project_persona", (q) =>
        q.eq("projectId", projectId).eq("personaId", personaId),
      )
      .collect();
    for (const m of msgs) if (m.mode === mode) await ctx.db.delete(m._id);
  },
});
