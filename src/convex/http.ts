import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { auth } from "./auth";
import { oauthCallback } from "./ads/oauth";
import { socialOauthCallback } from "./social/oauth";
import { stripeWebhookSecret, verifyStripeSignature } from "./lib/stripe";

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

// ── Stripe webhook (T2.4) ───────────────────────────────────────────────────
// Signature-verified before anything is read. The handler only authenticates
// the caller to Stripe and hands the event to the idempotent internal apply —
// it never trusts a redirect, a browser session or a client-supplied body.
const stripeWebhook = httpAction(async (ctx, request) => {
  const secret = stripeWebhookSecret();
  if (!secret) {
    return new Response("Stripe webhook secret is not configured", {
      status: 503,
    });
  }

  const payload = await request.text();
  const check = await verifyStripeSignature({
    payload,
    header: request.headers.get("Stripe-Signature"),
    secret,
  });
  if (!check.valid) {
    return new Response(`Invalid Stripe signature: ${check.reason}`, {
      status: 400,
    });
  }

  let event: {
    id?: string;
    type?: string;
    created?: number;
    livemode?: boolean;
    data?: { object?: Record<string, unknown> };
  };
  try {
    event = JSON.parse(payload) as typeof event;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
  if (
    !event.id ||
    !event.type ||
    typeof event.created !== "number" ||
    !event.data?.object
  ) {
    return new Response("Malformed Stripe event", { status: 400 });
  }

  try {
    await ctx.runMutation(internal.billingWebhooks.applyEvent, {
      eventId: event.id,
      type: event.type,
      created: event.created,
      livemode: event.livemode === true,
      objectId:
        typeof (event.data.object as { id?: unknown }).id === "string"
          ? ((event.data.object as { id: string }).id)
          : undefined,
      data: event.data.object,
    });
  } catch {
    // A failed apply returns 500 so Stripe retries; the event id makes the
    // retry idempotent once the underlying problem is fixed.
    return new Response("Webhook apply failed", { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});

http.route({
  path: "/api/stripe/webhook",
  method: "POST",
  handler: stripeWebhook,
});

export default http;
