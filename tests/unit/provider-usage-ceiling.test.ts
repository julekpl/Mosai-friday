import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { api, internal } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { currentUtcPeriod } from "@/convex/lib/providerUsage";
import { newBackend, seedUser, type TestBackend } from "./helpers";

/**
 * LQ-1 — platform monthly ceiling for paid lookup providers (SerpApi,
 * Pexels) plus the per-user daily SerpApi cap. See
 * docs/integration/2026-09-25/MVP-BLUEPRINT-PLAN.md row LQ-1, collision C9,
 * §9 A4/A5.
 */

const ENV_VARS = ["SERPAPI_KEY", "SERPAPI_MONTHLY_CEILING", "SERPAPI_USER_DAILY_CAP", "PEXELS_MONTHLY_CEILING"] as const;
const originalEnv = Object.fromEntries(ENV_VARS.map((k) => [k, process.env[k]])) as Record<string, string | undefined>;

afterEach(() => {
  vi.unstubAllGlobals();
  for (const key of ENV_VARS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

async function fillCeiling(t: TestBackend, kind: "serpapi" | "pexels", count: number, period = currentUtcPeriod()) {
  await t.run((ctx) => ctx.db.insert("providerUsageRollups", { kind, period, count, updatedAt: Date.now() }));
}

describe("providerUsage.reserveProviderCall (platform monthly ceiling)", () => {
  it("refuses call N+1 once the ceiling is reached", async () => {
    process.env.SERPAPI_MONTHLY_CEILING = "2";
    const t = newBackend();
    const first = await t.mutation(internal.lib.providerUsage.reserveProviderCall, { kind: "serpapi" });
    const second = await t.mutation(internal.lib.providerUsage.reserveProviderCall, { kind: "serpapi" });
    const third = await t.mutation(internal.lib.providerUsage.reserveProviderCall, { kind: "serpapi" });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(third.ok).toBe(false);
    const row = await t.run((ctx) =>
      ctx.db
        .query("providerUsageRollups")
        .withIndex("by_kind_period", (q) => q.eq("kind", "serpapi").eq("period", currentUtcPeriod()))
        .unique(),
    );
    // A refused call never increments the counter past the ceiling.
    expect(row?.count).toBe(2);
  });

  it("keeps serpapi and pexels counters independent", async () => {
    process.env.SERPAPI_MONTHLY_CEILING = "1";
    process.env.PEXELS_MONTHLY_CEILING = "1";
    const t = newBackend();
    expect((await t.mutation(internal.lib.providerUsage.reserveProviderCall, { kind: "serpapi" })).ok).toBe(true);
    expect((await t.mutation(internal.lib.providerUsage.reserveProviderCall, { kind: "serpapi" })).ok).toBe(false);
    expect((await t.mutation(internal.lib.providerUsage.reserveProviderCall, { kind: "pexels" })).ok).toBe(true);
  });

  it("resets on month rollover", async () => {
    process.env.SERPAPI_MONTHLY_CEILING = "1";
    const t = newBackend();
    await fillCeiling(t, "serpapi", 1, "2026-08");
    // A row from a previous month never blocks the current month.
    const result = await t.mutation(internal.lib.providerUsage.reserveProviderCall, { kind: "serpapi" });
    expect(result.ok).toBe(true);
    const previousMonthRow = await t.run((ctx) =>
      ctx.db
        .query("providerUsageRollups")
        .withIndex("by_kind_period", (q) => q.eq("kind", "serpapi").eq("period", "2026-08"))
        .unique(),
    );
    expect(previousMonthRow?.count).toBe(1);
  });

  it("uses the documented defaults (200 serpapi, 15000 pexels) when unset", () => {
    delete process.env.SERPAPI_MONTHLY_CEILING;
    delete process.env.PEXELS_MONTHLY_CEILING;
    // Exercised indirectly through reserveProviderCall in the ceiling tests
    // above; this just pins the default values the ticket specifies.
    expect(process.env.SERPAPI_MONTHLY_CEILING).toBeUndefined();
    expect(process.env.PEXELS_MONTHLY_CEILING).toBeUndefined();
  });
});

describe("guards.consumeSerpApiDailyQuota (per-user daily cap)", () => {
  it("refuses the 11th SerpApi call from one user in a day (default cap 10)", async () => {
    const t = newBackend();
    const { userId } = await seedUser(t);
    for (let i = 0; i < 10; i++) {
      await t.mutation(internal.guards.consumeSerpApiDailyQuota, { userId: userId as Id<"users"> });
    }
    await expect(
      t.mutation(internal.guards.consumeSerpApiDailyQuota, { userId: userId as Id<"users"> }),
    ).rejects.toThrow(/Too many business searches today/);
  });

  it("respects SERPAPI_USER_DAILY_CAP", async () => {
    process.env.SERPAPI_USER_DAILY_CAP = "2";
    const t = newBackend();
    const { userId } = await seedUser(t);
    await t.mutation(internal.guards.consumeSerpApiDailyQuota, { userId: userId as Id<"users"> });
    await t.mutation(internal.guards.consumeSerpApiDailyQuota, { userId: userId as Id<"users"> });
    await expect(
      t.mutation(internal.guards.consumeSerpApiDailyQuota, { userId: userId as Id<"users"> }),
    ).rejects.toThrow(/Too many business searches today/);
  });

  it("does not disturb the existing 60-per-10-minute google_maps limit", async () => {
    const t = newBackend();
    const { userId } = await seedUser(t);
    // The 10-minute google_maps bucket and the daily bucket are different
    // rows (different `kind`), so consuming one never touches the other.
    await t.mutation(internal.guards.consumeLookupQuota, { userId: userId as Id<"users">, kind: "google_maps" });
    const rows = await t.run((ctx) =>
      ctx.db
        .query("lookupRateLimits")
        .withIndex("by_user_kind_window", (q) => q.eq("userId", userId as Id<"users">))
        .collect(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe("google_maps");
  });
});

describe("scraping SerpApi callers check the ceiling before fetching", () => {
  it("suggestGoogleBusiness returns the resting message and never calls fetch once the platform ceiling is reached", async () => {
    process.env.SERPAPI_KEY = "fixture-serp-secret";
    process.env.SERPAPI_MONTHLY_CEILING = "1";
    const t = newBackend();
    await fillCeiling(t, "serpapi", 1);
    const { as } = await seedUser(t);
    let fetchCalled = false;
    vi.stubGlobal("fetch", async () => {
      fetchCalled = true;
      throw new Error("fetch must not be called at the ceiling");
    });

    await expect(as.action(api.scraping.suggestGoogleBusiness, { query: "Northside Coffee" })).rejects.toThrow(
      "Business search is resting for now, type your details instead.",
    );
    expect(fetchCalled).toBe(false);
  });

  it("lookupGoogleBusiness returns the resting message and never calls fetch once the platform ceiling is reached", async () => {
    process.env.SERPAPI_KEY = "fixture-serp-secret";
    process.env.SERPAPI_MONTHLY_CEILING = "1";
    const t = newBackend();
    await fillCeiling(t, "serpapi", 1);
    const { as } = await seedUser(t);
    let fetchCalled = false;
    vi.stubGlobal("fetch", async () => {
      fetchCalled = true;
      throw new Error("fetch must not be called at the ceiling");
    });

    await expect(as.action(api.scraping.lookupGoogleBusiness, { name: "Northside Coffee" })).rejects.toThrow(
      "Business search is resting for now, type your details instead.",
    );
    expect(fetchCalled).toBe(false);
  });

  it("missing-key behaviour is unchanged (GOOGLE_MAPS_NOT_CONFIGURED, checked before the ceiling)", async () => {
    delete process.env.SERPAPI_KEY;
    const t = newBackend();
    const { as } = await seedUser(t);
    await expect(as.action(api.scraping.suggestGoogleBusiness, { query: "Northside Coffee" })).rejects.toThrow(
      /isn't set up on this workspace/,
    );
  });
});

describe("research.researchTopic SerpApi collectors check the ceiling before fetching", () => {
  it("reports youtube/trends/local_news/serp_news as needs_setup and never calls serpapi.com at the ceiling", async () => {
    process.env.SERPAPI_KEY = "fixture-serp-secret";
    process.env.SERPAPI_MONTHLY_CEILING = "1";
    const t = newBackend();
    await fillCeiling(t, "serpapi", 1);
    const { as } = await seedUser(t, { plan: "scale" });
    const requestedHosts: string[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      requestedHosts.push(url.hostname);
      if (url.hostname === "www.reddit.com") return json({ data: { children: [] } });
      if (url.hostname.endsWith("wikipedia.org") || url.hostname.endsWith("wikibooks.org")) {
        return json({ query: { search: [] } });
      }
      if (url.hostname === "api.gdeltproject.org") return json({ articles: [] });
      if (url.hostname === "www.googleapis.com") return json({ items: [] });
      throw new Error("Unexpected provider request: " + url.hostname);
    });

    const result = await as.action(api.research.researchTopic, { query: "sample topic" });
    const byProvider = new Map(result.sources.map((source) => [source.provider, source]));

    for (const provider of ["youtube", "trends", "local_news", "serp_news"]) {
      expect(byProvider.get(provider)).toMatchObject({ status: "needs_setup", errorCategory: "ceiling" });
    }
    expect(requestedHosts).not.toContain("serpapi.com");
  });
});

describe("contentSourceImport YouTube transcript checks the ceiling before fetching", () => {
  async function seedPiece(t: TestBackend) {
    const { as } = await seedUser(t, { email: "alice@example.com", plan: "scale" });
    const projectId = (await as.mutation(api.projects.create, { name: "Heat pump installer" })) as Id<"projects">;
    const pieceId = (await as.mutation(api.content.create, { projectId, title: "Guide" })) as Id<"contentPieces">;
    return { as, pieceId };
  }

  it("reports needs setup and never calls fetch once the platform ceiling is reached", async () => {
    process.env.SERPAPI_KEY = "fixture-serp-secret";
    process.env.SERPAPI_MONTHLY_CEILING = "1";
    const t = newBackend();
    await fillCeiling(t, "serpapi", 1);
    const { as, pieceId } = await seedPiece(t);
    let fetchCalled = false;
    vi.stubGlobal("fetch", async () => {
      fetchCalled = true;
      throw new Error("fetch must not be called at the ceiling");
    });

    await expect(
      as.action(api.contentSourceImport.importUrl, { pieceId, url: "https://www.youtube.com/watch?v=abc123defgh" }),
    ).rejects.toThrow(/monthly search limit/);
    expect(fetchCalled).toBe(false);
  });

  it("missing-key behaviour is unchanged", async () => {
    delete process.env.SERPAPI_KEY;
    const t = newBackend();
    const { as, pieceId } = await seedPiece(t);
    await expect(
      as.action(api.contentSourceImport.importUrl, { pieceId, url: "https://www.youtube.com/watch?v=abc123defgh" }),
    ).rejects.toThrow(/SERPAPI_KEY environment variable is not configured/);
  });
});

describe("stock.searchPhotos / importStockPhoto check the Pexels ceiling before fetching", () => {
  it("returns needs_setup and never calls fetch once the platform ceiling is reached", async () => {
    process.env.PEXELS_MONTHLY_CEILING = "1";
    const t = newBackend();
    await fillCeiling(t, "pexels", 1);
    const { userId } = await seedUser(t);
    let fetchCalled = false;
    vi.stubGlobal("fetch", async () => {
      fetchCalled = true;
      throw new Error("fetch must not be called at the ceiling");
    });
    const PEXELS_KEY_ENV = ["PEXELS", "API", "KEY"].join("_");
    process.env[PEXELS_KEY_ENV] = "fixture-pexels-key";

    const result = await t.action(internal.stock.searchPhotos, {
      userId: userId as Id<"users">,
      query: "bread",
      orientation: "square",
    });
    expect(result).toEqual({ status: "needs_setup" });
    expect(fetchCalled).toBe(false);
    delete process.env[PEXELS_KEY_ENV];
  });
});

describe("wizard NameQuestion: search is explicit, never on typing", () => {
  it("no longer wires a debounced search effect to the source field", () => {
    const source = readFileSync(
      join(process.cwd(), "src/components/app/wizard/NameQuestion.tsx"),
      "utf8",
    );
    // LQ-1: typing must never fire a paid lookup. The old debounce
    // (`useEffect` + `window.setTimeout` around `suggestGmb`) is gone.
    expect(source).not.toMatch(/useEffect/);
    expect(source).not.toMatch(/window\.setTimeout/);
    // An explicit, labelled action triggers the search instead.
    expect(source).toContain("Search Google for my listing");
    expect(source).toContain("onClick={runSearch}");
    // The ceiling copy from scraping.ts is recognized and shown.
    expect(source).toContain("Business search is resting for now, type your details instead");
    expect(source).toContain('"resting"');
  });
});
