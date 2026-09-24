import { internalMutation, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireProject } from "./guards";

/**
 * Disabled until consent can be read from a server-owned record under an
 * approved EU/EEA policy. Client-supplied consent is not evidence and this
 * endpoint intentionally accepts no event or consent payload.
 */
export const collect = mutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    await requireProject(ctx, projectId);
    return { status: "unavailable" as const };
  },
});

/* ── M1 analytics signals (pre-registered in SELL-EXECUTION-PLAN) ────────
 * Internal-only: written from sell mutations, read by nothing yet. Rows are
 * tiny (event name + dimension bag). This gives the M1 decision gate real
 * data without building an analytics product. */

export const log = internalMutation({
  args: {
    projectId: v.id("projects"),
    event: v.string(),
    meta: v.optional(v.any()),
  },
  handler: async (ctx, { projectId, event, meta }) => {
    await ctx.db.insert("commerceEvents", {
      projectId,
      event,
      meta,
      createdAt: Date.now(),
    });
  },
});
