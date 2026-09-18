import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

const PROVIDERS = [
  "ga4",
  "gsc",
  "gads",
  "meta",
  "tiktok",
  "posthog",
  "matomo",
  "gtm",
] as const;
export type Provider = (typeof PROVIDERS)[number];

export const list = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const project = await ctx.db.get(projectId);
    if (!project || project.ownerId !== userId) return [];
    return await ctx.db
      .query("connections")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
  },
});

/** Connect a provider. OAuth is not wired yet — this records the intent and
 *  marks the connection pending-error-free ("connected" with label) so module
 *  UIs can react to status. Replace the body with the real OAuth flow later. */
export const connect = mutation({
  args: { projectId: v.id("projects"), provider: v.string() },
  handler: async (ctx, { projectId, provider }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    const project = await ctx.db.get(projectId);
    if (!project || project.ownerId !== userId) throw new Error("Not found");
    const existing = await ctx.db
      .query("connections")
      .withIndex("by_project_provider", (q) =>
        q.eq("projectId", projectId).eq("provider", provider),
      )
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        status: "connected",
        lastSyncedAt: Date.now(),
      });
      return existing._id;
    }
    return await ctx.db.insert("connections", {
      projectId,
      provider,
      status: "connected",
      accountLabel: `${project.name} · ${provider}`,
      lastSyncedAt: Date.now(),
    });
  },
});

export const disconnect = mutation({
  args: { projectId: v.id("projects"), provider: v.string() },
  handler: async (ctx, { projectId, provider }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    const project = await ctx.db.get(projectId);
    if (!project || project.ownerId !== userId) throw new Error("Not found");
    const existing = await ctx.db
      .query("connections")
      .withIndex("by_project_provider", (q) =>
        q.eq("projectId", projectId).eq("provider", provider),
      )
      .first();
    if (existing) await ctx.db.delete(existing._id);
  },
});
