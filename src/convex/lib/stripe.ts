/**
 * Stripe client (MOSAI pack T2.4).
 *
 * A deliberately small REST client instead of a provider SDK: the tickets that
 * need it are an action and an HTTP handler, and a hand-rolled client keeps the
 * test-mode guard, the signature check and the receipt rule visible in one
 * file. No other module or feature code may call Stripe directly
 * (`AGENTS.md` §5 rule 11 is the ModelGateway rule; this is its billing
 * equivalent — one seam).
 *
 * Truth rules encoded here:
 *   - **Test mode only unless the owner says otherwise.** A live key is refused
 *     unless `STRIPE_LIVE_MODE === "true"`.
 *   - **Every external write carries an idempotency key.** `stripeRequest`
 *     requires one for POSTs, and the caller derives it from a stable value
 *     (organization id + plan + period), so a retry cannot double-charge.
 *   - **Signature verification is mandatory** and constant-time. A webhook that
 *     does not verify is discarded before any handler runs.
 *
 * Keep this module dependency-free.
 */

const STRIPE_API = "https://api.stripe.com/v1";

export type StripeMode = "test" | "live" | "unconfigured";

export function stripeSecretKey(): string | null {
  const key = process.env.STRIPE_SECRET_KEY;
  return key && key.trim().length ? key.trim() : null;
}

export function stripeWebhookSecret(): string | null {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  return secret && secret.trim().length ? secret.trim() : null;
}

export function stripeMode(): StripeMode {
  const key = stripeSecretKey();
  if (!key) return "unconfigured";
  return key.startsWith("sk_live_") || key.startsWith("rk_live_")
    ? "live"
    : "test";
}

/** Throws when the deployment is pointed at live mode without an explicit
 *  owner opt-in. Called before every outbound request. */
export function assertStripeModeAllowed(): void {
  const mode = stripeMode();
  if (mode === "unconfigured") {
    throw new Error(
      "Stripe is not configured in this deployment — add STRIPE_SECRET_KEY in the Keys / API keys settings.",
    );
  }
  if (mode === "live" && process.env.STRIPE_LIVE_MODE !== "true") {
    throw new Error(
      "Refusing to use a Stripe live key: this deployment runs test mode only unless STRIPE_LIVE_MODE=true is set by the owner.",
    );
  }
}

type StripeParams = Record<string, unknown>;

/** Form-encode Stripe's bracket notation (`a[b][0][c]=v`). */
function encodeForm(
  params: StripeParams,
  prefix = "",
  out: Array<[string, string]> = [],
): Array<[string, string]> {
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    const name = prefix ? `${prefix}[${key}]` : key;
    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        if (item && typeof item === "object") {
          encodeForm(item as StripeParams, `${name}[${index}]`, out);
        } else {
          out.push([`${name}[${index}]`, String(item)]);
        }
      });
    } else if (typeof value === "object") {
      encodeForm(value as StripeParams, name, out);
    } else {
      out.push([name, String(value)]);
    }
  }
  return out;
}

export interface StripeRequestOptions {
  method?: "GET" | "POST" | "DELETE";
  params?: StripeParams;
  /** Required for POST/DELETE — the idempotency key for this external write. */
  idempotencyKey?: string;
}

/** Call the Stripe REST API. Throws on a non-2xx response with a bounded,
 *  secret-free message. */
export async function stripeRequest<T = unknown>(
  path: string,
  options: StripeRequestOptions = {},
): Promise<T> {
  assertStripeModeAllowed();
  const key = stripeSecretKey();
  if (!key) throw new Error("Stripe is not configured");
  const method = options.method ?? "GET";
  const entries = encodeForm(options.params ?? {});
  const query = new URLSearchParams(entries).toString();
  const url =
    method === "GET" && query
      ? `${STRIPE_API}${path}?${query}`
      : `${STRIPE_API}${path}`;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${key}`,
  };
  let body: string | undefined;
  if (method !== "GET") {
    // A provider write without an idempotency key is refused rather than sent.
    if (!options.idempotencyKey || !options.idempotencyKey.trim()) {
      throw new Error(
        `Stripe ${method} ${path} needs an idempotency key (AGENTS.md §5 rule 6).`,
      );
    }
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    headers["Idempotency-Key"] = options.idempotencyKey;
    body = query;
  }

  const response = await fetch(url, { method, headers, body });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `Stripe ${method} ${path} failed (${response.status}): ${text.slice(0, 300)}`,
    );
  }
  return JSON.parse(text) as T;
}

// ── Webhook signature verification ─────────────────────────────────────────

export interface SignatureCheck {
  valid: boolean;
  reason: string;
}

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** Constant-time string comparison (length differences are not secret here,
 *  but a naive `===` on hex is not constant-time). */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Verify a `Stripe-Signature` header against the raw request body.
 *
 * Format: `t=<unix>,v1=<hex>[,v1=<hex>…]`. The signed payload is
 * `<t>.<rawBody>`, HMAC-SHA256 with the endpoint secret. A stale timestamp
 * (default 300s) is rejected to bound replay.
 */
export async function verifyStripeSignature(input: {
  payload: string;
  header: string | null;
  secret: string | null;
  toleranceSeconds?: number;
  now?: number;
}): Promise<SignatureCheck> {
  if (!input.secret) {
    return { valid: false, reason: "webhook secret is not configured" };
  }
  if (!input.header) {
    return { valid: false, reason: "missing Stripe-Signature header" };
  }

  const parts = input.header.split(",").map((part) => part.trim());
  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const part of parts) {
    const [scheme, value] = part.split("=");
    if (scheme === "t") timestamp = Number(value);
    if (scheme === "v1" && value) signatures.push(value);
  }
  if (timestamp === null || Number.isNaN(timestamp)) {
    return { valid: false, reason: "signature header has no timestamp" };
  }
  if (!signatures.length) {
    return { valid: false, reason: "signature header has no v1 signature" };
  }

  const tolerance = input.toleranceSeconds ?? 300;
  const now = input.now ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > tolerance) {
    return { valid: false, reason: "signature timestamp outside tolerance" };
  }

  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(input.secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    encoder.encode(`${timestamp}.${input.payload}`),
  );
  const expected = toHex(digest);

  const matched = signatures.some((signature) =>
    timingSafeEqual(signature, expected),
  );
  return matched
    ? { valid: true, reason: "verified" }
    : { valid: false, reason: "signature does not match" };
}
