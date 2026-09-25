/**
 * Brand kit: the one statement of how the business sounds, what it says and
 * how it looks. Every AI feature reads it through the ContextPack (as lines
 * appended to the business brief), so content, social posts, the website and
 * app builders and product copy all speak with one voice.
 *
 * Built from established practice (sources in docs/brand-system.md):
 * - Positioning after April Dunford: competitive alternatives, unique value,
 *   target customers, market category.
 * - Messaging house: one brand promise (roof), 2-4 key messages (pillars),
 *   proof points under each (foundation). AI may only claim listed proof.
 * - Voice on the four Nielsen Norman Group tone dimensions (formality, humour,
 *   respectfulness, enthusiasm). Voice stays constant; tone adapts to the
 *   channel and the reader's situation (Mailchimp content style guide).
 * - Visual identity as design tokens in the W3C DTCG 2025.10 format, with
 *   WCAG 2.2 contrast checks on the colour pairs a site will actually use.
 *
 * Lifecycle mirrors the business profile: AI drafts it on the server
 * (`ai_draft`), the owner edits and confirms it (`confirmed`); a confirmed kit
 * is never overwritten by AI without an explicit owner request. Pure module:
 * no Convex imports, unit-testable.
 */

export const VOICE_DIMENSIONS = ["formality", "humor", "respect", "enthusiasm"] as const;
export type VoiceDimension = (typeof VOICE_DIMENSIONS)[number];
/** 1..5 on each NN/g dimension. 1 = formal / serious / respectful / matter-of-fact;
 *  5 = casual / funny / irreverent / enthusiastic. */
export type VoiceScale = Record<VoiceDimension, number>;

export const VOICE_LABELS: Record<VoiceDimension, { low: string; high: string }> = {
  formality: { low: "Formal", high: "Casual" },
  humor: { low: "Serious", high: "Playful" },
  respect: { low: "Respectful", high: "Irreverent" },
  enthusiasm: { low: "Matter-of-fact", high: "Enthusiastic" },
};

export const SHAPES = ["sharp", "soft", "round"] as const;
export type BrandShape = (typeof SHAPES)[number];

export const COLOR_ROLES = ["primary", "secondary", "accent", "dark", "light"] as const;
export type ColorRole = (typeof COLOR_ROLES)[number];
export type BrandColors = Partial<Record<ColorRole, string>>;

export type MessagePillar = {
  title: string;
  message: string;
  proofPoints: string[];
};

export type BrandProfile = {
  // Positioning and messaging
  positioning: string;
  category?: string;
  alternatives: string[];
  promise: string;
  tagline?: string;
  elevatorPitch?: string;
  pillars: MessagePillar[];
  // Personality and voice
  personality: string[];
  voice: VoiceScale;
  writeLike: string[];
  neverLike: string[];
  preferredWords: string[];
  avoidWords: string[];
  language?: string;
  // Visual identity
  colors: BrandColors;
  headingFont?: string;
  bodyFont?: string;
  imageryStyle: string[];
  shape?: BrandShape;
  logoNotes?: string;
};

export type StoredBrandProfile = BrandProfile & {
  status: "ai_draft" | "confirmed";
  updatedAt: number;
  confirmedAt?: number;
};

export const BRAND_LIMITS = {
  item: 160,
  list: 8,
  sentence: 400,
  pitch: 600,
  short: 120,
  pillars: 4,
  proof: 4,
} as const;

export const DEFAULT_VOICE: VoiceScale = { formality: 3, humor: 2, respect: 2, enthusiasm: 3 };

/** Phrases that read as generic AI or agency filler in any brand. The voice
 *  check always flags them; the owner's own avoid-list is added on top. */
export const GENERIC_FILLER = [
  "in today's fast-paced world",
  "unlock the power",
  "unlock your potential",
  "take it to the next level",
  "game-changer",
  "game changer",
  "cutting-edge",
  "best-in-class",
  "world-class",
  "synergy",
  "seamless experience",
  "elevate your",
  "delve into",
  "look no further",
  "revolutionize",
  "revolutionise",
] as const;

/* ── Cleaning ─────────────────────────────────────────────────────────── */

export function cleanBrandText(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.replace(/\s+/g, " ").trim();
  return text ? text.slice(0, max) : undefined;
}

export function cleanBrandList(value: unknown, max: number = BRAND_LIMITS.list, itemMax: number = BRAND_LIMITS.item): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    const text = cleanBrandText(item, itemMax);
    if (!text || seen.has(text.toLowerCase())) continue;
    seen.add(text.toLowerCase());
    out.push(text);
    if (out.length >= max) break;
  }
  return out;
}

/** `#rrggbb` (lower-case) or undefined. `#rgb` is expanded. Anything else is
 *  refused, so a stored colour can be placed in CSS without escaping. */
export function normalizeHex(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const raw = value.trim().toLowerCase();
  const short = /^#?([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(raw);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  const long = /^#?([0-9a-f]{6})$/.exec(raw);
  return long ? `#${long[1]}` : undefined;
}

/** Font family names only: letters, digits, spaces and hyphens. */
export function normalizeFont(value: unknown): string | undefined {
  const text = cleanBrandText(value, 60);
  return text && /^[\p{L}\p{N} -]+$/u.test(text) ? text : undefined;
}

function clampScale(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(5, Math.max(1, Math.round(n)));
}

export function cleanVoice(value: unknown): VoiceScale {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    formality: clampScale(raw.formality, DEFAULT_VOICE.formality),
    humor: clampScale(raw.humor, DEFAULT_VOICE.humor),
    respect: clampScale(raw.respect, DEFAULT_VOICE.respect),
    enthusiasm: clampScale(raw.enthusiasm, DEFAULT_VOICE.enthusiasm),
  };
}

export function cleanColors(value: unknown): BrandColors {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const out: BrandColors = {};
  for (const role of COLOR_ROLES) {
    const hex = normalizeHex(raw[role]);
    if (hex) out[role] = hex;
  }
  return out;
}

function cleanPillars(value: unknown): MessagePillar[] {
  if (!Array.isArray(value)) return [];
  const out: MessagePillar[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const raw = item as Record<string, unknown>;
    const title = cleanBrandText(raw.title, BRAND_LIMITS.short);
    const message = cleanBrandText(raw.message, BRAND_LIMITS.sentence);
    if (!title || !message) continue;
    out.push({ title, message, proofPoints: cleanBrandList(raw.proofPoints, BRAND_LIMITS.proof) });
    if (out.length >= BRAND_LIMITS.pillars) break;
  }
  return out;
}

/** Bound and normalise any brand input (AI output or owner form). Never throws. */
export function boundBrandProfile(value: unknown): BrandProfile {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const shape = typeof raw.shape === "string" && (SHAPES as readonly string[]).includes(raw.shape)
    ? (raw.shape as BrandShape)
    : undefined;
  return {
    positioning: cleanBrandText(raw.positioning, BRAND_LIMITS.sentence) ?? "",
    category: cleanBrandText(raw.category, BRAND_LIMITS.short),
    alternatives: cleanBrandList(raw.alternatives, 6),
    promise: cleanBrandText(raw.promise, BRAND_LIMITS.sentence) ?? "",
    tagline: cleanBrandText(raw.tagline, BRAND_LIMITS.short),
    elevatorPitch: cleanBrandText(raw.elevatorPitch, BRAND_LIMITS.pitch),
    pillars: cleanPillars(raw.pillars),
    personality: cleanBrandList(raw.personality, 5, 40),
    voice: cleanVoice(raw.voice),
    writeLike: cleanBrandList(raw.writeLike, 6),
    neverLike: cleanBrandList(raw.neverLike, 6),
    preferredWords: cleanBrandList(raw.preferredWords, 12, 60),
    avoidWords: cleanBrandList(raw.avoidWords, 12, 60),
    language: cleanBrandText(raw.language, 40),
    colors: cleanColors(raw.colors),
    headingFont: normalizeFont(raw.headingFont),
    bodyFont: normalizeFont(raw.bodyFont),
    imageryStyle: cleanBrandList(raw.imageryStyle, 5),
    shape,
    logoNotes: cleanBrandText(raw.logoNotes, BRAND_LIMITS.sentence),
  };
}

/** A kit is usable once it states a promise and at least one key message. */
export function brandProfileProblems(profile: BrandProfile): string[] {
  const problems: string[] = [];
  if (!profile.promise) problems.push("Add the brand promise (the one thing you always deliver).");
  if (!profile.pillars.length) problems.push("Add at least one key message.");
  return problems;
}

/** Parse and validate the model's JSON. Throws when the essentials are missing. */
export function parseBrandProfile(text: string): BrandProfile {
  const cleaned = text.replace(/```json|```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("invalid brand profile");
  const raw: unknown = JSON.parse(cleaned.slice(start, end + 1));
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("invalid brand profile");
  const profile = boundBrandProfile(raw);
  if (brandProfileProblems(profile).length || !profile.positioning) throw new Error("invalid brand profile");
  return profile;
}

export const BRAND_PROFILE_JSON_SHAPE = `Return ONLY valid JSON (no markdown fences) shaped as:
{
  "positioning": string,          // one sentence: for [customers] who [need], [business] is the [category] that [unique value], unlike [alternative]
  "category": string,             // the market category customers would file the business under
  "alternatives": string[],       // what customers would do or use if this business did not exist (competitors, DIY, doing nothing)
  "promise": string,              // the brand promise: the one benefit customers can always count on, max 15 words
  "tagline": string,              // optional short line, max 8 words; omit if nothing honest fits
  "elevatorPitch": string,        // 2-3 sentences a customer would understand
  "pillars": [                    // 2-4 key messages that support the promise
    {"title": string, "message": string, "proofPoints": string[]}  // proofPoints: only facts found in the evidence; empty if none
  ],
  "personality": string[],        // 3-5 adjectives, e.g. "Warm", "Precise"
  "voice": {"formality": 1-5, "humor": 1-5, "respect": 1-5, "enthusiasm": 1-5},  // 1 = formal/serious/respectful/matter-of-fact, 5 = casual/playful/irreverent/enthusiastic
  "writeLike": string[],          // 3-5 short rules, e.g. "Plain words a homeowner uses"
  "neverLike": string[],          // 3-5 matching anti-rules, e.g. "Architect jargon without explanation"
  "preferredWords": string[],     // words and phrases customers use for the offering
  "avoidWords": string[],         // words that would feel off-brand or misleading
  "language": string,             // e.g. "British English", "Polish"; match the evidence
  "colors": {"primary": "#rrggbb", "secondary": "#rrggbb", "accent": "#rrggbb", "dark": "#rrggbb", "light": "#rrggbb"},
  "headingFont": string,          // a Google Fonts family name
  "bodyFont": string,             // a Google Fonts family name that is highly legible at small sizes
  "imageryStyle": string[],       // 2-4 short art-direction rules for photos and illustrations
  "shape": "sharp" | "soft" | "round",
  "logoNotes": string             // optional; omit if unknown
}`;

/* ── Colour and contrast (WCAG 2.2) ───────────────────────────────────── */

function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** WCAG relative luminance of an sRGB hex colour. */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((channel) => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio (1..21), rounded to two decimals. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const ratio = (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  return Math.round(ratio * 100) / 100;
}

/** Black or white, whichever reads better on the background. */
export function readableTextOn(background: string): "#000000" | "#ffffff" {
  return contrastRatio(background, "#000000") >= contrastRatio(background, "#ffffff") ? "#000000" : "#ffffff";
}

export type ContrastCheck = {
  id: string;
  label: string;
  foreground: string;
  background: string;
  ratio: number;
  /** "text" = body text (4.5:1 AA); "large" = headings, buttons, icons (3:1). */
  use: "text" | "large";
  passes: boolean;
};

/** The colour pairs a site built from the kit will really use. */
export function brandContrastChecks(colors: BrandColors): ContrastCheck[] {
  const light = colors.light ?? "#ffffff";
  const dark = colors.dark ?? "#111111";
  const pairs: Array<Omit<ContrastCheck, "ratio" | "passes">> = [
    { id: "text", label: "Body text on page background", foreground: dark, background: light, use: "text" },
  ];
  if (colors.primary) {
    pairs.push(
      { id: "button", label: "Button text on primary colour", foreground: readableTextOn(colors.primary), background: colors.primary, use: "text" },
      { id: "link", label: "Primary colour as links and headings on the page", foreground: colors.primary, background: light, use: "text" },
    );
  }
  if (colors.accent) {
    pairs.push({ id: "accent", label: "Accent colour for highlights and icons on the page", foreground: colors.accent, background: light, use: "large" });
  }
  if (colors.secondary) {
    pairs.push({ id: "secondary", label: "Text on secondary colour panels", foreground: readableTextOn(colors.secondary), background: colors.secondary, use: "text" });
  }
  return pairs.map((pair) => {
    const ratio = contrastRatio(pair.foreground, pair.background);
    return { ...pair, ratio, passes: ratio >= (pair.use === "text" ? 4.5 : 3) };
  });
}

/* ── Design tokens (W3C DTCG 2025.10) ─────────────────────────────────── */

type DtcgToken = { $type: string; $value: unknown; $description?: string };
type DtcgGroup = { [key: string]: DtcgToken | DtcgGroup | string };

function colorToken(hex: string, description: string): DtcgToken {
  const [r, g, b] = hexToRgb(hex).map((c) => Math.round((c / 255) * 10_000) / 10_000);
  return { $type: "color", $value: { colorSpace: "srgb", components: [r, g, b], hex }, $description: description };
}

const RADIUS: Record<BrandShape, number> = { sharp: 2, soft: 8, round: 16 };

/**
 * Export the visual identity as a Design Tokens Format Module file, readable
 * by Figma, Penpot, Tokens Studio and Style Dictionary.
 */
export function brandDesignTokens(profile: Pick<BrandProfile, "colors" | "headingFont" | "bodyFont" | "shape">): DtcgGroup {
  const color: DtcgGroup = {};
  for (const role of COLOR_ROLES) {
    const hex = profile.colors[role];
    if (!hex) continue;
    color[role] = colorToken(hex, `Brand ${role} colour`);
    color[`on-${role}`] = colorToken(readableTextOn(hex), `Text and icons placed on ${role}`);
  }
  const tokens: DtcgGroup = { $description: "Brand tokens exported from MOSAI", color };
  const font: DtcgGroup = {};
  if (profile.headingFont) font.heading = { $type: "fontFamily", $value: [profile.headingFont, "sans-serif"] };
  if (profile.bodyFont) font.body = { $type: "fontFamily", $value: [profile.bodyFont, "sans-serif"] };
  if (Object.keys(font).length) tokens.font = font;
  if (profile.shape) {
    tokens.radius = {
      base: { $type: "dimension", $value: { value: RADIUS[profile.shape], unit: "px" }, $description: `Corner radius for a ${profile.shape} shape language` },
    };
  }
  return tokens;
}

/* ── Prompt brief ─────────────────────────────────────────────────────── */

function voiceWord(dimension: VoiceDimension, value: number): string {
  const { low, high } = VOICE_LABELS[dimension];
  if (value <= 1) return `very ${low.toLowerCase()}`;
  if (value === 2) return low.toLowerCase();
  if (value === 3) return `balanced between ${low.toLowerCase()} and ${high.toLowerCase()}`;
  if (value === 4) return high.toLowerCase();
  return `very ${high.toLowerCase()}`;
}

export function describeVoice(voice: VoiceScale): string {
  return VOICE_DIMENSIONS.map((dimension) => voiceWord(dimension, voice[dimension])).join("; ");
}

/** An active marketing communication (communications table) as prompt data. */
export type ActiveMessage = {
  name: string;
  message: string;
  audience?: string;
  proofPoints?: string[];
  callToAction?: string;
};

function joined(items: string[] | undefined): string {
  return items?.length ? items.join("; ") : "";
}

/**
 * Plain-text brand brief appended to the business brief in every AI prompt.
 * Returns an empty list when there is neither a kit nor an active message,
 * so projects without a brand keep today's prompts.
 */
export function brandBriefLines(
  brand: StoredBrandProfile | undefined,
  activeMessages: ActiveMessage[] = [],
): string[] {
  const lines: string[] = [];
  if (brand) {
    lines.push(
      "",
      `BRAND KIT (${brand.status === "confirmed" ? "confirmed by the owner" : "AI draft, not yet confirmed by the owner"}; follow it in every piece of copy and design):`,
      brand.positioning ? `Positioning: ${brand.positioning}` : "",
      brand.category ? `Market category: ${brand.category}` : "",
      joined(brand.alternatives) ? `Customers' alternatives to this business: ${joined(brand.alternatives)}` : "",
      brand.promise ? `Brand promise (every piece should support it): ${brand.promise}` : "",
      brand.tagline ? `Tagline: ${brand.tagline}` : "",
      brand.elevatorPitch ? `Elevator pitch: ${brand.elevatorPitch}` : "",
      ...brand.pillars.map((pillar, index) =>
        `Key message ${index + 1} — ${pillar.title}: ${pillar.message}${pillar.proofPoints.length ? ` (proof: ${pillar.proofPoints.join("; ")})` : " (no proof points recorded)"}`,
      ),
      brand.pillars.length
        ? "Claims rule: only state facts, numbers, awards, guarantees or results that appear in the proof points or evidence. Never invent them."
        : "",
      joined(brand.personality) ? `Brand personality: ${joined(brand.personality)}` : "",
      `Voice (constant across channels; adapt only the tone to the channel and the reader's situation): ${describeVoice(brand.voice)}`,
      joined(brand.writeLike) ? `Write like this: ${joined(brand.writeLike)}` : "",
      joined(brand.neverLike) ? `Never like this: ${joined(brand.neverLike)}` : "",
      joined(brand.preferredWords) ? `Preferred words: ${joined(brand.preferredWords)}` : "",
      joined(brand.avoidWords) ? `Words to avoid: ${joined(brand.avoidWords)}` : "",
      brand.language ? `Language and spelling: ${brand.language}` : "",
      visualLine(brand),
      joined(brand.imageryStyle) ? `Imagery style: ${joined(brand.imageryStyle)}` : "",
    );
  }
  if (activeMessages.length) {
    lines.push("", "ACTIVE MARKETING MESSAGES (current campaigns; use the one that fits the piece, do not force any):");
    for (const item of activeMessages.slice(0, 5)) {
      lines.push(
        `- ${item.name}: ${item.message}${item.audience ? ` — for ${item.audience}` : ""}${joined(item.proofPoints) ? ` — proof: ${joined(item.proofPoints)}` : ""}${item.callToAction ? ` — call to action: ${item.callToAction}` : ""}`,
      );
    }
  }
  // Absent optional fields leave "" behind; keep only the blank line that
  // opens each section heading.
  return lines.filter((line, index) => line !== "" || /^[A-Z][A-Z ]+ \(/.test(lines[index + 1] ?? ""));
}

function visualLine(brand: BrandProfile): string {
  const colors = COLOR_ROLES.filter((role) => brand.colors[role]).map((role) => `${role} ${brand.colors[role]}`);
  const parts = [
    colors.length ? `colours ${colors.join(", ")}` : "",
    brand.headingFont ? `heading font ${brand.headingFont}` : "",
    brand.bodyFont ? `body font ${brand.bodyFont}` : "",
    brand.shape ? `${brand.shape} corners` : "",
  ].filter(Boolean);
  return parts.length ? `Visual identity: ${parts.join("; ")}` : "";
}

/* ── Deterministic voice check ────────────────────────────────────────── */

export type BrandIssue = {
  kind: "avoid_word" | "filler" | "long_sentence" | "exclamation" | "shouting";
  quote: string;
  problem: string;
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findPhrase(text: string, phrase: string): string | null {
  const pattern = new RegExp(`(^|[^\\p{L}\\p{N}])(${escapeRegExp(phrase)})(?=$|[^\\p{L}\\p{N}])`, "iu");
  const match = pattern.exec(text);
  return match ? match[2] : null;
}

/**
 * Rule-based checks that need no model: the owner's avoid-list, generic
 * filler, over-long sentences and tone markers that contradict the voice.
 * Run before (and alongside) the AI review so the result is explainable.
 */
export function lintCopyAgainstBrand(text: string, brand: Pick<BrandProfile, "avoidWords" | "voice">): BrandIssue[] {
  const issues: BrandIssue[] = [];
  const plain = text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  for (const word of brand.avoidWords) {
    const found = findPhrase(plain, word);
    if (found) issues.push({ kind: "avoid_word", quote: found, problem: `“${word}” is on your words-to-avoid list.` });
  }
  for (const phrase of GENERIC_FILLER) {
    const found = findPhrase(plain, phrase);
    if (found) issues.push({ kind: "filler", quote: found, problem: "Generic filler phrase; say the specific benefit instead." });
  }
  const sentences = plain.split(/(?<=[.!?])\s+/).filter(Boolean);
  const limit = brand.voice.formality >= 4 ? 22 : 30;
  for (const sentence of sentences) {
    const words = sentence.split(/\s+/).length;
    if (words > limit) {
      issues.push({ kind: "long_sentence", quote: sentence.slice(0, 120), problem: `${words} words; aim for under ${limit} so it reads easily.` });
      if (issues.filter((issue) => issue.kind === "long_sentence").length >= 3) break;
    }
  }
  const exclamations = (plain.match(/!/g) ?? []).length;
  if (brand.voice.enthusiasm <= 2 && exclamations > 0) {
    issues.push({ kind: "exclamation", quote: "!", problem: "Exclamation marks don’t fit a matter-of-fact voice." });
  } else if (exclamations > 2) {
    issues.push({ kind: "exclamation", quote: "!", problem: `${exclamations} exclamation marks; keep it to one at most.` });
  }
  const shouting = plain.match(/\b[A-Z]{4,}\b/g)?.filter((word) => !/^(HTML|HTTPS?|SEO|FAQ|USA|NATO|ASAP)$/.test(word)) ?? [];
  if (shouting.length) {
    issues.push({ kind: "shouting", quote: shouting[0], problem: "All-caps words read as shouting." });
  }
  return issues;
}

/** Score derived from rule issues only, 0..100. */
export function lintScore(issues: BrandIssue[]): number {
  const weights: Record<BrandIssue["kind"], number> = { avoid_word: 15, filler: 10, long_sentence: 5, exclamation: 5, shouting: 5 };
  return Math.max(0, 100 - issues.reduce((sum, issue) => sum + weights[issue.kind], 0));
}
