import { moduleMutation, moduleQuery } from "./guards";
import { v } from "convex/values";
import { isSocialPlatform } from "./social/platforms";
import { getSocialAdapter } from "./social/adapters";

export const list = moduleQuery("promote", {
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }, access) => {
    const scope = await access.ownedProject(projectId);
    if (!scope) return [];
    return await ctx.db
      .query("posts")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
  },
});

export const create = moduleMutation("promote", {
  args: {
    projectId: v.id("projects"),
    channel: v.string(), // facebook | instagram | linkedin | x | tiktok
    body: v.string(),
    mediaUrl: v.optional(v.string()),
    campaignId: v.optional(v.id("campaigns")),
    scheduledFor: v.optional(v.number()),
    contentId: v.optional(v.id("contentPieces")),
  },
  handler: async (ctx, args, access) => {
    await access.requireProject(args.projectId);
    if (!isSocialPlatform(args.channel)) throw new Error("Unknown platform");

    // Fail early, not at publish time: run the platform adapter's validation.
    const validationError = getSocialAdapter(args.channel).validate(
      args.body,
      args.mediaUrl,
    );
    if (validationError) throw new Error(validationError);

    const { projectId, scheduledFor, ...rest } = args;
    return await ctx.db.insert("posts", {
      projectId,
      ...rest,
      scheduledFor,
      // A post only becomes "scheduled" via the explicit executor.schedule
      // action; creating with a time keeps it a draft so the user confirms.
      status: "draft",
      origin: "user" as const,
      createdAt: Date.now(),
    });
  },
});

export const update = moduleMutation("promote", {
  args: {
    id: v.id("posts"),
    body: v.optional(v.string()),
    channel: v.optional(v.string()),
    mediaUrl: v.optional(v.string()),
    campaignId: v.optional(v.id("campaigns")),
    scheduledFor: v.optional(v.number()),
    status: v.optional(
      v.union(
        v.literal("draft"),
        v.literal("scheduled"),
        v.literal("published"),
        v.literal("failed"),
      ),
    ),
  },
  handler: async (ctx, { id, ...patch }, access) => {
    const doc = await access.ownedRow(await ctx.db.get(id));
    if (!doc) throw new Error("Not found");
    // Status transitions that touch real publishing go through the executor
    // (schedule / publishNow); direct status writes stay for drafts/edits.
    if (patch.status && doc.status !== "draft") {
      throw new Error(
        "Use Schedule / Publish now / Pull back for posts that are scheduled, published or failed.",
      );
    }
    const clean = Object.fromEntries(
      Object.entries(patch).filter(([, v]) => v !== undefined),
    );
    if (Object.keys(clean).length) await ctx.db.patch(id, clean);
  },
});

export const remove = moduleMutation("promote", {
  args: { id: v.id("posts") },
  handler: async (ctx, { id }, access) => {
    const row = await access.ownedRow(await ctx.db.get(id));
    if (!row) throw new Error("Not found");
    await ctx.db.delete(id);
  },
});
