import { internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { projectCtx } from "./dal";
import { moduleMutation, moduleQuery } from "./guards";

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

const isProvider = (provider: string): provider is Provider =>
  (PROVIDERS as readonly string[]).includes(provider);
const AUTHORIZATION_TIMEOUT_MS = 10 * 60_000;

/**
 * Generic connection projection used by modules that only need to display
 * lifecycle state. Provider-specific OAuth/token flows remain authoritative;
 * this table must never be used to manufacture a connected state.
 */
export const list = moduleQuery("grow", {
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }, access) => {
    // T2.2 authorized the project through the org access object; T2.3 adds the
    // Grow capability, so a plan without the add-on reads nothing.
    const scope = await access.ownedProject(projectId);
    if (!scope) return [];
    const rows = await ctx.db
      .query("connections")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
    const now = Date.now();
    return rows.map((row) => {
      if (
        row.status !== "authorizing" ||
        row.authorizationStartedAt === undefined ||
        now - row.authorizationStartedAt < AUTHORIZATION_TIMEOUT_MS
      ) return row;
      return {
        ...row,
        status: "disconnected" as const,
        detail: "Authorization timed out after 10 minutes. Start again to retry.",
      };
    });
  },
});

/**
 * Record that a provider authorization flow has started. This intentionally
 * writes "authorizing", not "connected". A provider-specific callback must
 * verify credentials before a row may become connected.
 */
export const beginAuthorization = moduleMutation("grow", {
  // Connecting a provider changes the module's setup.
  capability: "grow.manage",
  args: { projectId: v.id("projects"), provider: v.string() },
  handler: async (ctx, { projectId, provider }, access) => {
    // Was `dal.projectCtx`, which compared `project.ownerId` inline: a teammate
    // in the owning organization was refused (T2.2 leftover, fixed here with
    // the defect regression in tests/unit/entitlements.test.ts).
    await access.requireProject(projectId);
    if (!isProvider(provider)) throw new Error("Unsupported provider");

    const existing = await ctx.db
      .query("connections")
      .withIndex("by_project_provider", (q) =>
        q.eq("projectId", projectId).eq("provider", provider),
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        status: "authorizing",
        authorizationStartedAt: Date.now(),
        detail: "Authorization started — waiting for provider verification.",
      });
      return existing._id;
    }

    return await ctx.db.insert("connections", {
      projectId,
      provider,
      status: "authorizing",
      authorizationStartedAt: Date.now(),
      detail: "Authorization started — waiting for provider verification.",
    });
  },
});

/**
 * Provider callbacks or verified sync jobs use this transition after a real
 * provider response. It is intentionally internal to prevent clients from
 * self-declaring a connection.
 */
export const markVerified = internalMutation({
  args: {
    projectId: v.id("projects"),
    provider: v.string(),
    accountLabel: v.optional(v.string()),
    providerAccountId: v.optional(v.string()),
    detail: v.optional(v.string()),
  },
  handler: async (
    ctx,
    { projectId, provider, accountLabel, providerAccountId, detail },
  ) => {
    await projectCtx(ctx, projectId);
    if (!isProvider(provider)) throw new Error("Unsupported provider");

    const existing = await ctx.db
      .query("connections")
      .withIndex("by_project_provider", (q) =>
        q.eq("projectId", projectId).eq("provider", provider),
      )
      .first();
    if (!existing) throw new Error("Authorization has not been started");

    await ctx.db.patch(existing._id, {
      status: "connected",
      authorizationStartedAt: undefined,
      accountLabel,
      providerAccountId,
      lastSyncedAt: Date.now(),
      detail: detail ?? "Provider credentials verified.",
    });
    return existing._id;
  },
});

/** Mark a verified connection as needing attention after a provider failure. */
export const markNeedsAttention = internalMutation({
  args: {
    projectId: v.id("projects"),
    provider: v.string(),
    detail: v.string(),
  },
  handler: async (ctx, { projectId, provider, detail }) => {
    await projectCtx(ctx, projectId);
    if (!isProvider(provider)) throw new Error("Unsupported provider");

    const existing = await ctx.db
      .query("connections")
      .withIndex("by_project_provider", (q) =>
        q.eq("projectId", projectId).eq("provider", provider),
      )
      .first();
    if (!existing) throw new Error("Connection not found");

    await ctx.db.patch(existing._id, {
      status: "needs_attention",
      authorizationStartedAt: undefined,
      detail,
    });
  },
});

/** Disconnect preserves the connection record and its last-known state. */
export const disconnect = moduleMutation("grow", {
  capability: "grow.manage",
  args: { projectId: v.id("projects"), provider: v.string() },
  handler: async (ctx, { projectId, provider }, access) => {
    await access.requireProject(projectId);
    if (!isProvider(provider)) throw new Error("Unsupported provider");

    const existing = await ctx.db
      .query("connections")
      .withIndex("by_project_provider", (q) =>
        q.eq("projectId", projectId).eq("provider", provider),
      )
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        status: "disconnected",
        authorizationStartedAt: undefined,
        detail: "Disconnected by the project owner. Historical data is preserved.",
      });
    }
  },
});
