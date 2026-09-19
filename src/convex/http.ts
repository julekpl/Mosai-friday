import { httpRouter } from "convex/server";
import { auth } from "./auth";
import { oauthCallback } from "./ads/oauth";
import { socialOauthCallback } from "./social/oauth";

const http = httpRouter();

auth.addHttpRoutes(http);

// OAuth 2.0 callback for the five social publishing platforms.
http.route({
  path: "/api/social/callback",
  method: "GET",
  handler: socialOauthCallback,
});

// OAuth 2.0 callback for the four ad platforms (Google, Meta, TikTok, ChatGPT).
http.route({
  path: "/api/ads/callback",
  method: "GET",
  handler: oauthCallback,
});

export default http;
