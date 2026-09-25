/**
 * Design helpers behind the Brand tab: colour palettes that are readable by
 * construction, automatic contrast repair, font pairings recommended from the
 * brand's personality and voice, and concrete example sentences for each
 * point on the voice scales. Pure and deterministic (no model, no network),
 * so the UI can react instantly and the rules are unit-tested. AI suggestions
 * (ai.brandAssist) are passed through the same repair before they are shown.
 *
 * References: WCAG 2.2 SC 1.4.3 (4.5:1 text), 1.4.11 (3:1 non-text) and
 * 1.4.12 (text spacing); NN/g tone-of-voice dimensions.
 */
import {
  COLOR_ROLES,
  brandContrastChecks,
  contrastRatio,
  normalizeHex,
  type BrandColors,
  type BrandShape,
  type ColorRole,
  type VoiceDimension,
  type VoiceScale,
} from "./brandProfile";

/* ── Colour space helpers ─────────────────────────────────────────────── */

type Hsl = { h: number; s: number; l: number };

export function hexToHsl(hex: string): Hsl {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h * 60, s, l };
}

export function hslToHex({ h, s, l }: Hsl): string {
  const hue = ((h % 360) + 360) % 360;
  const sat = Math.min(1, Math.max(0, s));
  const lig = Math.min(1, Math.max(0, l));
  const c = (1 - Math.abs(2 * lig - 1)) * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = lig - c / 2;
  const [r, g, b] =
    hue < 60 ? [c, x, 0] : hue < 120 ? [x, c, 0] : hue < 180 ? [0, c, x] : hue < 240 ? [0, x, c] : hue < 300 ? [x, 0, c] : [c, 0, x];
  const to = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

/** Darken (or, on a dark background, lighten) until the ratio is met. */
function adjustUntil(color: string, background: string, ratio: number): string {
  if (contrastRatio(color, background) >= ratio) return color;
  const hsl = hexToHsl(color);
  const direction = hexToHsl(background).l > 0.5 ? -1 : 1;
  for (let step = 1; step <= 50; step += 1) {
    const candidate = hslToHex({ ...hsl, l: hsl.l + direction * step * 0.02 });
    if (contrastRatio(candidate, background) >= ratio) return candidate;
  }
  return direction < 0 ? "#000000" : "#ffffff";
}

export type ReadabilityFix = { colors: BrandColors; changed: ColorRole[] };

/**
 * Repair the pairs brandContrastChecks tests: text on background (4.5:1),
 * primary as links (4.5:1), accent as icons/large text (3:1). The hue is kept;
 * only lightness moves, so the palette still looks like the brand.
 */
export function fixReadability(colors: BrandColors): ReadabilityFix {
  const next: BrandColors = { ...colors };
  const changed: ColorRole[] = [];
  const light = next.light ?? "#ffffff";
  const set = (role: ColorRole, value: string) => {
    if (next[role] !== value) {
      next[role] = value;
      changed.push(role);
    }
  };
  if (next.dark) set("dark", adjustUntil(next.dark, light, 4.5));
  if (next.primary) set("primary", adjustUntil(next.primary, light, 4.5));
  if (next.accent) set("accent", adjustUntil(next.accent, light, 3));
  return { colors: next, changed };
}

export function paletteIsReadable(colors: BrandColors): boolean {
  return brandContrastChecks(colors).every((check) => check.passes);
}

/* ── Palette generation ───────────────────────────────────────────────── */

/** Starting value for colour pickers before the owner picks a colour. */
export const DEFAULT_PICKER_COLOR = "#1f4e79";

export const HARMONIES = ["complementary", "analogous", "triadic", "monochrome"] as const;
export type Harmony = (typeof HARMONIES)[number];

export const HARMONY_LABELS: Record<Harmony, string> = {
  complementary: "Contrasting",
  analogous: "Harmonious",
  triadic: "Vibrant",
  monochrome: "One colour",
};

/** A five-role palette built around one base colour, readable by construction. */
export function generatePalette(base: string, harmony: Harmony): BrandColors {
  const hex = normalizeHex(base) ?? DEFAULT_PICKER_COLOR;
  const { h, s } = hexToHsl(hex);
  const sat = Math.max(0.35, Math.min(0.85, s || 0.5));
  const accentHue = harmony === "complementary" ? h + 180 : harmony === "analogous" ? h + 35 : harmony === "triadic" ? h + 120 : h;
  const secondaryHue = harmony === "triadic" ? h + 240 : harmony === "analogous" ? h - 30 : h;
  const palette: BrandColors = {
    primary: hex,
    secondary: hslToHex({ h: secondaryHue, s: Math.min(sat, 0.45), l: 0.9 }),
    accent: hslToHex({ h: accentHue, s: Math.max(0.55, sat), l: harmony === "monochrome" ? 0.62 : 0.5 }),
    dark: hslToHex({ h, s: 0.2, l: 0.12 }),
    light: hslToHex({ h, s: 0.25, l: 0.98 }),
  };
  return fixReadability(palette).colors;
}

export type PalettePreset = { id: string; name: string; mood: string; colors: BrandColors };

/** Starting points by mood. Shown after fixReadability, so all pass AA. */
export const PALETTE_PRESETS: PalettePreset[] = [
  { id: "trust", name: "Trust", mood: "Dependable, expert, calm", colors: { primary: "#1f4e79", secondary: "#dce8f5", accent: "#e8a33d", dark: "#15202b", light: "#f8fafc" } },
  { id: "natural", name: "Natural", mood: "Fresh, healthy, local", colors: { primary: "#2f6b3f", secondary: "#e3efe1", accent: "#c9822b", dark: "#1b261d", light: "#fbfcf8" } },
  { id: "earth", name: "Warm earth", mood: "Crafted, cosy, honest", colors: { primary: "#8a4b2a", secondary: "#f3e6d8", accent: "#3f7d6e", dark: "#2a1d16", light: "#fdf9f4" } },
  { id: "bold", name: "Bold", mood: "Confident, energetic, direct", colors: { primary: "#c2261d", secondary: "#fde6e2", accent: "#1d4ed8", dark: "#171717", light: "#ffffff" } },
  { id: "calm", name: "Calm", mood: "Quiet, clinical, reassuring", colors: { primary: "#2d6a73", secondary: "#e2f0f1", accent: "#9b6bb3", dark: "#1a2527", light: "#f9fbfb" } },
  { id: "playful", name: "Playful", mood: "Fun, young, friendly", colors: { primary: "#6d28d9", secondary: "#f1e8ff", accent: "#ea8a1c", dark: "#1e1433", light: "#fffdfa" } },
  { id: "premium", name: "Premium", mood: "Refined, exclusive, elegant", colors: { primary: "#1c1c1c", secondary: "#efe9df", accent: "#a67c2e", dark: "#111111", light: "#faf8f4" } },
  { id: "fresh", name: "Fresh", mood: "Clean, modern, optimistic", colors: { primary: "#0e7490", secondary: "#e0f5f7", accent: "#e0566b", dark: "#0f1f24", light: "#ffffff" } },
].map((preset) => ({ ...preset, colors: fixReadability(preset.colors).colors }));

/** Keep only valid roles; repair contrast. Used for AI-proposed palettes. */
export function cleanPalette(value: unknown): BrandColors | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const colors: BrandColors = {};
  for (const role of COLOR_ROLES) {
    const hex = normalizeHex(raw[role]);
    if (hex) colors[role] = hex;
  }
  if (!colors.primary) return null;
  return fixReadability(colors).colors;
}

/* ── Fonts ────────────────────────────────────────────────────────────── */

export type FontStyle = "sans" | "serif" | "rounded" | "geometric" | "grotesk";

export type FontPair = {
  id: string;
  heading: string;
  body: string;
  style: FontStyle;
  tags: string[];
  note: string;
};

/** Curated Google Fonts pairings; every body font is a text face with a large
 *  x-height that stays legible at 16px. */
export const FONT_PAIRS: FontPair[] = [
  { id: "inter", heading: "Inter", body: "Inter", style: "sans", tags: ["modern", "straightforward", "technical", "calm"], note: "Neutral and very legible on screens." },
  { id: "fraunces-inter", heading: "Fraunces", body: "Inter", style: "serif", tags: ["warm", "crafted", "thoughtful", "elegant"], note: "Characterful serif headings, clean text." },
  { id: "playfair-source", heading: "Playfair Display", body: "Source Sans 3", style: "serif", tags: ["elegant", "premium", "traditional"], note: "Editorial and refined." },
  { id: "montserrat-opensans", heading: "Montserrat", body: "Open Sans", style: "geometric", tags: ["confident", "bold", "friendly", "modern"], note: "Strong headings, friendly text." },
  { id: "poppins-inter", heading: "Poppins", body: "Inter", style: "geometric", tags: ["friendly", "modern", "playful", "energetic"], note: "Round geometric shapes feel approachable." },
  { id: "nunito", heading: "Nunito", body: "Nunito Sans", style: "rounded", tags: ["playful", "warm", "friendly", "caring"], note: "Soft rounded letters; gentle and welcoming." },
  { id: "merriweather-lato", heading: "Merriweather", body: "Lato", style: "serif", tags: ["trustworthy", "expert", "traditional", "calm"], note: "Sturdy serif signals expertise." },
  { id: "spacegrotesk-plex", heading: "Space Grotesk", body: "IBM Plex Sans", style: "grotesk", tags: ["technical", "innovative", "bold", "modern"], note: "Engineered and forward-looking." },
  { id: "dmserif-dmsans", heading: "DM Serif Display", body: "DM Sans", style: "serif", tags: ["elegant", "premium", "modern", "confident"], note: "High-contrast headlines, crisp text." },
  { id: "worksans", heading: "Work Sans", body: "Work Sans", style: "sans", tags: ["honest", "down-to-earth", "straightforward", "friendly"], note: "Plain-spoken and practical." },
  { id: "lora-opensans", heading: "Lora", body: "Open Sans", style: "serif", tags: ["warm", "thoughtful", "caring", "calm"], note: "Literary warmth with an easy read." },
  { id: "archivo-inter", heading: "Archivo", body: "Inter", style: "grotesk", tags: ["bold", "energetic", "confident", "straightforward"], note: "Punchy headings for a direct voice." },
  { id: "baskerville-source", heading: "Libre Baskerville", body: "Source Sans 3", style: "serif", tags: ["expert", "trustworthy", "premium", "traditional"], note: "Classic authority, modern text." },
];

/** Families that read well large but tire the eye in paragraphs. */
export const DISPLAY_ONLY_FONTS = [
  "Playfair Display", "DM Serif Display", "Abril Fatface", "Lobster", "Pacifico", "Bebas Neue",
  "Archivo Black", "Oswald", "Anton", "Dancing Script", "Great Vibes", "Righteous", "Alfa Slab One",
];

const TRAIT_TAGS: Record<string, string[]> = {
  warm: ["warm"], friendly: ["friendly"], expert: ["expert"], knowledgeable: ["expert"], trustworthy: ["trustworthy"],
  reliable: ["trustworthy"], bold: ["bold"], confident: ["confident", "bold"], playful: ["playful"], fun: ["playful"],
  calm: ["calm"], honest: ["honest"], premium: ["premium"], luxurious: ["premium", "elegant"], elegant: ["elegant"],
  refined: ["elegant", "premium"], modern: ["modern"], innovative: ["innovative"], caring: ["caring"], kind: ["caring"],
  straightforward: ["straightforward"], direct: ["straightforward", "bold"], energetic: ["energetic"], thoughtful: ["thoughtful"],
  technical: ["technical"], precise: ["technical"], traditional: ["traditional"], classic: ["traditional"],
  "down-to-earth": ["down-to-earth"], unpretentious: ["down-to-earth", "honest"], crafted: ["crafted"], artisan: ["crafted"],
};

export type FontRecommendation = FontPair & { reasons: string[] };

/**
 * Recommend three pairings from personality words, voice and corner shape.
 * The reasons say which choices led to each pairing.
 */
export function recommendFonts(input: { personality: string[]; voice: VoiceScale; shape?: BrandShape }): FontRecommendation[] {
  // Traits the owner picked weigh 3; traits inferred from the voice weigh 2.
  const wanted = new Map<string, { reason: string; weight: number }>();
  const want = (tag: string, reason: string, weight: number) => {
    const current = wanted.get(tag);
    if (!current || current.weight < weight) wanted.set(tag, { reason, weight });
  };
  for (const trait of input.personality) {
    for (const tag of TRAIT_TAGS[trait.trim().toLowerCase()] ?? []) want(tag, `“${trait}” personality`, 3);
  }
  const { formality, humor, enthusiasm } = input.voice;
  if (formality <= 2) { want("traditional", "formal voice", 2); want("expert", "formal voice", 2); }
  if (formality >= 4) { want("friendly", "casual voice", 2); want("modern", "casual voice", 2); }
  if (humor >= 4) want("playful", "playful voice", 2);
  if (enthusiasm >= 4) want("energetic", "enthusiastic voice", 2);
  if (enthusiasm <= 2 && humor <= 2) want("calm", "matter-of-fact voice", 2);
  const scored = FONT_PAIRS.map((pair, index) => {
    const reasons = new Set<string>();
    let score = 0;
    for (const tag of pair.tags) {
      const match = wanted.get(tag);
      if (match) { score += match.weight; reasons.add(match.reason); }
    }
    if (input.shape === "round" && pair.style === "rounded") { score += 3; reasons.add("round corners"); }
    if (input.shape === "round" && pair.style === "geometric") { score += 1; reasons.add("round corners"); }
    if (input.shape === "sharp" && (pair.style === "serif" || pair.style === "grotesk")) { score += 1; reasons.add("sharp corners"); }
    return { ...pair, reasons: [...reasons], score, index };
  });
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored.slice(0, 3).map((pair) => ({
    id: pair.id,
    heading: pair.heading,
    body: pair.body,
    style: pair.style,
    tags: pair.tags,
    note: pair.note,
    reasons: pair.reasons,
  }));
}

/** Readability advice for the chosen fonts (WCAG 1.4.12 text spacing). */
export function fontAdvice(heading?: string, body?: string): string[] {
  const advice: string[] = [];
  if (body && DISPLAY_ONLY_FONTS.some((font) => font.toLowerCase() === body.toLowerCase())) {
    advice.push(`${body} is a display face: use it for headings only and pick a text font for paragraphs.`);
  }
  if (heading && body && heading.toLowerCase() === body.toLowerCase()) {
    advice.push("One family keeps things simple; use bold weights for headings.");
  }
  advice.push("Set body text at 16px or larger with 1.5 line spacing so it stays readable when people zoom or adjust spacing.");
  return advice;
}

/** Google Fonts stylesheet URL for previews (allowed by the app CSP). */
export function googleFontsHref(families: string[]): string | null {
  const unique = [...new Set(families.filter((family) => /^[\p{L}\p{N} -]{1,60}$/u.test(family)))].slice(0, 12);
  if (!unique.length) return null;
  return `https://fonts.googleapis.com/css2?${unique.map((family) => `family=${encodeURIComponent(family).replace(/%20/g, "+")}:wght@400;700`).join("&")}&display=swap`;
}

/* ── Voice ────────────────────────────────────────────────────────────── */

/** What each point on a scale sounds like, for the same everyday message. */
export const VOICE_EXAMPLES: Record<VoiceDimension, [string, string, string, string, string]> = {
  formality: [
    "We acknowledge receipt of your enquiry and will respond within one business day.",
    "Thank you for your enquiry. We will reply within one working day.",
    "Thanks for getting in touch. We’ll reply within a day.",
    "Thanks for reaching out! We’ll get back to you by tomorrow.",
    "Got it, thanks! Talk tomorrow.",
  ],
  humor: [
    "Your order has shipped.",
    "Good news: your order is on its way.",
    "Your order is on its way, so no need to keep refreshing.",
    "Your order is on its way. Time to clear some shelf space.",
    "Your order has left the building. Cue the happy dance.",
  ],
  respect: [
    "We sincerely apologise and appreciate your patience while we resolve this.",
    "Thanks for bearing with us while we sort this out.",
    "Hang tight, we’re sorting this out.",
    "Yep, that one’s on us. Fixing it now.",
    "We broke it. Our bad. Fixing it right now.",
  ],
  enthusiasm: [
    "The new menu is available from Monday.",
    "Our new menu starts on Monday.",
    "Our new menu starts Monday, and we think you’ll like it.",
    "Our new menu starts Monday, and we can’t wait for you to try it!",
    "Monday. New menu. We are beyond excited!",
  ],
};

export type VoicePreset = {
  id: string;
  name: string;
  description: string;
  voice: VoiceScale;
  personality: string[];
};

export const VOICE_PRESETS: VoicePreset[] = [
  { id: "expert", name: "Trusted expert", description: "Clear, precise, reassuring", voice: { formality: 2, humor: 1, respect: 1, enthusiasm: 2 }, personality: ["Expert", "Trustworthy", "Calm"] },
  { id: "neighbour", name: "Friendly neighbour", description: "Warm, helpful, down-to-earth", voice: { formality: 4, humor: 3, respect: 2, enthusiasm: 3 }, personality: ["Warm", "Friendly", "Down-to-earth"] },
  { id: "challenger", name: "Bold challenger", description: "Direct, energetic, confident", voice: { formality: 4, humor: 3, respect: 4, enthusiasm: 5 }, personality: ["Bold", "Confident", "Energetic"] },
  { id: "professional", name: "Calm professional", description: "Straightforward, measured", voice: { formality: 3, humor: 1, respect: 1, enthusiasm: 2 }, personality: ["Calm", "Straightforward", "Thoughtful"] },
  { id: "playful", name: "Playful companion", description: "Fun, light, upbeat", voice: { formality: 5, humor: 5, respect: 3, enthusiasm: 4 }, personality: ["Playful", "Warm", "Energetic"] },
  { id: "premium", name: "Refined & premium", description: "Elegant, understated", voice: { formality: 2, humor: 1, respect: 1, enthusiasm: 2 }, personality: ["Elegant", "Premium", "Thoughtful"] },
];
