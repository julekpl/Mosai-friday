import { v } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  operatorEmailFor,
  requirePlatformAdmin,
  requireUser,
  resolvePlatformAdmin,
} from "./guards";
import { isPlan, PLANS, modulesForPlan } from "./lib/capabilities";
import { platformAdminEmails } from "./lib/platformAdmin";
import { checkoutConfigured, planCatalog } from "./lib/billingCatalog";
import { stripeMode, stripeWebhookSecret } from "./lib/stripe";
import { dayPeriod } from "./lib/aiBudget";
import { currentUtcPeriod } from "./lib/providerUsage";
import {
  LIMIT_KEYS,
  LIMIT_SPECS,
  LIMITS_SETTINGS_KEY,
  isValidLimitValue,
  readStoredLimits,
  resolveLimit,
  type LimitKey,
  type LimitSource,
  type StoredLimits,
} from "./lib/platformLimits";

const ADMIN_OVERVIEW_SAMPLE_LIMIT = 5_000;

/**
 * MOSAI admin panel (T2.4 admin slice).
 *
 * A platform operator is a MOSAI-wide role, not an organization role and not a
 * module capability: it needs to see across tenants to run the product. Every
 * function here is server-guarded by `guards.requirePlatformAdmin`, which
 * honours `users.isPlatformAdmin`, the legacy `admin` role, the deployment
 * email allow-list — including the bootstrap operator — and active
 * `platformAdmins` rows.
 *
 * Full access is powerful, so every write records an `adminAuditLog` row. The
 * panel is read-mostly on purpose: support can override a plan or grant an
 * operator, and can read the webhook ledger and the reconciliation report, but
 * nothing here can fake a payment — a successful billing state still only
 * comes from a verified webhook (`AGENTS.md` §5 rule 5).
 */

async function audit(
  ctx: MutationCtx,
  actorId: Id<"users">,
  action: string,
  targetType: string,
  targetId: string | undefined,
  detail: string | undefined,
) {
  await ctx.db.insert("adminAuditLog", {
    actorId,
    actorEmail: (await operatorEmailFor(ctx, actorId)) ?? undefined,
    action,
    targetType,
    targetId,
    detail,
    createdAt: Date.now(),
  });
}

/** Is the signed-in caller an operator? Safe for any signed-in user: it only
 *  reports their own status, so the UI can decide whether to show the link. */
export const me = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const user = await ctx.db.get(userId);
    return {
      isAdmin: await resolvePlatformAdmin(ctx, userId),
      email: user?.email ?? null,
      name: user?.name ?? null,
    };
  },
});

/** Platform summary for the panel header. Counts are bounded reads (the panel
 *  reports a capped count rather than scanning an unbounded table). */
export const overview = query({
  args: {},
  handler: async (
    ctx,
  ): Promise<{
    users: number;
    usersCapped: boolean;
    organizations: number;
    projects: number;
    subscriptions: number;
    subscriptionsCapped: boolean;
    activeSubscriptions: number;
    pastDue: number;
    planCounts: Record<string, number>;
    reconciliation: {
      driftCount: number;
      checked: number;
      finishedAt: number;
      source: string;
    } | null;
  }> => {
    await requirePlatformAdmin(ctx);
    const users = await ctx.db
      .query("users")
      .take(ADMIN_OVERVIEW_SAMPLE_LIMIT);
    const organizations = await ctx.db
      .query("organizations")
      .take(ADMIN_OVERVIEW_SAMPLE_LIMIT);
    const projects = await ctx.runQuery(internal.projects.platformCount, {
      limit: ADMIN_OVERVIEW_SAMPLE_LIMIT,
    });
    const subscriptionSample = await ctx.db
      .query("subscriptions")
      .take(ADMIN_OVERVIEW_SAMPLE_LIMIT + 1);
    const subscriptionsCapped =
      subscriptionSample.length > ADMIN_OVERVIEW_SAMPLE_LIMIT;
    const subscriptions = subscriptionSample.slice(
      0,
      ADMIN_OVERVIEW_SAMPLE_LIMIT,
    );

    const planCounts: Record<string, number> = {};
    for (const user of users) {
      const plan = user.plan && isPlan(user.plan) ? user.plan : "free";
      planCounts[plan] = (planCounts[plan] ?? 0) + 1;
    }

    const activeSubscriptions = subscriptions.filter(
      (row) => row.status === "active" || row.status === "trialing",
    ).length;
    const pastDue = subscriptions.filter(
      (row) => row.status === "past_due" || row.status === "unpaid",
    ).length;

    const latestRun = await ctx.db
      .query("reconciliationRuns")
      .withIndex("by_started")
      .order("desc")
      .first();

    return {
      users: users.length,
      usersCapped: users.length === ADMIN_OVERVIEW_SAMPLE_LIMIT,
      organizations: organizations.length,
      projects: projects.count,
      subscriptions: subscriptions.length,
      subscriptionsCapped,
      activeSubscriptions,
      pastDue,
      planCounts,
      reconciliation: latestRun
        ? {
            driftCount: latestRun.driftCount,
            checked: latestRun.checked,
            finishedAt: latestRun.finishedAt,
            source: latestRun.source,
          }
        : null,
    };
  },
});

/** Every organization with its plan mirror and member count. */
export const organizations = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    await requirePlatformAdmin(ctx);
    const take = Math.min(Math.max(limit ?? 100, 1), 500);
    const rows = await ctx.db.query("organizations").take(take);
    const result = [];
    for (const organization of rows) {
      const owner = await ctx.db.get(organization.ownerId);
      const memberships = await ctx.db
        .query("memberships")
        .withIndex("by_organization", (q) =>
          q.eq("organizationId", organization._id),
        )
        .collect();
      const subscription = await ctx.db
        .query("subscriptions")
        .withIndex("by_organization", (q) =>
          q.eq("organizationId", organization._id),
        )
        .first();
      result.push({
        _id: organization._id,
        name: organization.name,
        kind: organization.kind,
        ownerEmail: owner?.email ?? null,
        plan: owner?.plan && isPlan(owner.plan) ? owner.plan : "free",
        planStatus: owner?.planStatus ?? "active",
        members: memberships.filter((m) => m.status === "active").length,
        subscriptionStatus: subscription?.status ?? null,
      });
    }
    return result;
  },
});

/** Recent accounts, with the operator flag and the plan mirror. */
export const users = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    await requirePlatformAdmin(ctx);
    const take = Math.min(Math.max(limit ?? 100, 1), 500);
    const rows = await ctx.db.query("users").take(take);
    return rows
      .sort((a, b) => (b.emailVerificationTime ?? 0) - (a.emailVerificationTime ?? 0))
      .map((user) => ({
        _id: user._id,
        email: user.email ?? null,
        name: user.name ?? null,
        role: user.role ?? "user",
        isPlatformAdmin: user.isPlatformAdmin === true,
        plan: user.plan ?? "free",
        planStatus: user.planStatus ?? "active",
      }));
  },
});

/** The webhook ledger — the honest record of what Stripe actually confirmed. */
export const billingEvents = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    await requirePlatformAdmin(ctx);
    const take = Math.min(Math.max(limit ?? 50, 1), 200);
    const rows = await ctx.db.query("billingEvents").collect();
    return rows
      .sort((a, b) => b.created - a.created)
      .slice(0, take)
      .map((row) => ({
        _id: row._id,
        eventId: row.eventId,
        type: row.type,
        objectId: row.objectId ?? null,
        status: row.status,
        livemode: row.livemode,
        note: row.note ?? null,
        created: row.created,
      }));
  },
});

/** The reconciliation report (target: drift 0). */
export const reconciliation = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    await requirePlatformAdmin(ctx);
    const take = Math.min(Math.max(limit ?? 10, 1), 50);
    const runs = await ctx.db
      .query("reconciliationRuns")
      .withIndex("by_started")
      .order("desc")
      .take(take);
    return {
      runs: runs.map((run) => ({
        _id: run._id,
        source: run.source,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        checked: run.checked,
        driftCount: run.driftCount,
        drifts: run.drifts,
      })),
      latest: runs[0] ?? null,
    };
  },
});

/** Configuration state — booleans only, never a key value. */
export const billingConfig = query({
  args: {},
  handler: async (ctx) => {
    await requirePlatformAdmin(ctx);
    return {
      mode: stripeMode(),
      checkoutConfigured: checkoutConfigured(),
      webhookSecretConfigured: Boolean(stripeWebhookSecret()),
      plans: planCatalog(),
      catalog: PLANS.map((plan) => ({
        plan,
        modules: [...modulesForPlan(plan)],
      })),
    };
  },
});

/** Operator audit trail. */
export const auditLog = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    await requirePlatformAdmin(ctx);
    const take = Math.min(Math.max(limit ?? 50, 1), 200);
    return await ctx.db
      .query("adminAuditLog")
      .withIndex("by_created")
      .order("desc")
      .take(take);
  },
});

/** Support action: set an organization's plan mirror directly.
 *
 *  This is an explicit operator override (a refund, a comp, a fix), not a
 *  payment — it is recorded in the audit log and never presented as a Stripe
 *  subscription. `reason` is required. */
export const setOrganizationPlan = mutation({
  args: {
    organizationId: v.id("organizations"),
    // A registry tier or a non-draft operator catalog plan key.
    plan: v.string(),
    reason: v.string(),
  },
  handler: async (ctx, { organizationId, plan, reason }) => {
    const actorId = await requirePlatformAdmin(ctx);
    const trimmed = reason.trim();
    if (trimmed.length < 3) throw new Error("A reason is required.");
    if (!isPlan(plan)) {
      const row = await ctx.db
        .query("billingPlans")
        .withIndex("by_key", (q) => q.eq("key", plan))
        .unique();
      if (!row || row.kind !== "plan" || row.status === "draft") throw new Error("Unknown plan");
    }

    const organization = await ctx.db.get(organizationId);
    if (!organization) throw new Error("Not found");

    await ctx.db.patch(organization.ownerId, {
      plan,
      planStatus: "active",
    });

    await audit(
      ctx,
      actorId,
      "organization.set_plan",
      "organizations",
      organizationId,
      `plan=${plan}; ${trimmed}`,
    );
    return { ok: true };
  },
});

/** Grant or revoke operator access for an account. */
export const setUserOperator = mutation({
  args: {
    userId: v.id("users"),
    enabled: v.boolean(),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, { userId, enabled, reason }) => {
    const actorId = await requirePlatformAdmin(ctx);
    const target = await ctx.db.get(userId);
    if (!target) throw new Error("Not found");
    if (target._id === actorId && !enabled) {
      throw new Error("You cannot revoke your own operator access.");
    }

    await ctx.db.patch(userId, { isPlatformAdmin: enabled });
    const email = target.email?.trim().toLowerCase();
    if (email) {
      const existing = await ctx.db
        .query("platformAdmins")
        .withIndex("by_email", (q) => q.eq("email", email))
        .first();
      if (existing) {
        await ctx.db.patch(existing._id, {
          status: enabled ? "active" : "revoked",
          userId,
          updatedAt: Date.now(),
        });
      } else {
        await ctx.db.insert("platformAdmins", {
          email,
          userId,
          status: enabled ? "active" : "revoked",
          grantedBy: actorId,
          note: reason,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      }
    }

    await audit(
      ctx,
      actorId,
      enabled ? "user.grant_operator" : "user.revoke_operator",
      "users",
      userId,
      reason,
    );
    return { ok: true };
  },
});

/** Kick off a reconciliation run now (the cron runs it daily as well). */
export const requestReconciliation = mutation({
  args: {},
  handler: async (ctx): Promise<{ scheduled: boolean }> => {
    const actorId = await requirePlatformAdmin(ctx);
    await audit(
      ctx,
      actorId,
      "billing.request_reconciliation",
      "platform",
      undefined,
      undefined,
    );
    await ctx.scheduler.runAfter(0, internal.billing.reconcileNow, {
      source: "manual",
    });
    return { scheduled: true };
  },
});

/** The operator allow-list (emails, not secrets) — for the panel's footer. */
export const operatorAllowList = query({
  args: {},
  handler: async (ctx) => {
    await requirePlatformAdmin(ctx);
    return { emails: platformAdminEmails() };
  },
});

/* ── Limits (owner ask, 26 Sep 2026) ─────────────────────────────────────
 *
 * The operator changes spending limits here instead of redeploying with new
 * environment variables. `lib/platformLimits.ts` resolves every limit as
 * admin value > environment > default, and the enforcement points
 * (`lib/providerUsage.ts`, `guards.startAiRun`) read it on every call. Every
 * change is written to the admin audit log. */

type LimitView = {
  key: LimitKey;
  value: number;
  source: LimitSource;
  defaultValue: number;
  max: number;
  adminValue: number | null;
};

async function usageCount(ctx: QueryCtx | MutationCtx, kind: "serpapi" | "pexels", period: string) {
  const row = await ctx.db
    .query("providerUsageRollups")
    .withIndex("by_kind_period", (q) => q.eq("kind", kind).eq("period", period))
    .unique();
  return row?.count ?? 0;
}

async function aiDaySpend(ctx: QueryCtx | MutationCtx, scope: "platform" | "trial", period: string) {
  const row = await ctx.db
    .query("aiSpendRollups")
    .withIndex("by_scope_period", (q) => q.eq("scope", scope).eq("period", period))
    .first();
  return (row?.spentMicrousd ?? 0) + (row?.reservedMicrousd ?? 0);
}

export const limits = query({
  args: {},
  handler: async (ctx) => {
    await requirePlatformAdmin(ctx);
    const stored = await readStoredLimits(ctx);
    const views: LimitView[] = LIMIT_KEYS.map((key) => ({
      key,
      ...resolveLimit(key, stored[key]),
      defaultValue: LIMIT_SPECS[key].defaultValue,
      max: LIMIT_SPECS[key].max,
      adminValue: stored[key] ?? null,
    }));
    const now = Date.now();
    const month = currentUtcPeriod(now);
    const day = dayPeriod(now);
    return {
      limits: views,
      month,
      day: day.key,
      dayResetsAt: day.resetsAt,
      usage: {
        serpapiThisMonth: await usageCount(ctx, "serpapi", month),
        pexelsThisMonth: await usageCount(ctx, "pexels", month),
        aiPlatformTodayMicrousd: await aiDaySpend(ctx, "platform", day.key),
        aiTrialTodayMicrousd: await aiDaySpend(ctx, "trial", day.key),
      },
    };
  },
});

const limitChange = v.optional(v.union(v.number(), v.null()));

/** Save or clear admin limits. A number sets the limit; `null` removes the
 *  admin value so the limit falls back to the environment/default; an
 *  omitted key is left unchanged. */
export const setLimits = mutation({
  args: {
    changes: v.object({
      serpapiMonthlyCeiling: limitChange,
      serpapiUserDailyCap: limitChange,
      pexelsMonthlyCeiling: limitChange,
      aiPlatformDailyMicrousd: limitChange,
      aiTrialDailyMicrousd: limitChange,
    }),
  },
  handler: async (ctx, { changes }) => {
    const actorId = await requirePlatformAdmin(ctx);
    const row = await ctx.db
      .query("appSettings")
      .withIndex("by_key", (q) => q.eq("key", LIMITS_SETTINGS_KEY))
      .unique();
    const next: StoredLimits = { ...(row?.limits ?? {}) };
    const changed: string[] = [];
    for (const key of LIMIT_KEYS) {
      const value = changes[key];
      if (value === undefined) continue;
      if (value === null) {
        delete next[key];
        changed.push(`${key}=cleared`);
        continue;
      }
      if (!isValidLimitValue(key, value)) {
        throw new Error(`Enter a whole number from 0 to ${LIMIT_SPECS[key].max.toLocaleString("en-US")}.`);
      }
      next[key] = value;
      changed.push(`${key}=${value}`);
    }
    if (changed.length === 0) return;
    const now = Date.now();
    if (row) {
      await ctx.db.patch(row._id, { limits: next, updatedBy: actorId, updatedAt: now });
    } else {
      await ctx.db.insert("appSettings", {
        key: LIMITS_SETTINGS_KEY,
        limits: next,
        updatedBy: actorId,
        updatedAt: now,
      });
    }
    await audit(ctx, actorId, "limits.update", "appSettings", LIMITS_SETTINGS_KEY, changed.join("; "));
  },
});

/** Set this month's lookup counter to match the provider's own dashboard
 *  (e.g. searches used before MOSAI started counting, or by another
 *  deployment sharing the same key). Only the current UTC month. */
export const setProviderUsageCount = mutation({
  args: {
    kind: v.union(v.literal("serpapi"), v.literal("pexels")),
    count: v.number(),
  },
  handler: async (ctx, { kind, count }) => {
    const actorId = await requirePlatformAdmin(ctx);
    if (!Number.isInteger(count) || count < 0 || count > 10_000_000) {
      throw new Error("Enter a whole number of calls, 0 or more.");
    }
    const period = currentUtcPeriod();
    const row = await ctx.db
      .query("providerUsageRollups")
      .withIndex("by_kind_period", (q) => q.eq("kind", kind).eq("period", period))
      .unique();
    const previous = row?.count ?? 0;
    const now = Date.now();
    if (row) await ctx.db.patch(row._id, { count, updatedAt: now });
    else await ctx.db.insert("providerUsageRollups", { kind, period, count, updatedAt: now });
    await audit(ctx, actorId, "provider_usage.set", "providerUsageRollups", `${kind}:${period}`, `${previous} -> ${count}`);
  },
});
