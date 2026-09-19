/** The five social publishing platforms MOSAI Promote manages. */
export type SocialPlatform =
  | "facebook"
  | "instagram"
  | "linkedin"
  | "x"
  | "tiktok";

export const SOCIAL_PLATFORMS: SocialPlatform[] = [
  "facebook",
  "instagram",
  "linkedin",
  "x",
  "tiktok",
];

export function isSocialPlatform(p: string): p is SocialPlatform {
  return (SOCIAL_PLATFORMS as string[]).includes(p);
}

/** Human labels + what the connection does (UI). */
export const SOCIAL_PLATFORM_META: Record<
  SocialPlatform,
  { label: string; detail: string }
> = {
  facebook: {
    label: "Facebook Page",
    detail: "Publish to your Facebook Page via the Graph API",
  },
  instagram: {
    label: "Instagram",
    detail: "Publish posts via the Instagram Graph API",
  },
  linkedin: {
    label: "LinkedIn",
    detail: "Post as a member via the LinkedIn API (w_member_social)",
  },
  x: {
    label: "X (Twitter)",
    detail: "Post tweets via the X API v2",
  },
  tiktok: {
    label: "TikTok",
    detail: "Publish videos via the TikTok Content Posting API",
  },
};

/** Env-var-driven OAuth config per platform. Returns null when the deployment
 *  lacks the env vars — the UI then shows "needs configuration". */
export type SocialPlatformEnv = {
  clientId: string;
  clientSecret: string;
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string[];
  /** How the token endpoint wants its credentials on exchange. */
  tokenExchange: "form" | "basic";
};

export function socialPlatformEnv(
  platform: SocialPlatform,
): SocialPlatformEnv | null {
  switch (platform) {
    case "facebook":
    case "instagram":
      if (!process.env.META_APP_ID || !process.env.META_APP_SECRET) return null;
      return {
        clientId: process.env.META_APP_ID,
        clientSecret: process.env.META_APP_SECRET,
        authorizeUrl: "https://www.facebook.com/v21.0/dialog/oauth",
        tokenUrl: "https://graph.facebook.com/v21.0/oauth/access_token",
        scopes:
          platform === "facebook"
            ? ["pages_show_list", "pages_manage_posts", "pages_read_engagement"]
            : [
                "instagram_basic",
                "instagram_content_publish",
                "pages_show_list",
                "pages_manage_posts",
              ],
        tokenExchange: "form",
      };
    case "linkedin":
      if (!process.env.LINKEDIN_CLIENT_ID || !process.env.LINKEDIN_CLIENT_SECRET)
        return null;
      return {
        clientId: process.env.LINKEDIN_CLIENT_ID,
        clientSecret: process.env.LINKEDIN_CLIENT_SECRET,
        authorizeUrl: "https://www.linkedin.com/oauth/v2/authorization",
        tokenUrl: "https://www.linkedin.com/oauth/v2/accessToken",
        scopes: ["openid", "profile", "w_member_social"],
        tokenExchange: "basic",
      };
    case "x":
      if (!process.env.X_CLIENT_ID || !process.env.X_CLIENT_SECRET) return null;
      return {
        clientId: process.env.X_CLIENT_ID,
        clientSecret: process.env.X_CLIENT_SECRET,
        authorizeUrl: "https://twitter.com/i/oauth2/authorize",
        tokenUrl: "https://api.twitter.com/2/oauth2/token",
        scopes: ["tweet.read", "tweet.write", "users.read", "offline.access"],
        tokenExchange: "basic",
      };
    case "tiktok":
      if (!process.env.TIKTOK_CLIENT_ID || !process.env.TIKTOK_CLIENT_SECRET)
        return null;
      return {
        clientId: process.env.TIKTOK_CLIENT_ID,
        clientSecret: process.env.TIKTOK_CLIENT_SECRET,
        authorizeUrl: "https://www.tiktok.com/v2/auth/authorize/",
        tokenUrl: "https://open.tiktokapis.com/v2/oauth/token/",
        scopes: ["user.info.basic", "video.publish", "video.upload"],
        tokenExchange: "form",
      };
  }
}
