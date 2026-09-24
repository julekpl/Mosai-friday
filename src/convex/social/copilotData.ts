import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";

/**
 * Internal data helpers for the social copilot. Kept in a separate file
 * because Convex forbids queries/mutations in "use node" action files.
 */

export const getDraftReferences = internalQuery({
  args: {
    projectId: v.id("projects"),
    campaignId: v.optional(v.id("campaigns")),
    contentId: v.optional(v.id("contentPieces")),
  },
  handler: async (ctx, { projectId, campaignId, contentId }) => {
    const campaign = campaignId ? await ctx.db.get(campaignId) : null;
    if (campaignId && (!campaign || campaign.projectId !== projectId)) {
      throw new Error("Not found");
    }
    const content = contentId ? await ctx.db.get(contentId) : null;
    if (contentId && (!content || content.projectId !== projectId)) {
      throw new Error("Not found");
    }
    return campaign ? { name: campaign.name, channel: campaign.channel } : null;
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
    // Recheck at the write boundary: no caller may attach a foreign campaign
    // or content row to a post, even if an earlier action query succeeded.
    if (args.campaignId) {
      const campaign = await ctx.db.get(args.campaignId);
      if (!campaign || campaign.projectId !== args.projectId) throw new Error("Not found");
    }
    if (args.contentId) {
      const content = await ctx.db.get(args.contentId);
      if (!content || content.projectId !== args.projectId) throw new Error("Not found");
    }
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
