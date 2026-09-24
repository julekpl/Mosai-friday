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

/** The fields of a project that feed the brief (subset of `Doc<"projects">`). */
export type BusinessBriefSource = {
  name: string;
  businessName?: string;
  industry?: string;
  description?: string;
  productsServices?: string[];
  goals?: string[];
  targetAudience?: string[];
  customerPains?: string[];
  serviceArea?: string;
  businessProfile?: StoredBusinessProfile;
};

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
  const segments = [
    ...(profile?.customerSegments ?? []),
    ...(source.targetAudience ?? []),
  ];
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
    segments.length ? `Customers (the audience): ${[...new Set(segments)].join("; ")}` : "Customers (the audience): not stated — infer the people or organisations who would pay for the offerings above",
    `Not the audience: ${[...new Set(notAudience)].join("; ")}`,
    list([...(profile?.customerProblems ?? []), ...(source.customerPains ?? [])])
      ? `Customer problems this business solves: ${list([...new Set([...(profile?.customerProblems ?? []), ...(source.customerPains ?? [])])])}`
      : "",
    list([...(profile?.primaryGoals ?? []), ...(source.goals ?? [])])
      ? `Business goals: ${list([...new Set([...(profile?.primaryGoals ?? []), ...(source.goals ?? [])])])}`
      : "",
    profile?.market || source.serviceArea ? `Market served: ${profile?.market ?? source.serviceArea}` : "",
    list(profile?.differentiators) ? `Why customers choose it: ${list(profile?.differentiators)}` : "",
    list(profile?.contentThemes) ? `Subject-matter themes customers care about: ${list(profile?.contentThemes)}` : "",
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
].join("\n");
