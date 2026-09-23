/**
 * Social publisher adapters. One contract, five implementations.
 *
 * Design notes (mirrors ads/adapters.ts):
 * - Adapters take explicit tokens — no shared mutable state.
 * - Errors are returned as results, never raw provider payloads to clients.
 * - The executor decides honest status; adapters only talk to providers.
 */

import type { SocialPlatform } from "./platforms";

export type PublishResult =
  | { ok: true; providerRef: string }
  | { ok: false; error: string };

export type SocialPublisherAdapter = {
  /** Publish immediately. platformAccountId = page id / author urn / etc. */
  publish(
    accessToken: string,
    platformAccountId: string | undefined,
    body: string,
    mediaUrl: string | undefined,
  ): Promise<PublishResult>;
  /** Validate before scheduling so users fail early, not at publish time. */
  validate(body: string, mediaUrl: string | undefined): string | null;
};

/* ────────────────────────────── Facebook ──────────────────────────────── */

const facebookAdapter: SocialPublisherAdapter = {
  validate(body) {
    if (!body.trim()) return "Post text is empty";
    return null;
  },
  async publish(accessToken, platformAccountId, body, mediaUrl) {
    if (!platformAccountId) {
      return {
        ok: false,
        error: "No Facebook Page connected — reconnect and pick a page.",
      };
    }
    const endpoint = mediaUrl
      ? `https://graph.facebook.com/v21.0/${platformAccountId}/photos`
      : `https://graph.facebook.com/v21.0/${platformAccountId}/feed`;
    const params = new URLSearchParams({ access_token: accessToken });
    if (mediaUrl) {
      params.set("url", mediaUrl);
      params.set("caption", body);
    } else {
      params.set("message", body);
    }
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
    });
    if (!res.ok) {
      return {
        ok: false,
        // BP-04: only the HTTP status is safe to surface — a provider body
        // may echo tokens or account data and is never recorded on a post.
        error: `Facebook publish failed (HTTP ${res.status})`,
      };
    }
    const data = (await res.json()) as { id?: string; post_id?: string };
    return { ok: true, providerRef: data.post_id ?? data.id ?? "unknown" };
  },
};

/* ───────────────────────────── Instagram ──────────────────────────────── */

/** Instagram requires media (public image URL) and a two-step publish. */
const instagramAdapter: SocialPublisherAdapter = {
  validate(_body, mediaUrl) {
    if (!mediaUrl) return "Instagram requires a public image URL (mediaUrl)";
    return null;
  },
  async publish(accessToken, platformAccountId, body, mediaUrl) {
    if (!platformAccountId) {
      return { ok: false, error: "No Instagram business account connected." };
    }
    if (!mediaUrl) return { ok: false, error: "Instagram requires a public image URL" };

    // Step 1: create a media container
    const container = await fetch(
      `https://graph.facebook.com/v21.0/${platformAccountId}/media`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          image_url: mediaUrl,
          caption: body,
          access_token: accessToken,
        }),
      },
    );
    if (!container.ok) {
      return {
        ok: false,
        error: `Instagram container failed (${container.status}): ${(await container.text()).slice(0, 200)}`,
      };
    }
    const cd = (await container.json()) as { id?: string };
    if (!cd.id) return { ok: false, error: "Instagram returned no container id" };

    // Step 2: publish the container
    const publish = await fetch(
      `https://graph.facebook.com/v21.0/${platformAccountId}/media_publish`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          creation_id: cd.id,
          access_token: accessToken,
        }),
      },
    );
    if (!publish.ok) {
      return {
        ok: false,
        error: `Instagram publish failed (HTTP ${publish.status})`,
      };
    }
    const pd = (await publish.json()) as { id?: string };
    return { ok: true, providerRef: pd.id ?? "unknown" };
  },
};

/* ───────────────────────────── LinkedIn ───────────────────────────────── */

const linkedinAdapter: SocialPublisherAdapter = {
  validate(body) {
    if (!body.trim()) return "Post text is empty";
    return null;
  },
  async publish(accessToken, platformAccountId, body, mediaUrl) {
    // LinkedIn requires an author URN: urn:li:person:{id} (member) or
    // urn:li:organization:{id} (page). It is captured at connect time.
    if (!platformAccountId || !platformAccountId.startsWith("urn:")) {
      return {
        ok: false,
        error:
          "No LinkedIn author URN connected — reconnect to capture it before publishing.",
      };
    }
    const res = await fetch("https://api.linkedin.com/v2/ugcPosts", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "X-Restli-Protocol-Version": "2.0.0",
      },
      body: JSON.stringify({
        author: platformAccountId,
        specificContent: {
          "com.linkedin.ugc.ShareContent": {
            shareCommentary: { text: body },
            shareMediaCategory: mediaUrl ? "IMAGE" : "NONE",
            ...(mediaUrl
              ? { media: [{ status: "READY", originalUrl: mediaUrl }] }
              : {}),
          },
        },
        visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" },
      }),
    });
    if (!res.ok) {
      return {
        ok: false,
        error: `LinkedIn publish failed (HTTP ${res.status})`,
      };
    }
    const data = (await res.json()) as { id?: string };
    return { ok: true, providerRef: data.id ?? "unknown" };
  },
};

/* ───────────────────────────── X ──────────────────────────────────────── */

const xAdapter: SocialPublisherAdapter = {
  validate(body) {
    if (!body.trim()) return "Post text is empty";
    if (body.length > 280) return "X posts are limited to 280 characters";
    return null;
  },
  async publish(accessToken, _platformAccountId, body) {
    const res = await fetch("https://api.twitter.com/2/tweets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text: body }),
    });
    if (!res.ok) {
      return {
        ok: false,
        error: `X publish failed (HTTP ${res.status})`,
      };
    }
    const data = (await res.json()) as { data?: { id?: string } };
    return { ok: true, providerRef: data.data?.id ?? "unknown" };
  },
};

/* ───────────────────────────── TikTok ─────────────────────────────────── */

const tiktokAdapter: SocialPublisherAdapter = {
  validate(_body, mediaUrl) {
    if (!mediaUrl) return "TikTok requires a public video URL (mediaUrl)";
    return null;
  },
  async publish(accessToken, _platformAccountId, body, mediaUrl) {
    if (!mediaUrl) return { ok: false, error: "TikTok requires a public video URL (mediaUrl)" };
    const res = await fetch(
      "https://open.tiktokapis.com/v2/post/publish/video/init/",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json; charset=UTF-8",
        },
        body: JSON.stringify({
          post_info: {
            title: body.slice(0, 2200) || undefined,
            privacy_level: "PUBLIC_TO_EVERYONE",
          },
          source_info: {
            source: "PULL_FROM_URL",
            video_url: mediaUrl,
          },
        }),
      },
    );
    if (!res.ok) {
      return {
        ok: false,
        error: `TikTok publish init failed (HTTP ${res.status})`,
      };
    }
    const data = (await res.json()) as {
      data?: { publish_id?: string };
      error?: { message?: string; code?: string };
    };
    if (data.error && data.error.code && data.error.code !== "ok") {
      return { ok: false, error: `TikTok error ${data.error.code}: ${data.error.message ?? "unknown"}` };
    }
    return { ok: true, providerRef: data.data?.publish_id ?? "unknown" };
  },
};

/* ───────────────────────────── Registry ───────────────────────────────── */

export function getSocialAdapter(platform: SocialPlatform): SocialPublisherAdapter {
  switch (platform) {
    case "facebook":
      return facebookAdapter;
    case "instagram":
      return instagramAdapter;
    case "linkedin":
      return linkedinAdapter;
    case "x":
      return xAdapter;
    case "tiktok":
      return tiktokAdapter;
  }
}
