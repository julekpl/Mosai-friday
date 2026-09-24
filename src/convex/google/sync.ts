import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { moduleAction, moduleMutation } from "../guards";
import {
  ADS_CUSTOMER_DESCRIBE_LIMIT,
  GA4_ADMIN_API,
  GA4_DATA_API,
  GOOGLE_ADS_API,
  GSC_API,
  RESOURCE_LIMIT,
  TOP_LIMIT,
  adsCampaignQuery,
  adsCustomerQuery,
  adsDailyQuery,
  aggregateAds,
  aggregateGsc,
  ga4BatchRequest,
  googleAdsDeveloperToken,
  googleAdsLoginCustomerId,
  googleErrorMessage,
  grantedSources,
  normalizeCustomerId,
  parseAccessibleCustomers,
  parseAccountSummaries,
  parseAdsCampaigns,
  parseAdsCustomer,
  parseAdsDaily,
  parseGa4Batch,
  parseGscRows,
  parseGscSites,
  gscQuery,
  reportWindows,
  type DailyMetrics,
  type Ga4Property,
  type GoogleError,
  type GoogleSource,
  type GscSite,
} from "./config";
import { callGoogle, openSession, type GoogleSession } from "./tokens";
import { enqueueRun } from "./credentials";

/**
 * Grow — Google resource listing and the metrics sync job.
 *
 * A sync is a job row (`googleSyncRuns`: queued → running → succeeded |
 * partially_succeeded | failed | canceled). Each source (GA4, Search Console,
 * Google Ads) records its own outcome; a failing source never blocks the
 * others and never produces placeholder numbers. Stored data is a bounded,
 * replace-on-success snapshot: 56 daily rows per source plus top-10 lists.
 */

type Connection = Doc<"googleConnections">;
type SourceResult = {
  source: GoogleSource;
  status: "succeeded" | "failed" | "skipped";
  rows: number;
  code?: string;
  message?: string;
};
type TopRow = {
  kind: "totals_current" | "totals_previous" | "query" | "page" | "landing_page" | "channel" | "campaign";
  label: string;
  key?: string;
  status?: string;
  sessions?: number;
  users?: number;
  keyEvents?: number;
  engagementRate?: number;
  clicks?: number;
  impressions?: number;
  ctr?: number;
  position?: number;
  costMicros?: number;
  conversions?: number;
  currency?: string;
  periodStart: string;
  periodEnd: string;
};

async function loadConnection(ctx: ActionCtx, projectId: Id<"projects">): Promise<Connection | null> {
  return (await ctx.runQuery(internal.google.credentials.getConnection, { projectId })) as Connection | null;
}

function adsHeaders(developerToken: string): Record<string, string> {
  const login = googleAdsLoginCustomerId();
  return { "developer-token": developerToken, ...(login ? { "login-customer-id": login } : {}) };
}

// ── Resource listing ──────────────────────────────────────────────────────

type ResourceError = { source: GoogleSource; state: "needs_setup" | "error"; code?: string; message: string };

async function listResources(
  ctx: ActionCtx,
  projectId: Id<"projects">,
): Promise<{ ok: boolean; reconnect: boolean; errors: ResourceError[] }> {
  const connection = await loadConnection(ctx, projectId);
  if (!connection) return { ok: false, reconnect: false, errors: [] };
  const opened = await openSession(ctx, connection._id);
  if (!opened.ok) return { ok: false, reconnect: opened.reason === "reconnect", errors: [] };
  const session = opened.session;
  const granted = grantedSources(connection.scope);
  const errors: ResourceError[] = [];
  const fail = (source: GoogleSource, error: GoogleError) =>
    errors.push({ source, state: "error", code: error.code, message: googleErrorMessage(source, error) });

  let ga4Properties: Ga4Property[] | undefined;
  if (granted.ga4) {
    const collected: Ga4Property[] = [];
    let pageToken: string | undefined;
    let failed = false;
    for (let page = 0; page < 4 && collected.length < RESOURCE_LIMIT; page++) {
      const url = new URL(`${GA4_ADMIN_API}/accountSummaries`);
      url.searchParams.set("pageSize", "200");
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const res = await callGoogle(ctx, session, { url: url.toString() });
      if (!res.ok) {
        if (res.reconnect) return { ok: false, reconnect: true, errors };
        fail("ga4", res.error);
        failed = true;
        break;
      }
      const parsed = parseAccountSummaries(res.data);
      collected.push(...parsed.properties);
      pageToken = parsed.nextPageToken;
      if (!pageToken) break;
    }
    if (!failed) ga4Properties = collected.slice(0, RESOURCE_LIMIT);
  }

  let gscSites: GscSite[] | undefined;
  if (granted.gsc) {
    const res = await callGoogle(ctx, session, { url: `${GSC_API}/sites` });
    if (!res.ok) {
      if (res.reconnect) return { ok: false, reconnect: true, errors };
      fail("gsc", res.error);
    } else gscSites = parseGscSites(res.data);
  }

  let adsCustomers: Array<{ id: string; name?: string; currency?: string; manager?: boolean; usable: boolean }> | undefined;
  const developerToken = googleAdsDeveloperToken();
  if (granted.gads && !developerToken) {
    errors.push({
      source: "gads",
      state: "needs_setup",
      message: "Google Ads reporting isn't set up on this workspace yet — ask your admin.",
    });
  } else if (granted.gads && developerToken) {
    const res = await callGoogle(ctx, session, {
      url: `${GOOGLE_ADS_API}/customers:listAccessibleCustomers`,
      headers: { "developer-token": developerToken },
    });
    if (!res.ok) {
      if (res.reconnect) return { ok: false, reconnect: true, errors };
      fail("gads", res.error);
    } else {
      const ids = parseAccessibleCustomers(res.data);
      adsCustomers = [];
      for (const id of ids.slice(0, ADS_CUSTOMER_DESCRIBE_LIMIT)) {
        const info = await callGoogle(ctx, session, {
          url: `${GOOGLE_ADS_API}/customers/${id}/googleAds:searchStream`,
          method: "POST",
          body: { query: adsCustomerQuery() },
          headers: adsHeaders(developerToken),
        });
        if (!info.ok) {
          if (info.reconnect) return { ok: false, reconnect: true, errors };
          adsCustomers.push({ id, usable: false });
          continue;
        }
        const parsed = parseAdsCustomer(info.data);
        adsCustomers.push({
          id,
          name: parsed?.name,
          currency: parsed?.currency,
          manager: parsed?.manager ?? false,
          // Manager accounts have no metrics of their own.
          usable: parsed !== null && !parsed.manager,
        });
      }
      for (const id of ids.slice(ADS_CUSTOMER_DESCRIBE_LIMIT)) adsCustomers.push({ id, usable: false });
    }
  }

  await ctx.runMutation(internal.google.credentials.saveResources, {
    connectionId: connection._id,
    ga4Properties,
    gscSites,
    adsCustomers,
    errors,
  });
  return { ok: true, reconnect: false, errors };
}

/** Refresh the lists behind the pickers. */
export const refreshResources = moduleAction("grow", {
  capability: "grow.manage",
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }, access): Promise<{ state: "ok" | "needs_reconnect" | "not_connected" | "error" }> => {
    await access.requireProject(projectId);
    const out = await listResources(ctx, projectId);
    if (out.ok) return { state: "ok" };
    if (out.reconnect) return { state: "needs_reconnect" };
    const connection = await loadConnection(ctx, projectId);
    return { state: connection ? "error" : "not_connected" };
  },
});

/** Scheduled by the OAuth callback: list resources, then queue a first sync
 *  if anything got auto-selected. */
export const afterConnect = internalAction({
  args: { projectId: v.id("projects"), connectionId: v.id("googleConnections") },
  handler: async (ctx, { projectId }) => {
    const out = await listResources(ctx, projectId);
    if (!out.ok) return;
    const connection = await loadConnection(ctx, projectId);
    if (!connection || !(connection.ga4PropertyId || connection.gscSiteUrl || connection.adsCustomerId)) return;
    const queued = await ctx.runMutation(internal.google.credentials.enqueueRunInternal, {
      projectId,
      trigger: "connect",
      idempotencyKey: `connect:${projectId}:${connection.updatedAt}`,
    });
    if (queued.created) await ctx.scheduler.runAfter(0, internal.google.sync.runSync, { runId: queued.runId });
  },
});

// ── Sync ──────────────────────────────────────────────────────────────────

/** Queue a sync now. Idempotent per click (client key) and never runs two
 *  syncs for one project at once. */
export const syncNow = moduleMutation("grow", {
  capability: "grow.edit",
  args: { projectId: v.id("projects"), requestKey: v.string() },
  handler: async (ctx, { projectId, requestKey }, access) => {
    const { userId } = await access.requireProject(projectId);
    const connection = await ctx.db
      .query("googleConnections")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .first();
    if (!connection) throw new Error("Connect Google first.");
    if (connection.status === "needs_reconnect") throw new Error("Reconnect Google first.");
    const key = `manual:${projectId}:${requestKey.slice(0, 80)}`;
    const queued = await enqueueRun(ctx, { projectId, trigger: "manual", idempotencyKey: key, requestedBy: userId });
    if (queued.created) await ctx.scheduler.runAfter(0, internal.google.sync.runSync, { runId: queued.runId });
    return { runId: queued.runId, created: queued.created };
  },
});

type SourceOutcome = { result: SourceResult; reconnect: boolean };

async function syncGa4(ctx: ActionCtx, session: GoogleSession, connection: Connection): Promise<SourceOutcome> {
  const propertyId = connection.ga4PropertyId;
  if (!propertyId || !/^\d+$/.test(propertyId)) return { result: { source: "ga4", status: "skipped", rows: 0 }, reconnect: false };
  const windows = reportWindows();
  const res = await callGoogle(ctx, session, {
    url: `${GA4_DATA_API}/properties/${propertyId}:batchRunReports`,
    method: "POST",
    body: ga4BatchRequest(windows),
  });
  if (!res.ok) return failure(ctx, connection, "ga4", res.error, res.reconnect);
  const parsed = parseGa4Batch(res.data);
  const top: TopRow[] = [];
  const period = (w: { start: string; end: string }) => ({ periodStart: w.start, periodEnd: w.end });
  if (parsed.totals.current) {
    const { date: _d, ...m } = parsed.totals.current;
    void _d;
    top.push({ kind: "totals_current", label: "Last 28 days", ...m, ...period(windows.current) });
  }
  if (parsed.totals.previous) {
    const { date: _d, ...m } = parsed.totals.previous;
    void _d;
    top.push({ kind: "totals_previous", label: "Previous 28 days", ...m, ...period(windows.previous) });
  }
  for (const row of parsed.landingPages) top.push({ kind: "landing_page", ...row, ...period(windows.current) });
  for (const row of parsed.channels) top.push({ kind: "channel", ...row, ...period(windows.current) });
  const written = await ctx.runMutation(internal.google.credentials.writeSourceData, {
    projectId: connection.projectId,
    source: "ga4",
    resourceId: propertyId,
    resourceLabel: connection.ga4PropertyName ?? `Property ${propertyId}`,
    daily: parsed.daily,
    top,
  });
  return { result: { source: "ga4", status: "succeeded", rows: written.written }, reconnect: false };
}

async function syncGsc(ctx: ActionCtx, session: GoogleSession, connection: Connection): Promise<SourceOutcome> {
  const siteUrl = connection.gscSiteUrl;
  if (!siteUrl) return { result: { source: "gsc", status: "skipped", rows: 0 }, reconnect: false };
  const windows = reportWindows();
  const url = `${GSC_API}/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
  const whole = { start: windows.previous.start, end: windows.current.end };
  const dailyRes = await callGoogle(ctx, session, { url, method: "POST", body: gscQuery(whole, "date", 100) });
  if (!dailyRes.ok) return failure(ctx, connection, "gsc", dailyRes.error, dailyRes.reconnect);
  const queriesRes = await callGoogle(ctx, session, { url, method: "POST", body: gscQuery(windows.current, "query", TOP_LIMIT) });
  if (!queriesRes.ok) return failure(ctx, connection, "gsc", queriesRes.error, queriesRes.reconnect);
  const pagesRes = await callGoogle(ctx, session, { url, method: "POST", body: gscQuery(windows.current, "page", TOP_LIMIT) });
  if (!pagesRes.ok) return failure(ctx, connection, "gsc", pagesRes.error, pagesRes.reconnect);

  const daily: DailyMetrics[] = parseGscRows(dailyRes.data)
    .filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.key))
    .map((row) => ({ date: row.key, clicks: row.clicks, impressions: row.impressions, ctr: row.ctr, position: row.position }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const top: TopRow[] = [];
  const current = aggregateGsc(daily, windows.current);
  const previous = aggregateGsc(daily, windows.previous);
  const strip = ({ date: _d, ...m }: DailyMetrics) => {
    void _d;
    return m;
  };
  top.push({ kind: "totals_current", label: "Last 28 days", ...strip(current), periodStart: windows.current.start, periodEnd: windows.current.end });
  top.push({ kind: "totals_previous", label: "Previous 28 days", ...strip(previous), periodStart: windows.previous.start, periodEnd: windows.previous.end });
  for (const [kind, res] of [["query", queriesRes], ["page", pagesRes]] as const) {
    for (const row of parseGscRows(res.data).slice(0, TOP_LIMIT)) {
      top.push({
        kind,
        label: row.key || "(not set)",
        clicks: row.clicks,
        impressions: row.impressions,
        ctr: row.ctr,
        position: row.position,
        periodStart: windows.current.start,
        periodEnd: windows.current.end,
      });
    }
  }
  const written = await ctx.runMutation(internal.google.credentials.writeSourceData, {
    projectId: connection.projectId,
    source: "gsc",
    resourceId: siteUrl,
    resourceLabel: siteUrl,
    daily,
    top,
  });
  return { result: { source: "gsc", status: "succeeded", rows: written.written }, reconnect: false };
}

async function syncAds(ctx: ActionCtx, session: GoogleSession, connection: Connection): Promise<SourceOutcome> {
  const customerId = connection.adsCustomerId ? normalizeCustomerId(connection.adsCustomerId) : null;
  if (!customerId) return { result: { source: "gads", status: "skipped", rows: 0 }, reconnect: false };
  const developerToken = googleAdsDeveloperToken();
  if (!developerToken) {
    return {
      result: {
        source: "gads",
        status: "failed",
        rows: 0,
        code: "NEEDS_SETUP",
        message: "Google Ads reporting isn't set up on this workspace yet — ask your admin.",
      },
      reconnect: false,
    };
  }
  const windows = reportWindows();
  const url = `${GOOGLE_ADS_API}/customers/${customerId}/googleAds:searchStream`;
  const headers = adsHeaders(developerToken);
  const whole = { start: windows.previous.start, end: windows.current.end };
  const dailyRes = await callGoogle(ctx, session, { url, method: "POST", body: { query: adsDailyQuery(whole) }, headers });
  if (!dailyRes.ok) return failure(ctx, connection, "gads", dailyRes.error, dailyRes.reconnect);
  const campaignRes = await callGoogle(ctx, session, { url, method: "POST", body: { query: adsCampaignQuery(windows.current) }, headers });
  if (!campaignRes.ok) return failure(ctx, connection, "gads", campaignRes.error, campaignRes.reconnect);

  const listed = connection.adsCustomers?.find((c) => c.id === customerId);
  const { rows: daily, currency: dailyCurrency } = parseAdsDaily(dailyRes.data);
  const currency = dailyCurrency ?? listed?.currency;
  const top: TopRow[] = [];
  const strip = ({ date: _d, ...m }: DailyMetrics) => {
    void _d;
    return m;
  };
  top.push({ kind: "totals_current", label: "Last 28 days", ...strip(aggregateAds(daily, windows.current)), currency, periodStart: windows.current.start, periodEnd: windows.current.end });
  top.push({ kind: "totals_previous", label: "Previous 28 days", ...strip(aggregateAds(daily, windows.previous)), currency, periodStart: windows.previous.start, periodEnd: windows.previous.end });
  for (const campaign of parseAdsCampaigns(campaignRes.data)) {
    top.push({
      kind: "campaign",
      label: campaign.name,
      key: campaign.id,
      status: campaign.status,
      costMicros: campaign.costMicros,
      impressions: campaign.impressions,
      clicks: campaign.clicks,
      conversions: campaign.conversions,
      currency,
      periodStart: windows.current.start,
      periodEnd: windows.current.end,
    });
  }
  const written = await ctx.runMutation(internal.google.credentials.writeSourceData, {
    projectId: connection.projectId,
    source: "gads",
    resourceId: customerId,
    resourceLabel: connection.adsCustomerName ?? `Ads account ${customerId}`,
    daily: daily.map((row) => ({ ...row, currency })),
    top,
  });
  return { result: { source: "gads", status: "succeeded", rows: written.written }, reconnect: false };
}

async function failure(
  ctx: ActionCtx,
  connection: Connection,
  source: GoogleSource,
  error: GoogleError,
  reconnect: boolean,
): Promise<SourceOutcome> {
  const message = googleErrorMessage(source, error);
  if (!reconnect) {
    await ctx.runMutation(internal.google.credentials.markSourceAttention, {
      projectId: connection.projectId,
      source,
      detail: message,
    });
  }
  return {
    result: {
      source,
      status: "failed",
      rows: 0,
      code: error.code ?? (error.status ? `HTTP_${error.status}` : error.kind.toUpperCase()),
      message,
    },
    reconnect,
  };
}

/** Execute one queued run. */
export const runSync = internalAction({
  args: { runId: v.id("googleSyncRuns") },
  handler: async (ctx, { runId }) => {
    const started = await ctx.runMutation(internal.google.credentials.startRun, { runId });
    if (!started) return;
    const finish = (sources: SourceResult[], message?: string) =>
      ctx.runMutation(internal.google.credentials.finishRun, { runId, sources, message });

    const connection = await loadConnection(ctx, started.projectId);
    if (!connection) {
      await finish([], "Google isn't connected.");
      return;
    }
    const opened = await openSession(ctx, connection._id);
    if (!opened.ok) {
      const message =
        opened.reason === "reconnect"
          ? "Google no longer accepts this connection — reconnect Google."
          : opened.reason === "not_configured"
            ? "Google isn't set up on this workspace yet — ask your admin."
            : "We couldn't refresh access to Google. We'll try again later.";
      await finish(
        (["ga4", "gsc", "gads"] as const).map((source) => ({ source, status: "failed" as const, rows: 0, code: opened.reason.toUpperCase(), message })),
        message,
      );
      return;
    }
    const session = opened.session;
    const results: SourceResult[] = [];
    for (const step of [syncGa4, syncGsc, syncAds]) {
      let outcome: SourceOutcome;
      try {
        outcome = await step(ctx, session, connection);
      } catch {
        const source: GoogleSource = step === syncGa4 ? "ga4" : step === syncGsc ? "gsc" : "gads";
        outcome = {
          result: { source, status: "failed", rows: 0, code: "INTERNAL", message: "Something went wrong while saving this data. We'll try again later." },
          reconnect: false,
        };
      }
      results.push(outcome.result);
      if (outcome.reconnect) {
        // The grant is dead; the remaining sources would fail the same way.
        const done = new Set(results.map((r) => r.source));
        for (const source of ["ga4", "gsc", "gads"] as const) {
          if (!done.has(source)) {
            results.push({ source, status: "failed", rows: 0, code: "RECONNECT", message: "Google no longer accepts this connection — reconnect Google." });
          }
        }
        break;
      }
    }
    await finish(results);
  },
});

/** Daily cron: queue one sync per connected project, staggered. */
export const enqueueDailyRuns = internalAction({
  args: {},
  handler: async (ctx) => {
    const projectIds = (await ctx.runQuery(internal.google.credentials.connectionsDueForSync, { limit: 1000 })) as Id<"projects">[];
    const day = new Date().toISOString().slice(0, 10);
    let index = 0;
    for (const projectId of projectIds) {
      const queued = await ctx.runMutation(internal.google.credentials.enqueueRunInternal, {
        projectId,
        trigger: "cron",
        idempotencyKey: `cron:${projectId}:${day}`,
      });
      if (queued.created) {
        await ctx.scheduler.runAfter(index * 20_000, internal.google.sync.runSync, { runId: queued.runId });
        index += 1;
      }
    }
    return { queued: index };
  },
});
