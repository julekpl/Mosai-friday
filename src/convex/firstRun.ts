import { v } from "convex/values";
import { orgMutation } from "./guards";
import { FIRST_RUN_STEPS, type FirstRunStep } from "../shared/firstRun";

/**
 * FR-M (owner decision O4, 26 Sep 2026): where owners stop in the six-screen
 * first run. The project row only exists after the last screen, so progress
 * lives in a small per-user row keyed by a random key the wizard makes when
 * it opens. Metrics only: the wizard never waits for these writes.
 *
 * Stored: the user, when the wizard opened and the furthest step reached
 * ("created" once the project exists). No answers, no project link, nothing
 * about the business.
 */

const stepValidator = v.union(...FIRST_RUN_STEPS.map((step) => v.literal(step)));
const rank = (step: string | undefined) => FIRST_RUN_STEPS.indexOf(step as FirstRunStep);
/** A key older than this starts a new session instead of reviving an old one. */
const SESSION_WINDOW_MS = 24 * 60 * 60_000;

export const record = orgMutation({
  args: {
    sessionKey: v.string(),
    step: stepValidator,
  },
  handler: async (ctx, { sessionKey, step }, access) => {
    const key = sessionKey.trim();
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(key)) throw new Error("Invalid session key");
    const userId = await access.requireUser();
    const now = Date.now();
    const row = await ctx.db
      .query("firstRunSessions")
      .withIndex("by_user_key", (q) => q.eq("userId", userId).eq("sessionKey", key))
      .unique();
    if (!row || now - row.startedAt > SESSION_WINDOW_MS) {
      if (row) return null; // stale key: ignore rather than rewrite history
      await ctx.db.insert("firstRunSessions", {
        userId,
        sessionKey: key,
        startedAt: now,
        lastStep: step,
        updatedAt: now,
      });
      return null;
    }
    if (rank(step) > rank(row.lastStep)) await ctx.db.patch(row._id, { lastStep: step, updatedAt: now });
    return null;
  },
});
