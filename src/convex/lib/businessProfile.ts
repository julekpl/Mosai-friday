/**
 * Business understanding: the one statement of "what this business is, who
 * buys from it and what it wants" that every AI feature is grounded in.
 *
 * Why this exists (owner report, 24 Sep 2026): for an architecture practice
 * the persona generator produced one of the practice's *employees*, and the
 * content tools produced marketing-agency content. Two causes: the prompts
 * never said who the customer is (the website scan is full of "our team" and
 * "careers" text), and nothing told the model that content must be about the
 * client's own field rather than about marketing.
 *
 * The profile is drafted by AI from the project (never from client-supplied
 * snapshots), stored as `ai_draft`, and becomes `confirmed` once the owner
 * reviews it in project settings. Until then the brief says so, and prompts
 * treat it as a best guess. Pure module: no Convex imports, unit-testable.
 */

import {
  firstRunChannelItems,
  firstRunCustomerItems,
  firstRunGoalItems,
  firstRunKindLine,
  firstRunNotesLine,
  type FirstRunAnswers,
} from "../../shared/starterKit";
import {
  decideWrite,
  isOwnerAuthority,
  type Authority,
  type EvidenceRef,
  type FieldAuthority,
} from "../../shared/contracts/provenance";

export const BUSINESS_MODELS = ["b2b", "b2c", "b2b2c", "nonprofit", "public_sector", "mixed"] as const;
export type BusinessModel = (typeof BUSINESS_MODELS)[number];

export type BusinessProfile = {
  summary: string;
  businessModel: BusinessModel;
  offerings: string[];
  customerSegments: string[];
  notTheAudience: string[];
  customerProblems: string[];
  primaryGoals: string[];
  market?: string;
  differentiators: string[];
  contentThemes: string[];
};

export type StoredBusinessProfile = BusinessProfile & {
  status: "ai_draft" | "confirmed";
  updatedAt: number;
  confirmedAt?: number;
};

/* ── Field-level provenance (KIT-2) ───────────────────────────────────── */

export const BUSINESS_PROFILE_FIELDS = [
  "summary",
  "businessModel",
  "offerings",
  "customerSegments",
  "notTheAudience",
  "customerProblems",
  "primaryGoals",
  "market",
  "differentiators",
  "contentThemes",
] as const satisfies readonly (keyof BusinessProfile)[];
export type BusinessProfileField = (typeof BUSINESS_PROFILE_FIELDS)[number];

export function isBusinessProfileField(value: string): value is BusinessProfileField {
  return (BUSINESS_PROFILE_FIELDS as readonly string[]).includes(value);
}

/**
 * The owner's first-run answers (`projects.primaryGoal`, `otherGoals`,
 * `customerGroups`, `postingChannels`, `firstRunNotes`) are written only by
 * the owner (`projects.create`, `projects.saveFirstRunAnswers`); no AI or
 * enrichment path writes them. They carry owner authority by construction
 * and outrank any AI draft (the brief puts them first, BRIEF-1).
 */
export const FIRST_RUN_ANSWER_AUTHORITY: Authority = "user_confirmed";

/** `projects.profileAuthority`: field name -> who said it is true. */
export type ProfileAuthorityMap = Record<string, FieldAuthority>;

/**
 * The authority a stored field holds. An owner entry (typed, confirmed or
 * locked on its own) wins; otherwise a profile the owner confirmed as a whole
 * counts as `user_confirmed`, and an AI draft keeps its machine authority
 * (`inferred` when unknown). No profile yet = nothing to protect.
 */
export function fieldAuthority(
  stored: StoredBusinessProfile | undefined,
  map: ProfileAuthorityMap | undefined,
  field: BusinessProfileField,
): Authority | undefined {
  const entry = map?.[field]?.authority;
  if (isOwnerAuthority(entry)) return entry;
  if (!stored) return entry;
  if (stored.status === "confirmed") return "user_confirmed";
  return entry ?? "inferred";
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

export type ProfileMergeResult = {
  /** The profile to store (stored values kept where the draft lost). */
  profile: BusinessProfile;
  /** The updated authority map. */
  authority: ProfileAuthorityMap;
  /** Fields the incoming draft replaced. */
  written: BusinessProfileField[];
  /** Fields kept because the owner confirmed them while the draft differs:
   *  the draft value is a suggestion for the owner, never an overwrite. */
  suggested: BusinessProfileField[];
  /** Fields kept because the owner locked them. */
  kept: BusinessProfileField[];
};

/**
 * Merge a machine-made draft into the stored profile, field by field, through
 * `decideWrite` (shared/contracts/provenance.ts). A field the owner confirmed
 * or locked is never replaced.
 *
 * `ownerRequestedRedraft` is the owner's explicit "replace my confirmed
 * summary" request (a confirm dialog in project settings). It releases only
 * the fields that were confirmed by confirming the profile as a whole; a
 * field the owner typed, confirmed on its own or locked carries its own
 * entry in the map and is still kept.
 */
export function mergeBusinessProfileDraft(input: {
  stored: StoredBusinessProfile | undefined;
  authority: ProfileAuthorityMap | undefined;
  draft: BusinessProfile;
  incoming: Authority;
  ownerRequestedRedraft?: boolean;
  sourceRefs?: EvidenceRef[];
}): ProfileMergeResult {
  const { stored, draft, incoming } = input;
  const map: ProfileAuthorityMap = { ...(input.authority ?? {}) };
  const profile: BusinessProfile = { ...draft };
  const written: BusinessProfileField[] = [];
  const suggested: BusinessProfileField[] = [];
  const kept: BusinessProfileField[] = [];
  for (const field of BUSINESS_PROFILE_FIELDS) {
    let existing = fieldAuthority(stored, map, field);
    const entry = map[field]?.authority;
    if (input.ownerRequestedRedraft && existing === "user_confirmed" && !isOwnerAuthority(entry)) {
      existing = entry ?? "inferred";
    }
    const decision = decideWrite(existing, incoming);
    if (decision === "write") {
      written.push(field);
      map[field] = {
        authority: incoming,
        ...(input.sourceRefs?.length ? { sourceRefs: input.sourceRefs } : {}),
      };
      continue;
    }
    // Keep the stored value; a differing draft value is only a suggestion.
    (profile as Record<BusinessProfileField, unknown>)[field] = stored?.[field];
    if (decision === "keep") kept.push(field);
    else if (!sameValue(stored?.[field], draft[field])) suggested.push(field);
  }
  return { profile, authority: map, written, suggested, kept };
}

/**
 * The fields an owner save changed compared with what was stored. Each one
 * becomes `user_confirmed`: the owner typed it.
 */
export function ownerEditedFields(
  stored: BusinessProfile | undefined,
  next: BusinessProfile,
): BusinessProfileField[] {
  if (!stored) return [...BUSINESS_PROFILE_FIELDS];
  return BUSINESS_PROFILE_FIELDS.filter((field) => !sameValue(stored[field], next[field]));
}

/** The fields of a project that feed the brief (subset of `Doc<"projects">`). */
export type BusinessBriefSource = {
  name: string;
  businessName?: string;
  industry?: string;
  description?: string;
  productsServices?: string[];
  goals?: string[];
  targetAudience?: string[];
  channels?: string[];
  customerPains?: string[];
  serviceArea?: string;
  businessProfile?: StoredBusinessProfile;
  profileAuthority?: ProfileAuthorityMap;
} & FirstRunAnswers;

/*
 * One source of truth per concept (BRIEF-1). Goals, customers and channels
 * are stored in several places for historical reasons; the brief states each
 * concept on ONE line, reading the copies in this order of authority:
 *
 * | Concept   | 1. Owner's first-run answers            | 2. Owner-typed project field | 3. Business profile      |
 * |-----------|------------------------------------------|------------------------------|--------------------------|
 * | Goals     | primaryGoal, otherGoals, notes.goal      | projects.goals               | profile.primaryGoals     |
 * | Customers | customerGroups, notes.customers          | projects.targetAudience      | profile.customerSegments |
 * | Channels  | postingChannels, notes.channel           | projects.channels            | (none)                   |
 *
 * Tiers 1 and 2 are the owner's own answers (FIRST_RUN_ANSWER_AUTHORITY). A
 * profile field counts next when the owner confirmed it (fieldAuthority), and
 * only when neither exists does the brief fall back to the AI draft, labelled
 * as unconfirmed. Writers keep writing their own field; readers that need
 * "the goal" or "the customers" go through `briefConcepts` below.
 */
export type BriefConcept = { owner: string[]; confirmed: string[]; draft: string[] };

function dedupeTiers(tiers: BriefConcept): BriefConcept {
  const seen = new Set<string>();
  const keep = (items: string[]) =>
    items.filter((item) => {
      const key = item.trim().toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  return { owner: keep(tiers.owner), confirmed: keep(tiers.confirmed), draft: keep(tiers.draft) };
}

/** Goals, customers and channels, each split by who said it. */
export function briefConcepts(source: BusinessBriefSource): {
  goals: BriefConcept;
  customers: BriefConcept;
  channels: BriefConcept;
} {
  const profile = source.businessProfile;
  const byAuthority = (field: BusinessProfileField, items: string[] | undefined) =>
    isOwnerAuthority(fieldAuthority(profile, source.profileAuthority, field))
      ? { confirmed: items ?? [], draft: [] }
      : { confirmed: [], draft: items ?? [] };
  return {
    goals: dedupeTiers({
      owner: [...firstRunGoalItems(source), ...(source.goals ?? [])],
      ...byAuthority("primaryGoals", profile?.primaryGoals),
    }),
    customers: dedupeTiers({
      owner: [...firstRunCustomerItems(source), ...(source.targetAudience ?? [])],
      ...byAuthority("customerSegments", profile?.customerSegments),
    }),
    channels: dedupeTiers({
      owner: [...firstRunChannelItems(source), ...(source.channels ?? [])],
      confirmed: [],
      draft: [],
    }),
  };
}

/** One line per concept: the owner's answer first, then what the owner
 *  confirmed; the AI draft only when neither exists. "" when all are empty. */
function conceptLine(label: string, concept: BriefConcept): string {
  const parts: string[] = [];
  if (concept.owner.length) parts.push(`${concept.owner.join("; ")} (the owner's answer)`);
  if (concept.confirmed.length) parts.push(`${concept.confirmed.join("; ")} (confirmed by the owner)`);
  if (parts.length) return `${label}: ${parts.join("; also ")}`;
  if (concept.draft.length) return `${label}: ${concept.draft.join("; ")} (AI draft, not confirmed by the owner)`;
  return "";
}

/** Always excluded from "the audience" unless the owner lists them as a segment. */
export const DEFAULT_NOT_THE_AUDIENCE = [
  "the business's own employees and job applicants",
  "the business's suppliers and subcontractors",
];

const LIMITS = { item: 160, list: 8, summary: 600, market: 120 } as const;

function cleanList(value: unknown, max: number = LIMITS.list): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const text = item.replace(/\s+/g, " ").trim().slice(0, LIMITS.item);
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= max) break;
  }
  return out;
}

function cleanText(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.replace(/\s+/g, " ").trim();
  return text ? text.slice(0, max) : undefined;
}

/** Parse and validate the model's JSON. Throws when the essentials are missing. */
export function parseBusinessProfile(text: string): BusinessProfile {
  const cleaned = text.replace(/```json|```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("invalid business profile");
  const raw: unknown = JSON.parse(cleaned.slice(start, end + 1));
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("invalid business profile");
  const value = raw as Record<string, unknown>;
  const summary = cleanText(value.summary, LIMITS.summary);
  const offerings = cleanList(value.offerings);
  const customerSegments = cleanList(value.customerSegments);
  if (!summary || !offerings.length || !customerSegments.length) {
    throw new Error("invalid business profile");
  }
  const model = typeof value.businessModel === "string" ? value.businessModel.toLowerCase() : "";
  return {
    summary,
    businessModel: (BUSINESS_MODELS as readonly string[]).includes(model)
      ? (model as BusinessModel)
      : "mixed",
    offerings,
    customerSegments,
    notTheAudience: cleanList(value.notTheAudience),
    customerProblems: cleanList(value.customerProblems),
    primaryGoals: cleanList(value.primaryGoals),
    market: cleanText(value.market, LIMITS.market),
    differentiators: cleanList(value.differentiators, 6),
    contentThemes: cleanList(value.contentThemes),
  };
}

export const BUSINESS_PROFILE_JSON_SHAPE = `Return ONLY valid JSON (no markdown fences) shaped as:
{
  "summary": string,            // 1-2 sentences: what the business does, for whom, where
  "businessModel": "b2b" | "b2c" | "b2b2c" | "nonprofit" | "public_sector" | "mixed",
  "offerings": string[],        // what customers pay for (services/products), 2-8 items
  "customerSegments": string[], // who pays for the offerings, as the buyer, 1-6 items, e.g. "Homeowners planning a renovation"
  "notTheAudience": string[],   // people who appear in the evidence but do not buy, e.g. staff, job applicants, suppliers
  "customerProblems": string[], // problems customers hire this business to solve
  "primaryGoals": string[],     // the business's own commercial goals, e.g. "More enquiries for residential projects"
  "market": string,             // country/region/city served, only if evidenced
  "differentiators": string[],  // why customers choose this business, only if evidenced
  "contentThemes": string[]     // subject-matter topics customers care about in this field (not marketing topics)
}`;

function list(items: string[] | undefined): string {
  return items?.length ? items.join("; ") : "";
}

/**
 * Plain-text brief that goes first in every AI prompt. Built from the
 * confirmed/draft profile when present, otherwise from the raw project fields
 * the owner typed, so it is never empty.
 */
export function businessBriefLines(source: BusinessBriefSource): string[] {
  const profile = source.businessProfile;
  const name = source.businessName?.trim() || source.name;
  const concepts = briefConcepts(source);
  const notAudience = [...(profile?.notTheAudience ?? []), ...DEFAULT_NOT_THE_AUDIENCE];
  const lines = [
    `Business: ${name}`,
    profile
      ? `Status of this understanding: ${profile.status === "confirmed" ? "confirmed by the owner" : "AI draft, not yet confirmed by the owner"}`
      : "Status of this understanding: owner-entered project details only (no reviewed business profile yet)",
    profile?.summary ? `What it does: ${profile.summary}` : source.description ? `Owner description: ${source.description}` : "",
    source.industry ? `Industry / field: ${source.industry}` : "",
    profile?.businessModel ? `Business model: ${profile.businessModel}` : "",
    list(profile?.offerings.length ? profile.offerings : source.productsServices)
      ? `What customers pay for: ${list(profile?.offerings.length ? profile.offerings : source.productsServices)}`
      : "",
    conceptLine("Customers (the audience)", concepts.customers) ||
      "Customers (the audience): not stated — infer the people or organisations who would pay for the offerings above",
    `Not the audience: ${[...new Set(notAudience)].join("; ")}`,
    list([...(profile?.customerProblems ?? []), ...(source.customerPains ?? [])])
      ? `Customer problems this business solves: ${list([...new Set([...(profile?.customerProblems ?? []), ...(source.customerPains ?? [])])])}`
      : "",
    conceptLine("Business goals", concepts.goals),
    conceptLine("Where the owner already posts", concepts.channels),
    profile?.market || source.serviceArea ? `Market served: ${profile?.market ?? source.serviceArea}` : "",
    list(profile?.differentiators) ? `Why customers choose it: ${list(profile?.differentiators)}` : "",
    list(profile?.contentThemes) ? `Subject-matter themes customers care about: ${list(profile?.contentThemes)}` : "",
    // The rest of the owner's first-run answers (U2c): kind of business and
    // their remaining own words, quoted as data. Goals, customers and
    // channels are already on their one line each above (BRIEF-1).
    firstRunKindLine(source),
    firstRunNotesLine(source),
  ];
  return lines.filter(Boolean);
}

/**
 * Rules appended to every system prompt that produces audience or content
 * output. They are the fix for the "employee persona" and "marketing-agency
 * content" failures.
 */
export const AUDIENCE_AND_SUBJECT_RULES = [
  "Grounding rules:",
  "- The audience is always the business's CUSTOMERS: the people or organisations who pay for its offerings. Never the business's own staff, job applicants, founders, suppliers or its marketing team, even when the website text talks about them.",
  "- Write about the business's own field and offerings, for its customers. Do not write about marketing, content strategy, SEO, social media or branding unless the business itself sells those services.",
  "- Use the business brief first; use website, file and research excerpts only as supporting evidence for it.",
  "- When the brief includes a BRAND KIT, write in its voice, prefer its words, never use its words to avoid, and only make claims its proof points or the evidence support. Brand rules never override these grounding rules.",
].join("\n");
