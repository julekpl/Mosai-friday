
import type { Id } from "../_generated/dataModel";

/** The four ad platforms MOSAI Ads manages. */
export type Platform = "google" | "meta" | "tiktok" | "chatgpt";

export const PLATFORMS: Platform[] = ["google", "meta", "tiktok", "chatgpt"];

export function isPlatform(p: string): p is Platform {
  return (PLATFORMS as string[]).includes(p);
}

/** Human labels + descriptions (UI). */
export const PLATFORM_META: Record<
  Platform,
  { label: string; detail: string }
> = {
  google: { label: "Google Ads", detail: "Search, PMax, Demand Gen, YouTube" },
  meta: { label: "Meta Ads", detail: "Facebook + Instagram" },
  tiktok: { label: "TikTok Ads", detail: "In-feed, Spark, carousel" },
  chatgpt: { label: "ChatGPT Ads", detail: "Sponsored cards in ChatGPT" },
};

/**
 * Env-var-driven platform configuration. All four platforms are OAuth 2.0;
 * credentials come from the deployment environment (never the client).
 */
export type PlatformEnv = {
  clientId: string;
  clientSecret: string;
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string[];
};

/** Resolve one row of appSettings (key = "ads"). */
export function settingsKey(): string {
  return "ads";
}

export function copilotDefaultModel(): string {
  return "openai/gpt-4o-mini";
}

/** Curated shortlist surfaced in the admin panel dropdown. */
export const COPILOT_MODEL_OPTIONS = [
  "openai/gpt-4o-mini",
  "openai/gpt-4.1-mini",
  "openai/gpt-4.1",
  "anthropic/claude-3.5-haiku",
  "anthropic/claude-3.7-sonnet",
  "google/gemini-2.0-flash-001",
  "meta-llama/llama-3.3-70b-instruct",
];

/** ChatGPT Ads is new: management API access is gated by OpenAI. We surface a
 *  clear, honest status instead of pretending it works. */
export function chatgptAdsStatus(): {
  supported: boolean;
  note: string;
} {
  const clientId = process.env.CHATGPT_ADS_CLIENT_ID;
  if (!clientId) {
    return {
      supported: false,
      note: "Requires OpenAI advertiser API access (CHATGPT_ADS_CLIENT_ID not configured in this deployment). Connect is available once OpenAI grants access.",
    };
  }
  return {
    supported: true,
    note: "Connect your OpenAI advertiser account.",
  };
}

/** Per-platform OAuth config. Returns null when the deployment lacks the
 *  env vars — the UI shows "needs configuration" for that platform. */
export function platformEnv(platform: Platform): PlatformEnv | null {
  switch (platform) {
    case "google":
      if (!process.env.GOOGLE_ADS_CLIENT_ID || !process.env.GOOGLE_ADS_CLIENT_SECRET)
        return null;
      return {
        clientId: process.env.GOOGLE_ADS_CLIENT_ID,
        clientSecret: process.env.GOOGLE_ADS_CLIENT_SECRET,
        authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
        tokenUrl: "https://oauth2.googleapis.com/token",
        scopes: ["https://www.googleapis.com/auth/adwords"],
      };
    case "meta":
      if (!process.env.META_APP_ID || !process.env.META_APP_SECRET) return null;
      return {
        clientId: process.env.META_APP_ID,
        clientSecret: process.env.META_APP_SECRET,
        authorizeUrl: "https://www.facebook.com/v21.0/dialog/oauth",
        tokenUrl: "long-lived token exchange (see meta adapter)",
        scopes: ["ads_management", "ads_read", "business_management"],
      };
    // Meta uses a special exchange; signal that via a marker the adapter handles.
    case "tiktok":
      if (!process.env.TIKTOK_CLIENT_ID || !process.env.TIKTOK_CLIENT_SECRET)
        return null;
      return {
        clientId: process.env.TIKTOK_CLIENT_ID,
        clientSecret: process.env.TIKTOK_CLIENT_SECRET,
        authorizeUrl: "https://business-api.tiktok.com/portal/auth",
        tokenUrl: "https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/",
        scopes: [],
      };
    case "chatgpt":
      if (!process.env.CHATGPT_ADS_CLIENT_ID || !process.env.CHATGPT_ADS_CLIENT_SECRET)
        return null;
      return {
        clientId: process.env.CHATGPT_ADS_CLIENT_ID,
        clientSecret: process.env.CHATGPT_ADS_CLIENT_SECRET,
        authorizeUrl: "https://auth.openai.com/authorize",
        tokenUrl: "https://auth.openai.com/oauth/token",
        scopes: ["ads:read", "ads:write"],
      };
  }
}

/** Redact a token for safe storage in logs — keep a short prefix only. */
export function redact(token: string): string {
  return token ? `${token.slice(0, 4)}…${token.length}ch` : "";
}

/** Rough per-platform cents conversion. Google reports micros of the account
 *  currency; Meta and TikTok report minor units of their own currency. */
export function toCents(platform: Platform, value: number): number {
  switch (platform) {
    case "google":
      return Math.round(value / 10000); // micros → cents
    case "meta":
      return Math.round(value); // minor units assumed cents
    case "tiktok":
      return Math.round(value); // minor units assumed cents
    case "chatgpt":
      return Math.round(value); // minor units assumed cents
  }
}

/** Token exchange for standard OAuth2 code flow. Meta needs its own exchange
 *  (graph.facebook.com with appsecret_proof etc.) — handled in the adapter. */
export async function exchangeCodeForTokens(
  platform: Platform,
  env: PlatformEnv,
  code: string,
  redirectUri: string,
): Promise<{ accessToken: string; refreshToken?: string; expiresIn?: number; scope?: string }> {
  const res = await fetch(
    platform === "meta"
      ? `https://graph.facebook.com/v21.0/oauth/access_token?client_id=${encodeURIComponent(
          env.clientId,
        )}&client_secret=${encodeURIComponent(
          env.clientSecret,
        )}&redirect_uri=${encodeURIComponent(
          redirectUri,
        )}&code=${encodeURIComponent(code)}`
      : env.tokenUrl,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: env.clientId,
        client_secret: env.clientSecret,
      }),
    },
  );
  if (!res.ok) {
    throw new Error(
      `Token exchange failed (${res.status}): ${(await res.text()).slice(0, 300)}`,
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
