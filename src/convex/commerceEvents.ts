import { internalMutation } from "./_generated/server";
import { v } from "convex/values";

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
