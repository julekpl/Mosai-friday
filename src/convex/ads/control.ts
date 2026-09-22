
import { v } from "convex/values";
import { action, internalMutation, internalQuery, mutation, query } from "../_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { getAdapter } from "./adapters";
import { isPlatform, type Platform } from "./platforms";
import { assertModule } from "../guards";

/**
 * Change control: nothing touches a live ad platform without a drafted
 * change, an explicit human approval, an idempotency key, and an immutable
 * execution receipt. (Pattern validated against claude-ads' safety model.)
 *
 *   draft → approved → executed (receipt)   | rejected | failed
 */

/** Create a change request (draft). The UI and the copilot both land here. */
export const createDraft = mutation({
  args: {
    projectId: v.id("projects"),
    platform: v.string(),
    accountId: v.string(),
    campaignId: v.string(),
    campaignName: v.string(),
    kind: v.union(
      v.literal("pause"),
      v.literal("resume"),
      v.literal("set_daily_budget"),
    ),
    payload: v.optional(v.number()),
    beforeValue: v.optional(v.number()),
    rationale: v.optional(v.string()),
    origin: v.union(v.literal("user"), v.literal("copilot")),
  },
  handler: async (ctx, args) => {
    await assertModule(ctx, "promote");
    const userId = (await getAuthUserId(ctx)) as Id<"users">;
    const project = await ctx.db.get(args.projectId);
    if (!project || project.ownerId !== userId) throw new Error("Not found");
    if (!isPlatform(args.platform)) throw new Error("Unknown platform");
    if (args.kind === "set_daily_budget") {
      if (!args.payload || args.payload <= 0) {
        throw new Error("Budget change requires a positive payload (cents)");
      }
      // Guardrail: budgets between €1 and €10,000 per day.
      if (args.payload < 100 || args.payload > 1_000_000) {
        throw new Error("Daily budget out of allowed range (€1 – €10,000)");
      }
    }
    return await ctx.db.insert("adsChangeRequests", {
      projectId: args.projectId,
      platform: args.platform,
      accountId: args.accountId,
      campaignId: args.campaignId,
      campaignName: args.campaignName,
      kind: args.kind,
      payload: args.payload,
      beforeValue: args.beforeValue,
      rationale: args.rationale,
      origin: args.origin,
      status: "draft",
      requestedBy: userId,
      createdAt: Date.now(),
    });
  },
});

/** Approve a draft. This is the human gate — nothing executes without it. */
export const approve = mutation({
  args: { id: v.id("adsChangeRequests") },
  handler: async (ctx, { id }) => {
    await assertModule(ctx, "promote");
    const userId = (await getAuthUserId(ctx)) as Id<"users">;
    const row = await ctx.db.get(id);
    if (!row) throw new Error("Not found");
    const project = await ctx.db.get(row.projectId);
    if (!project || project.ownerId !== userId) throw new Error("Not found");
    if (row.status !== "draft") throw new Error("Only drafts can be approved");
    // Idempotency key: a uuid-style hex string generated without node:crypto.
    const idempotencyKey = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 10)}`;
    await ctx.db.patch(id, {
      status: "approved",
      idempotencyKey,
      decidedAt: Date.now(),
    });
  },
});

/** Reject a draft. */
export const reject = mutation({
  args: { id: v.id("adsChangeRequests") },
  handler: async (ctx, { id }) => {
    await assertModule(ctx, "promote");
    const userId = (await getAuthUserId(ctx)) as Id<"users">;
    const row = await ctx.db.get(id);
    if (!row) throw new Error("Not found");
    const project = await ctx.db.get(row.projectId);
    if (!project || project.ownerId !== userId) throw new Error("Not found");
    if (row.status !== "draft") throw new Error("Only drafts can be rejected");
    await ctx.db.patch(id, { status: "rejected", decidedAt: Date.now() });
  },
});

/** Execute an approved change against the provider. Records a receipt either
 *  way; the receipt is immutable (insert-only). */
export const execute = action({
  args: { id: v.id("adsChangeRequests") },
  handler: async (ctx, { id }) => {
    const userId = (await getAuthUserId(ctx as never)) as Id<"users">;
    if (!userId) throw new Error("Not signed in");
    await ctx.runQuery(internal.billing.checkModule, {
      userId,
      module: "promote",
    });
    const row = await ctx.runQuery(internal.ads.control.getChange, { id });
    if (!row) throw new Error("Not found");
    const project = await ctx.runQuery(internal.ads.control.getProject, {
      projectId: row.projectId,
    });
    if (!project || project.ownerId !== userId) throw new Error("Not found");
    if (row.status !== "approved") {
      throw new Error("Only approved changes can be executed");
    }
    if (!row.idempotencyKey) throw new Error("Missing idempotency key");

    const platform = row.platform as Platform;
    const cred = await ctx.runQuery(internal.ads.credentials.getCredId, {
      projectId: row.projectId,
      platform,
    });
    if (!cred) throw new Error(`No ${platform} credential — reconnect the platform`);
    const accessToken = await ctx.runMutation(
      internal.ads.credentials.refreshIfNeeded,
      { credId: cred._id },
    );

    const adapter = getAdapter(platform);
    let result: { ok: true; providerRef: string } | { ok: false; error: string };
    try {
      if (row.kind === "pause") {
        result = await adapter.pauseCampaign(
          accessToken,
          row.accountId,
          row.campaignId,
        );
      } else if (row.kind === "resume") {
        result = await adapter.resumeCampaign(
          accessToken,
          row.accountId,
          row.campaignId,
        );
      } else {
        if (!row.payload) throw new Error("Missing budget payload");
        result = await adapter.setDailyBudget(
          accessToken,
          row.accountId,
          row.campaignId,
          row.payload,
        );
      }
    } catch (e) {
      result = {
        ok: false,
        error: e instanceof Error ? e.message : "provider call failed",
      };
    }

    // Record the receipt + update the change row.
    await ctx.runMutation(internal.ads.control.recordExecution, {
      changeId: id,
      result,
      executedBy: userId,
    });
    return result;
  },
});

/** List change requests (drafts first) + executions receipts. */
export const listChanges = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const project = await ctx.db.get(projectId);
    if (!project || project.ownerId !== userId) return [];
    const rows = await ctx.db
      .query("adsChangeRequests")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
    return rows.sort((a, b) => b.createdAt - a.createdAt);
  },
});

export const listExecutions = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const project = await ctx.db.get(projectId);
    if (!project || project.ownerId !== userId) return [];
    const rows = await ctx.db
      .query("adsExecutions")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
    return rows.sort((a, b) => b.createdAt - a.createdAt);
  },
});

/* ── internal helpers ─────────────────────────────────────────────────── */

export const getChange = internalQuery({
  args: { id: v.id("adsChangeRequests") },
  handler: async (ctx, { id }) => {
    return await ctx.db.get(id);
  },
});

export const getProject = internalQuery({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    return await ctx.db.get(projectId);
  },
});

export const recordExecution = internalMutation({
  args: {
    changeId: v.id("adsChangeRequests"),
    result: v.union(
      v.object({ ok: v.literal(true), providerRef: v.string() }),
      v.object({ ok: v.literal(false), error: v.string() }),
    ),
    executedBy: v.id("users"),
  },
  handler: async (ctx, { changeId, result, executedBy }) => {
    const change = await ctx.db.get(changeId);
    if (!change) throw new Error("Change not found");
    await ctx.db.insert("adsExecutions", {
      projectId: change.projectId,
      changeId,
      platform: change.platform,
      campaignId: change.campaignId,
      kind: change.kind,
      result: result.ok ? "success" : "error",
      providerRef: result.ok ? result.providerRef : undefined,
      errorDetail: result.ok ? undefined : result.error,
      executedBy,
      createdAt: Date.now(),
    });
    await ctx.db.patch(changeId, {
      status: result.ok ? "executed" : "failed",
      decidedAt: Date.now(),
    });
  },
});
