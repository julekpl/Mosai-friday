import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";

/**
 * Ads credential storage + refresh bookkeeping (BP-04).
 *
 * Tokens live in Convex (encrypted at rest by Convex) and NEVER leave the
 * server: the client queries only status/labels, never token values.
 *
 * The provider request itself lives in `ads/credentialActions.ts` — an
 * **action** is the only place a `fetch` may run (Convex forbids it in
 * queries/mutations, and the lease/version protocol below is what makes a
 * concurrent rotating-token response safe):
 *
 *   claim (lease + version) → provider request in the action →
 *   save (only while the lease is held AND the version is unchanged) →
 *   release on any failure. A stale response can never overwrite a newer
 *   refresh token.
 */

/** How long one refresh attempt may hold the claim. Long enough for a slow
 *  provider, short enough that a crashed attempt stops blocking refreshes. */
export const REFRESH_LEASE_MS = 60_000;

/** Access tokens with less than this margin are treated as expired. */
const REFRESH_SKEW_MS = 5 * 60 * 1000;

/** The one result shape a refresh returns. Tokens travel only inside actions
 *  on the server; callers surface `message` (redacted) to users. */
export type RefreshOutcome =
  | { ok: true; accessToken: string }
  | {
      ok: false,
      reason: "missing" | "not_configured" | "reconnect" | "busy" | "provider_error";
      message: string;
    };

/** Fresh enough to use without a provider round trip. A credential with no
 *  `expiresAt` (e.g. Meta long-lived tokens) is always fresh. */
export function tokenIsFresh(
  cred: { expiresAt?: number | undefined },
  now = Date.now(),
): boolean {
  return !cred.expiresAt || cred.expiresAt > now + REFRESH_SKEW_MS;
}

/** Internal query used by actions to fetch a credential by (project, platform).
 *  Despite the historic name it returns the credential **document**; callers
 *  use `cred._id` (the documented ads contract — preserved in BP-04). */
export const getCredId = internalQuery({
  args: { projectId: v.id("projects"), platform: v.string() },
  handler: async (ctx, { projectId, platform }) => {
    return await ctx.db
      .query("adsCredentials")
      .withIndex("by_project_platform", (q) =>
        q.eq("projectId", projectId).eq("platform", platform),
      )
      .first();
  },
});

/** The credential document by id — used by the refresh action to load the
 *  secrets it needs (server-to-server; never reachable from a client). */
export const getCredentialById = internalQuery({
  args: { credId: v.id("adsCredentials") },
  handler: async (ctx, { credId }) => await ctx.db.get(credId),
});

/** Claim the right to refresh this credential: at most one lease holder, and
 *  the version observed at claim time so a late save can be refused. */
export const claimRefresh = internalMutation({
  args: { credId: v.id("adsCredentials"), leaseMs: v.number() },
  handler: async (ctx, { credId, leaseMs }) => {
    const cred = await ctx.db.get(credId);
    if (!cred) return { status: "missing" as const };
    const now = Date.now();
    if (cred.refreshLeaseId && cred.refreshLeaseUntil && cred.refreshLeaseUntil > now) {
      return { status: "busy" as const };
    }
    // Either no lease, or an expired one (a crashed attempt expires safely).
    const leaseId = crypto.randomUUID();
    await ctx.db.patch(credId, {
      refreshLeaseId: leaseId,
      refreshLeaseUntil: now + leaseMs,
    });
    return {
      status: "claimed" as const,
      leaseId,
      tokenVersion: cred.tokenVersion ?? 0,
    };
  },
});

/** Save a refresh result only while (a) our lease is still held and
 *  unexpired and (b) the token version is still the one we claimed — a stale
 *  rotating-token response can never overwrite a newer token. A newly
 *  rotated refresh token supplied by the provider is saved here. */
export const saveRefreshResult = internalMutation({
  args: {
    credId: v.id("adsCredentials"),
    leaseId: v.string(),
    expectedVersion: v.number(),
    accessToken: v.string(),
    expiresAt: v.optional(v.number()),
    refreshToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const cred = await ctx.db.get(args.credId);
    if (!cred) return { applied: false as const, reason: "missing" as const };
    const leaseHeld =
      cred.refreshLeaseId === args.leaseId &&
      !!cred.refreshLeaseUntil &&
      cred.refreshLeaseUntil > Date.now();
    if (!leaseHeld) {
      return { applied: false as const, reason: "lease_lost" as const };
    }
    const version = cred.tokenVersion ?? 0;
    if (version !== args.expectedVersion) {
      return { applied: false as const, reason: "stale_version" as const };
    }
    const patch: Record<string, unknown> = {
      accessToken: args.accessToken,
      updatedAt: Date.now(),
      tokenVersion: version + 1,
      refreshLeaseId: undefined,
      refreshLeaseUntil: undefined,
      refreshStatus: "ok",
    };
    if (args.expiresAt !== undefined) patch.expiresAt = args.expiresAt;
    if (args.refreshToken) patch.refreshToken = args.refreshToken;
    await ctx.db.patch(args.credId, patch);
    return { applied: true as const };
  },
});

/** Release a failed claim without touching tokens. A stale lease id (from an
 *  attempt that already lost its claim) is a no-op. */
export const releaseRefresh = internalMutation({
  args: { credId: v.id("adsCredentials"), leaseId: v.string() },
  handler: async (ctx, { credId, leaseId }) => {
    const cred = await ctx.db.get(credId);
    if (!cred || cred.refreshLeaseId !== leaseId) return;
    await ctx.db.patch(credId, {
      refreshLeaseId: undefined,
      refreshLeaseUntil: undefined,
    });
  },
});

/** The provider rejected this credential (revoked / expired / no refresh
 *  token): record the reconnect state so the UI offers "reconnect" instead of
 *  pretending, and drop any held lease. Never stores provider text. */
export const markNeedsReconnect = internalMutation({
  args: { credId: v.id("adsCredentials") },
  handler: async (ctx, { credId }) => {
    const cred = await ctx.db.get(credId);
    if (!cred) return;
    await ctx.db.patch(credId, {
      refreshStatus: "needs_reconnect",
      refreshLeaseId: undefined,
      refreshLeaseUntil: undefined,
    });
  },
});
