import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";

/* ── LQ-1: platform-wide monthly ceiling for paid lookup providers ───────
 *
 * `providerUsageRollups` holds one row per (kind, UTC month). Every SerpApi
 * and Pexels caller runs `reserveProviderCall` before its provider fetch;
 * the increment and the ceiling check happen inside one mutation, so
 * concurrent callers cannot race past the ceiling. This is a platform cap,
 * separate from (and in addition to) the per-user quotas in `guards.ts`
 * (`consumeLookupQuota`, `consumeSerpApiDailyQuota`).
 *
 * At the ceiling, callers must degrade to their feature's existing
 * `needs_setup`-style result — never an empty success, never fake results.
 */

export type ProviderKind = "serpapi" | "pexels";

const DEFAULT_CEILINGS: Record<ProviderKind, number> = {
  serpapi: 200,
  pexels: 15_000,
};

const CEILING_ENV_VAR: Record<ProviderKind, string> = {
  serpapi: "SERPAPI_MONTHLY_CEILING",
  pexels: "PEXELS_MONTHLY_CEILING",
};

function ceilingFor(kind: ProviderKind): number {
  const raw = process.env[CEILING_ENV_VAR[kind]];
  if (!raw) return DEFAULT_CEILINGS[kind];
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_CEILINGS[kind];
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
    const ceiling = ceilingFor(kind);
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
