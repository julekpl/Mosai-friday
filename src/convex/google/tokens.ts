import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import {
  GOOGLE_TOKEN_URL,
  classifyGoogleError,
  googleOAuthEnv,
  type GoogleError,
} from "./config";

/**
 * Google token handling for the Grow connection. The only place a Google
 * token is refreshed, and the one `fetch` wrapper every Google read uses:
 *
 *  - access tokens are refreshed ahead of expiry under the BP-04 lease;
 *  - a 401 forces one refresh and one retry; a second 401, or a rejected
 *    refresh grant, records `needs_reconnect` — never silent failure;
 *  - failures are reduced to an HTTP status plus enum-like Google codes.
 */

export const REFRESH_LEASE_MS = 60_000;
const REFRESH_SKEW_MS = 5 * 60 * 1000;
const OAUTH_REJECTIONS = ["invalid_grant", "invalid_token", "unauthorized_client", "invalid_client"];

export type TokenOutcome =
  | { ok: true; accessToken: string }
  | { ok: false; reason: "missing" | "not_configured" | "reconnect" | "busy" | "provider_error" };

type ConnectionTokens = Pick<Doc<"googleConnections">, "accessToken" | "refreshToken" | "expiresAt" | "status">;

export function tokenIsFresh(row: { expiresAt?: number }, now = Date.now()): boolean {
  return !row.expiresAt || row.expiresAt > now + REFRESH_SKEW_MS;
}

async function loadTokens(ctx: ActionCtx, connectionId: Id<"googleConnections">): Promise<ConnectionTokens | null> {
  return (await ctx.runQuery(internal.google.credentials.getConnectionById, { connectionId })) as ConnectionTokens | null;
}

/** A usable access token, refreshing when stale (or when `force`). */
export async function accessTokenFor(
  ctx: ActionCtx,
  connectionId: Id<"googleConnections">,
  force = false,
): Promise<TokenOutcome> {
  const row = await loadTokens(ctx, connectionId);
  if (!row) return { ok: false, reason: "missing" };
  if (row.status === "needs_reconnect") return { ok: false, reason: "reconnect" };
  if (!force && tokenIsFresh(row)) return { ok: true, accessToken: row.accessToken };
  if (!row.refreshToken) {
    await ctx.runMutation(internal.google.credentials.markNeedsReconnect, { connectionId });
    return { ok: false, reason: "reconnect" };
  }
  const env = googleOAuthEnv();
  if (!env) return { ok: false, reason: "not_configured" };

  const claim = await ctx.runMutation(internal.google.credentials.claimRefresh, {
    connectionId,
    leaseMs: REFRESH_LEASE_MS,
  });
  if (claim.status === "missing") return { ok: false, reason: "missing" };
  if (claim.status === "busy") {
    const again = await loadTokens(ctx, connectionId);
    return again && !force && tokenIsFresh(again)
      ? { ok: true, accessToken: again.accessToken }
      : { ok: false, reason: "busy" };
  }

  let res: Response;
  try {
    res = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: row.refreshToken,
        client_id: env.clientId,
        client_secret: env.clientSecret,
      }),
    });
  } catch {
    await ctx.runMutation(internal.google.credentials.releaseRefresh, { connectionId, leaseId: claim.leaseId });
    return { ok: false, reason: "provider_error" };
  }

  if (!res.ok) {
    let oauthError: string | null = null;
    try {
      const parsed = (await res.json()) as { error?: unknown };
      if (typeof parsed.error === "string") oauthError = parsed.error;
    } catch {
      // Body is never echoed.
    }
    if ((oauthError && OAUTH_REJECTIONS.includes(oauthError)) || (!oauthError && (res.status === 400 || res.status === 401))) {
      await ctx.runMutation(internal.google.credentials.markNeedsReconnect, { connectionId });
      return { ok: false, reason: "reconnect" };
    }
    await ctx.runMutation(internal.google.credentials.releaseRefresh, { connectionId, leaseId: claim.leaseId });
    return { ok: false, reason: "provider_error" };
  }

  let data: { access_token?: unknown; expires_in?: unknown; refresh_token?: unknown };
  try {
    data = (await res.json()) as typeof data;
  } catch {
    data = {};
  }
  if (typeof data.access_token !== "string") {
    await ctx.runMutation(internal.google.credentials.releaseRefresh, { connectionId, leaseId: claim.leaseId });
    return { ok: false, reason: "provider_error" };
  }
  const saved = await ctx.runMutation(internal.google.credentials.saveRefreshResult, {
    connectionId,
    leaseId: claim.leaseId,
    expectedVersion: claim.tokenVersion,
    accessToken: data.access_token,
    expiresAt: typeof data.expires_in === "number" ? Date.now() + data.expires_in * 1000 : undefined,
    refreshToken: typeof data.refresh_token === "string" ? data.refresh_token : undefined,
  });
  if (!saved.applied) {
    const newer = await loadTokens(ctx, connectionId);
    return newer && tokenIsFresh(newer) ? { ok: true, accessToken: newer.accessToken } : { ok: false, reason: "busy" };
  }
  return { ok: true, accessToken: data.access_token };
}

/** Internal entry point (used by tests and by other internal actions). */
export const refreshAccessToken = internalAction({
  args: { connectionId: v.id("googleConnections"), force: v.optional(v.boolean()) },
  handler: async (ctx, { connectionId, force }): Promise<{ ok: boolean; reason?: string }> => {
    const out = await accessTokenFor(ctx, connectionId, force ?? false);
    // Never hand token material back out of the action.
    return out.ok ? { ok: true } : { ok: false, reason: out.reason };
  },
});

export type GoogleCall =
  | { ok: true; data: unknown }
  | { ok: false; error: GoogleError; reconnect: boolean };

/** A session reuses one token across calls and refreshes at most once. */
export type GoogleSession = {
  connectionId: Id<"googleConnections">;
  accessToken: string;
  refreshed: boolean;
};

export async function openSession(
  ctx: ActionCtx,
  connectionId: Id<"googleConnections">,
): Promise<{ ok: true; session: GoogleSession } | { ok: false; reason: Exclude<TokenOutcome, { ok: true }>["reason"] }> {
  const token = await accessTokenFor(ctx, connectionId);
  if (!token.ok) return { ok: false, reason: token.reason };
  return { ok: true, session: { connectionId, accessToken: token.accessToken, refreshed: false } };
}

/** GET/POST a fixed Google endpoint with the session token. */
export async function callGoogle(
  ctx: ActionCtx,
  session: GoogleSession,
  request: { url: string; method?: "GET" | "POST"; body?: unknown; headers?: Record<string, string> },
): Promise<GoogleCall> {
  const attempt = async (): Promise<Response | null> => {
    try {
      return await fetch(request.url, {
        method: request.method ?? "GET",
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
          Accept: "application/json",
          ...(request.body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...request.headers,
        },
        body: request.body !== undefined ? JSON.stringify(request.body) : undefined,
      });
    } catch {
      return null;
    }
  };

  let res = await attempt();
  if (res && res.status === 401 && !session.refreshed) {
    session.refreshed = true;
    const token = await accessTokenFor(ctx, session.connectionId, true);
    if (!token.ok) {
      return {
        ok: false,
        error: { kind: token.reason === "reconnect" ? "unauthorized" : "provider_error", status: 401 },
        reconnect: token.reason === "reconnect",
      };
    }
    session.accessToken = token.accessToken;
    res = await attempt();
  }
  if (!res) return { ok: false, error: { kind: "network" }, reconnect: false };

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (res.ok) return { ok: true, data: body };
  const error = classifyGoogleError(res.status, body);
  if (res.status === 401) {
    // Still rejected after a successful refresh: the grant is dead.
    await ctx.runMutation(internal.google.credentials.markNeedsReconnect, { connectionId: session.connectionId });
    return { ok: false, error, reconnect: true };
  }
  return { ok: false, error, reconnect: false };
}
