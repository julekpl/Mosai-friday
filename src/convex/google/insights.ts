import { v } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import { moduleQuery } from "../guards";
import { percentChange, type GoogleSource } from "./config";

/**
 * Grow — the compact Google insights view. Reads only what a verified sync
 * stored; a source that never synced is reported as `no_data`, never zeros.
 */

type Top = Doc<"googleTopItems">;
type Daily = Doc<"googleMetricsDaily">;

export type Kpi = {
  key: string;
  label: string;
  current: number;
  previous: number | null;
  change: number | null;
  /** How to format: count, rate (0–1), position (lower is better), money (micros). */
  format: "count" | "rate" | "position" | "money";
  currency?: string;
};

function kpi(
  key: string,
  label: string,
  format: Kpi["format"],
  current: Top | undefined,
  previous: Top | undefined,
  field: keyof Pick<Top, "sessions" | "users" | "keyEvents" | "engagementRate" | "clicks" | "impressions" | "ctr" | "position" | "costMicros" | "conversions">,
): Kpi {
  const now = current?.[field] ?? 0;
  const before = previous?.[field];
  return {
    key,
    label,
    format,
    current: now,
    previous: before ?? null,
    change: before === undefined ? null : percentChange(now, before),
    currency: format === "money" ? current?.currency : undefined,
  };
}

function section(source: GoogleSource, top: Top[], daily: Daily[]) {
  const mine = top.filter((row) => row.source === source).sort((a, b) => a.rank - b.rank);
  const current = mine.find((row) => row.kind === "totals_current");
  const previous = mine.find((row) => row.kind === "totals_previous");
  const series = daily
    .filter((row) => row.source === source)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!current && series.length === 0) return null;
  const syncedAt = Math.max(0, ...mine.map((row) => row.syncedAt), ...series.map((row) => row.syncedAt));
  return {
    periodStart: current?.periodStart,
    periodEnd: current?.periodEnd,
    syncedAt,
    resourceId: series[0]?.resourceId,
    current,
    previous,
    list: (kind: Top["kind"]) => mine.filter((row) => row.kind === kind),
    series,
  };
}

export const overview = moduleQuery("grow", {
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }, access) => {
    const scope = await access.ownedProject(projectId);
    if (!scope) return null;
    const top = await ctx.db
      .query("googleTopItems")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .take(300);
    const daily = await ctx.db
      .query("googleMetricsDaily")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .take(400);

    const ga4 = section("ga4", top, daily);
    const gsc = section("gsc", top, daily);
    const gads = section("gads", top, daily);
    const pick = (row: Top) => ({
      label: row.label,
      key: row.key,
      status: row.status,
      sessions: row.sessions,
      users: row.users,
      keyEvents: row.keyEvents,
      clicks: row.clicks,
      impressions: row.impressions,
      ctr: row.ctr,
      position: row.position,
      costMicros: row.costMicros,
      conversions: row.conversions,
      currency: row.currency,
    });

    return {
      ga4: ga4
        ? {
            periodStart: ga4.periodStart,
            periodEnd: ga4.periodEnd,
            syncedAt: ga4.syncedAt,
            kpis: [
              kpi("sessions", "Visits", "count", ga4.current, ga4.previous, "sessions"),
              kpi("users", "Visitors", "count", ga4.current, ga4.previous, "users"),
              kpi("keyEvents", "Key events", "count", ga4.current, ga4.previous, "keyEvents"),
              kpi("engagementRate", "Engaged visits", "rate", ga4.current, ga4.previous, "engagementRate"),
            ],
            trend: ga4.series.map((row) => ({ date: row.date, value: row.sessions ?? 0 })),
            landingPages: ga4.list("landing_page").map(pick),
            channels: ga4.list("channel").map(pick),
          }
        : null,
      gsc: gsc
        ? {
            periodStart: gsc.periodStart,
            periodEnd: gsc.periodEnd,
            syncedAt: gsc.syncedAt,
            kpis: [
              kpi("clicks", "Search clicks", "count", gsc.current, gsc.previous, "clicks"),
              kpi("impressions", "Times shown in Google", "count", gsc.current, gsc.previous, "impressions"),
              kpi("ctr", "Click rate", "rate", gsc.current, gsc.previous, "ctr"),
              kpi("position", "Average position", "position", gsc.current, gsc.previous, "position"),
            ],
            trend: gsc.series.map((row) => ({ date: row.date, value: row.clicks ?? 0 })),
            queries: gsc.list("query").map(pick),
            pages: gsc.list("page").map(pick),
          }
        : null,
      gads: gads
        ? {
            periodStart: gads.periodStart,
            periodEnd: gads.periodEnd,
            syncedAt: gads.syncedAt,
            currency: gads.current?.currency,
            kpis: [
              kpi("cost", "Ad spend", "money", gads.current, gads.previous, "costMicros"),
              kpi("clicks", "Ad clicks", "count", gads.current, gads.previous, "clicks"),
              kpi("impressions", "Ad impressions", "count", gads.current, gads.previous, "impressions"),
              kpi("conversions", "Conversions", "count", gads.current, gads.previous, "conversions"),
            ],
            trend: gads.series.map((row) => ({ date: row.date, value: row.costMicros ?? 0 })),
            campaigns: gads.list("campaign").map(pick),
          }
        : null,
    };
  },
});
