
import { v } from "convex/values";
import { httpAction } from "../_generated/server";
import { internalMutation, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import { moduleMutation, moduleQuery } from "../guards";
import {
  PLATFORMS,
  exchangeCodeForTokens,
  isPlatform,
  platformEnv,
  type Platform,
} from "./platforms";

/**
 * OAuth 2.0 connect/disconnect for the four ad platforms.
 *
 * Flow: client calls adsOauth.start → gets provider authorize URL.
 * Provider redirects to /api/ads/callback?state=…&code=…
 * Callback exchanges the code, stores tokens in adsCredentials, redirects
 * back to the Promote module.
 */

const STATE_TTL_MS = 10 * 60 * 1000;

/** Client-visible status: which platforms are configured + connected. */
export const status = moduleQuery("promote", {
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }, access) => {
    const scope = await access.ownedProject(projectId);
    if (!scope) return null;

    const creds = await ctx.db
      .query("adsCredentials")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();

    return PLATFORMS.map((p) => {
      const cred = creds.find((c) => c.platform === p);
      const env = platformEnv(p);
      return {
        platform: p,
        // configured = deployment has the platform's client id/secret
        configured: env !== null,
        connected: cred !== undefined,
        accountLabel: cred?.accountLabel,
        expiresAt: cred?.expiresAt,
      };
    });
  },
});

/** Begin OAuth: create state, return the provider authorize URL. */
export const start = moduleMutation("promote", {
  // Connecting or disconnecting a provider changes the module's setup.
  capability: "promote.manage",
  args: { projectId: v.id("projects"), platform: v.string() },
  handler: async (ctx, { projectId, platform }, access) => {
    const { userId } = await access.requireProject(projectId);
    if (!isPlatform(platform)) throw new Error("Unknown platform");

    const env = platformEnv(platform);
    if (!env) {
      throw new Error(
        `${platform} OAuth is not configured in this deployment (missing client id/secret env vars).`,
      );
    }

    const state = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}-${Math.random().toString(36).slice(2, 12)}`;
    await ctx.db.insert("oauthStates", {
      state,
      projectId,
      platform,
      createdBy: userId,
      createdAt: Date.now(),
    });

    const redirectUri = `${process.env.ADS_OAUTH_REDIRECT_BASE ?? ""}/api/ads/callback`;
    const url = new URL(env.authorizeUrl);
    for (const [k, v] of Object.entries({
      client_id: env.clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      state,
      scope: env.scopes.join(platform === "google" ? " " : ","),
    })) {
      if (v) url.searchParams.set(k, v);
    }
    // TikTok OAuth uses its portal; add required params
    if (platform === "tiktok") {
      url.searchParams.set("advertiser_id", "");
    }
    return { authorizeUrl: url.toString() };
  },
});

/** OAuth callback: exchange code, store tokens, redirect to the app. */
export const oauthCallback = httpAction(async (ctx, request) => {
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  const appUrl =
    process.env.ADS_OAUTH_REDIRECT_BASE ??
    `${url.protocol}//${url.host}`;

  if (error || !state || !code) {
    return redirect(`${appUrl}/app`, `error=${encodeURIComponent(error ?? "missing code or state")}`);
  }

  // 1. Validate + consume state (CSRF protection)
  const stateRow = await ctx.runQuery(internal.ads.oauth.getOauthState, { state });
  if (!stateRow || Date.now() - stateRow.createdAt > STATE_TTL_MS) {
    return redirect(appUrl, "error=expired_or_invalid_state");
  }
  await ctx.runMutation(internal.ads.oauth.consumeOauthState, { state });

  const platform = stateRow.platform as Platform;
  const env = platformEnv(platform);
  if (!env) return redirect(appUrl, "error=platform_not_configured");

  // 2. Exchange the authorization code for tokens
  const redirectUri = `${process.env.ADS_OAUTH_REDIRECT_BASE ?? `${url.protocol}//${url.host}`}/api/ads/callback`;
  try {
    const tokens = await exchangeCodeForTokens(platform, env, code, redirectUri);

    // 3. Store credentials server-side
    await ctx.runMutation(internal.ads.oauth.storeCred, {
      projectId: stateRow.projectId,
      platform,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresIn ? Date.now() + tokens.expiresIn * 1000 : undefined,
      scope: tokens.scope,
      connectedBy: stateRow.createdBy,
    });
    return redirect(appUrl, "connected=" + platform);
  } catch (e) {
    return redirect(
      appUrl,
      `error=${encodeURIComponent(e instanceof Error ? e.message : "token exchange failed")}`,
    );
  }
});

function redirect(appUrl: string, query: string) {
  // Normalize: always land on {origin}/app?query
  const origin = appUrl.replace(/\/$/, "").replace(/\/app$/, "");
  return new Response(null, {
    status: 302,
    headers: { Location: `${origin}/app?${query}` },
  });
}

/* ── internal helpers for the callback ────────────────────────────────── */

export const getOauthState = internalQuery({
  args: { state: v.string() },
  handler: async (ctx, { state }) => {
    return await ctx.db
      .query("oauthStates")
      .withIndex("by_state", (q) => q.eq("state", state))
      .first();
  },
});

export const consumeOauthState = internalMutation({
  args: { state: v.string() },
  handler: async (ctx, { state }) => {
    const row = await ctx.db
      .query("oauthStates")
      .withIndex("by_state", (q) => q.eq("state", state))
      .first();
    if (row) await ctx.db.delete(row._id);
  },
});

export const storeCred = internalMutation({
  args: {
    projectId: v.id("projects"),
    platform: v.string(),
    accessToken: v.string(),
    refreshToken: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
    scope: v.optional(v.string()),
    connectedBy: v.id("users"),
  },
  handler: async (ctx, args) => {
      const existing = await ctx.db
        .query("adsCredentials")
        .withIndex("by_project_platform", (q) =>
          q.eq("projectId", args.projectId).eq("platform", args.platform),
        )
        .first();
      const now = Date.now();
      if (existing) {
        await ctx.db.patch(existing._id, {
          accessToken: args.accessToken,
          refreshToken: args.refreshToken,
          expiresAt: args.expiresAt,
          scope: args.scope,
          updatedAt: now,
        });
        return existing._id;
      }
      return await ctx.db.insert("adsCredentials", {
        projectId: args.projectId,
        platform: args.platform,
        accessToken: args.accessToken,
        refreshToken: args.refreshToken,
        expiresAt: args.expiresAt,
        scope: args.scope,
        connectedBy: args.connectedBy,
        createdAt: now,
        updatedAt: now,
      });
    },
});

/** Disconnect a platform: delete stored tokens. */
export const disconnect = moduleMutation("promote", {
  capability: "promote.manage",
  args: { projectId: v.id("projects"), platform: v.string() },
  handler: async (ctx, { projectId, platform }, access) => {
    await access.requireProject(projectId);
    const cred = await ctx.db
      .query("adsCredentials")
      .withIndex("by_project_platform", (q) =>
        q.eq("projectId", projectId).eq("platform", platform),
      )
      .first();
    if (cred) {
      await ctx.db.delete(cred._id);
      // Also drop synced data for this platform so stale campaigns don't linger.
      const accounts = await ctx.db
        .query("adsAccounts")
        .withIndex("by_project_platform", (q) =>
          q.eq("projectId", projectId).eq("platform", platform),
        )
        .collect();
      for (const a of accounts) {
        const campaigns = await ctx.db
          .query("adsCampaigns")
          .withIndex("by_project_platform", (q) =>
            q.eq("projectId", projectId).eq("platform", platform),
          )
          .collect();
        for (const c of campaigns) await ctx.db.delete(c._id);
        await ctx.db.delete(a._id);
      }
    }
  },
});
