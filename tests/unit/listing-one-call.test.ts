import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/convex/_generated/api";
import { listingFromSuggestion } from "@/components/app/wizard/listing";
import { newBackend, seedUser, type TestBackend } from "./helpers";

/**
 * LQ-1b: a picked Google listing whose search answer already carries the
 * details costs one paid SerpApi call (the search), not two. Synthetic
 * SerpApi answer; fetch is stubbed, so no provider is called.
 */

const SEARCH_ANSWER = {
  local_results: [
    {
      title: "Northside Coffee",
      place_id: "p_full",
      address: "1 High St, Bristol",
      type: "Coffee shop",
      phone: "+44 117 000 0000",
      website: "https://northside.example",
      rating: 4.6,
      reviews: 120,
      operating_hours: { monday: "8 AM–5 PM" },
    },
    { title: "Northside Bakery", place_id: "p_thin" },
  ],
};

const originalKey = process.env.SERPAPI_KEY;
let fetchCalls = 0;

beforeEach(() => {
  process.env.SERPAPI_KEY = "test-only-not-a-key";
  fetchCalls = 0;
  vi.stubGlobal("fetch", async () => {
    fetchCalls += 1;
    return new Response(JSON.stringify(SEARCH_ANSWER), { status: 200, headers: { "content-type": "application/json" } });
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  if (originalKey === undefined) delete process.env.SERPAPI_KEY;
  else process.env.SERPAPI_KEY = originalKey;
});

async function reservedSerpApiCalls(t: TestBackend): Promise<number> {
  const rows = await t.run((ctx) => ctx.db.query("providerUsageRollups").collect());
  return rows.filter((row) => row.kind === "serpapi").reduce((sum, row) => sum + row.count, 0);
}

describe("LQ-1b: one SerpApi call for a pick with full details", () => {
  it("the search answer carries the details, so the pick needs no lookup", async () => {
    const t = newBackend();
    const owner = await seedUser(t, { email: "owner@example.test" });

    const suggestions = await owner.as.action(api.scraping.suggestGoogleBusiness, { query: "Northside Coffee" });
    const picked = suggestions.find((s) => s.placeId === "p_full");
    expect(picked).toBeDefined();
    const listing = listingFromSuggestion(picked!);

    expect(listing).toEqual({
      title: "Northside Coffee",
      address: "1 High St, Bristol",
      phone: "+44 117 000 0000",
      website: "https://northside.example",
      rating: 4.6,
      reviews: 120,
      category: "Coffee shop",
      openHours: "Monday: 8 AM–5 PM",
    });
    expect(fetchCalls).toBe(1);
    expect(await reservedSerpApiCalls(t)).toBe(1);
  });

  it("a thin pick still needs the details lookup", async () => {
    const t = newBackend();
    const owner = await seedUser(t, { email: "owner@example.test" });
    const suggestions = await owner.as.action(api.scraping.suggestGoogleBusiness, { query: "Northside" });
    const thin = suggestions.find((s) => s.placeId === "p_thin");
    expect(listingFromSuggestion(thin!)).toBeNull();
  });

  it("an address and category without any way to reach the business is not enough", () => {
    expect(
      listingFromSuggestion({ placeId: "p", title: "T", address: "A", category: "C" }),
    ).toBeNull();
  });
});
