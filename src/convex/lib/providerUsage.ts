import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";
import type { ActionCtx, MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { LOOKUP_RESTING_CODE } from "../../lib/lookupErrors";
import { limitFor, type LimitKey } from "./platformLimits";

export { LOOKUP_RESTING_CODE };

/* ── LQ-1: platform-wide monthly ceiling for paid lookup providers ───────
 *
 * `providerUsageRollups` holds one row per (kind, UTC month). Every SerpApi
 * and Pexels caller runs `reserveProviderCall` (or, for SerpApi,
 * `reserveSerpApiCall` — see below) before its provider fetch; the
 * increment and the ceiling check happen inside one mutation, so concurrent
 * callers cannot race past the ceiling. This is a platform cap, separate
 * from (and in addition to) the existing per-user `google_maps` 10-minute
 * quota in `guards.ts` (`consumeLookupQuota`), which is unchanged.
 *
 * At the ceiling, callers must degrade to their feature's existing
 * `needs_setup`-style result — never an empty success, never fake results.
 */

export type ProviderKind = "serpapi" | "pexels";

// Ceilings resolve admin > Limits, else env (`SERPAPI_MONTHLY_CEILING`,
// `PEXELS_MONTHLY_CEILING`), else the defaults 200 / 15,000
// (lib/platformLimits.ts).
const CEILING_KEY: Record<ProviderKind, LimitKey> = {
  serpapi: "serpapiMonthlyCeiling",
  pexels: "pexelsMonthlyCeiling",
};

async function ceilingFor(ctx: MutationCtx, kind: ProviderKind): Promise<number> {
  return await limitFor(ctx, CEILING_KEY[kind]);
}

/** UTC calendar month, e.g. "2026-09". */
export function currentUtcPeriod(now: number = Date.now()): string {
  const d = new Date(now);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Atomically increments this month's counter for `kind` and refuses once the
 * platform ceiling is reached. Convex serializes mutations against the same
 * document, so concurrent callers cannot both slip past the last slot.
 */
export const reserveProviderCall = internalMutation({
  args: { kind: v.union(v.literal("serpapi"), v.literal("pexels")) },
  handler: async (ctx, { kind }): Promise<{ ok: boolean }> => {
    const period = currentUtcPeriod();
    const ceiling = await ceilingFor(ctx, kind);
    const row = await ctx.db
      .query("providerUsageRollups")
      .withIndex("by_kind_period", (q) => q.eq("kind", kind).eq("period", period))
      .unique();
    if (row) {
      if (row.count >= ceiling) return { ok: false };
      await ctx.db.patch(row._id, { count: row.count + 1, updatedAt: Date.now() });
      return { ok: true };
    }
    await ctx.db.insert("providerUsageRollups", { kind, period, count: 1, updatedAt: Date.now() });
    return { ok: true };
  },
});

/** Action-side helper: call BEFORE the provider fetch. Returns false at the
 *  platform ceiling; the caller must then return its feature's existing
 *  `needs_setup` result instead of fetching. */
export async function reserveProviderCallForAction(
  ctx: ActionCtx,
  kind: ProviderKind,
): Promise<boolean> {
  const result = await ctx.runMutation(internal.lib.providerUsage.reserveProviderCall, { kind });
  return result.ok;
}

/* ── SerpApi: platform ceiling + per-user daily cap, combined ───────────
 *
 * Every SerpApi caller (business search, research, YouTube transcripts)
 * spends against two budgets: the platform monthly ceiling above, and a
 * per-user daily cap (default 10; admin > Limits, else env `SERPAPI_USER_DAILY_CAP`) that stops
 * one account draining the whole month through the existing 60-per-10-minute
 * `google_maps` window (`guards.consumeLookupQuota`, unchanged and separate).
 *
 * Both budgets are read and, only if BOTH have room, incremented inside one
 * mutation — a refusal on either side never spends the other's slot.
 */

const SERPAPI_DAILY_KIND = "serpapi_daily";
const SERPAPI_DAILY_WINDOW_MS = 24 * 60 * 60_000;


export type SerpApiReserveResult =
  | { ok: true }
  | { ok: false; reason: "daily_cap" | "ceiling" };

export const reserveSerpApiCall = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }): Promise<SerpApiReserveResult> => {
    const now = Date.now();

    const dailyCap = await limitFor(ctx, "serpapiUserDailyCap");
    const dailyWindowStart = Math.floor(now / SERPAPI_DAILY_WINDOW_MS) * SERPAPI_DAILY_WINDOW_MS;
    const dailyBucket = await ctx.db
      .query("lookupRateLimits")
      .withIndex("by_user_kind_window", (q) =>
        q.eq("userId", userId).eq("kind", SERPAPI_DAILY_KIND).eq("windowStart", dailyWindowStart),
      )
      .unique();
    if (dailyBucket && dailyBucket.count >= dailyCap) return { ok: false, reason: "daily_cap" };

    const period = currentUtcPeriod(now);
    const ceiling = await ceilingFor(ctx, "serpapi");
    const platformRow = await ctx.db
      .query("providerUsageRollups")
      .withIndex("by_kind_period", (q) => q.eq("kind", "serpapi").eq("period", period))
      .unique();
    if (platformRow && platformRow.count >= ceiling) return { ok: false, reason: "ceiling" };

    // Both budgets have room: commit both increments together.
    if (dailyBucket) {
      await ctx.db.patch(dailyBucket._id, { count: dailyBucket.count + 1 });
    } else {
      await ctx.db.insert("lookupRateLimits", {
        userId,
        kind: SERPAPI_DAILY_KIND,
        windowStart: dailyWindowStart,
        count: 1,
      });
      const stale = await ctx.db
        .query("lookupRateLimits")
        .withIndex("by_user_kind_window", (q) =>
          q
            .eq("userId", userId)
            .eq("kind", SERPAPI_DAILY_KIND)
            .lt("windowStart", dailyWindowStart - 7 * SERPAPI_DAILY_WINDOW_MS),
        )
        .collect();
      for (const row of stale) await ctx.db.delete(row._id);
    }
    if (platformRow) {
      await ctx.db.patch(platformRow._id, { count: platformRow.count + 1, updatedAt: now });
    } else {
      await ctx.db.insert("providerUsageRollups", { kind: "serpapi", period, count: 1, updatedAt: now });
    }
    return { ok: true };
  },
});

/** Action-side helper: call BEFORE every paid SerpApi fetch (business
 *  search, research collectors, YouTube transcript import). */
export async function reserveSerpApiCallForAction(
  ctx: ActionCtx,
  userId: Id<"users">,
): Promise<SerpApiReserveResult> {
  return await ctx.runMutation(internal.lib.providerUsage.reserveSerpApiCall, { userId });
}
