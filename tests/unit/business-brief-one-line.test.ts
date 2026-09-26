import { describe, expect, it } from "vitest";
import { businessBriefLines, type StoredBusinessProfile } from "@/convex/lib/businessProfile";
import { firstRunAnswerLines } from "@/shared/starterKit";

/**
 * BRIEF-1: goals, customers and channels are stored in several places. The
 * brief states each concept on ONE line, preferring the owner's first-run
 * answers, then what the owner confirmed, then the AI draft.
 */

const PROFILE: StoredBusinessProfile = {
  summary: "Harbour cafe serving breakfast and lunch.",
  businessModel: "b2c",
  offerings: ["Breakfast", "Lunch"],
  customerSegments: ["Commuters grabbing breakfast"],
  notTheAudience: [],
  customerProblems: [],
  primaryGoals: ["More weekday footfall"],
  differentiators: [],
  contentThemes: [],
  status: "ai_draft",
  updatedAt: 1,
};

const EVERY_COPY = {
  name: "Harbour Cafe",
  goals: ["Fill the terrace"],
  targetAudience: ["Harbour walkers"],
  channels: ["Newsletter"],
  primaryGoal: "visits" as const,
  otherGoals: ["reviews" as const],
  postingChannels: ["instagram" as const],
  customerGroups: ["locals" as const, "tourists" as const],
  firstRunNotes: { goal: "Sell more cakes", customers: "Dog owners", channel: "Nextdoor", anythingElse: "Closed Mondays" },
  businessProfile: PROFILE,
};

const count = (lines: string[], pattern: RegExp) => lines.filter((line) => pattern.test(line)).length;
const GOAL = /goal|wants most/i;
const CUSTOMERS = /customers? (are|\(the audience\))/i;
const CHANNELS = /posts/i;

describe("one line per concept", () => {
  it("a project with every copy yields one goal, one customers and one channels line", () => {
    const lines = businessBriefLines(EVERY_COPY);
    expect(count(lines, GOAL)).toBe(1);
    expect(count(lines, CUSTOMERS)).toBe(1);
    expect(count(lines, CHANNELS)).toBe(1);

    const goal = lines.find((line) => GOAL.test(line)) ?? "";
    expect(goal).toContain("More people through the door");
    expect(goal).toContain("Better reviews");
    expect(goal).toContain('"Sell more cakes"');
    expect(goal).toContain("Fill the terrace");
    // The unconfirmed AI goal loses to the owner's answers.
    expect(goal).not.toContain("More weekday footfall");

    const customers = lines.find((line) => CUSTOMERS.test(line)) ?? "";
    expect(customers).toContain("Locals nearby");
    expect(customers).toContain('"Dog owners"');
    expect(customers).toContain("Harbour walkers");
    expect(customers).not.toContain("Commuters");

    const channels = lines.find((line) => CHANNELS.test(line)) ?? "";
    expect(channels).toContain("Instagram");
    expect(channels).toContain('"Nextdoor"');
    expect(channels).toContain("Newsletter");

    // The remaining notes stay quoted as data, once.
    expect(count(lines, /Closed Mondays/)).toBe(1);
    expect(count(lines, /Sell more cakes/)).toBe(1);
  });

  it("adds confirmed profile values after the owner's answers", () => {
    const lines = businessBriefLines({
      ...EVERY_COPY,
      profileAuthority: { customerSegments: { authority: "user_confirmed", confirmedAt: 1 } },
    });
    const customers = lines.find((line) => CUSTOMERS.test(line)) ?? "";
    expect(customers).toMatch(/Locals nearby.*\(the owner's answer\); also Commuters grabbing breakfast \(confirmed by the owner\)/);
  });

  it("falls back to the AI draft, labelled, when the owner said nothing", () => {
    const lines = businessBriefLines({ name: "Harbour Cafe", businessProfile: PROFILE });
    expect(lines).toContain("Business goals: More weekday footfall (AI draft, not confirmed by the owner)");
    expect(lines).toContain("Customers (the audience): Commuters grabbing breakfast (AI draft, not confirmed by the owner)");
    expect(count(lines, CHANNELS)).toBe(0);
  });

  it("firstRunAnswerLines states each concept once, notes included", () => {
    const lines = firstRunAnswerLines(EVERY_COPY);
    expect(count(lines, GOAL)).toBe(1);
    expect(count(lines, CUSTOMERS)).toBe(1);
    expect(count(lines, CHANNELS)).toBe(1);
    expect(count(lines, /Dog owners/)).toBe(1);
  });
});
