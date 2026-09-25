/**
 * Starter kit — the shared vocabulary for the first run
 * (docs/ux/first-run-blueprint.md §2 and §4).
 *
 * Pure values and validators only (no database access), so the schema, the
 * wizard, the kit job and the unit tests read the same lists.
 */

import { v, type Infer } from "convex/values";

/** Q1 "What kind of business is it?" (blueprint §2, strategy §3). */
export const BUSINESS_TYPES = ["appointments", "shop", "walk_in", "agency"] as const;
export type BusinessType = (typeof BUSINESS_TYPES)[number];

/** Q3 "What do you want most right now?" */
export const PRIMARY_GOALS = ["bookings", "sales", "visits", "awareness"] as const;
export type PrimaryGoal = (typeof PRIMARY_GOALS)[number];

export const businessTypeValidator = v.union(
  v.literal("appointments"),
  v.literal("shop"),
  v.literal("walk_in"),
  v.literal("agency"),
);

export const primaryGoalValidator = v.union(
  v.literal("bookings"),
  v.literal("sales"),
  v.literal("visits"),
  v.literal("awareness"),
);

/**
 * Skipping Q3 picks the default for the type (blueprint §3). An agency's goal
 * is chosen per client project, so it has no default of its own.
 */
export function defaultGoalFor(type: BusinessType | undefined): PrimaryGoal | undefined {
  switch (type) {
    case "appointments":
      return "bookings";
    case "shop":
      return "sales";
    case "walk_in":
      return "visits";
    default:
      return undefined;
  }
}

/** The standard job states (AGENTS.md rule 13). */
export const STARTER_KIT_STATUSES = [
  "queued",
  "running",
  "waiting_for_user",
  "succeeded",
  "partially_succeeded",
  "failed",
  "canceled",
] as const;
export type StarterKitStatus = (typeof STARTER_KIT_STATUSES)[number];

export const starterKitStatusValidator = v.union(
  v.literal("queued"),
  v.literal("running"),
  v.literal("waiting_for_user"),
  v.literal("succeeded"),
  v.literal("partially_succeeded"),
  v.literal("failed"),
  v.literal("canceled"),
);

/**
 * A part never waits for the user on its own: the kit does. `locked` is not
 * stored; the UI derives it from the caller's capabilities.
 */
export const STARTER_KIT_PART_STATUSES = [
  "queued",
  "running",
  "succeeded",
  "partially_succeeded",
  "failed",
  "canceled",
] as const;
export type StarterKitPartStatus = (typeof STARTER_KIT_PART_STATUSES)[number];

export const STARTER_KIT_PARTS = ["plan", "site", "posts"] as const;
export type StarterKitPartName = (typeof STARTER_KIT_PARTS)[number];

/**
 * What a part produced, as canonical references (docs/pack/08 module
 * contracts): the table the draft lives in and its id. None of these rows is
 * ever written as published, scheduled or sent by the kit (AGENTS.md rule 5).
 */
export const starterKitOutputValidator = v.object({
  type: v.union(
    v.literal("contentPieces"),
    v.literal("posts"),
    v.literal("builds"),
    v.literal("sites"),
    v.literal("cmsPages"),
    v.literal("cmsAssets"),
    v.literal("projectFiles"),
  ),
  id: v.string(),
});
export type StarterKitOutput = Infer<typeof starterKitOutputValidator>;

export const starterKitPartValidator = v.object({
  status: v.union(
    v.literal("queued"),
    v.literal("running"),
    v.literal("succeeded"),
    v.literal("partially_succeeded"),
    v.literal("failed"),
    v.literal("canceled"),
  ),
  // The real step the server job is on ("Reading your website"). Written
  // only by the job, so the UI never shows a fake timer.
  step: v.optional(v.string()),
  // Plain-language outcome or named gap ("3 of 7 posts have pictures").
  message: v.optional(v.string()),
  // Machine-readable failure reason (e.g. "ai_budget", "rate_limited").
  errorCode: v.optional(v.string()),
  outputs: v.array(starterKitOutputValidator),
  attempts: v.number(),
  updatedAt: v.number(),
});
export type StarterKitPart = Infer<typeof starterKitPartValidator>;

export function emptyStarterKitPart(now: number): StarterKitPart {
  return { status: "queued", outputs: [], attempts: 0, updatedAt: now };
}
