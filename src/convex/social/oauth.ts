import { v } from "convex/values";
import {
  httpAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "../_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import {
  SOCIAL_PLATFORMS,
  isSocialPlatform,
  socialPlatformEnv,
  type SocialPlatform,
} from "./platforms";

/**
 * OAuth 2.0 connect/disconnect for the five social publishing platforms.
 *
 * Mirrors the ads flow exactly: client calls socialOauth.start → provider
 * authorize URL → provider redirects to /api/social/callback?state=…&code=…
 * → callback exchanges the code, stores tokens in socialCredentials, and
 * redirects back to the app. Tokens NEVER reach the client.
 */

const STATE_TTL_MS = 10 * 60 * 1000;

async function requireUserSafe(ctx: Parameters<typeof getAuthUserId>[0]) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Not signed in");
  return userId as Id<"users">;
}

/** Client-visible status: which platforms are configured + connected. */
export const status = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const project = await ctx.db.get(projectId);
    if (!project || project.ownerId !== userId) return [];

    const creds = await ctx.db
      .query("socialCredentials")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();

    return SOCIAL_PLATFORMS.map((p) => {
      const cred = creds.find((c) => c.platform === p);
      const env = socialPlatformEnv(p);
      return {
        platform: p,
        // configured = deployment has the platform's client id/secret env vars
        configured: env !== null,
        connected: cred !== undefined,
        accountLabel: cred?.accountLabel,
        providerAccountId: cred?.providerAccountId,
        expiresAt: cred?.expiresAt,
      };
    });
  },
});

/** Begin OAuth: create state, return the provider authorize URL. */
export const start = mutation({
  args: { projectId: v.id("projects"), platform: v.string() },
  handler: async (ctx, { projectId, platform }) => {
    const userId = await requireUserSafe(ctx);
    const project = await ctx.db.get(projectId);
    if (!project || project.ownerId !== userId) throw new Error("Not found");
    if (!isSocialPlatform(platform)) throw new Error("Unknown platform");

    const env = socialPlatformEnv(platform);
    if (!env) {
      throw new Error(
        `${platform} OAuth is not configured in this deployment (missing client id/secret env vars).`,
      );
    }

    const state = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}-${Math.random().toString(36).slice(2, 12)}`;
    // Reuse the shared oauthStates table (platform names are disjoint from
    // the ads platforms, and the callback routes are separate).
    await ctx.db.insert("oauthStates", {
      state,
      projectId,
      platform,
      createdBy: userId,
      createdAt: Date.now(),
    });

    const redirectUri = `${process.env.ADS_OAUTH_REDIRECT_BASE ?? ""}/api/social/callback`;
    const url = new URL(env.authorizeUrl);
    for (const [k, v] of Object.entries({
      client_id: env.clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      state,
      scope: env.scopes.join(" "),
    })) {
      if (v) url.searchParams.set(k, v);
    }
    return { authorizeUrl: url.toString() };
  },
});

/** OAuth callback: exchange code, store tokens, redirect back to the app. */
export const socialOauthCallback = httpAction(async (ctx, request) => {
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  const appUrl = process.env.ADS_OAUTH_REDIRECT_BASE ?? `${url.protocol}//${url.host}`;

  if (error || !state || !code) {
    return redirectBack(appUrl, `error=${encodeURIComponent(error ?? "missing code or state")}`);
  }

  const stateRow = await ctx.runQuery(internal.social.oauth.getOauthState, { state });
  if (!stateRow || Date.now() - stateRow.createdAt > STATE_TTL_MS) {
    return redirectBack(appUrl, "error=expired_or_invalid_state");
  }
  await ctx.runMutation(internal.social.oauth.consumeOauthState, { state });

  const platform = stateRow.platform;
  if (!isSocialPlatform(platform)) {
    return redirectBack(appUrl, "error=unknown_platform");
  }
  const env = socialPlatformEnv(platform);
  if (!env) return redirectBack(appUrl, "error=platform_not_configured");

  const redirectUri = `${process.env.ADS_OAUTH_REDIRECT_BASE ?? `${url.protocol}//${url.host}`}/api/social/callback`;
  try {
    const tokens = await exchangeSocialCode(platform, env, code, redirectUri);
    await ctx.runMutation(internal.social.oauth.storeCred, {
      projectId: stateRow.projectId,
      platform,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresIn ? Date.now() + tokens.expiresIn * 1000 : undefined,
      scope: tokens.scope,
      providerAccountId: tokens.providerAccountId,
      accountLabel: tokens.accountLabel,
      connectedBy: stateRow.createdBy,
    });
    return redirectBack(appUrl, `connected=${platform}`);
  } catch (e) {
    return redirectBack(
      appUrl,
      `error=${encodeURIComponent(e instanceof Error ? e.message : "token exchange failed")}`,
    );
  }
});

function redirectBack(appUrl: string, query: string) {
  const origin = appUrl.replace(/\/$/, "").replace(/\/app$/, "");
  return new Response(null, {
    status: 302,
    headers: { Location: `${origin}/app?${query}` },
  });
}

/* ── Token exchange (form or basic auth per provider) ──────────────────── */

type ExchangeResult = {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  scope?: string;
  providerAccountId?: string;
  accountLabel?: string;
};

export async function exchangeSocialCode(
  platform: SocialPlatform,
  env: { clientId: string; clientSecret: string; tokenUrl: string; tokenExchange: "form" | "basic" },
  code: string,
  redirectUri: string,
): Promise<ExchangeResult> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  });

  const headers: Record<string, string> = { Accept: "application/json" };
  if (env.tokenExchange === "basic") {
    // LinkedIn + X require HTTP Basic auth on the token endpoint.
    headers.Authorization = `Basic ${btoa(`${env.clientId}:${env.clientSecret}`)}`;
  } else {
    body.set("client_id", env.clientId);
    body.set("client_secret", env.clientSecret);
  }

  const res = await fetch(env.tokenUrl, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new Error(
      `${platform} token exchange failed (${res.status}): ${(await res.text()).slice(0, 300)}`,
    );
  }
  const data = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };
  if (!data.access_token) throw new Error("Token exchange returned no access token");

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
    scope: data.scope,
  };
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
    providerAccountId: v.optional(v.string()),
    accountLabel: v.optional(v.string()),
    connectedBy: v.id("users"),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("socialCredentials")
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
        providerAccountId: args.providerAccountId,
        accountLabel: args.accountLabel,
        updatedAt: now,
      });
      return existing._id;
    }
    return await ctx.db.insert("socialCredentials", {
      projectId: args.projectId,
      platform: args.platform,
      accessToken: args.accessToken,
      refreshToken: args.refreshToken,
      expiresAt: args.expiresAt,
      scope: args.scope,
      providerAccountId: args.providerAccountId,
      accountLabel: args.accountLabel,
      connectedBy: args.connectedBy,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/** Disconnect a platform: delete stored tokens. */
export const disconnect = mutation({
  args: { projectId: v.id("projects"), platform: v.string() },
  handler: async (ctx, { projectId, platform }) => {
    const userId = await requireUserSafe(ctx);
    const project = await ctx.db.get(projectId);
    if (!project || project.ownerId !== userId) throw new Error("Not found");
    const cred = await ctx.db
      .query("socialCredentials")
      .withIndex("by_project_platform", (q) =>
        q.eq("projectId", projectId).eq("platform", platform),
      )
      .first();
    if (cred) await ctx.db.delete(cred._id);
  },
});
