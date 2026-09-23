import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "../_generated/server";
import type { GenericActionCtx } from "convex/server";
import type { AnyDataModel } from "convex/server";
import { moduleAction, moduleMutation } from "../guards";
import type { Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { getSocialAdapter } from "./adapters";
import { isSocialPlatform } from "./platforms";
import type { RefreshOutcome } from "./credentials";
import { capabilityMessage } from "../lib/capabilities";

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
export const schedule = moduleMutation("promote", {
  // Scheduling commits the post to be published by the queue worker, so it
  // carries the same `publish` capability as publishing it right now.
  capability: "promote.publish",
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
export const unschedule = moduleMutation("promote", {
  args: { id: v.id("posts") },
  handler: async (ctx, { id }, access) => {
    const row = await access.ownedRow(await ctx.db.get(id));
    if (!row) throw new Error("Not found");
    if (row.status !== "scheduled") throw new Error("Only scheduled posts can be pulled back");
    await ctx.db.patch(id, { status: "draft", scheduledFor: undefined });
  },
});

/** Publish now — only drafts, explicit user action. */
export const publishNow = moduleAction("promote", {
  // Sending a post to a live platform is the `publish` verb.
  capability: "promote.publish",
  args: { id: v.id("posts") },
  handler: async (ctx, { id }, access) => {
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
      try {
        await publishOne(ctx, post._id);
        // publishOne records failures honestly on the post itself.
      } catch {
        // Belt and braces: one post's unexpected throw must never abort the
        // batch — record a safe failure for THIS post and continue with the
        // next due post. Nothing here claims the post was published.
        try {
          await ctx.runMutation(internal.social.executor.markFailed, {
            id: post._id,
            errorDetail:
              "Not published — an unexpected internal error occurred while publishing. Reconnect the platform in Promote and retry.",
          });
        } catch {
          // The row itself could not be updated; keep the batch alive anyway.
        }
      }
    }
    return { processed: due.length };
  },
});

type RunCtx = Pick<
  GenericActionCtx<AnyDataModel>,
  "runQuery" | "runMutation" | "runAction"
>;

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

  // T2.3 — the job respects the entitlement. Disabling Promote does not let a
  // queued post slip out: the capability is resolved from the **organization's
  // plan** (a job has no user role), and the post records why instead of ever
  // claiming it was sent. This is the "jobs change consistently" half of the
  // T2.3 acceptance: tests/unit/entitlements.test.ts proves it.
  const gate = await ctx.runQuery(internal.guards.capabilityStateForProject, {
    projectId: post.projectId,
    capability: "promote.publish",
  });
  if (!gate || gate.state !== "included") {
    const reason =
      (gate &&
        capabilityMessage(gate, { module: "promote", action: "publish" })) ??
      "Promote is not available for this project.";
    const err = `Not published — ${reason}`;
    await ctx.runMutation(internal.social.executor.markFailed, {
      id: postId,
      errorDetail: err,
    });
    return { ok: false, error: err };
  }

  // BP-04 handoff: the credential DOCUMENT comes from a typed internal query,
  // and it is `credential._id` — never the document itself — that travels to
  // the refresh action (the old code cast the document to an Id here, which
  // aborted the publish at argument validation).
  const credential = (await ctx.runQuery(
    internal.social.credentials.getCredential,
    { projectId: post.projectId, platform: post.channel },
  )) as {
    _id: Id<"socialCredentials">;
    providerAccountId?: string | undefined;
  } | null;
  if (!credential) {
    const err = `Platform "${post.channel}" is not connected — connect it in Promote before publishing.`;
    await ctx.runMutation(internal.social.executor.markFailed, {
      id: postId,
      errorDetail: err,
    });
    return { ok: false, error: err };
  }

  // The token refresh runs in an internal ACTION (Convex forbids `fetch` in
  // mutations; the action owns the lease/version protocol). Its failure is
  // caught at THIS post's boundary: the post records the action's redacted
  // message as its honest failure and the due-post batch continues.
  const refreshed = (await ctx.runAction(
    internal.social.credentialActions.refreshIfNeeded,
    { credId: credential._id },
  )) as RefreshOutcome;
  if (!refreshed.ok) {
    const err = `Not published — ${refreshed.message}`;
    await ctx.runMutation(internal.social.executor.markFailed, {
      id: postId,
      errorDetail: err,
    });
    return { ok: false, error: err };
  }

  const result = await getSocialAdapter(post.channel).publish(
    refreshed.accessToken,
    credential.providerAccountId,
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
