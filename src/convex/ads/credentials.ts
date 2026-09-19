
import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { platformEnv, type Platform } from "./platforms";

/**
 * Ads credential storage + refresh.
 *
 * Tokens live in Convex (encrypted at rest by Convex) and NEVER leave the
 * server: the client queries only status/labels, never token values.
 */

/** Refresh the access token when it is (nearly) expired. Meta access tokens
 *  are long-lived and refreshed by re-exchange; Google refreshes via its
 *  token endpoint; TikTok's long-lived token follows the same endpoint. */
export async function ensureFreshToken(
  db: { get(id: Id<"adsCredentials">): Promise<Record<string, unknown> | null>; patch(id: Id<"adsCredentials">, patch: Record<string, unknown>): Promise<void> },
  credId: Id<"adsCredentials">,
): Promise<string> {
  const cred = await db.get(credId);
  if (!cred) throw new Error("Ads credential not found");
  const accessToken = cred.accessToken as string;
  const expiresAt = cred.expiresAt as number | undefined;
  const refreshToken = cred.refreshToken as string | undefined;
  const platform = cred.platform as Platform;

  // Still valid for >5 min — use as-is.
  if (!expiresAt || expiresAt > Date.now() + 5 * 60 * 1000) return accessToken;

  if (!refreshToken) {
    // Meta long-lived tokens (60 days) carry no refresh token — surface an
    // explicit reconnect rather than a silent failure.
    throw new Error(
      "Access token expired and no refresh token available — reconnect this platform.",
    );
  }

  const env = platformEnv(platform);
  if (!env) throw new Error("Platform credentials not configured in this deployment");

  const res = await fetch(env.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: env.clientId,
      client_secret: env.clientSecret,
    }),
  });
  if (!res.ok) {
    throw new Error(
      `Token refresh failed (${res.status}): ${(await res.text()).slice(0, 200)}`,
    );
  }
  const data = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!data.access_token) throw new Error("Token refresh returned no access token");

  const patch: Record<string, unknown> = {
    accessToken: data.access_token,
    updatedAt: Date.now(),
  };
  if (data.expires_in) {
    patch.expiresAt = Date.now() + data.expires_in * 1000;
  }
  await db.patch(credId, patch);
  return data.access_token;
}

/** Action-safe wrapper: refresh the token if needed and return it.
 *  Actions have no ctx.db, so they call this mutation instead. */
export const refreshIfNeeded = internalMutation({
  args: { credId: v.id("adsCredentials") },
  handler: async (ctx, { credId }) => {
    return await ensureFreshToken(ctx.db, credId);
  },
});

/** Internal query used by actions to fetch a credential id by (project, platform). */
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
