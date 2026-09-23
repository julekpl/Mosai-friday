
import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Id } from "../_generated/dataModel";
import { getAdapter } from "./adapters";
import { isPlatform, type Platform } from "./platforms";
import { internal } from "../_generated/api";
import {
  moduleAction,
  moduleMutation,
  moduleQuery,
  projectAccessFor,
} from "../guards";

/**
 * Sync engine: pull data from the four platforms into normalized MOSAI tables.
 * All data flows through the adapters — no provider payloads reach the client.
 */

/** Today in YYYY-MM-DD (UTC). */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** N days ago in YYYY-MM-DD (UTC). */
function daysAgo(n: number): string {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Full sync for one platform: accounts → campaigns → 14 days of metrics. */
export const syncPlatform = moduleAction("promote", {
  args: { projectId: v.id("projects"), platform: v.string() },
  handler: async (ctx, { projectId, platform }) => {
    if (!isPlatform(platform)) throw new Error("Unknown platform");
    const p = platform as Platform;

    // Ownership + entitlement were checked by `moduleAction` before this
    // handler ran (organization membership × plan × role). The explicit
    // re-check keeps the read of the acting user for the provider call.
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    void projectAccessFor;

    const adapter = getAdapter(p);

    // 1. Load credential + refresh token if needed
    const cred = await ctx.runQuery(internal.ads.credentials.getCredId, {
      projectId,
      platform,
    });
    if (!cred) throw new Error(`No ${platform} credential — connect the platform first`);
    // BP-04: the provider request runs in an internal action (a mutation may
    // not fetch). A rejected/expired credential surfaces here as the action's
    // safe, redacted message and the sync stops honestly instead of proceeding
    // with a dead token.
    const refreshed = await ctx.runAction(
      internal.ads.credentialActions.refreshIfNeeded,
      { credId: cred._id },
    );
    if (!refreshed.ok) throw new Error(refreshed.message);
    const accessToken = refreshed.accessToken;

    // 2. Sync accounts
    let accounts;
    try {
      accounts = await adapter.listAccounts(accessToken);
    } catch (e) {
      throw new Error(
        e instanceof Error ? e.message : `${platform} account listing failed`,
      );
    }
    const summary = { accounts: 0, campaigns: 0, metrics: 0 };
    for (const acct of accounts) {
      await ctx.runMutation(internal.ads.sync.upsertAccountRow, {
        projectId,
        platform,
        accountId: acct.accountId,
        name: acct.name,
        currency: acct.currency,
      });
      summary.accounts += 1;

      // Only selected accounts get campaign/metric pulls.
      const acctRow = await ctx.runQuery(internal.ads.sync.getAccountRow, {
        projectId,
        platform,
        accountId: acct.accountId,
      });
      if (!acctRow || acctRow.status !== "selected") continue;

      // 3. Sync campaigns for selected accounts
      const campaigns = await adapter.listCampaigns(accessToken, acct.accountId);
      for (const c of campaigns) {
        await ctx.runMutation(internal.ads.sync.upsertCampaignRow, {
          projectId,
          platform,
          accountId: acct.accountId,
          campaign: c,
        });
        summary.campaigns += 1;

        // 4. Pull 14 days of daily metrics per campaign
        try {
          const metrics = await adapter.fetchDailyMetrics(
            accessToken,
            acct.accountId,
            c.campaignId,
            daysAgo(14),
            today(),
          );
          for (const m of metrics) {
            if (!m.date) continue;
            await ctx.runMutation(internal.ads.sync.upsertMetricRow, {
              projectId,
              platform,
              campaignId: c.campaignId,
              metric: m,
            });
            summary.metrics += 1;
          }
        } catch {
          // Metric failure doesn't fail the campaign sync — partial data is
          // honest data. The client shows lastSyncedAt + status.
        }
      }
    }
    return summary;
  },
});

async function requireProject(
  ctx: QueryCtx | MutationCtx,
  projectId: Id<"projects">,
) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Not signed in");
  if (!(await projectAccessFor(ctx, projectId, userId as Id<"users">))) {
    throw new Error("Not found");
  }
  return userId as Id<"users">;
}

/** Manually mark/unmark an account for import. */
export const setAccountSelected = moduleMutation("promote", {
  // Choosing which ad accounts MOSAI imports is module configuration.
  capability: "promote.manage",
  args: {
    projectId: v.id("projects"),
    platform: v.string(),
    accountId: v.string(),
    selected: v.boolean(),
  },
  handler: async (ctx, { projectId, platform, accountId, selected }) => {
    await requireProject(ctx, projectId);
    const rows = await ctx.db
      .query("adsAccounts")
      .withIndex("by_project_platform", (q) =>
        q.eq("projectId", projectId).eq("platform", platform),
      )
      .collect();
    const row = rows.find((r) => r.accountId === accountId);
    if (!row) throw new Error("Account not found");
    await ctx.db.patch(row._id, {
      status: selected ? "selected" : "not_selected",
    });
  },
});

/** Internal upserts called from the action. */
export const upsertAccountRow = internalMutation({
  args: {
    projectId: v.id("projects"),
    platform: v.string(),
    accountId: v.string(),
    name: v.string(),
    currency: v.optional(v.string()),
  },
  handler: async (ctx, { projectId, platform, accountId, name, currency }) => {
    const rows = await ctx.db
      .query("adsAccounts")
      .withIndex("by_project_platform", (q) =>
        q.eq("projectId", projectId).eq("platform", platform),
      )
      .collect();
    const found = rows.find((r) => r.accountId === accountId);
    if (found) {
      await ctx.db.patch(found._id, { name, currency, lastSyncedAt: Date.now() });
      return found._id;
    }
    return await ctx.db.insert("adsAccounts", {
      projectId,
      platform,
      accountId,
      name,
      currency,
      status: "not_selected",
      lastSyncedAt: Date.now(),
    });
  },
});

export const getAccountRow = internalQuery({
  args: {
    projectId: v.id("projects"),
    platform: v.string(),
    accountId: v.string(),
  },
  handler: async (ctx, { projectId, platform, accountId }) => {
    const rows = await ctx.db
      .query("adsAccounts")
      .withIndex("by_project_platform", (q) =>
        q.eq("projectId", projectId).eq("platform", platform),
      )
      .collect();
    return rows.find((r) => r.accountId === accountId) ?? null;
  },
});

export const upsertCampaignRow = internalMutation({
  args: {
    projectId: v.id("projects"),
    platform: v.string(),
    accountId: v.string(),
    campaign: v.object({
      campaignId: v.string(),
      name: v.string(),
      status: v.string(),
      objective: v.optional(v.string()),
      dailyBudgetCents: v.optional(v.number()),
      lifetimeBudgetCents: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { projectId, platform, accountId, campaign }) => {
    const rows = await ctx.db
      .query("adsCampaigns")
      .withIndex("by_project_platform", (q) =>
        q.eq("projectId", projectId).eq("platform", platform),
      )
      .collect();
    const found = rows.find((r) => r.campaignId === campaign.campaignId);
    if (found) {
      await ctx.db.patch(found._id, {
        accountId,
        name: campaign.name,
        status: campaign.status,
        objective: campaign.objective,
        dailyBudgetCents: campaign.dailyBudgetCents,
        lifetimeBudgetCents: campaign.lifetimeBudgetCents,
        lastSyncedAt: Date.now(),
      });
      return found._id;
    }
    return await ctx.db.insert("adsCampaigns", {
      projectId,
      platform,
      accountId,
      campaignId: campaign.campaignId,
      name: campaign.name,
      status: campaign.status,
      objective: campaign.objective,
      dailyBudgetCents: campaign.dailyBudgetCents,
      lifetimeBudgetCents: campaign.lifetimeBudgetCents,
      lastSyncedAt: Date.now(),
    });
  },
});

export const upsertMetricRow = internalMutation({
  args: {
    projectId: v.id("projects"),
    platform: v.string(),
    campaignId: v.string(),
    metric: v.object({
      date: v.string(),
      spendCents: v.number(),
      impressions: v.number(),
      clicks: v.number(),
      conversions: v.number(),
    }),
  },
  handler: async (ctx, { projectId, platform, campaignId, metric }) => {
    const rows = await ctx.db
      .query("adsMetrics")
      .withIndex("by_campaign_day", (q) =>
        q
          .eq("projectId", projectId)
          .eq("platform", platform)
          .eq("campaignId", campaignId)
          .eq("date", metric.date),
      )
      .collect();
    const found = rows[0];
    if (found) {
      await ctx.db.patch(found._id, { ...metric, updatedAt: Date.now() });
      return found._id;
    }
    return await ctx.db.insert("adsMetrics", {
      projectId,
      platform,
      campaignId,
      ...metric,
      updatedAt: Date.now(),
    });
  },
});

/** Client-facing reads: accounts, campaigns, metrics rollup. */
export const listAccounts = moduleQuery("promote", {
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }, access) => {
    const scope = await access.ownedProject(projectId);
    if (!scope) return [];
    return await ctx.db
      .query("adsAccounts")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
  },
});

export const listCampaigns = moduleQuery("promote", {
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }, access) => {
    const scope = await access.ownedProject(projectId);
    if (!scope) return [];
    const campaigns = await ctx.db
      .query("adsCampaigns")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
    // Attach a 14-day metric rollup per campaign.
    const metrics = await ctx.db
      .query("adsMetrics")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
    return campaigns.map((c) => {
      const rows = metrics.filter(
        (m) => m.platform === c.platform && m.campaignId === c.campaignId,
      );
      const spendCents = rows.reduce((s, m) => s + m.spendCents, 0);
      const impressions = rows.reduce((s, m) => s + m.impressions, 0);
      const clicks = rows.reduce((s, m) => s + m.clicks, 0);
      const conversions = rows.reduce((s, m) => s + m.conversions, 0);
      const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
      const cpc = clicks > 0 ? spendCents / clicks : 0;
      const cpa = conversions > 0 ? spendCents / conversions : 0;
      const newest = rows.reduce((mx, m) => Math.max(mx, m.updatedAt), 0);
      return {
        ...c,
        metrics: {
          spendCents,
          impressions,
          clicks,
          conversions,
          ctr,
          cpcCents: cpc,
          cpaCents: cpa,
          asOf: newest || undefined,
          days: rows.length,
        },
      };
    });
  },
});
