import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { api, internal } from "@/convex/_generated/api";
import { newBackend, seedUser, type TestBackend } from "./helpers";

/**
 * BP-04 — credential refresh regressions (blueprint §5 BP-04 acceptance).
 *
 *  - an expired credential refreshes **through an internal action** (no
 *    provider request ever runs inside a mutation), and a rotated refresh
 *    token returned by the provider is saved;
 *  - a revoked credential produces a **reconnect** state with a redacted,
 *    safe error (no provider body, no token material);
 *  - a failed claim is released safely and a stale rotating-token response
 *    can never clobber a newer token (lease + version check);
 *  - the ads sync caller surfaces a refresh rejection as a safe error.
 *
 * Network policy: `fetch` is fully stubbed; unrouted URLs throw. Synthetic
 * token strings only — never real credentials.
 */

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

type FetchCall = { url: string; init?: RequestInit | undefined };

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

function bodyText(init: RequestInit | undefined): string {
  const b = init?.body;
  if (typeof b === "string") return b;
  // The refresh action posts `application/x-www-form-urlencoded` with a
  // URLSearchParams body — serialize it exactly as the wire format would be.
  if (b instanceof URLSearchParams) return b.toString();
  return "";
}

// Test-only OAuth app values so `platformEnv("google")` resolves.
// Synthetic placeholders — never real credentials.
const ENV_KEYS = ["GOOGLE_ADS_CLIENT_ID", "GOOGLE_ADS_CLIENT_SECRET"] as const;
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

async function seedAdsCred(
  t: TestBackend,
  projectId: string,
  connectedBy: string,
  overrides: Partial<{
    platform: string;
    accessToken: string;
    refreshToken: string | undefined;
    expiresAt: number | undefined;
  }> = {},
): Promise<string> {
  const now = Date.now();
  return await t.run((ctx) =>
    ctx.db.insert("adsCredentials", {
      projectId: projectId as never,
      platform: overrides.platform ?? "google",
      accessToken: overrides.accessToken ?? "test-ads-access-old",
      // `refreshToken: undefined` means the provider issued none — an absent
      // field, not the default seeded token.
      refreshToken:
        "refreshToken" in overrides
          ? overrides.refreshToken
          : "test-ads-refresh-old",
      expiresAt:
        overrides.expiresAt === undefined ? now + 3_600_000 : overrides.expiresAt,
      connectedBy: connectedBy as never,
      createdAt: now,
      updatedAt: now,
    }),
  );
}

type AdsCredRow = {
  accessToken: string;
  refreshToken?: string | undefined;
  expiresAt?: number | undefined;
  refreshStatus?: string | undefined;
  tokenVersion?: number | undefined;
  refreshLeaseId?: string | undefined;
  refreshLeaseUntil?: number | undefined;
};

async function readAdsCred(t: TestBackend, credId: string): Promise<AdsCredRow> {
  const row = await t.run((ctx) => ctx.db.get(credId as never));
  if (!row) throw new Error("credential disappeared");
  return row as AdsCredRow;
}

describe("BP-04 — refresh runs in an action", () => {
  it("an expired credential refreshes through an action and stores the rotated refresh token", async () => {
    const t = newBackend();
    const owner = await seedUser(t, { plan: "starter", email: "refresh@example.com" });
    const projectId = await owner.as.mutation(api.projects.create, { name: "R" });
    const credId = await seedAdsCred(t, projectId, owner.userId, {
      accessToken: "test-ads-access-expired",
      refreshToken: "test-ads-refresh-old",
      expiresAt: Date.now() - 60_000,
    });

    const calls = stubFetch((call) => {
      if (call.url === GOOGLE_TOKEN_URL) {
        return json(200, {
          access_token: "test-ads-access-new",
          refresh_token: "test-ads-refresh-rotated",
          expires_in: 3_600,
        });
      }
      return null;
    });

    const out = (await t.action(internal.ads.credentialActions.refreshIfNeeded, {
      credId: credId as never,
    })) as { ok: boolean; accessToken?: string };

    expect(out.ok).toBe(true);
    expect(out.accessToken).toBe("test-ads-access-new");

    // Exactly one provider request, POSTing the stored refresh token.
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(GOOGLE_TOKEN_URL);
    expect(bodyText(calls[0].init)).toContain("grant_type=refresh_token");
    expect(bodyText(calls[0].init)).toContain(
      encodeURIComponent("test-ads-refresh-old"),
    );

    const cred = await readAdsCred(t, credId);
    expect(cred.accessToken).toBe("test-ads-access-new");
    // The provider rotated the refresh token — it must be saved, or the next
    // refresh would use an already-consumed token.
    expect(cred.refreshToken).toBe("test-ads-refresh-rotated");
    expect(cred.expiresAt ?? 0).toBeGreaterThan(Date.now());
    expect(cred.tokenVersion).toBe(1);
    expect(cred.refreshLeaseId).toBeUndefined();
    expect(cred.refreshLeaseUntil).toBeUndefined();
    expect(cred.refreshStatus).toBe("ok");
  });

  it("a revoked credential becomes a reconnect state with a redacted, safe error", async () => {
    const t = newBackend();
    const owner = await seedUser(t, { plan: "starter", email: "revoked@example.com" });
    const projectId = await owner.as.mutation(api.projects.create, { name: "R" });
    const credId = await seedAdsCred(t, projectId, owner.userId, {
      accessToken: "test-ads-access-expired",
      refreshToken: "test-ads-refresh-revoked",
      expiresAt: Date.now() - 60_000,
    });

    stubFetch((call) => {
      if (call.url === GOOGLE_TOKEN_URL) {
        return json(400, {
          error: "invalid_grant",
          error_description: "REVOKED-BODY-MARKER test-ads-refresh-revoked",
        });
      }
      return null;
    });

    const out = (await t.action(internal.ads.credentialActions.refreshIfNeeded, {
      credId: credId as never,
    })) as { ok: boolean; reason?: string; message?: string };

    expect(out.ok).toBe(false);
    expect(out.reason).toBe("reconnect");
    expect(out.message).toMatch(/reconnect/i);
    // Redaction: no provider body text, no refresh token in the message.
    expect(out.message ?? "").not.toContain("REVOKED-BODY-MARKER");
    expect(out.message ?? "").not.toContain("test-ads-refresh-revoked");

    const cred = await readAdsCred(t, credId);
    expect(cred.refreshStatus).toBe("needs_reconnect");
    // The rejected tokens are untouched and the claim was released.
    expect(cred.accessToken).toBe("test-ads-access-expired");
    expect(cred.refreshToken).toBe("test-ads-refresh-revoked");
    expect(cred.refreshLeaseId).toBeUndefined();
    expect(cred.refreshLeaseUntil).toBeUndefined();
  });

  it("an expired credential with no refresh token needs reconnect without calling the provider", async () => {
    const t = newBackend();
    const owner = await seedUser(t, { plan: "starter", email: "nore@example.com" });
    const projectId = await owner.as.mutation(api.projects.create, { name: "R" });
    const credId = await seedAdsCred(t, projectId, owner.userId, {
      platform: "meta",
      accessToken: "test-meta-access-expired",
      refreshToken: undefined,
      expiresAt: Date.now() - 60_000,
    });

    // Unrouted URLs (i.e. ANY fetch) would fail this test: no provider call.
    const calls = stubFetch(() => null);

    const out = (await t.action(internal.ads.credentialActions.refreshIfNeeded, {
      credId: credId as never,
    })) as { ok: boolean; reason?: string; message?: string };

    expect(out.ok).toBe(false);
    expect(out.reason).toBe("reconnect");
    expect(out.message).toMatch(/reconnect/i);
    expect(calls).toHaveLength(0);

    const cred = await readAdsCred(t, credId);
    expect(cred.refreshStatus).toBe("needs_reconnect");
  });

  it("a provider outage releases the claim safely with a redacted error", async () => {
    const t = newBackend();
    const owner = await seedUser(t, { plan: "starter", email: "outage@example.com" });
    const projectId = await owner.as.mutation(api.projects.create, { name: "R" });
    const credId = await seedAdsCred(t, projectId, owner.userId, {
      accessToken: "test-ads-access-expired",
      expiresAt: Date.now() - 60_000,
    });

    stubFetch((call) => {
      if (call.url === GOOGLE_TOKEN_URL) {
        return new Response("500-OOPS-BODY-MARKER access_token=should-not-leak", {
          status: 500,
          headers: { "Content-Type": "text/plain" },
        });
      }
      return null;
    });

    const out = (await t.action(internal.ads.credentialActions.refreshIfNeeded, {
      credId: credId as never,
    })) as { ok: boolean; reason?: string; message?: string };

    expect(out.ok).toBe(false);
    expect(out.reason).toBe("provider_error");
    expect(out.message).toMatch(/HTTP 500/);
    expect(out.message ?? "").not.toContain("500-OOPS-BODY-MARKER");
    expect(out.message ?? "").not.toContain("should-not-leak");

    const cred = await readAdsCred(t, credId);
    // Failed claim released: no stale lease pins the credential.
    expect(cred.refreshLeaseId).toBeUndefined();
    expect(cred.refreshLeaseUntil).toBeUndefined();
    expect(cred.accessToken).toBe("test-ads-access-expired");
  });
});

describe("BP-04 — concurrent refresh cannot clobber a newer token", () => {
  it("refuses a second claim while the lease is held, and a stale rotating-token response cannot overwrite newer tokens", async () => {
    const t = newBackend();
    const owner = await seedUser(t, { plan: "starter", email: "race@example.com" });
    const projectId = await owner.as.mutation(api.projects.create, { name: "R" });
    const credId = await seedAdsCred(t, projectId, owner.userId, {
      accessToken: "test-ads-access-expired",
      refreshToken: "test-ads-refresh-old",
      expiresAt: Date.now() - 60_000,
    });

    // Writer A claims the refresh.
    const claimA = (await t.mutation(internal.ads.credentials.claimRefresh, {
      credId: credId as never,
      leaseMs: 60_000,
    })) as { status: string; leaseId?: string; tokenVersion?: number };
    expect(claimA.status).toBe("claimed");
    expect(claimA.leaseId).toBeTruthy();
    expect(claimA.tokenVersion).toBe(0);

    // A concurrent refresh cannot claim while A's lease is live.
    const claimB = (await t.mutation(internal.ads.credentials.claimRefresh, {
      credId: credId as never,
      leaseMs: 60_000,
    })) as { status: string };
    expect(claimB.status).toBe("busy");

    // Simulate an out-of-band newer rotation landing while A's provider call
    // is still in flight (newer token + bumped version).
    await t.run((ctx) =>
      ctx.db.patch(credId as never, {
        accessToken: "test-ads-access-newer",
        refreshToken: "test-ads-refresh-newer",
        expiresAt: Date.now() + 3_600_000,
        tokenVersion: 1,
      }),
    );

    // A's late response (tokens rotated from its own refresh) must be refused.
    const save = (await t.mutation(internal.ads.credentials.saveRefreshResult, {
      credId: credId as never,
      leaseId: claimA.leaseId!,
      expectedVersion: claimA.tokenVersion!,
      accessToken: "test-ads-access-stale",
      refreshToken: "test-ads-refresh-stale",
      expiresAt: Date.now() + 3_600_000,
    })) as { applied: boolean; reason?: string };
    expect(save.applied).toBe(false);
    expect(save.reason).toBe("stale_version");

    const cred = await readAdsCred(t, credId);
    expect(cred.accessToken).toBe("test-ads-access-newer");
    expect(cred.refreshToken).toBe("test-ads-refresh-newer");
    expect(cred.tokenVersion).toBe(1);
  });

  it("an expired lease is claimable again and a failed claim releases cleanly", async () => {
    const t = newBackend();
    const owner = await seedUser(t, { plan: "starter", email: "lease@example.com" });
    const projectId = await owner.as.mutation(api.projects.create, { name: "R" });
    const credId = await seedAdsCred(t, projectId, owner.userId, {
      accessToken: "test-ads-access-expired",
      expiresAt: Date.now() - 60_000,
    });

    const claimA = (await t.mutation(internal.ads.credentials.claimRefresh, {
      credId: credId as never,
      leaseMs: 60_000,
    })) as { status: string; leaseId?: string };
    expect(claimA.status).toBe("claimed");

    // A crashes: the lease expires on its own and becomes claimable.
    await t.run((ctx) =>
      ctx.db.patch(credId as never, { refreshLeaseUntil: Date.now() - 1 }),
    );
    const claimB = (await t.mutation(internal.ads.credentials.claimRefresh, {
      credId: credId as never,
      leaseMs: 60_000,
    })) as { status: string; leaseId?: string };
    expect(claimB.status).toBe("claimed");
    expect(claimB.leaseId).not.toBe(claimA.leaseId);

    // Releasing with A's stale lease id is a no-op for B's claim.
    await t.mutation(internal.ads.credentials.releaseRefresh, {
      credId: credId as never,
      leaseId: claimA.leaseId!,
    });
    let cred = await readAdsCred(t, credId);
    expect(cred.refreshLeaseId).toBe(claimB.leaseId);

    // Releasing with the holder's own lease id frees the claim.
    await t.mutation(internal.ads.credentials.releaseRefresh, {
      credId: credId as never,
      leaseId: claimB.leaseId!,
    });
    cred = await readAdsCred(t, credId);
    expect(cred.refreshLeaseId).toBeUndefined();
    expect(cred.refreshLeaseUntil).toBeUndefined();
    // Tokens were never touched by claim/release.
    expect(cred.accessToken).toBe("test-ads-access-expired");
  });
});

describe("BP-04 — ads caller uses the refresh action", () => {
  it("syncPlatform surfaces a rejected refresh as a safe reconnect error", async () => {
    const t = newBackend();
    const owner = await seedUser(t, { plan: "starter", email: "syncreject@example.com" });
    const projectId = await owner.as.mutation(api.projects.create, { name: "R" });
    const credId = await seedAdsCred(t, projectId, owner.userId, {
      platform: "google",
      accessToken: "test-ads-access-expired",
      refreshToken: "test-ads-refresh-revoked",
      expiresAt: Date.now() - 60_000,
    });

    stubFetch((call) => {
      if (call.url === GOOGLE_TOKEN_URL) {
        return json(400, {
          error: "invalid_grant",
          error_description: "SYNC-REVOKED-BODY-MARKER",
        });
      }
      return null;
    });

    let message = "";
    await expect(
      owner.as
        .action(api.ads.sync.syncPlatform, {
          projectId: projectId as never,
          platform: "google",
        })
        .catch((e: unknown) => {
          message = e instanceof Error ? e.message : String(e);
          throw e;
        }),
    ).rejects.toThrow();

    expect(message).toMatch(/reconnect/i);
    expect(message).not.toContain("SYNC-REVOKED-BODY-MARKER");

    const cred = await readAdsCred(t, credId);
    expect(cred.refreshStatus).toBe("needs_reconnect");
  });
});
