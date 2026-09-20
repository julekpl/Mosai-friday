import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";
import { projectCtx } from "../dal";

/**
 * Internal data helpers for the social copilot. Kept in a separate file
 * because Convex forbids queries/mutations in "use node" action files.
 */

export const getPersona = internalQuery({
  args: { projectId: v.id("projects"), personaId: v.id("personas") },
  handler: async (ctx, { projectId, personaId }) => {
    await projectCtx(ctx, projectId);
    const persona = await ctx.db.get(personaId);
    return persona?.projectId === projectId ? persona : null;
  },
});

export const getCampaign = internalQuery({
  args: { projectId: v.id("projects"), campaignId: v.id("campaigns") },
  handler: async (ctx, { projectId, campaignId }) => {
    await projectCtx(ctx, projectId);
    const campaign = await ctx.db.get(campaignId);
    return campaign?.projectId === projectId ? campaign : null;
  },
});

export const assertProjectAccess = internalQuery({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    await projectCtx(ctx, projectId);
    return true;
  },
});

/** Insert an AI-drafted post variant as an honest, reviewable DRAFT. */
export const insertCopilotDraft = internalMutation({
  args: {
    projectId: v.id("projects"),
    contentId: v.optional(v.id("contentPieces")),
    campaignId: v.optional(v.id("campaigns")),
    channel: v.string(),
    body: v.string(),
    createdBy: v.id("users"),
  },
  handler: async (ctx, args) => {
    await projectCtx(ctx, args.projectId);
    return await ctx.db.insert("posts", {
      projectId: args.projectId,
      contentId: args.contentId,
      campaignId: args.campaignId,
      channel: args.channel,
      body: args.body,
      status: "draft",
      origin: "copilot",
      createdAt: Date.now(),
    });
  },
});
