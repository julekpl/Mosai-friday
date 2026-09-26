import type { QueryCtx, MutationCtx } from "../_generated/server";

/* ── Operator-editable platform limits (owner ask, 26 Sep 2026) ──────────
 *
 * Spending limits the platform admin can change in admin > Limits without a
 * redeploy. Each limit resolves in this order:
 *
 *   1. the value saved in admin (`appSettings` row, key "limits");
 *   2. the deployment environment variable;
 *   3. the default below.
 *
 * One exception keeps the documented kill switch intact: setting
 * `MOSAI_AI_DAILY_CAP_MICROUSD=0` on the deployment stops all AI whatever
 * the admin value says, so an operator can always stop spend from the
 * deployment even if the admin panel is unreachable.
 *
 * Values are integers: calls for lookup providers, micro-US-dollars for AI
 * (AGENTS.md §5.7). A stored value outside its bounds is ignored (falls
 * through to the environment/default) so a bad row can never lift a limit
 * past its maximum.
 */

export const LIMIT_KEYS = [
  "serpapiMonthlyCeiling",
  "serpapiUserDailyCap",
  "pexelsMonthlyCeiling",
  "aiPlatformDailyMicrousd",
  "aiTrialDailyMicrousd",
] as const;

export type LimitKey = (typeof LIMIT_KEYS)[number];

export type LimitSource = "admin" | "env" | "default" | "kill_switch";

export type ResolvedLimit = { value: number; source: LimitSource };

type LimitSpec = {
  defaultValue: number;
  envVar: string;
  /** Smallest value the environment variable may set (existing behaviour:
   *  lookup ceilings ignore 0 from the environment; the AI cap accepts it). */
  envMin: number;
  /** Bounds for an admin-saved value (inclusive). 0 means "stop". */
  max: number;
};

export const LIMIT_SPECS: Record<LimitKey, LimitSpec> = {
  serpapiMonthlyCeiling: { defaultValue: 200, envVar: "SERPAPI_MONTHLY_CEILING", envMin: 1, max: 1_000_000 },
  serpapiUserDailyCap: { defaultValue: 10, envVar: "SERPAPI_USER_DAILY_CAP", envMin: 1, max: 10_000 },
  pexelsMonthlyCeiling: { defaultValue: 15_000, envVar: "PEXELS_MONTHLY_CEILING", envMin: 1, max: 1_000_000 },
  // $10 per day (lib/aiBudget.ts AI_BUDGET_CONFIG.platformDailyMicrousd).
  aiPlatformDailyMicrousd: {
    defaultValue: 10_000_000,
    envVar: "MOSAI_AI_DAILY_CAP_MICROUSD",
    envMin: 0,
    max: 1_000_000_000,
  },
  // Owner decision O3 (26 Sep 2026): trial AI spend across the platform
  // stops at $1 per UTC day.
  aiTrialDailyMicrousd: {
    defaultValue: 1_000_000,
    envVar: "MOSAI_AI_TRIAL_DAILY_CAP_MICROUSD",
    envMin: 0,
    max: 1_000_000_000,
  },
};

export type StoredLimits = Partial<Record<LimitKey, number>>;

export const LIMITS_SETTINGS_KEY = "limits";

export function isValidLimitValue(key: LimitKey, value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= LIMIT_SPECS[key].max;
}

function parseEnv(key: LimitKey, raw: string | undefined): number | null {
  const trimmed = raw?.trim() ?? "";
  if (!/^\d{1,15}$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return value >= LIMIT_SPECS[key].envMin ? value : null;
}

/** Pure resolution: admin value, else environment, else default. */
export function resolveLimit(
  key: LimitKey,
  stored: number | undefined,
  env: Readonly<Record<string, string | undefined>> = process.env,
): ResolvedLimit {
  const spec = LIMIT_SPECS[key];
  const fromEnv = parseEnv(key, env[spec.envVar]);
  if (key === "aiPlatformDailyMicrousd" && fromEnv === 0) {
    return { value: 0, source: "kill_switch" };
  }
  if (stored !== undefined && isValidLimitValue(key, stored)) {
    return { value: stored, source: "admin" };
  }
  if (fromEnv !== null) return { value: fromEnv, source: "env" };
  return { value: spec.defaultValue, source: "default" };
}

/** The admin-saved limits row, or an empty object. */
export async function readStoredLimits(ctx: QueryCtx | MutationCtx): Promise<StoredLimits> {
  const row = await ctx.db
    .query("appSettings")
    .withIndex("by_key", (q) => q.eq("key", LIMITS_SETTINGS_KEY))
    .unique();
  return row?.limits ?? {};
}

/** One limit, resolved server-side. The value is never logged. */
export async function limitFor(ctx: QueryCtx | MutationCtx, key: LimitKey): Promise<number> {
  return resolveLimit(key, (await readStoredLimits(ctx))[key]).value;
}
