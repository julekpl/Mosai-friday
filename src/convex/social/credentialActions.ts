import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import {
  REFRESH_LEASE_MS,
  tokenIsFresh,
  type RefreshOutcome,
} from "./credentials";
import { socialPlatformEnv, type SocialPlatform } from "./platforms";

/** OAuth machine codes that may ever appear verbatim in a server message.
 *  Any other provider-supplied JSON `error` string is discarded at the
 *  message site (review gap 2) — only the HTTP status is reported. */
const OAUTH_ERROR_ALLOWLIST: readonly string[] = [
  "invalid_grant",
  "invalid_token",
  "expired_token",
  "revoked_token",
];

/**
 * BP-04 — the only place a social token refresh may talk to a provider.
 *
 * Convex forbids `fetch` inside queries/mutations, so the request lives here:
 *  - an internal **query** loads the credential (secrets stay server-side);
 *  - an internal **mutation** claims a lease and records the observed version;
 *  - the provider request runs in this action;
 *  - an internal **mutation** saves the result only if the lease is still held
 *    and the version is unchanged, or releases the claim on failure.
 *
 * Every provider failure is redacted to an HTTP status and — when the provider
 * speaks OAuth — the machine error code. Provider response bodies are read
 * only to extract that code and are never echoed into messages, logs, posts or
 * the client. `invalid_grant`-style rejections become a **reconnect** state.
 */
export const refreshIfNeeded = internalAction({
  args: { credId: v.id("socialCredentials") },
  handler: async (ctx, { credId }): Promise<RefreshOutcome> => {
    const cred = await ctx.runQuery(
      internal.social.credentials.getCredentialById,
      { credId },
    ) as {
      accessToken: string;
      expiresAt?: number | undefined;
      refreshToken?: string | undefined;
      platform: string;
    } | null;
    if (!cred) {
      return {
        ok: false,
        reason: "missing",
        message: "Credential not found — reconnect this platform.",
      };
    }
    if (tokenIsFresh(cred)) return { ok: true, accessToken: cred.accessToken };

    if (!cred.refreshToken) {
      // Expired with nothing to rotate (this platform issued no refresh
      // token) — an honest reconnect beats a silent failure.
      await ctx.runMutation(internal.social.credentials.markNeedsReconnect, { credId });
      return {
        ok: false,
        reason: "reconnect",
        message:
          "Access token expired and no refresh token is available — reconnect this platform.",
      };
    }

    const env = socialPlatformEnv(cred.platform as SocialPlatform);
    if (!env) {
      return {
        ok: false,
        reason: "not_configured",
        message: "Platform credentials are not configured in this deployment.",
      };
    }

    const claim = await ctx.runMutation(internal.social.credentials.claimRefresh, {
      credId,
      leaseMs: REFRESH_LEASE_MS,
    });
    if (claim.status === "missing") {
      return {
        ok: false,
        reason: "missing",
        message: "Credential not found — reconnect this platform.",
      };
    }
    if (claim.status === "busy") {
      // Another refresh holds the lease: use its result if it landed, else
      // report the in-flight state instead of firing a second request.
      const again = await ctx.runQuery(
        internal.social.credentials.getCredentialById,
        { credId },
      ) as { accessToken: string; expiresAt?: number | undefined } | null;
      if (again && tokenIsFresh(again)) return { ok: true, accessToken: again.accessToken };
      return {
        ok: false,
        reason: "busy",
        message: "A token refresh is already in progress — try again shortly.",
      };
    }

    const observedVersion = claim.tokenVersion;
    // Honor the platform's configured token exchange (platforms.ts): LinkedIn
    // and X use HTTP Basic auth on the token endpoint — client credentials
    // never ride in the form (same shape as oauth.exchangeSocialCode). The
    // remaining platforms keep the form exchange.
    const form = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: cred.refreshToken,
    });
    const headers: Record<string, string> = {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    };
    if (env.tokenExchange === "basic") {
      headers.Authorization = `Basic ${btoa(`${env.clientId}:${env.clientSecret}`)}`;
    } else {
      form.set("client_id", env.clientId);
      form.set("client_secret", env.clientSecret);
    }
    let res: Response;
    try {
      res = await fetch(env.tokenUrl, { method: "POST", headers, body: form });
    } catch {
      await ctx.runMutation(internal.social.credentials.releaseRefresh, {
        credId,
        leaseId: claim.leaseId,
      });
      return {
        ok: false,
        reason: "provider_error",
        message: "Token refresh failed — the provider could not be reached.",
      };
    }

    if (!res.ok) {
      const status = res.status;
      let oauthError: string | null = null;
      try {
        const parsed = (await res.json()) as { error?: unknown };
        if (typeof parsed?.error === "string") oauthError = parsed.error;
      } catch {
        // Not JSON — the body is never echoed.
      }
      // Review gap 2: the allowlist check lives AT the message site, so a
      // provider-supplied `error` string that is not one of these OAuth
      // machine codes is discarded here and can never reach a message, post
      // or error — only the HTTP status is reported instead.
      const safeCode =
        oauthError !== null && OAUTH_ERROR_ALLOWLIST.includes(oauthError)
          ? oauthError
          : null;
      const grantRejected =
        safeCode !== null || (oauthError === null && (status === 400 || status === 401));
      if (grantRejected) {
        await ctx.runMutation(internal.social.credentials.markNeedsReconnect, { credId });
        return {
          ok: false,
          reason: "reconnect",
          message: `The ${cred.platform} credential was rejected (HTTP ${status}${
            safeCode ? `, ${safeCode}` : ""
          }) — reconnect this platform.`,
        };
      }
      await ctx.runMutation(internal.social.credentials.releaseRefresh, {
        credId,
        leaseId: claim.leaseId,
      });
      return {
        ok: false,
        reason: "provider_error",
        message: `Token refresh failed (HTTP ${status}) — try again later.`,
      };
    }

    let data: { access_token?: string; refresh_token?: string; expires_in?: number };
    try {
      data = await res.json();
    } catch {
      await ctx.runMutation(internal.social.credentials.releaseRefresh, {
        credId,
        leaseId: claim.leaseId,
      });
      return {
        ok: false,
        reason: "provider_error",
        message: "Token refresh returned an unreadable response — try again later.",
      };
    }
    if (!data.access_token) {
      await ctx.runMutation(internal.social.credentials.releaseRefresh, {
        credId,
        leaseId: claim.leaseId,
      });
      return {
        ok: false,
        reason: "provider_error",
        message: "Token refresh returned no access token.",
      };
    }

    const saved = await ctx.runMutation(
      internal.social.credentials.saveRefreshResult,
      {
        credId,
        leaseId: claim.leaseId,
        expectedVersion: observedVersion,
        accessToken: data.access_token,
        expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
        // Save the rotated refresh token when the provider supplies one —
        // otherwise the stored copy is already consumed and dead.
        refreshToken: data.refresh_token,
      },
    );
    if (!saved.applied) {
      // Someone newer won the race: prefer the stored token, never overwrite.
      const newer = await ctx.runQuery(
        internal.social.credentials.getCredentialById,
        { credId },
      ) as { accessToken: string; expiresAt?: number | undefined } | null;
      if (newer && tokenIsFresh(newer)) return { ok: true, accessToken: newer.accessToken };
      return {
        ok: false,
        reason: "busy",
        message: "The stored credential changed during refresh — try again.",
      };
    }
    return { ok: true, accessToken: data.access_token };
  },
});
