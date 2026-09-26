/**
 * Big Five personality scores on a persona, with where they came from.
 *
 * Country blueprint rule: never present model-invented personality as fact.
 * A persona's Big Five scores are usually an AI guess about an imagined
 * customer, not a measurement. Every score therefore carries a source, the
 * UI labels AI scores as "AI guess, not measured", and prompts call them an
 * unverified AI hypothesis. A trait the model did not give stays missing; it
 * is never filled with a made-up middle value.
 *
 * Pure values and validators only, shared by the schema, the persona
 * functions, the AI prompts and the Understand page.
 */

import { v } from "convex/values";

export const BIG_FIVE_TRAITS = [
  "openness",
  "conscientiousness",
  "extraversion",
  "agreeableness",
  "neuroticism",
] as const;
export type BigFiveTrait = (typeof BIG_FIVE_TRAITS)[number];

/** Each trait 0-100 when known; a missing trait is unknown, not 50. */
export type BigFive = Partial<Record<BigFiveTrait, number>>;

export const bigFiveValidator = v.object({
  openness: v.optional(v.number()),
  conscientiousness: v.optional(v.number()),
  extraversion: v.optional(v.number()),
  agreeableness: v.optional(v.number()),
  neuroticism: v.optional(v.number()),
});

/**
 * - `ai_hypothesis`: the model guessed it (the default for old rows);
 * - `user_assessed`: the owner set the scores from their own knowledge;
 * - `customer_research`: measured with real customers (survey, interviews);
 * - `population_prior`: a published population average, not this customer.
 */
export const BIG_FIVE_SOURCES = [
  "ai_hypothesis",
  "user_assessed",
  "customer_research",
  "population_prior",
] as const;
export type BigFiveSource = (typeof BIG_FIVE_SOURCES)[number];

export const bigFiveSourceValidator = v.union(
  v.literal("ai_hypothesis"),
  v.literal("user_assessed"),
  v.literal("customer_research"),
  v.literal("population_prior"),
);

export const BIG_FIVE_TRAIT_LABELS: Record<BigFiveTrait, string> = {
  openness: "Openness",
  conscientiousness: "Conscientiousness",
  extraversion: "Extraversion",
  agreeableness: "Agreeableness",
  neuroticism: "Emotional sensitivity",
};

/** Plain-words label for the owner. */
export const BIG_FIVE_SOURCE_LABELS: Record<BigFiveSource, string> = {
  ai_hypothesis: "AI guess, not measured",
  user_assessed: "Your own estimate",
  customer_research: "From customer research",
  population_prior: "General population average",
};

/** Rows saved before the source existed were all AI output. */
export function bigFiveSourceOf(persona: { bigFiveSource?: BigFiveSource }): BigFiveSource {
  return persona.bigFiveSource ?? "ai_hypothesis";
}

/**
 * Keep only real numbers, clamped to 0-100 and rounded. Returns undefined
 * when no trait is known, so an empty object is never stored.
 */
export function cleanBigFive(raw: unknown): BigFive | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const source = raw as Record<string, unknown>;
  const out: BigFive = {};
  for (const trait of BIG_FIVE_TRAITS) {
    const value = source[trait];
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    out[trait] = Math.round(Math.max(0, Math.min(100, value)));
  }
  return Object.keys(out).length ? out : undefined;
}

/** The known traits as "Openness 70, Extraversion 40". */
export function describeBigFive(bigFive: BigFive): string {
  return BIG_FIVE_TRAITS.filter((trait) => bigFive[trait] !== undefined)
    .map((trait) => `${BIG_FIVE_TRAIT_LABELS[trait]} ${bigFive[trait]}`)
    .join(", ");
}

/** The line an AI prompt gets. AI scores are called what they are. */
export function bigFivePromptLine(
  bigFive: BigFive | undefined,
  source: BigFiveSource | undefined,
): string {
  const known = bigFive ? cleanBigFive(bigFive) : undefined;
  if (!known) return "";
  const effective = source ?? "ai_hypothesis";
  const label =
    effective === "ai_hypothesis"
      ? "unverified AI hypothesis, not measured; do not treat as fact"
      : effective === "user_assessed"
        ? "the owner's own estimate, not measured"
        : effective === "customer_research"
          ? "from the owner's customer research"
          : "general population average, not this customer";
  return `Big Five (0-100, non-clinical; ${label}): ${JSON.stringify(known)}`;
}
