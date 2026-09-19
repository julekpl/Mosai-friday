import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";

/**
 * Internal data helpers for the social copilot. Kept in a separate file
 * because Convex forbids queries/mutations in "use node" action files.
 */

export const getPersona = internalQuery({
  args: { personaId: v.id("personas") },
  handler: async (ctx, { personaId }) => await ctx.db.get(personaId),
});

export const getCampaign = internalQuery({
  args: { campaignId: v.id("campaigns") },
  handler: async (ctx, { campaignId }) => await ctx.db.get(campaignId),
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
