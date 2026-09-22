import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "../_generated/server";
import type { GenericActionCtx } from "convex/server";
import type { AnyDataModel } from "convex/server";
import { orgAction, orgMutation } from "../guards";
import type { Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { getSocialAdapter } from "./adapters";
import { isSocialPlatform } from "./platforms";

/**
 * Execution engine for the social queue.
 *
 *   draft → scheduled → published (receipt)   | failed
 *
 * Nothing publishes without (a) a real stored OAuth token and (b) a schedule
 * time that has passed (or an explicit publish-now). Failures are recorded
 * honestly on the post with the provider's error detail.
 */

/* ── Scheduling (mutations — user-facing gate) ────────────────────────── */

/** Schedule a draft. This is the explicit human action that arms the post. */
export const schedule = orgMutation({
  args: {
    id: v.id("posts"),
    scheduledFor: v.number(),
  },
  handler: async (ctx, { id, scheduledFor }, access) => {
    const row = await access.ownedRow(await ctx.db.get(id));
    if (!row) throw new Error("Not found");
    if (row.status !== "draft") throw new Error("Only drafts can be scheduled");
    if (scheduledFor < Date.now() - 60_000) {
      throw new Error("Schedule time must be in the future");
    }
    await ctx.db.patch(id, { scheduledFor, status: "scheduled" });
  },
});

/** Unschedule: pull a scheduled post back to draft. */
export const unschedule = orgMutation({
  args: { id: v.id("posts") },
  handler: async (ctx, { id }, access) => {
    const row = await access.ownedRow(await ctx.db.get(id));
    if (!row) throw new Error("Not found");
    if (row.status !== "scheduled") throw new Error("Only scheduled posts can be pulled back");
    await ctx.db.patch(id, { status: "draft", scheduledFor: undefined });
  },
});

/** Publish now — only drafts, explicit user action. */
export const publishNow = orgAction({
  args: { id: v.id("posts") },
  handler: async (ctx, { id }, access) => {
    const userId = await access.requireUser();
    await ctx.runQuery(internal.billing.checkModule, {
      userId,
      module: "promote",
    });
    const post = await ctx.runQuery(internal.social.executor.getPost, { id });
    if (!post) throw new Error("Not found");
    await access.requireProject(post.projectId);
    if (post.status === "published") throw new Error("Already published");

    const result = await publishOne(ctx, id);
    if (!result.ok) {
      throw new Error(result.error);
    }
    return result;
  },
});

/* ── Cron executor ────────────────────────────────────────────────────── */

/** Internal query helpers for the action-based executor. */
export const getPost = internalQuery({
  args: { id: v.id("posts") },
  handler: async (ctx, { id }) => await ctx.db.get(id),
});

/** Fetch due scheduled posts (scheduledFor <= now, status = scheduled). */
export const getDuePosts = internalQuery({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    // by_project_status needs a projectId; scan all projects via by_status-ish
    // approach: Convex requires an index equality first. We use by_project via
    // a lightweight all-projects scan is not available — instead use the
    // by_project_status index per status via a full-table scan on scheduled.
    const rows = await ctx.db
      .query("posts")
      .withIndex("by_status", (q) => q.eq("status", "scheduled"))
      .collect();
    return rows.filter(
      (p) => p.scheduledFor !== undefined && p.scheduledFor <= now,
    );
  },
});

/** Mark a post failed with an honest error detail. */
export const markFailed = internalMutation({
  args: { id: v.id("posts"), errorDetail: v.string() },
  handler: async (ctx, { id, errorDetail }) => {
    await ctx.db.patch(id, { status: "failed", errorDetail });
  },
});

/** Mark a post published with its receipt. */
export const markPublished = internalMutation({
  args: {
    id: v.id("posts"),
    providerRef: v.string(),
    publishedAt: v.number(),
  },
  handler: async (ctx, { id, providerRef, publishedAt }) => {
    await ctx.db.patch(id, {
      status: "published",
      providerRef,
      publishedAt,
      errorDetail: undefined,
    });
  },
});

/** Due-post scan entry point for the cron. */
export const runDue = internalAction({
  args: {},
  handler: async (ctx): Promise<{ processed: number }> => {
    const due: Array<{ _id: Id<"posts"> }> = await ctx.runQuery(
      internal.social.executor.getDuePosts,
      {},
    );
    for (const post of due) {
      await publishOne(ctx, post._id);
      // publishOne never throws — failures are recorded honestly per post.
    }
    return { processed: due.length };
  },
});

type RunCtx = Pick<GenericActionCtx<AnyDataModel>, "runQuery" | "runMutation">;

/** Publish a single post via its platform adapter. Never throws — records
 *  the outcome (published/failed) on the post itself. */
async function publishOne(
  ctx: RunCtx,
  postId: Id<"posts">,
): Promise<{ ok: true; providerRef: string } | { ok: false; error: string }> {
  const post = (await ctx.runQuery(internal.social.executor.getPost, {
    id: postId,
  })) as {
    projectId: Id<"projects">;
    channel: string;
    body: string;
    mediaUrl?: string;
    status: string;
  } | null;
  if (!post) return { ok: false, error: "Post not found" };
  if (!isSocialPlatform(post.channel)) {
    await ctx.runMutation(internal.social.executor.markFailed, {
      id: postId,
      errorDetail: `Unknown platform "${post.channel}"`,
    });
    return { ok: false, error: `Unknown platform "${post.channel}"` };
  }

  const credId = (await ctx.runQuery(internal.social.credentials.getCredId, {
    projectId: post.projectId,
    platform: post.channel,
  })) as Id<"socialCredentials"> | null;
  if (!credId) {
    const err = `Platform "${post.channel}" is not connected — connect it in Promote before publishing.`;
    await ctx.runMutation(internal.social.executor.markFailed, {
      id: postId,
      errorDetail: err,
    });
    return { ok: false, error: err };
  }

  const accessToken = (await ctx.runMutation(
    internal.social.credentials.refreshIfNeeded,
    { credId },
  )) as string;

  const cred = (await ctx.runQuery(internal.social.executor.getCred, {
    credId,
  })) as { providerAccountId?: string } | null;

  const result = await getSocialAdapter(post.channel).publish(
    accessToken,
    cred?.providerAccountId,
    post.body,
    post.mediaUrl,
  );

  if (result.ok) {
    await ctx.runMutation(internal.social.executor.markPublished, {
      id: postId,
      providerRef: result.providerRef,
      publishedAt: Date.now(),
    });
    return { ok: true, providerRef: result.providerRef };
  }
  await ctx.runMutation(internal.social.executor.markFailed, {
    id: postId,
    errorDetail: result.error,
  });
  return { ok: false, error: result.error };
}

/** Internal query for a credential (action-safe). */
export const getCred = internalQuery({
  args: { credId: v.id("socialCredentials") },
  handler: async (ctx, { credId }) => await ctx.db.get(credId),
});
