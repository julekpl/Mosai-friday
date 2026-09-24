import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "@/convex/_generated/api";
import { getAdapter } from "@/convex/ads/adapters";
import {
  chatgptAdsStatus,
  exchangeCodeForTokens,
  platformEnv,
} from "@/convex/ads/platforms";
import { newBackend, seedProject, seedUser } from "./helpers";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("OpenAI Ads truth boundary", () => {
  it("stays unavailable even if legacy OAuth-shaped env vars exist", () => {
    vi.stubEnv("CHATGPT_ADS_CLIENT_ID", "test-client-id");
    vi.stubEnv("CHATGPT_ADS_CLIENT_SECRET", "test-client-secret");

    expect(platformEnv("chatgpt")).toBeNull();
    expect(chatgptAdsStatus()).toEqual({
      supported: false,
      note: expect.stringMatching(/unavailable.*account-scoped API key setup/i),
    });
  });

  it("does not surface old credentials as a connected platform", async () => {
    vi.stubEnv("CHATGPT_ADS_CLIENT_ID", "test-client-id");
    vi.stubEnv("CHATGPT_ADS_CLIENT_SECRET", "test-client-secret");
    const t = newBackend();
    const owner = await seedUser(t, { plan: "growth" });
    const projectId = await seedProject(t, owner.userId);
    await t.run((ctx) =>
      ctx.db.insert("adsCredentials", {
        projectId: projectId as never,
        platform: "chatgpt",
        accessToken: "legacy-test-token",
        accountLabel: "Legacy account",
        expiresAt: Date.now() + 60_000,
        connectedBy: owner.userId as never,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );

    const rows = await owner.as.query(api.ads.oauth.status, {
      projectId: projectId as never,
    });

    expect(rows?.find((row) => row.platform === "chatgpt")).toMatchObject({
      configured: false,
      connected: false,
      setupDetail: expect.stringMatching(/unavailable/i),
    });
    const openAiRow = rows?.find((row) => row.platform === "chatgpt");
    expect(openAiRow).not.toHaveProperty("accountLabel");
    expect(openAiRow).not.toHaveProperty("expiresAt");
  });

  it("rejects OAuth start before creating state", async () => {
    const t = newBackend();
    const owner = await seedUser(t, { plan: "growth" });
    const projectId = await seedProject(t, owner.userId);

    await expect(
      owner.as.mutation(api.ads.oauth.start, {
        projectId: projectId as never,
        platform: "chatgpt",
      }),
    ).rejects.toThrow(/OAuth is not configured/i);
    const states = await t.run((ctx) => ctx.db.query("oauthStates").collect());
    expect(states).toHaveLength(0);
  });

  it("rejects OAuth token exchange without making a request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      exchangeCodeForTokens(
        "chatgpt",
        {
          clientId: "test-client",
          clientSecret: "test-secret",
          authorizeUrl: "https://example.invalid/authorize",
          tokenUrl: "https://example.invalid/token",
          scopes: [],
        },
        "test-code",
        "https://mosai.invalid/callback",
      ),
    ).rejects.toThrow(/does not use OAuth/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("blocks all adapter reads and writes without making a provider request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const adapter = getAdapter("chatgpt");

    await expect(adapter.listAccounts("test-token")).rejects.toThrow(/unavailable/i);
    await expect(adapter.listCampaigns("test-token", "acct")).rejects.toThrow(/unavailable/i);
    await expect(
      adapter.fetchDailyMetrics("test-token", "acct", "campaign", "2026-01-01", "2026-01-02"),
    ).rejects.toThrow(/unavailable/i);
    await expect(adapter.pauseCampaign("test-token", "acct", "campaign")).resolves.toMatchObject({ ok: false });
    await expect(adapter.resumeCampaign("test-token", "acct", "campaign")).resolves.toMatchObject({ ok: false });
    await expect(adapter.setDailyBudget("test-token", "acct", "campaign", 5000)).resolves.toMatchObject({ ok: false });

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
