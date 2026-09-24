import { describe, expect, it, vi } from "vitest";
import { api, internal } from "@/convex/_generated/api";
import { newBackend, seedProject, seedUser } from "./helpers";

async function approvedChange() {
  const t = newBackend();
  const owner = await seedUser(t, { plan: "growth" });
  const projectId = await seedProject(t, owner.userId);
  const changeId = await t.run((ctx) =>
    ctx.db.insert("adsChangeRequests", {
      projectId: projectId as never,
      platform: "google",
      accountId: "test-account",
      campaignId: "test-campaign",
      campaignName: "Test campaign",
      kind: "pause",
      origin: "user",
      status: "approved",
      idempotencyKey: "logical-operation-1",
      requestedBy: owner.userId as never,
      createdAt: Date.now(),
    }),
  );
  return { t, owner, projectId, changeId };
}

describe("BP-07/S1 ads execution claim and receipt", () => {
  it("allows only one claim for an approved logical operation", async () => {
    const { t, changeId } = await approvedChange();

    const claims = await Promise.all([
      t.mutation(internal.ads.control.claimExecution, {
        changeId: changeId as never,
      }),
      t.mutation(internal.ads.control.claimExecution, {
        changeId: changeId as never,
      }),
    ]);
    const first = claims.find((claim) => claim.status === "claimed");
    const second = claims.find((claim) => claim.status !== "claimed");

    expect(first?.status).toBe("claimed");
    expect(second?.status).toBe("already_claimed");
    if (first?.status !== "claimed") throw new Error("Expected execution claim");
    const row = await t.run((ctx) => ctx.db.get(changeId as never));
    expect(row?.status).toBe("executing");
    expect(row?.executionToken).toBe(first.claimToken);
  });

  it("records a receipt only for the active claim token", async () => {
    const { t, owner, changeId } = await approvedChange();
    const claim = await t.mutation(internal.ads.control.claimExecution, {
      changeId: changeId as never,
    });
    if (claim.status !== "claimed") throw new Error("Expected execution claim");

    const recorded = await t.mutation(internal.ads.control.recordExecution, {
      changeId: changeId as never,
      claimToken: claim.claimToken,
      result: { ok: true as const, providerRef: "provider-campaign-1" },
      executedBy: owner.userId as never,
    });
    expect(recorded.applied).toBe(true);
    const stale = await t.mutation(internal.ads.control.recordExecution, {
      changeId: changeId as never,
      claimToken: claim.claimToken,
      result: { ok: false as const, error: "late failure" },
      executedBy: owner.userId as never,
    });
    expect(stale.applied).toBe(false);
    const row = await t.run((ctx) => ctx.db.get(changeId as never));
    const receipts = await t.run((ctx) =>
      ctx.db
        .query("adsExecutions")
        .withIndex("by_change", (q) => q.eq("changeId", changeId as never))
        .collect(),
    );
    expect(row?.status).toBe("executed");
    expect(receipts).toHaveLength(1);
    expect(receipts[0]?.providerRef).toBe("provider-campaign-1");
  });

  it("stops before the provider write if promote.spend is removed during refresh", async () => {
    const { t, owner, projectId, changeId } = await approvedChange();
    const refreshUrl = "https://oauth2.googleapis.com/token";
    const savedClientId = process.env.GOOGLE_ADS_CLIENT_ID;
    const savedClientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;
    process.env.GOOGLE_ADS_CLIENT_ID = "test-google-client-id";
    process.env.GOOGLE_ADS_CLIENT_SECRET = "test-google-client-secret";

    await t.run((ctx) =>
      ctx.db.insert("adsCredentials", {
        projectId: projectId as never,
        platform: "google",
        accessToken: "test-expired-access-token",
        refreshToken: "test-refresh-token",
        expiresAt: Date.now() - 60_000,
        connectedBy: owner.userId as never,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url !== refreshUrl) throw new Error(`unexpected network request: ${url}`);
      // Simulate an entitlement downgrade while the token refresh is in flight.
      await t.run((ctx) => ctx.db.patch(owner.userId as never, { plan: "free" }));
      return new Response(
        JSON.stringify({ access_token: "test-refreshed-access-token", expires_in: 3600 }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      const result = await owner.as.action(api.ads.control.execute, {
        id: changeId as never,
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(result).toEqual({
        ok: false,
        error: expect.stringMatching(/does not include "promote"/),
      });
      const row = await t.run((ctx) => ctx.db.get(changeId as never));
      const executions = await t.run((ctx) =>
        ctx.db
          .query("adsExecutions")
          .withIndex("by_change", (q) => q.eq("changeId", changeId as never))
          .collect(),
      );
      expect(row?.status).toBe("failed");
      expect(executions).toHaveLength(1);
      expect(executions[0]?.result).toBe("error");
      expect(executions[0]?.errorDetail).toMatch(/does not include "promote"/);
    } finally {
      vi.unstubAllGlobals();
      if (savedClientId === undefined) delete process.env.GOOGLE_ADS_CLIENT_ID;
      else process.env.GOOGLE_ADS_CLIENT_ID = savedClientId;
      if (savedClientSecret === undefined) delete process.env.GOOGLE_ADS_CLIENT_SECRET;
      else process.env.GOOGLE_ADS_CLIENT_SECRET = savedClientSecret;
    }
  });
});
