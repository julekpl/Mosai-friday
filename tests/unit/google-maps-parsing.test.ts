import { describe, expect, it } from "vitest";
import {
  formatOpeningHours,
  googleMapsFailure,
  isEmptyGoogleMapsAnswer,
  parseGoogleMapsPlace,
  parseGoogleMapsSuggestions,
} from "@/convex/lib/googleMaps";

/**
 * Regression (24 Sep 2026 audit): Google Business search in the project
 * wizard showed "No matches" for businesses that exist and "temporarily
 * unavailable" when Google simply had no results.
 *
 *  - SerpApi returns `place_results` (one object) when the query resolves to a
 *    single exact place; only `local_results` used to be read.
 *  - "No results" is a documented 200 with an `error` string and
 *    `local_results_state: "Fully empty"`; it used to be thrown as an outage.
 *  - Place results carry hours as an array of `{ day: hours }` objects; the
 *    lookup used to stringify them as "[object Object]".
 *
 * Fixtures mirror the documented SerpApi response shapes (synthetic values).
 */

const EXACT_MATCH = {
  search_metadata: { status: "Success" },
  place_results: {
    title: "Studio Forma Architects",
    place_id: "ChIJ_exact_place",
    address: "ul. Prosta 1, 00-001 Warszawa",
    phone: "+48 22 000 00 00",
    website: "https://studioforma.example",
    rating: 4.8,
    reviews: 57,
    type: ["Architect"],
    gps_coordinates: { latitude: 52.2297, longitude: 21.0122 },
    hours: [{ monday: "9 AM–5 PM" }, { tuesday: "9 AM–5 PM" }],
  },
};

const LIST = {
  local_results: [
    { title: "A", place_id: "p1", address: "x", type: "Architect", rating: 4.1, reviews: 3 },
    { title: "A duplicate", place_id: "p1" },
    { title: "No id" },
    { title: "B", place_id: "p2", types: ["Interior designer"] },
  ],
};

const NO_RESULTS = {
  search_metadata: { status: "Success" },
  search_information: { local_results_state: "Fully empty" },
  error: "Google hasn't returned any results for this query.",
};

describe("SerpApi google_maps parsing", () => {
  it("returns the exact-match place as a suggestion", () => {
    expect(parseGoogleMapsSuggestions(EXACT_MATCH)).toEqual([
      {
        placeId: "ChIJ_exact_place",
        title: "Studio Forma Architects",
        address: "ul. Prosta 1, 00-001 Warszawa",
        category: "Architect",
        rating: 4.8,
        reviews: 57,
        phone: "+48 22 000 00 00",
        website: "https://studioforma.example",
        openHours: "Monday: 9 AM–5 PM · Tuesday: 9 AM–5 PM",
      },
    ]);
  });

  it("deduplicates list results and drops hits without a place id", () => {
    const out = parseGoogleMapsSuggestions(LIST);
    expect(out.map((s) => s.placeId)).toEqual(["p1", "p2"]);
    expect(out[1]?.category).toBe("Interior designer");
  });

  it("treats Google's documented no-results answer as empty, not a failure", () => {
    expect(isEmptyGoogleMapsAnswer(NO_RESULTS)).toBe(true);
    expect(googleMapsFailure(NO_RESULTS)).toBe(false);
    expect(googleMapsFailure({ error: "Invalid API key." })).toBe(true);
  });

  it("formats both documented opening-hours shapes", () => {
    expect(formatOpeningHours(EXACT_MATCH.place_results)).toBe(
      "Monday: 9 AM–5 PM · Tuesday: 9 AM–5 PM",
    );
    expect(formatOpeningHours({ operating_hours: { saturday: "Closed" } })).toBe("Saturday: Closed");
  });

  it("parses a confirmed place without leaking object text", () => {
    const place = parseGoogleMapsPlace(EXACT_MATCH, "fallback");
    expect(place?.title).toBe("Studio Forma Architects");
    expect(place?.openHours).not.toContain("[object Object]");
    expect(place?.latitude).toBeCloseTo(52.2297);
    expect(parseGoogleMapsPlace(NO_RESULTS, "x")).toBeNull();
  });
});
