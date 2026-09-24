import { afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "@/convex/_generated/api";
import { configuredOAuthBaseUrl } from "@/convex/lib/oauthBaseUrl";
import { newBackend, seedProject, seedUser } from "./helpers";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("BP-08 OAuth state lifecycle", () => {
  it("accepts only a configured trusted origin for redirects", () => {
    expect(configuredOAuthBaseUrl("https://mosai.example.eu/")).toBe(
      "https://mosai.example.eu",
    );
    expect(configuredOAuthBaseUrl("http://localhost:5173")).toBe(
      "http://localhost:5173",
    );
    expect(configuredOAuthBaseUrl(undefined)).toBeNull();
    expect(configuredOAuthBaseUrl("https://user@evil.example")).toBeNull();
    expect(configuredOAuthBaseUrl("https://mosai.example.eu/app")).toBeNull();
    expect(configuredOAuthBaseUrl("http://mosai.example.eu")).toBeNull();
  });

  it("shows setup guidance without an app origin and supports local dashboard OAuth", async () => {
    vi.stubEnv("LINKEDIN_CLIENT_ID", "test-client-id");
    vi.stubEnv("LINKEDIN_CLIENT_SECRET", "test-client-secret");
    vi.stubEnv("ADS_OAUTH_REDIRECT_BASE", "");
    vi.stubEnv("CONVEX_SITE_URL", "https://mosai-dev.convex.site");

    const t = newBackend();
    const owner = await seedUser(t, { plan: "scale" });
    const projectId = await seedProject(t, owner.userId);
    const missingOrigin = await owner.as.query(api.social.oauth.status, {
      projectId: projectId as never,
    });
    expect(
      missingOrigin.find((row) => row.platform === "linkedin"),
    ).toMatchObject({
      configured: false,
      setupDetail: "The trusted MOSAI app return origin is not configured.",
    });

    vi.stubEnv("ADS_OAUTH_REDIRECT_BASE", "http://localhost:5173");
    const localStatus = await owner.as.query(api.social.oauth.status, {
      projectId: projectId as never,
    });
    expect(
      localStatus.find((row) => row.platform === "linkedin"),
    ).toMatchObject({
      configured: true,
    });

    const { authorizeUrl } = await owner.as.mutation(api.social.oauth.start, {
      projectId: projectId as never,
      platform: "linkedin",
    });
    expect(new URL(authorizeUrl).searchParams.get("redirect_uri")).toBe(
      "https://mosai-dev.convex.site/api/social/callback",
    );
  });

  it("allows at most one concurrent callback to claim a state", async () => {
    const t = newBackend();
    const { userId } = await seedUser(t);
    const projectId = await seedProject(t, userId);
    const state = "synthetic-oauth-state";

    await t.run((ctx) =>
      ctx.db.insert("oauthStates", {
        state,
        projectId: projectId as never,
        platform: "google",
        createdBy: userId as never,
        createdAt: Date.now(),
      }),
    );

    const [callbackA, callbackB] = await Promise.all([
      t.mutation(internal.ads.oauth.claimOauthState, { state }),
      t.mutation(internal.ads.oauth.claimOauthState, { state }),
    ]);

    expect([callbackA, callbackB].filter(Boolean)).toHaveLength(1);
    expect(
      await t.mutation(internal.ads.oauth.claimOauthState, { state }),
    ).toBeNull();
  });

  it("consumes expired states and refuses a state created for another tenant", async () => {
    const t = newBackend();
    const alice = await seedUser(t);
    const bob = await seedUser(t);
    const bobsProject = await seedProject(t, bob.userId);
    const wrongTenantState = "synthetic-wrong-tenant-state";
    const expiredState = "synthetic-expired-state";

    await t.run(async (ctx) => {
      await ctx.db.insert("oauthStates", {
        state: wrongTenantState,
        projectId: bobsProject as never,
        platform: "google",
        createdBy: alice.userId as never,
        createdAt: Date.now(),
      });
      await ctx.db.insert("oauthStates", {
        state: expiredState,
        projectId: bobsProject as never,
        platform: "google",
        createdBy: bob.userId as never,
        createdAt: 0,
      });
    });

    expect(
      await t.mutation(internal.ads.oauth.claimOauthState, {
        state: wrongTenantState,
      }),
    ).toBeNull();
    expect(
      await t.mutation(internal.ads.oauth.claimOauthState, {
        state: expiredState,
      }),
    ).toBeNull();
    expect(
      await t.run((ctx) => ctx.db.query("oauthStates").collect()),
    ).toHaveLength(0);
  });

  it("does not let the social callback consume an ads state", async () => {
    const t = newBackend();
    const { userId } = await seedUser(t);
    const projectId = await seedProject(t, userId);
    const state = "synthetic-ads-state";

    await t.run((ctx) =>
      ctx.db.insert("oauthStates", {
        state,
        projectId: projectId as never,
        platform: "google",
        createdBy: userId as never,
        createdAt: Date.now(),
      }),
    );

    expect(
      await t.mutation(internal.social.oauth.claimOauthState, { state }),
    ).toBeNull();
    expect(
      await t.mutation(internal.ads.oauth.claimOauthState, { state }),
    ).not.toBeNull();
  });

  it("lets the project owner select and deselect discovered ad accounts only", async () => {
    const t = newBackend();
    const owner = await seedUser(t, { plan: "scale" });
    const outsider = await seedUser(t, { plan: "scale" });
    const projectId = await seedProject(t, owner.userId);
    const accountId = "synthetic-account-1";

    await t.run((ctx) =>
      ctx.db.insert("adsAccounts", {
        projectId: projectId as never,
        platform: "meta",
        accountId,
        name: "Sample account",
        status: "not_selected",
      }),
    );

    await owner.as.mutation(api.ads.sync.setAccountSelected, {
      projectId: projectId as never,
      platform: "meta",
      accountId,
      selected: true,
    });
    expect(
      (
        await owner.as.query(api.ads.sync.listAccounts, {
          projectId: projectId as never,
        })
      )[0]?.status,
    ).toBe("selected");

    await owner.as.mutation(api.ads.sync.setAccountSelected, {
      projectId: projectId as never,
      platform: "meta",
      accountId,
      selected: false,
    });
    expect(
      (
        await owner.as.query(api.ads.sync.listAccounts, {
          projectId: projectId as never,
        })
      )[0]?.status,
    ).toBe("not_selected");

    await expect(
      outsider.as.mutation(api.ads.sync.setAccountSelected, {
        projectId: projectId as never,
        platform: "meta",
        accountId,
        selected: true,
      }),
    ).rejects.toThrow(/not found/i);
  });
});
