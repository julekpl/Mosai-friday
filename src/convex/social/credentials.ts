import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { socialPlatformEnv, type SocialPlatform } from "./platforms";

/**
 * Social credential storage + refresh. Mirrors ads/credentials.ts.
 * Tokens live in Convex and NEVER leave the server: the client queries only
 * status/labels, never token values.
 */

/** Refresh the access token when (nearly) expired. X and TikTok return
 *  refresh tokens with 24h access tokens; Meta pages tokens are long-lived;
 *  LinkedIn tokens are 60 days with no refresh. */
export async function ensureFreshSocialToken(
  db: {
    get(id: Id<"socialCredentials">): Promise<Record<string, unknown> | null>;
    patch(id: Id<"socialCredentials">, patch: Record<string, unknown>): Promise<void>;
  },
  credId: Id<"socialCredentials">,
): Promise<string> {
  const cred = await db.get(credId);
  if (!cred) throw new Error("Social credential not found");
  const accessToken = cred.accessToken as string;
  const expiresAt = cred.expiresAt as number | undefined;
  const refreshToken = cred.refreshToken as string | undefined;
  const platform = cred.platform as SocialPlatform;

  // Still valid for >5 min — use as-is.
  if (!expiresAt || expiresAt > Date.now() + 5 * 60 * 1000) return accessToken;

  if (!refreshToken) {
    throw new Error(
      "Access token expired and no refresh token available — reconnect this platform.",
    );
  }

  const env = socialPlatformEnv(platform);
  if (!env) throw new Error("Platform credentials not configured in this deployment");

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
  };
  if (env.tokenExchange === "basic") {
    headers.Authorization = `Basic ${btoa(`${env.clientId}:${env.clientSecret}`)}`;
  } else {
    body.set("client_id", env.clientId);
    body.set("client_secret", env.clientSecret);
  }

  const res = await fetch(env.tokenUrl, { method: "POST", headers, body });
  if (!res.ok) {
    throw new Error(
      `Token refresh failed (${res.status}): ${(await res.text()).slice(0, 200)}`,
    );
  }
  const data = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!data.access_token) throw new Error("Token refresh returned no access token");

  const patch: Record<string, unknown> = {
    accessToken: data.access_token,
    updatedAt: Date.now(),
  };
  if (data.expires_in) patch.expiresAt = Date.now() + data.expires_in * 1000;
  if (data.refresh_token) patch.refreshToken = data.refresh_token;
  await db.patch(credId, patch);
  return data.access_token;
}

/** Action-safe wrapper: refresh if needed and return the token. Actions have
 *  no ctx.db, so they call this internalMutation instead. */
export const refreshIfNeeded = internalMutation({
  args: { credId: v.id("socialCredentials") },
  handler: async (ctx, { credId }) => {
    return await ensureFreshSocialToken(ctx.db, credId);
  },
});

/** Internal query used by actions to fetch a credential id by (project, platform). */
export const getCredId = internalQuery({
  args: { projectId: v.id("projects"), platform: v.string() },
  handler: async (ctx, { projectId, platform }) => {
    return await ctx.db
      .query("socialCredentials")
      .withIndex("by_project_platform", (q) =>
        q.eq("projectId", projectId).eq("platform", platform),
      )
      .first();
  },
});
