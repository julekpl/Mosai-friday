import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { api, internal } from "@/convex/_generated/api";
import { newBackend, seedUser, type TestBackend, type Tenant } from "./helpers";

/**
 * BP-04 — social execution regressions (blueprint §5 BP-04 acceptance).
 *
 *  1. a stored credential reaches the adapter with its credential **id**
 *     (`publishOne` used to cast the credential *document* returned by
 *     `credentials.getCredId` to an `Id`, which aborts the publish at argument
 *     validation — the handoff must pass `credential._id` to the refresh
 *     action);
 *  2. a revoked/expired credential fails **that post** with a reconnect state
 *     and the next due post still publishes (one failure never aborts the
 *     batch), with no fake "published" claim anywhere;
 *  3. provider failure text is redacted — a raw provider body never lands in
 *     `errorDetail`, which the Promote UI renders.
 *
 * Network policy: `fetch` is fully stubbed. Any URL a test does not route is
 * rejected with an explicit "live network blocked" error, so no real provider
 * account can ever be contacted from this suite. Tokens in this file are
 * obviously synthetic strings, never real credentials.
 */

const TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";
const PUBLISH_URL = "https://api.linkedin.com/v2/ugcPosts";

type FetchCall = { url: string; init?: RequestInit | undefined };

/** Install a fetch stub; unrouted URLs throw instead of hitting the network. */
function stubFetch(handler: (call: FetchCall) => Response | null): FetchCall[] {
  const calls: FetchCall[] = [];
  vi.stubGlobal(
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      const call: FetchCall = { url, init };
      calls.push(call);
      const reply = handler(call);
      if (!reply) throw new Error(`live network blocked in tests: ${url}`);
      return reply;
    },
  );
  return calls;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function header(init: RequestInit | undefined, name: string): string {
  const headers = init?.headers as Record<string, string> | undefined;
  return headers?.[name] ?? "";
}

function bodyText(init: RequestInit | undefined): string {
  const b = init?.body;
  if (typeof b === "string") return b;
  // The refresh action posts `application/x-www-form-urlencoded` with a
  // URLSearchParams body — serialize it exactly as the wire format would be.
  if (b instanceof URLSearchParams) return b.toString();
  return "";
}

// Test-only OAuth app values so `socialPlatformEnv("linkedin")` resolves.
// Synthetic placeholders — never real credentials.
const ENV_KEYS = ["LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET"] as const;
const savedEnv: Record<string, string | undefined> = {};

beforeAll(() => {
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    process.env[key] = `test-${key.toLowerCase()}`;
  }
});

afterAll(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key]!;
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function tenantOn(
  t: TestBackend,
  email: string,
  plan = "starter",
): Promise<{ tenant: Tenant; projectId: string }> {
  const tenant = await seedUser(t, { plan, email });
  const projectId = await tenant.as.mutation(api.projects.create, {
    name: `${email} project`,
  });
  return { tenant, projectId };
}

async function seedSocialCred(
  t: TestBackend,
  projectId: string,
  connectedBy: string,
  overrides: Partial<{
    platform: string;
    accessToken: string;
    refreshToken: string | undefined;
    expiresAt: number | undefined;
    providerAccountId: string;
  }> = {},
): Promise<string> {
  const now = Date.now();
  return await t.run((ctx) =>
    ctx.db.insert("socialCredentials", {
      projectId: projectId as never,
      platform: overrides.platform ?? "linkedin",
      accessToken: overrides.accessToken ?? "test-access-token-old",
      refreshToken:
        overrides.refreshToken === undefined
          ? "test-refresh-token-old"
          : overrides.refreshToken,
      expiresAt:
        overrides.expiresAt === undefined ? now + 3_600_000 : overrides.expiresAt,
      providerAccountId: overrides.providerAccountId ?? "urn:li:person:4242",
      connectedBy: connectedBy as never,
      createdAt: now,
      updatedAt: now,
    }),
  );
}

async function seedDuePost(
  t: TestBackend,
  projectId: string,
  body: string,
): Promise<string> {
  const now = Date.now();
  return await t.run((ctx) =>
    ctx.db.insert("posts", {
      projectId: projectId as never,
      channel: "linkedin",
      body,
      status: "scheduled" as const,
      scheduledFor: now - 1_000,
      origin: "user" as const,
      createdAt: now,
    }),
  );
}

describe("BP-04 — social credential handoff", () => {
  it("a stored credential reaches the adapter with its credential id", async () => {
    const t = newBackend();
    const { tenant, projectId } = await tenantOn(t, "cred@example.com");
    // Expired access token: the publish must refresh through the action,
    // which only works when the REAL credential id (credential._id) is passed.
    const credId = await seedSocialCred(t, projectId, tenant.userId, {
      accessToken: "test-access-token-expired",
      refreshToken: "test-refresh-token-old",
      expiresAt: Date.now() - 60_000,
      providerAccountId: "urn:li:person:4242",
    });
    const postId = await seedDuePost(t, projectId, "BP-04 handoff proof");

    const calls = stubFetch((call) => {
      if (call.url === TOKEN_URL) {
        return json(200, {
          access_token: "test-access-token-refreshed",
          refresh_token: "test-refresh-token-rotated",
          expires_in: 3_600,
        });
      }
      if (call.url === PUBLISH_URL) return json(200, { id: "urn:li:share:99" });
      return null; // blocks the live network
    });

    const result = await t.action(internal.social.executor.runDue, {});
    expect(result.processed).toBe(1);

    const post = await t.run((ctx) => ctx.db.get(postId as never));
    expect(post?.status).toBe("published");
    expect(post?.providerRef).toBe("urn:li:share:99");
    expect(post?.publishedAt).toBeGreaterThan(0);
    expect(post?.errorDetail).toBeUndefined();

    // The refresh went through the provider endpoint with THIS credential's
    // stored refresh token (i.e. the correct credential id reached the action).
    const tokenCalls = calls.filter((c) => c.url === TOKEN_URL);
    expect(tokenCalls).toHaveLength(1);
    expect(bodyText(tokenCalls[0].init)).toContain("grant_type=refresh_token");
    expect(bodyText(tokenCalls[0].init)).toContain(
      encodeURIComponent("test-refresh-token-old"),
    );

    // The adapter received the refreshed token and the credential's own
    // provider-side account id — the documented handoff contract.
    const publishCalls = calls.filter((c) => c.url === PUBLISH_URL);
    expect(publishCalls).toHaveLength(1);
    expect(header(publishCalls[0].init, "Authorization")).toBe(
      "Bearer test-access-token-refreshed",
    );
    const payload = JSON.parse(bodyText(publishCalls[0].init)) as {
      author: string;
    };
    expect(payload.author).toBe("urn:li:person:4242");
    void credId;
  });

  it("a revoked credential fails only that post with a reconnect state; the next due post still publishes", async () => {
    const t = newBackend();
    const bad = await tenantOn(t, "revoked@example.com");
    const good = await tenantOn(t, "healthy@example.com");

    // Expired + refresh token the provider will reject as revoked.
    await seedSocialCred(t, bad.projectId, bad.tenant.userId, {
      accessToken: "test-access-token-expired",
      refreshToken: "test-refresh-token-revoked",
      expiresAt: Date.now() - 60_000,
    });
    // Fresh credential on the second project — must still publish.
    await seedSocialCred(t, good.projectId, good.tenant.userId, {
      accessToken: "test-access-token-fresh",
      expiresAt: Date.now() + 3_600_000,
    });

    const badPost = await seedDuePost(t, bad.projectId, "will hit revoked auth");
    const goodPost = await seedDuePost(t, good.projectId, "must still publish");

    const calls = stubFetch((call) => {
      if (call.url === TOKEN_URL) {
        return json(400, {
          error: "invalid_grant",
          // A provider that echoes details must never reach errorDetail.
          error_description: "REVOKED-BODY-MARKER test-refresh-token-revoked",
        });
      }
      if (call.url === PUBLISH_URL) return json(200, { id: "urn:li:share:ok" });
      return null;
    });

    // One failed post must not throw out of the batch.
    const result = await t.action(internal.social.executor.runDue, {});
    expect(result.processed).toBe(2);

    const badRow = await t.run((ctx) => ctx.db.get(badPost as never));
    expect(badRow?.status).toBe("failed");
    expect(badRow?.errorDetail).toMatch(/reconnect/i);
    // Redaction: neither the provider body nor the refresh token leaks.
    expect(badRow?.errorDetail ?? "").not.toContain("REVOKED-BODY-MARKER");
    expect(badRow?.errorDetail ?? "").not.toContain("test-refresh-token-revoked");
    // No fake receipt.
    expect(badRow?.providerRef).toBeUndefined();
    expect(badRow?.publishedAt).toBeUndefined();

    const goodRow = await t.run((ctx) => ctx.db.get(goodPost as never));
    expect(goodRow?.status).toBe("published");
    expect(goodRow?.providerRef).toBe("urn:li:share:ok");

    // The revoked credential itself is in the reconnect state (server-written).
    const badCred = await t.run((ctx) =>
      ctx.db
        .query("socialCredentials")
        .withIndex("by_project_platform", (q) =>
          q.eq("projectId", bad.projectId as never).eq("platform", "linkedin"),
        )
        .first(),
    );
    expect(badCred?.refreshStatus).toBe("needs_reconnect");

    // Only one token endpoint call (the healthy post is fresh — no refresh),
    // and exactly one publish (the healthy post).
    expect(calls.filter((c) => c.url === TOKEN_URL)).toHaveLength(1);
    expect(calls.filter((c) => c.url === PUBLISH_URL)).toHaveLength(1);
  });

  it("a provider failure is redacted on the post — never a raw provider body", async () => {
    const t = newBackend();
    const { tenant, projectId } = await tenantOn(t, "redaction@example.com");
    await seedSocialCred(t, projectId, tenant.userId, {
      accessToken: "test-access-token-fresh",
      expiresAt: Date.now() + 3_600_000,
    });
    const postId = await seedDuePost(t, projectId, "provider will 500");

    stubFetch((call) => {
      if (call.url === PUBLISH_URL) {
        // Raw body containing what looks like credential material.
        return new Response("upstream failure access_token=LEAKY-BODY-MARKER", {
          status: 500,
          headers: { "Content-Type": "text/plain" },
        });
      }
      return null;
    });

    const result = await t.action(internal.social.executor.runDue, {});
    expect(result.processed).toBe(1);

    const post = await t.run((ctx) => ctx.db.get(postId as never));
    expect(post?.status).toBe("failed");
    expect(post?.providerRef).toBeUndefined();
    // The failure carries the HTTP status (safe) but not the provider body.
    expect(post?.errorDetail ?? "").toMatch(/HTTP 500/);
    expect(post?.errorDetail ?? "").not.toContain("LEAKY-BODY-MARKER");
  });
});
