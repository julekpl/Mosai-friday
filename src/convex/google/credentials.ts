import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";
import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { hasProjectAccess } from "../guards";
import { GOOGLE_STATE_PLATFORM, GOOGLE_STATE_TTL_MS, type GoogleSource } from "./config";

/**
 * Internal storage for the Grow Google connection. Nothing here is reachable
 * from a client: tokens stay server-side, and every state transition that
 * means "connected" or "succeeded" is written only by server code holding a
 * Google response (AGENTS.md rule 5).
 *
 * Token refresh follows the ads BP-04 lease protocol (claim lease + observed
 * version → provider request in an action → save only while the lease is
 * held and the version is unchanged → release on failure).
 */

const source = v.union(v.literal("ga4"), v.literal("gsc"), v.literal("gads"));

const dailyRow = v.object({
  date: v.string(),
  sessions: v.optional(v.number()),
  users: v.optional(v.number()),
  keyEvents: v.optional(v.number()),
  engagementRate: v.optional(v.number()),
  clicks: v.optional(v.number()),
  impressions: v.optional(v.number()),
  ctr: v.optional(v.number()),
  position: v.optional(v.number()),
  costMicros: v.optional(v.number()),
  conversions: v.optional(v.number()),
  currency: v.optional(v.string()),
});

const topRow = v.object({
  kind: v.union(
    v.literal("totals_current"),
    v.literal("totals_previous"),
    v.literal("query"),
    v.literal("page"),
    v.literal("landing_page"),
    v.literal("channel"),
    v.literal("campaign"),
  ),
  label: v.string(),
  key: v.optional(v.string()),
  status: v.optional(v.string()),
  sessions: v.optional(v.number()),
  users: v.optional(v.number()),
  keyEvents: v.optional(v.number()),
  engagementRate: v.optional(v.number()),
  clicks: v.optional(v.number()),
  impressions: v.optional(v.number()),
  ctr: v.optional(v.number()),
  position: v.optional(v.number()),
  costMicros: v.optional(v.number()),
  conversions: v.optional(v.number()),
  currency: v.optional(v.string()),
  periodStart: v.string(),
  periodEnd: v.string(),
});

const PROVIDER_FOR_SOURCE: Record<GoogleSource, string> = { ga4: "ga4", gsc: "gsc", gads: "gads" };

// ── OAuth state ───────────────────────────────────────────────────────────

/** Single-use, user+project bound, 10-minute state. Consumed atomically. */
export const claimState = internalMutation({
  args: { state: v.string() },
  handler: async (ctx, { state }) => {
    const row = await ctx.db
      .query("oauthStates")
      .withIndex("by_state", (q) => q.eq("state", state))
      .unique();
    if (!row || row.platform !== GOOGLE_STATE_PLATFORM) return null;
    await ctx.db.delete(row._id);
    const now = Date.now();
    if (row.createdAt > now || now - row.createdAt > GOOGLE_STATE_TTL_MS) return null;
    const project = await ctx.db.get(row.projectId);
    const user = await ctx.db.get(row.createdBy);
    if (
      !project ||
      !user ||
      user.deletionRequestedAt !== undefined ||
      !(await hasProjectAccess(ctx, project, row.createdBy))
    ) {
      return null;
    }
    return { projectId: row.projectId, userId: row.createdBy };
  },
});

// ── Connection ────────────────────────────────────────────────────────────

export const getConnection = internalQuery({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) =>
    await ctx.db
      .query("googleConnections")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .first(),
});

export const getConnectionById = internalQuery({
  args: { connectionId: v.id("googleConnections") },
  handler: async (ctx, { connectionId }) => await ctx.db.get(connectionId),
});

/** Store tokens from a verified code exchange. A fresh handshake supersedes
 *  any in-flight refresh (version bump + lease drop). */
export const storeConnection = internalMutation({
  args: {
    projectId: v.id("projects"),
    connectedBy: v.id("users"),
    accessToken: v.string(),
    refreshToken: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
    scope: v.optional(v.string()),
    accountEmail: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("googleConnections")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        accessToken: args.accessToken,
        // Google omits refresh_token on some re-consents; keep the old one.
        refreshToken: args.refreshToken ?? existing.refreshToken,
        expiresAt: args.expiresAt,
        scope: args.scope,
        accountEmail: args.accountEmail ?? existing.accountEmail,
        status: "connected",
        connectedBy: args.connectedBy,
        updatedAt: now,
        tokenVersion: (existing.tokenVersion ?? 0) + 1,
        refreshLeaseId: undefined,
        refreshLeaseUntil: undefined,
      });
      return existing._id;
    }
    return await ctx.db.insert("googleConnections", {
      projectId: args.projectId,
      accessToken: args.accessToken,
      refreshToken: args.refreshToken,
      expiresAt: args.expiresAt,
      scope: args.scope,
      accountEmail: args.accountEmail,
      status: "connected",
      tokenVersion: 0,
      connectedBy: args.connectedBy,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const claimRefresh = internalMutation({
  args: { connectionId: v.id("googleConnections"), leaseMs: v.number() },
  handler: async (ctx, { connectionId, leaseMs }) => {
    const row = await ctx.db.get(connectionId);
    if (!row) return { status: "missing" as const };
    const now = Date.now();
    if (row.refreshLeaseId && row.refreshLeaseUntil && row.refreshLeaseUntil > now) {
      return { status: "busy" as const };
    }
    const leaseId = crypto.randomUUID();
    await ctx.db.patch(connectionId, { refreshLeaseId: leaseId, refreshLeaseUntil: now + leaseMs });
    return { status: "claimed" as const, leaseId, tokenVersion: row.tokenVersion ?? 0 };
  },
});

export const saveRefreshResult = internalMutation({
  args: {
    connectionId: v.id("googleConnections"),
    leaseId: v.string(),
    expectedVersion: v.number(),
    accessToken: v.string(),
    expiresAt: v.optional(v.number()),
    refreshToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.connectionId);
    if (!row) return { applied: false as const };
    const leaseHeld =
      row.refreshLeaseId === args.leaseId && !!row.refreshLeaseUntil && row.refreshLeaseUntil > Date.now();
    if (!leaseHeld || (row.tokenVersion ?? 0) !== args.expectedVersion) {
      return { applied: false as const };
    }
    await ctx.db.patch(args.connectionId, {
      accessToken: args.accessToken,
      ...(args.expiresAt !== undefined ? { expiresAt: args.expiresAt } : {}),
      ...(args.refreshToken ? { refreshToken: args.refreshToken } : {}),
      tokenVersion: (row.tokenVersion ?? 0) + 1,
      refreshLeaseId: undefined,
      refreshLeaseUntil: undefined,
      status: "connected",
      updatedAt: Date.now(),
    });
    return { applied: true as const };
  },
});

export const releaseRefresh = internalMutation({
  args: { connectionId: v.id("googleConnections"), leaseId: v.string() },
  handler: async (ctx, { connectionId, leaseId }) => {
    const row = await ctx.db.get(connectionId);
    if (!row || row.refreshLeaseId !== leaseId) return;
    await ctx.db.patch(connectionId, { refreshLeaseId: undefined, refreshLeaseUntil: undefined });
  },
});

/** Google rejected the grant: record the honest reconnect state. */
export const markNeedsReconnect = internalMutation({
  args: { connectionId: v.id("googleConnections") },
  handler: async (ctx, { connectionId }) => {
    const row = await ctx.db.get(connectionId);
    if (!row) return;
    await ctx.db.patch(connectionId, {
      status: "needs_reconnect",
      refreshLeaseId: undefined,
      refreshLeaseUntil: undefined,
      updatedAt: Date.now(),
    });
    for (const s of ["ga4", "gsc", "gads"] as const) {
      await upsertConnectionRow(ctx, row.projectId, s, {
        status: "needs_attention",
        detail: "Google no longer accepts this connection — reconnect Google in Grow.",
      }, { onlyIfExists: true });
    }
  },
});

const ga4Property = v.object({ id: v.string(), name: v.string(), account: v.optional(v.string()) });
const gscSite = v.object({ siteUrl: v.string(), permission: v.optional(v.string()) });
const adsCustomer = v.object({
  id: v.string(),
  name: v.optional(v.string()),
  currency: v.optional(v.string()),
  manager: v.optional(v.boolean()),
  usable: v.boolean(),
});
const resourceError = v.object({
  source,
  state: v.union(v.literal("needs_setup"), v.literal("error")),
  code: v.optional(v.string()),
  message: v.string(),
});

/** Save a resource listing. A source that failed keeps its previous list. */
export const saveResources = internalMutation({
  args: {
    connectionId: v.id("googleConnections"),
    ga4Properties: v.optional(v.array(ga4Property)),
    gscSites: v.optional(v.array(gscSite)),
    adsCustomers: v.optional(v.array(adsCustomer)),
    errors: v.array(resourceError),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.connectionId);
    if (!row) return;
    const patch: Partial<typeof row> = {
      resourcesListedAt: Date.now(),
      resourceErrors: args.errors,
    };
    if (args.ga4Properties) {
      patch.ga4Properties = args.ga4Properties;
      // Auto-select the only property so a simple setup needs no clicks.
      if (!row.ga4PropertyId && args.ga4Properties.length === 1) {
        patch.ga4PropertyId = args.ga4Properties[0].id;
        patch.ga4PropertyName = args.ga4Properties[0].name;
      }
    }
    if (args.gscSites) {
      patch.gscSites = args.gscSites;
      if (!row.gscSiteUrl && args.gscSites.length === 1) patch.gscSiteUrl = args.gscSites[0].siteUrl;
    }
    if (args.adsCustomers) {
      patch.adsCustomers = args.adsCustomers;
      const usable = args.adsCustomers.filter((c) => c.usable);
      if (!row.adsCustomerId && usable.length === 1) {
        patch.adsCustomerId = usable[0].id;
        patch.adsCustomerName = usable[0].name;
      }
    }
    await ctx.db.patch(args.connectionId, patch);
  },
});

/** Remove tokens, cached listings, synced metrics and mirror rows. Sync run
 *  history is kept as an audit trail (it holds no provider data). */
export const deleteConnection = internalMutation({
  args: { projectId: v.id("projects"), revoked: v.boolean() },
  handler: async (ctx, { projectId, revoked }) => {
    const rows = await ctx.db
      .query("googleConnections")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
    for (const row of rows) await ctx.db.delete(row._id);
    for (const table of ["googleMetricsDaily", "googleTopItems"] as const) {
      const data = await ctx.db
        .query(table)
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .take(1000);
      for (const item of data) await ctx.db.delete(item._id);
    }
    const runs = await ctx.db
      .query("googleSyncRuns")
      .withIndex("by_project_created", (q) => q.eq("projectId", projectId))
      .order("desc")
      .take(20);
    for (const run of runs) {
      if (run.status === "queued" || run.status === "running") {
        await ctx.db.patch(run._id, {
          status: "canceled",
          finishedAt: Date.now(),
          message: "Canceled because Google was disconnected.",
        });
      }
    }
    for (const s of ["ga4", "gsc", "gads"] as const) {
      await upsertConnectionRow(ctx, projectId, s, {
        status: "disconnected",
        detail: revoked
          ? "Google disconnected and access revoked. Synced data was removed."
          : "Google disconnected. Synced data was removed; Google could not confirm the revoke — remove MOSAI in your Google account settings to be sure.",
      }, { onlyIfExists: true });
    }
  },
});

// ── Sync runs ─────────────────────────────────────────────────────────────

const RUN_STALE_MS = 15 * 60 * 1000;

/** Create a queued run unless one with the same key exists or a run is
 *  already queued/running for the project. Returns the run id to execute,
 *  or the existing run id with `created: false`. */
export async function enqueueRun(
  ctx: MutationCtx,
  input: {
    projectId: Id<"projects">;
    trigger: "manual" | "cron" | "connect";
    idempotencyKey: string;
    requestedBy?: Id<"users">;
  },
): Promise<{ runId: Id<"googleSyncRuns">; created: boolean }> {
  const same = await ctx.db
    .query("googleSyncRuns")
    .withIndex("by_idempotency", (q) => q.eq("idempotencyKey", input.idempotencyKey))
    .first();
  if (same) return { runId: same._id, created: false };
  const latest = await ctx.db
    .query("googleSyncRuns")
    .withIndex("by_project_created", (q) => q.eq("projectId", input.projectId))
    .order("desc")
    .first();
  const now = Date.now();
  if (
    latest &&
    (latest.status === "queued" || latest.status === "running") &&
    now - latest.createdAt < RUN_STALE_MS
  ) {
    return { runId: latest._id, created: false };
  }
  const runId = await ctx.db.insert("googleSyncRuns", {
    projectId: input.projectId,
    trigger: input.trigger,
    status: "queued",
    idempotencyKey: input.idempotencyKey,
    requestedBy: input.requestedBy,
    createdAt: now,
    sources: [],
  });
  return { runId, created: true };
}

export const enqueueRunInternal = internalMutation({
  args: {
    projectId: v.id("projects"),
    trigger: v.union(v.literal("manual"), v.literal("cron"), v.literal("connect")),
    idempotencyKey: v.string(),
    requestedBy: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => await enqueueRun(ctx, args),
});

/** queued → running. Anything else (canceled, finished) is left alone. */
export const startRun = internalMutation({
  args: { runId: v.id("googleSyncRuns") },
  handler: async (ctx, { runId }) => {
    const run = await ctx.db.get(runId);
    if (!run || run.status !== "queued") return null;
    await ctx.db.patch(runId, { status: "running", startedAt: Date.now() });
    return { projectId: run.projectId };
  },
});

export const finishRun = internalMutation({
  args: {
    runId: v.id("googleSyncRuns"),
    sources: v.array(
      v.object({
        source,
        status: v.union(v.literal("succeeded"), v.literal("failed"), v.literal("skipped")),
        rows: v.number(),
        code: v.optional(v.string()),
        message: v.optional(v.string()),
      }),
    ),
    message: v.optional(v.string()),
  },
  handler: async (ctx, { runId, sources, message }) => {
    const run = await ctx.db.get(runId);
    if (!run || run.status !== "running") return;
    const attempted = sources.filter((s) => s.status !== "skipped");
    const ok = attempted.filter((s) => s.status === "succeeded").length;
    const status =
      attempted.length === 0
        ? ("failed" as const)
        : ok === attempted.length
          ? ("succeeded" as const)
          : ok > 0
            ? ("partially_succeeded" as const)
            : ("failed" as const);
    await ctx.db.patch(runId, {
      status,
      sources,
      finishedAt: Date.now(),
      message: message ?? (attempted.length === 0 ? "Nothing to sync yet — pick a property, site or ads account first." : undefined),
    });
  },
});

/** Replace one source's stored data with a fresh, bounded snapshot, and
 *  mirror the verified state into the generic `connections` projection. */
export const writeSourceData = internalMutation({
  args: {
    projectId: v.id("projects"),
    source,
    resourceId: v.string(),
    resourceLabel: v.string(),
    daily: v.array(dailyRow),
    top: v.array(topRow),
  },
  handler: async (ctx, args) => {
    const connection = await ctx.db
      .query("googleConnections")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .first();
    // Disconnected mid-sync: drop the result rather than resurrect data.
    if (!connection) return { written: 0 };
    const now = Date.now();
    const oldDaily = await ctx.db
      .query("googleMetricsDaily")
      .withIndex("by_project_source_date", (q) => q.eq("projectId", args.projectId).eq("source", args.source))
      .take(500);
    for (const row of oldDaily) await ctx.db.delete(row._id);
    const oldTop = await ctx.db
      .query("googleTopItems")
      .withIndex("by_project_source", (q) => q.eq("projectId", args.projectId).eq("source", args.source))
      .take(500);
    for (const row of oldTop) await ctx.db.delete(row._id);
    for (const row of args.daily.slice(0, 120)) {
      await ctx.db.insert("googleMetricsDaily", {
        ...row,
        projectId: args.projectId,
        source: args.source,
        resourceId: args.resourceId,
        syncedAt: now,
      });
    }
    let rank = 0;
    for (const row of args.top.slice(0, 80)) {
      await ctx.db.insert("googleTopItems", {
        ...row,
        projectId: args.projectId,
        source: args.source,
        rank: rank++,
        syncedAt: now,
      });
    }
    await upsertConnectionRow(ctx, args.projectId, args.source, {
      status: "connected",
      accountLabel: args.resourceLabel.slice(0, 200),
      providerAccountId: args.resourceId.slice(0, 500),
      lastSyncedAt: now,
      detail: "Verified by a successful Google sync.",
    });
    return { written: args.daily.length + args.top.length };
  },
});

/** A source failed during sync: record it on the generic projection. */
export const markSourceAttention = internalMutation({
  args: { projectId: v.id("projects"), source, detail: v.string() },
  handler: async (ctx, { projectId, source: s, detail }) => {
    await upsertConnectionRow(ctx, projectId, s, { status: "needs_attention", detail }, { onlyIfExists: true });
  },
});

async function upsertConnectionRow(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  s: GoogleSource,
  patch: {
    status: "connected" | "needs_attention" | "disconnected";
    detail: string;
    accountLabel?: string;
    providerAccountId?: string;
    lastSyncedAt?: number;
  },
  options: { onlyIfExists?: boolean } = {},
): Promise<void> {
  const provider = PROVIDER_FOR_SOURCE[s];
  const existing = await ctx.db
    .query("connections")
    .withIndex("by_project_provider", (q) => q.eq("projectId", projectId).eq("provider", provider))
    .first();
  if (existing) {
    await ctx.db.patch(existing._id, { ...patch, authorizationStartedAt: undefined });
    return;
  }
  if (options.onlyIfExists) return;
  await ctx.db.insert("connections", { projectId, provider, ...patch });
}

/** Cron: queue one run per connected project with something selected.
 *  Bounded; runs are staggered so Google quotas are not hit at once. */
export const connectionsDueForSync = internalQuery({
  args: { limit: v.number() },
  handler: async (ctx, { limit }) => {
    const rows = await ctx.db.query("googleConnections").take(Math.min(limit, 1000));
    return rows
      .filter((row) => row.status === "connected" && (row.ga4PropertyId || row.gscSiteUrl || row.adsCustomerId))
      .map((row) => row.projectId);
  },
});
