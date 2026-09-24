import { v } from "convex/values";
import { httpAction, internalMutation } from "../_generated/server";
import { hasProjectAccess, moduleMutation, moduleQuery } from "../guards";
import { configuredOAuthBaseUrl } from "../lib/oauthBaseUrl";
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

/** Client-visible status: which platforms are configured + connected. */
export const status = moduleQuery("promote", {
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }, access) => {
    const scope = await access.ownedProject(projectId);
    if (!scope) return [];

    const creds = await ctx.db
      .query("socialCredentials")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
    const appOrigin = configuredOAuthBaseUrl(
      process.env.ADS_OAUTH_REDIRECT_BASE,
    );
    const callbackOrigin = configuredOAuthBaseUrl(process.env.CONVEX_SITE_URL);

    return SOCIAL_PLATFORMS.map((p) => {
      const cred = creds.find((c) => c.platform === p);
      const providerConfigured = socialPlatformEnv(p) !== null;
      const configured =
        providerConfigured && appOrigin !== null && callbackOrigin !== null;
      return {
        platform: p,
        configured,
        setupDetail: !providerConfigured
          ? "Provider client credentials are not configured for this deployment."
          : !appOrigin
            ? "The trusted MOSAI app return origin is not configured."
            : !callbackOrigin
              ? "The Convex OAuth callback origin is unavailable."
              : undefined,
        connected: cred !== undefined,
        accountLabel: cred?.accountLabel,
        providerAccountId: cred?.providerAccountId,
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
    if (!isSocialPlatform(platform)) throw new Error("Unknown platform");

    const env = socialPlatformEnv(platform);
    if (!env) {
      throw new Error(
        `${platform} OAuth is not configured in this deployment (missing client id/secret env vars).`,
      );
    }
    const oauthBaseUrl = configuredOAuthBaseUrl(
      process.env.ADS_OAUTH_REDIRECT_BASE,
    );
    if (!oauthBaseUrl) {
      throw new Error(
        "The MOSAI app return origin is not configured. Set ADS_OAUTH_REDIRECT_BASE to its trusted HTTPS origin (localhost is allowed for development).",
      );
    }
    const callbackBaseUrl = configuredOAuthBaseUrl(process.env.CONVEX_SITE_URL);
    if (!callbackBaseUrl) {
      throw new Error("The Convex OAuth callback origin is unavailable.");
    }

    const state = crypto.randomUUID();
    // Reuse the shared oauthStates table (platform names are disjoint from
    // the ads platforms, and the callback routes are separate).
    await ctx.db.insert("oauthStates", {
      state,
      projectId,
      platform,
      createdBy: userId,
      createdAt: Date.now(),
    });

    const redirectUri = `${callbackBaseUrl}/api/social/callback`;
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

  const appUrl = configuredOAuthBaseUrl(process.env.ADS_OAUTH_REDIRECT_BASE);
  const callbackBaseUrl = configuredOAuthBaseUrl(process.env.CONVEX_SITE_URL);
  if (!appUrl || !callbackBaseUrl) {
    return new Response("OAuth redirect settings are not configured", {
      status: 503,
    });
  }

  if (!state) {
    return redirectBack(appUrl, "error=expired_or_invalid_state");
  }

  // Claim once, in one transaction, before any provider exchange. A separate
  // read and delete let parallel callbacks both pass the replay check.
  const stateRow = await ctx.runMutation(
    internal.social.oauth.claimOauthState,
    { state },
  );
  if (!stateRow) {
    return redirectBack(appUrl, "error=expired_or_invalid_state");
  }
  if (error || !code) {
    return redirectBack(
      appUrl,
      `error=${encodeURIComponent(error ? "authorization_canceled" : "missing_code")}`,
    );
  }

  const platform = stateRow.platform;
  if (!isSocialPlatform(platform)) {
    return redirectBack(appUrl, "error=unknown_platform");
  }
  const env = socialPlatformEnv(platform);
  if (!env) return redirectBack(appUrl, "error=platform_not_configured");

  const redirectUri = `${callbackBaseUrl}/api/social/callback`;
  try {
    const tokens = await exchangeSocialCode(platform, env, code, redirectUri);
    await ctx.runMutation(internal.social.oauth.storeCred, {
      projectId: stateRow.projectId,
      platform,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresIn
        ? Date.now() + tokens.expiresIn * 1000
        : undefined,
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
  env: {
    clientId: string;
    clientSecret: string;
    tokenUrl: string;
    tokenExchange: "form" | "basic";
  },
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
    headers: {
      ...headers,
      "Content-Type": "application/x-www-form-urlencoded",
    },
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
  if (!data.access_token)
    throw new Error("Token exchange returned no access token");

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
    scope: data.scope,
  };
}

/* ── internal helpers for the callback ────────────────────────────────── */

export const claimOauthState = internalMutation({
  args: { state: v.string() },
  handler: async (ctx, { state }) => {
    const row = await ctx.db
      .query("oauthStates")
      .withIndex("by_state", (q) => q.eq("state", state))
      .unique();
    if (!row || !isSocialPlatform(row.platform)) return null;

    await ctx.db.delete(row._id);
    const now = Date.now();
    if (row.createdAt > now || now - row.createdAt > STATE_TTL_MS) return null;

    const project = await ctx.db.get(row.projectId);
    const user = await ctx.db.get(row.createdBy);
    if (
      !project ||
      !user ||
      user.deletionRequestedAt !== undefined ||
      !(await hasProjectAccess(ctx, project, row.createdBy))
    ) {
      return null;
    }
    return row;
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
        // BP-04: a fresh OAuth handshake supersedes any in-flight refresh —
        // bump the version so a concurrent rotating-token response can never
        // overwrite these tokens, drop a held lease, and clear the
        // `needs_reconnect` state this reconnect just resolved.
        tokenVersion: (existing.tokenVersion ?? 0) + 1,
        refreshLeaseId: undefined,
        refreshLeaseUntil: undefined,
        refreshStatus: "ok" as const,
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
export const disconnect = moduleMutation("promote", {
  capability: "promote.manage",
  args: { projectId: v.id("projects"), platform: v.string() },
  handler: async (ctx, { projectId, platform }, access) => {
    await access.requireProject(projectId);
    const cred = await ctx.db
      .query("socialCredentials")
      .withIndex("by_project_platform", (q) =>
        q.eq("projectId", projectId).eq("platform", platform),
      )
      .first();
    if (cred) await ctx.db.delete(cred._id);
  },
});
