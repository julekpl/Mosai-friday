import { v } from "convex/values";
import { httpAction } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { moduleAction, moduleMutation, moduleQuery } from "../guards";
import { configuredOAuthBaseUrl } from "../lib/oauthBaseUrl";
import {
  GOOGLE_CALLBACK_PATH,
  GOOGLE_REVOKE_URL,
  GOOGLE_STATE_PLATFORM,
  GOOGLE_TOKEN_URL,
  buildAuthorizeUrl,
  emailFromIdToken,
  googleAdsDeveloperToken,
  googleOAuthEnv,
  grantedSources,
} from "./config";

/**
 * Grow — one Google OAuth connection per project, covering GA4, Search
 * Console and Google Ads (read-only reporting).
 *
 * Flow: `start` (grow.manage) writes a single-use state bound to the caller
 * and project, and returns Google's consent URL (offline access, forced
 * consent, incremental scopes). Google redirects to `/api/google/callback`,
 * which claims the state, exchanges the code server-side, stores the tokens
 * and immediately lists the selectable resources and queues a first sync.
 * Nothing is shown as connected until Google has issued tokens.
 */

const SETUP_MESSAGE = "Google isn't set up on this workspace yet — ask your admin.";

type SetupState = {
  /** OAuth can start (client credentials + both redirect origins). */
  ready: boolean;
  /** Google Ads additionally needs an approved developer token. */
  adsReady: boolean;
};

function setupState(): SetupState {
  const ready =
    googleOAuthEnv() !== null &&
    configuredOAuthBaseUrl(process.env.ADS_OAUTH_REDIRECT_BASE) !== null &&
    configuredOAuthBaseUrl(process.env.CONVEX_SITE_URL) !== null;
  return { ready, adsReady: ready && googleAdsDeveloperToken() !== null };
}

/** Everything the Grow page needs about the connection. Never tokens. */
export const status = moduleQuery("grow", {
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }, access) => {
    const scope = await access.ownedProject(projectId);
    if (!scope) return null;
    const setup = setupState();
    const row = await ctx.db
      .query("googleConnections")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .first();
    const lastRun = await ctx.db
      .query("googleSyncRuns")
      .withIndex("by_project_created", (q) => q.eq("projectId", projectId))
      .order("desc")
      .first();
    const now = Date.now();
    const runStale =
      lastRun &&
      (lastRun.status === "queued" || lastRun.status === "running") &&
      now - lastRun.createdAt > 15 * 60 * 1000;
    return {
      setup: {
        state: setup.ready ? ("ready" as const) : ("needs_setup" as const),
        adsState: setup.adsReady ? ("ready" as const) : ("needs_setup" as const),
        message: setup.ready ? undefined : SETUP_MESSAGE,
      },
      connection: row
        ? {
            status: row.status,
            accountEmail: row.accountEmail,
            connectedAt: row.createdAt,
            granted: grantedSources(row.scope),
            resourcesListedAt: row.resourcesListedAt,
            ga4Properties: row.ga4Properties ?? [],
            gscSites: row.gscSites ?? [],
            adsCustomers: row.adsCustomers ?? [],
            resourceErrors: row.resourceErrors ?? [],
            selected: {
              ga4PropertyId: row.ga4PropertyId,
              ga4PropertyName: row.ga4PropertyName,
              gscSiteUrl: row.gscSiteUrl,
              adsCustomerId: row.adsCustomerId,
              adsCustomerName: row.adsCustomerName,
            },
          }
        : null,
      lastRun: lastRun
        ? {
            status: runStale ? ("failed" as const) : lastRun.status,
            trigger: lastRun.trigger,
            createdAt: lastRun.createdAt,
            finishedAt: lastRun.finishedAt,
            sources: lastRun.sources,
            message: runStale ? "This sync stopped responding. Start it again." : lastRun.message,
          }
        : null,
    };
  },
});

/** Begin OAuth: create state, return Google's consent URL. */
export const start = moduleMutation("grow", {
  capability: "grow.manage",
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }, access) => {
    const { userId } = await access.requireProject(projectId);
    const env = googleOAuthEnv();
    const appOrigin = configuredOAuthBaseUrl(process.env.ADS_OAUTH_REDIRECT_BASE);
    const callbackOrigin = configuredOAuthBaseUrl(process.env.CONVEX_SITE_URL);
    if (!env || !appOrigin || !callbackOrigin) {
      return { state: "needs_setup" as const, message: SETUP_MESSAGE };
    }
    const state = crypto.randomUUID();
    await ctx.db.insert("oauthStates", {
      state,
      projectId,
      platform: GOOGLE_STATE_PLATFORM,
      createdBy: userId,
      createdAt: Date.now(),
    });
    return {
      state: "ready" as const,
      authorizeUrl: buildAuthorizeUrl({
        clientId: env.clientId,
        redirectUri: `${callbackOrigin}${GOOGLE_CALLBACK_PATH}`,
        state,
      }),
    };
  },
});

/** Pick the GA4 property / Search Console site / Ads account to sync. Each
 *  choice must be one Google listed for this connection. `null` clears. */
export const selectResources = moduleMutation("grow", {
  capability: "grow.manage",
  args: {
    projectId: v.id("projects"),
    ga4PropertyId: v.optional(v.union(v.string(), v.null())),
    gscSiteUrl: v.optional(v.union(v.string(), v.null())),
    adsCustomerId: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args, access) => {
    await access.requireProject(args.projectId);
    const row = await ctx.db
      .query("googleConnections")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .first();
    if (!row) throw new Error("Connect Google first.");
    const patch: {
      ga4PropertyId?: string;
      ga4PropertyName?: string;
      gscSiteUrl?: string;
      adsCustomerId?: string;
      adsCustomerName?: string;
    } = {};
    if (args.ga4PropertyId !== undefined) {
      if (args.ga4PropertyId === null) {
        patch.ga4PropertyId = undefined;
        patch.ga4PropertyName = undefined;
      } else {
        const match = row.ga4Properties?.find((p) => p.id === args.ga4PropertyId);
        if (!match) throw new Error("That Google Analytics property isn't available to this connection.");
        patch.ga4PropertyId = match.id;
        patch.ga4PropertyName = match.name;
      }
    }
    if (args.gscSiteUrl !== undefined) {
      if (args.gscSiteUrl === null) patch.gscSiteUrl = undefined;
      else {
        const match = row.gscSites?.find((s) => s.siteUrl === args.gscSiteUrl);
        if (!match) throw new Error("That Search Console site isn't available to this connection.");
        patch.gscSiteUrl = match.siteUrl;
      }
    }
    if (args.adsCustomerId !== undefined) {
      if (args.adsCustomerId === null) {
        patch.adsCustomerId = undefined;
        patch.adsCustomerName = undefined;
      } else {
        const match = row.adsCustomers?.find((c) => c.id === args.adsCustomerId);
        if (!match || !match.usable) throw new Error("That Google Ads account can't be used for reporting.");
        patch.adsCustomerId = match.id;
        patch.adsCustomerName = match.name;
      }
    }
    await ctx.db.patch(row._id, { ...patch, updatedAt: Date.now() });
    return null;
  },
});

/** Revoke at Google, then delete tokens and synced data. */
export const disconnect = moduleAction("grow", {
  capability: "grow.manage",
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }, access): Promise<{ revoked: boolean }> => {
    await access.requireProject(projectId);
    const row = (await ctx.runQuery(internal.google.credentials.getConnection, { projectId })) as {
      accessToken: string;
      refreshToken?: string;
    } | null;
    if (!row) return { revoked: true };
    let revoked = false;
    try {
      // Revoking the refresh token also revokes its access tokens.
      const res = await fetch(GOOGLE_REVOKE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: row.refreshToken ?? row.accessToken }),
      });
      // 400 invalid_token means it is already revoked or expired.
      revoked = res.ok || res.status === 400;
    } catch {
      revoked = false;
    }
    await ctx.runMutation(internal.google.credentials.deleteConnection, { projectId, revoked });
    return { revoked };
  },
});

/** Google redirect target. Unauthenticated by nature: validated by the
 *  single-use state row before any code is exchanged or token stored. */
export const googleOauthCallback = httpAction(async (ctx, request) => {
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  const appOrigin = configuredOAuthBaseUrl(process.env.ADS_OAUTH_REDIRECT_BASE);
  const callbackOrigin = configuredOAuthBaseUrl(process.env.CONVEX_SITE_URL);
  const env = googleOAuthEnv();
  if (!appOrigin || !callbackOrigin) {
    return new Response("OAuth redirect settings are not configured", { status: 503 });
  }
  const back = (projectId: Id<"projects"> | null, query: string) =>
    new Response(null, {
      status: 302,
      headers: {
        Location: projectId ? `${appOrigin}/app/${projectId}/grow?${query}` : `${appOrigin}/app?${query}`,
      },
    });

  if (!state) return back(null, "google_error=expired_or_invalid_state");
  const claimed = await ctx.runMutation(internal.google.credentials.claimState, { state });
  if (!claimed) return back(null, "google_error=expired_or_invalid_state");
  const { projectId, userId } = claimed;
  if (error || !code) return back(projectId, `google_error=${error === "access_denied" ? "access_denied" : "missing_code"}`);
  if (!env) return back(projectId, "google_error=not_configured");

  let tokens: {
    access_token?: unknown;
    refresh_token?: unknown;
    expires_in?: unknown;
    scope?: unknown;
    id_token?: unknown;
  };
  try {
    const res = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: `${callbackOrigin}${GOOGLE_CALLBACK_PATH}`,
        client_id: env.clientId,
        client_secret: env.clientSecret,
      }),
    });
    if (!res.ok) return back(projectId, "google_error=token_exchange_failed");
    tokens = (await res.json()) as typeof tokens;
  } catch {
    return back(projectId, "google_error=token_exchange_failed");
  }
  if (typeof tokens.access_token !== "string") return back(projectId, "google_error=token_exchange_failed");

  const connectionId = await ctx.runMutation(internal.google.credentials.storeConnection, {
    projectId,
    connectedBy: userId,
    accessToken: tokens.access_token,
    refreshToken: typeof tokens.refresh_token === "string" ? tokens.refresh_token : undefined,
    expiresAt: typeof tokens.expires_in === "number" ? Date.now() + tokens.expires_in * 1000 : undefined,
    scope: typeof tokens.scope === "string" ? tokens.scope : undefined,
    accountEmail: emailFromIdToken(typeof tokens.id_token === "string" ? tokens.id_token : undefined),
  });
  // List resources (and, once something is selected, sync) in the
  // background so the redirect is instant.
  await ctx.scheduler.runAfter(0, internal.google.sync.afterConnect, { projectId, connectionId });
  return back(projectId, "google=connected");
});
