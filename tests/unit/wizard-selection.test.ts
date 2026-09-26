import { describe, expect, it } from "vitest";
import {
  EMPTY_NOTES,
  EXCLUSIVE_CHANNELS,
  EXCLUSIVE_TYPES,
  answeredType,
  fromStored,
  mainChangeMessage,
  makeMain,
  toAnswers,
  toggleSelection,
  type AnswerDrafts,
} from "@/components/app/wizard/selection";
import { foundDetails, hasFoundDetails } from "@/components/app/wizard/findings";
import {
  BUSINESS_TYPE_OPTIONS,
  CHANNEL_OPTIONS,
  CLIENT_TYPE_OPTIONS,
  CUSTOMER_OPTIONS,
  GOAL_OPTIONS,
  channelLabel,
} from "@/components/app/wizard/questionOptions";
import {
  BUSINESS_TYPES,
  BUSINESS_TYPE_LABELS,
  CUSTOMER_GROUPS,
  FIRST_RUN_NOTE_LIMITS,
  POSTING_CHANNELS,
  PRIMARY_GOALS,
  normalizeFirstRunAnswers,
} from "@/shared/starterKit";

// U2d: the multi-select answer tiles (first-run wizard and Edit project).

const drafts = (patch: Partial<AnswerDrafts> = {}): AnswerDrafts => ({
  types: [],
  goals: [],
  channels: [],
  customers: [],
  notes: EMPTY_NOTES,
  ...patch,
});

describe("toggleSelection", () => {
  it("keeps the order of picking: the first pick is the main one", () => {
    let picked = toggleSelection<string>([], "instagram");
    picked = toggleSelection(picked, "facebook");
    picked = toggleSelection(picked, "tiktok");
    expect(picked).toEqual(["instagram", "facebook", "tiktok"]);
  });

  it("promotes the next pick when the main one is unpicked", () => {
    expect(toggleSelection(["instagram", "facebook", "tiktok"], "instagram")).toEqual(["facebook", "tiktok"]);
    expect(toggleSelection(["instagram"], "instagram")).toEqual([]);
  });

  it("makes an exclusive option clear every other pick", () => {
    expect(toggleSelection(["shop", "walk_in"], "agency", EXCLUSIVE_TYPES)).toEqual(["agency"]);
    expect(toggleSelection(["instagram", "facebook"], "none", EXCLUSIVE_CHANNELS)).toEqual(["none"]);
  });

  it("clears an exclusive option when anything else is picked", () => {
    expect(toggleSelection(["agency"], "shop", EXCLUSIVE_TYPES)).toEqual(["shop"]);
    expect(toggleSelection(["none"], "instagram", EXCLUSIVE_CHANNELS)).toEqual(["instagram"]);
  });

  it("unpicks an exclusive option like any other", () => {
    expect(toggleSelection(["agency"], "agency", EXCLUSIVE_TYPES)).toEqual([]);
  });

  it("does not mutate its input", () => {
    const before = Object.freeze(["a", "b"]);
    expect(toggleSelection(before, "c")).toEqual(["a", "b", "c"]);
    expect(before).toEqual(["a", "b"]);
  });
});

describe("makeMain", () => {
  it("moves the chosen pick to the front and keeps the rest in order", () => {
    expect(makeMain(["a", "b", "c", "d"], "c")).toEqual(["c", "a", "b", "d"]);
  });

  it("leaves the selection unchanged for the main one or an unpicked value", () => {
    expect(makeMain(["a", "b"], "a")).toEqual(["a", "b"]);
    expect(makeMain(["a", "b"], "z")).toEqual(["a", "b"]);
  });
});

describe("mainChangeMessage", () => {
  it("names the new main one", () => {
    expect(mainChangeMessage(["facebook"], ["instagram", "facebook"], channelLabel)).toBe("Instagram is now the main one.");
    expect(mainChangeMessage([], ["tiktok"], channelLabel)).toBe("TikTok is now the main one.");
  });

  it("says nothing when the main one did not change", () => {
    expect(mainChangeMessage(["instagram"], ["instagram", "facebook"], channelLabel)).toBe("");
  });

  it("says so when nothing is picked any more", () => {
    expect(mainChangeMessage(["instagram"], [], channelLabel)).toBe("Nothing picked.");
  });
});

describe("toAnswers", () => {
  it("maps main = first and others = the rest", () => {
    expect(
      toAnswers(
        drafts({
          types: ["walk_in", "shop"],
          goals: ["visits", "reviews", "awareness"],
          channels: ["instagram", "google_business"],
          customers: ["locals", "tourists"],
        }),
      ),
    ).toEqual({
      businessType: "walk_in",
      otherBusinessTypes: ["shop"],
      primaryGoal: "visits",
      otherGoals: ["reviews", "awareness"],
      postingChannels: ["instagram", "google_business"],
      customerGroups: ["locals", "tourists"],
    });
  });

  it("leaves out empty lists and blank notes", () => {
    expect(toAnswers(drafts())).toEqual({});
    expect(toAnswers(drafts({ notes: { ...EMPTY_NOTES, goal: "   " } }))).toEqual({});
  });

  it("uses the main type's default goal only when asked", () => {
    expect(toAnswers(drafts({ types: ["shop"] }))).toEqual({ businessType: "shop" });
    expect(toAnswers(drafts({ types: ["shop"] }), { defaultGoal: true })).toEqual({ businessType: "shop", primaryGoal: "sales" });
  });

  it("describes the client for an agency and drops the agency's own type note", () => {
    const agency = drafts({
      types: ["agency"],
      clientType: "trades",
      notes: { ...EMPTY_NOTES, businessType: "We are an agency", goal: "More calls" },
    });
    expect(answeredType(agency)).toBe("trades");
    expect(toAnswers(agency, { defaultGoal: true })).toEqual({
      businessType: "trades",
      primaryGoal: "bookings",
      firstRunNotes: { goal: "More calls" },
    });
    expect(toAnswers(drafts({ types: ["agency"] }), { defaultGoal: true })).toEqual({});
  });

  it("trims and bounds the owner's own words", () => {
    const long = "x".repeat(FIRST_RUN_NOTE_LIMITS.anythingElse + 50);
    const out = toAnswers(
      drafts({ notes: { ...EMPTY_NOTES, businessType: "  Dog   grooming van ", anythingElse: long } }),
    );
    expect(out.firstRunNotes?.businessType).toBe("Dog grooming van");
    expect(out.firstRunNotes?.anythingElse).toHaveLength(FIRST_RUN_NOTE_LIMITS.anythingElse);
  });

  it("agrees with the server clean-up", () => {
    const sent = toAnswers(
      drafts({ types: ["events", "professional"], goals: ["bookings"], channels: ["linkedin"], customers: ["businesses"] }),
    );
    expect(normalizeFirstRunAnswers(sent)).toEqual(sent);
  });

  it("round-trips stored answers", () => {
    const stored = {
      businessType: "shop" as const,
      otherBusinessTypes: ["online_shop" as const],
      primaryGoal: "sales" as const,
      otherGoals: ["online_orders" as const],
      postingChannels: ["instagram" as const],
      customerGroups: ["families" as const],
      firstRunNotes: { anythingElse: "Closed Mondays" },
    };
    expect(toAnswers(fromStored(stored))).toEqual(stored);
  });
});

describe("answer tiles", () => {
  it("come from the shared labels, one tile per option", () => {
    expect(BUSINESS_TYPE_OPTIONS.map((o) => o.value)).toEqual([...BUSINESS_TYPES]);
    expect(BUSINESS_TYPE_OPTIONS.find((o) => o.value === "trades")).toEqual({ value: "trades", ...BUSINESS_TYPE_LABELS.trades });
    expect(CLIENT_TYPE_OPTIONS.map((o) => o.value)).toEqual(BUSINESS_TYPES.filter((t) => t !== "agency"));
    expect(GOAL_OPTIONS.map((o) => o.value)).toEqual([...PRIMARY_GOALS]);
    expect(CHANNEL_OPTIONS.map((o) => o.value)).toEqual([...POSTING_CHANNELS]);
    expect(CUSTOMER_OPTIONS.map((o) => o.value)).toEqual([...CUSTOMER_GROUPS]);
  });
});

describe("foundDetails (truth rule)", () => {
  it("is empty when nothing came back", () => {
    expect(foundDetails(null, null)).toEqual({});
    expect(hasFoundDetails(foundDetails(null, null))).toBe(false);
  });

  it("keeps only fields a source returned and drops blanks", () => {
    const details = foundDetails(
      { businessDetails: { name: " Northside Coffee ", phone: "  ", email: "hi@northside.test" }, productsServices: [], socialChannels: [] },
      null,
    );
    expect(details).toEqual({ name: "Northside Coffee", email: "hi@northside.test" });
  });

  it("prefers the website's details and fills gaps from the listing", () => {
    expect(
      foundDetails(
        { businessDetails: { phone: "0117 000" } },
        { title: "Northside", phone: "0117 999", address: "1 High St", rating: 4.6, reviews: 12 },
      ),
    ).toEqual({ name: "Northside", phone: "0117 000", address: "1 High St", rating: 4.6, reviews: 12 });
  });
});
