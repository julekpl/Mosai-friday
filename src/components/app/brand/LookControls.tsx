import { useEffect, useMemo, useState } from "react";
import { Check, Download, Loader2, Sparkles, Wand2, X } from "lucide-react";
import { toast } from "sonner";
import type { Id } from "@/convex/_generated/dataModel";
import {
  COLOR_ROLES,
  brandContrastChecks,
  brandDesignTokens,
  normalizeHex,
  readableTextOn,
  type BrandColors,
  type BrandProfile,
  type ColorRole,
} from "@/convex/lib/brandProfile";
import {
  DEFAULT_PICKER_COLOR,
  HARMONIES,
  HARMONY_LABELS,
  PALETTE_PRESETS,
  fixReadability,
  fontAdvice,
  generatePalette,
  googleFontsHref,
  recommendFonts,
  type Harmony,
} from "@/convex/lib/brandDesign";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useBrandAssist } from "./useBrandAssist";

const COLOR_HELP: Record<ColorRole, string> = {
  primary: "Buttons, links, highlights",
  secondary: "Panels and sections",
  accent: "Small pops: icons, badges",
  dark: "Text",
  light: "Page background",
};

const ROLE_NAMES: Record<ColorRole, string> = {
  primary: "Primary",
  secondary: "Secondary",
  accent: "Accent",
  dark: "Text",
  light: "Background",
};

type SetBrand = <K extends keyof BrandProfile>(key: K, value: BrandProfile[K]) => void;

/** Load Google Fonts for previews (allowed by the app CSP; loaded only while
 *  the Brand tab is open and only for the families on screen). */
function useGoogleFonts(families: string[]) {
  const href = googleFontsHref(families);
  useEffect(() => {
    if (!href || document.querySelector(`link[data-brand-fonts="${CSS.escape(href)}"]`)) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.dataset.brandFonts = href;
    document.head.appendChild(link);
  }, [href]);
}

function fontStack(family?: string): string | undefined {
  return family ? `"${family}", ui-sans-serif, system-ui, sans-serif` : undefined;
}

function Swatches({ colors, size = "md" }: { colors: BrandColors; size?: "sm" | "md" }) {
  return (
    <span className="flex overflow-hidden rounded-md border" aria-hidden="true">
      {COLOR_ROLES.filter((role) => colors[role]).map((role) => (
        <span key={role} className={cn("flex-1", size === "sm" ? "h-5" : "h-8")} style={{ backgroundColor: colors[role] }} />
      ))}
    </span>
  );
}

function describePalette(colors: BrandColors): string {
  return COLOR_ROLES.filter((role) => colors[role]).map((role) => `${ROLE_NAMES[role]} ${colors[role]}`).join(", ");
}

export function LookControls({
  uid,
  projectId,
  projectName,
  form,
  set,
}: {
  uid: string;
  projectId: Id<"projects">;
  projectName: string;
  form: BrandProfile;
  set: SetBrand;
}) {
  const checks = useMemo(() => brandContrastChecks(form.colors), [form.colors]);
  const failing = checks.filter((check) => !check.passes);
  const recommended = useMemo(
    () => recommendFonts({ personality: form.personality, voice: form.voice, shape: form.shape }),
    [form.personality, form.voice, form.shape],
  );
  const palettesAi = useBrandAssist(projectId);
  const fontsAi = useBrandAssist(projectId);
  const [aiPalettes, setAiPalettes] = useState<Array<{ name: string; rationale: string; colors: BrandColors }>>([]);
  const [aiFonts, setAiFonts] = useState<Array<{ heading: string; body: string; rationale: string }>>([]);
  const [base, setBase] = useState(form.colors.primary ?? DEFAULT_PICKER_COLOR);
  const [harmony, setHarmony] = useState<Harmony>("complementary");

  useGoogleFonts([
    ...(form.headingFont ? [form.headingFont] : []),
    ...(form.bodyFont ? [form.bodyFont] : []),
    ...recommended.flatMap((pair) => [pair.heading, pair.body]),
    ...aiFonts.flatMap((pair) => [pair.heading, pair.body]),
  ]);

  const applyPalette = (colors: BrandColors, label: string) => {
    set("colors", colors);
    toast.success(`${label} applied`, { description: "Fine-tune any colour below." });
  };

  const setColor = (role: ColorRole, value: string) => {
    const next = { ...form.colors };
    const hex = normalizeHex(value);
    if (hex) next[role] = hex;
    else if (!value.trim()) delete next[role];
    else return;
    set("colors", next);
  };

  const fixAll = () => {
    const { colors, changed } = fixReadability(form.colors);
    set("colors", colors);
    toast.success(changed.length ? `Adjusted ${changed.map((role) => ROLE_NAMES[role].toLowerCase()).join(", ")}` : "Already readable", {
      description: "Same hues, just darker where needed.",
    });
  };

  const downloadTokens = () => {
    const blob = new Blob([JSON.stringify(brandDesignTokens(form), null, 2)], { type: "application/design-tokens+json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${projectName.replace(/[^\w-]+/g, "-").toLowerCase() || "brand"}.tokens.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const pickFonts = (heading: string, body: string) => {
    set("headingFont", heading);
    set("bodyFont", body);
  };

  return (
    <div className="grid min-w-0 grid-cols-1 gap-5">
      <BrandPreview form={form} />

      {/* ── Colours ── */}
      <section className="grid min-w-0 grid-cols-1 gap-3" aria-labelledby={`${uid}-colours`}>
        <h3 id={`${uid}-colours`} className="font-mono text-small font-medium">Colours</h3>

        <div className="grid gap-2">
          <p className="font-mono text-caption text-muted-foreground">Start from a mood</p>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {PALETTE_PRESETS.map((preset) => (
              <li key={preset.id}>
                <button
                  type="button"
                  onClick={() => applyPalette(preset.colors, `${preset.name} palette`)}
                  aria-label={`${preset.name} palette: ${preset.mood}. ${describePalette(preset.colors)}`}
                  className="grid w-full gap-1.5 rounded-lg border bg-card p-2 text-left transition-all ease-terminal hover:-translate-y-0.5 hover:shadow-soft"
                >
                  <Swatches colors={preset.colors} />
                  <span className="font-mono text-caption font-medium">{preset.name}</span>
                  <span className="font-mono text-caption text-muted-foreground">{preset.mood}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="grid gap-2 rounded-lg border bg-card p-3">
          <p className="font-mono text-caption font-medium">Build a palette from your main colour</p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="color"
              aria-label="Main colour for the palette"
              value={normalizeHex(base) ?? DEFAULT_PICKER_COLOR}
              onChange={(e) => setBase(e.target.value)}
              className="size-9 shrink-0 cursor-pointer rounded-md border bg-transparent p-0.5"
            />
            <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Palette style">
              {HARMONIES.map((option) => (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={harmony === option}
                  onClick={() => setHarmony(option)}
                  className={cn(
                    "rounded-full border px-2.5 py-1 font-mono text-caption transition-colors",
                    harmony === option ? "border-terminal-green/50 bg-terminal-green-soft text-terminal-green-ink" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {HARMONY_LABELS[option]}
                </button>
              ))}
            </div>
          </div>
          <Swatches colors={generatePalette(base, harmony)} size="sm" />
          <Button type="button" size="sm" variant="outline" className="h-auto w-fit whitespace-normal py-1.5 text-left" onClick={() => applyPalette(generatePalette(base, harmony), "Generated palette")}>
            <Wand2 className="size-4" aria-hidden="true" /> Use this palette
          </Button>
        </div>

        <div className="grid gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-auto w-fit whitespace-normal py-1.5 text-left"
            disabled={palettesAi.busy}
            onClick={async () => {
              const result = await palettesAi.run({ field: "palette" });
              if (result?.kind === "palettes") setAiPalettes(result.palettes);
            }}
          >
            {palettesAi.busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Sparkles className="size-4" aria-hidden="true" />}
            Suggest palettes for my business
          </Button>
          <div aria-live="polite">
            {palettesAi.error ? <p className="font-mono text-caption text-terminal-red" role="alert">{palettesAi.error}</p> : null}
            {aiPalettes.length ? (
              <ul className="grid gap-2 sm:grid-cols-3">
                {aiPalettes.map((palette, index) => (
                  <li key={index} className="grid gap-1.5 rounded-lg border bg-card p-2">
                    <Swatches colors={palette.colors} />
                    <span className="font-mono text-caption font-medium">{palette.name}</span>
                    <span className="font-mono text-caption text-muted-foreground">{palette.rationale}</span>
                    <Button type="button" size="sm" variant="secondary" className="h-7 w-fit" onClick={() => applyPalette(palette.colors, palette.name)}>
                      Use this
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>

        <details className="group rounded-lg border bg-card p-3">
          <summary className="cursor-pointer font-mono text-caption font-medium">Fine-tune each colour</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {COLOR_ROLES.map((role) => (
              <ColorField key={role} id={`${uid}-color-${role}`} role={role} value={form.colors[role]} onChange={(v) => setColor(role, v)} />
            ))}
          </div>
        </details>
      </section>

      {/* ── Fonts ── */}
      <section className="grid min-w-0 grid-cols-1 gap-3" aria-labelledby={`${uid}-fonts`}>
        <h3 id={`${uid}-fonts`} className="font-mono text-small font-medium">Fonts</h3>
        <p className="font-mono text-caption text-muted-foreground">Recommended from your personality, voice and corners.</p>
        <ul className="grid gap-2 sm:grid-cols-3">
          {recommended.map((pair) => (
            <FontCard
              key={pair.id}
              heading={pair.heading}
              body={pair.body}
              note={pair.note}
              reasons={pair.reasons}
              selected={form.headingFont === pair.heading && form.bodyFont === pair.body}
              onPick={() => pickFonts(pair.heading, pair.body)}
            />
          ))}
        </ul>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-auto w-fit whitespace-normal py-1.5 text-left"
          disabled={fontsAi.busy}
          onClick={async () => {
            const result = await fontsAi.run({ field: "fonts" });
            if (result?.kind === "fonts") setAiFonts(result.fonts);
          }}
        >
          {fontsAi.busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Sparkles className="size-4" aria-hidden="true" />}
          Ask AI for more pairings
        </Button>
        <div aria-live="polite">
          {fontsAi.error ? <p className="font-mono text-caption text-terminal-red" role="alert">{fontsAi.error}</p> : null}
          {aiFonts.length ? (
            <ul className="grid gap-2 sm:grid-cols-3">
              {aiFonts.map((pair, index) => (
                <FontCard
                  key={index}
                  heading={pair.heading}
                  body={pair.body}
                  note={pair.rationale}
                  reasons={[]}
                  selected={form.headingFont === pair.heading && form.bodyFont === pair.body}
                  onPick={() => pickFonts(pair.heading, pair.body)}
                />
              ))}
            </ul>
          ) : null}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <FontInput id={`${uid}-heading-font`} label="Heading font" value={form.headingFont} onChange={(v) => set("headingFont", v)} />
          <FontInput id={`${uid}-body-font`} label="Body font" value={form.bodyFont} onChange={(v) => set("bodyFont", v)} />
        </div>
      </section>

      {/* ── Readability ── */}
      <section className="grid gap-2 rounded-lg border bg-card p-3" aria-labelledby={`${uid}-readability`} aria-live="polite">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id={`${uid}-readability`} className="font-mono text-small font-medium">Readability check</h3>
          {failing.length ? (
            <Button type="button" size="sm" onClick={fixAll}>
              <Wand2 className="size-4" aria-hidden="true" /> Fix it for me
            </Button>
          ) : checks.length ? (
            <span className="font-mono text-caption text-terminal-green">All colours readable</span>
          ) : null}
        </div>
        {checks.length ? (
          <ul className="grid gap-1">
            {checks.map((check) => (
              <li key={check.id} className="flex items-start gap-2 font-mono text-caption">
                {check.passes ? (
                  <Check className="mt-0.5 size-3.5 shrink-0 text-terminal-green" aria-hidden="true" />
                ) : (
                  <X className="mt-0.5 size-3.5 shrink-0 text-terminal-red" aria-hidden="true" />
                )}
                <span className="min-w-0">
                  {check.label}: {check.ratio}:1{" "}
                  <span className={check.passes ? "text-muted-foreground" : "text-terminal-red"}>
                    {check.passes ? "readable" : `too faint, needs ${check.use === "text" ? "4.5" : "3"}:1`}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="font-mono text-caption text-muted-foreground">Pick colours to check them.</p>
        )}
        <ul className="grid gap-1 border-t pt-2">
          {fontAdvice(form.headingFont, form.bodyFont).map((advice) => (
            <li key={advice} className="font-mono text-caption text-muted-foreground">• {advice}</li>
          ))}
        </ul>
      </section>

      <Button type="button" variant="outline" size="sm" className="h-auto w-fit whitespace-normal text-left" onClick={downloadTokens}>
        <Download className="size-4" aria-hidden="true" /> Download for designers (design tokens)
      </Button>
    </div>
  );
}

/** A small mock page in the brand's colours, fonts and corners. */
function BrandPreview({ form }: { form: BrandProfile }) {
  const { colors } = form;
  const radius = form.shape === "sharp" ? "0.125rem" : form.shape === "round" ? "1rem" : "0.5rem";
  const primary = colors.primary;
  return (
    <figure className="grid gap-1.5">
      <figcaption className="font-mono text-caption text-muted-foreground">Preview</figcaption>
      <div
        className="grid gap-3 border p-4"
        style={{ backgroundColor: colors.light ?? "var(--card)", color: colors.dark ?? "var(--foreground)", borderRadius: radius }}
      >
        {colors.accent ? (
          <span
            className="w-fit px-2 py-0.5 text-xs font-semibold"
            style={{ backgroundColor: colors.accent, color: readableTextOn(colors.accent), borderRadius: radius }}
          >
            New
          </span>
        ) : null}
        <p className="text-xl font-bold leading-tight" style={{ fontFamily: fontStack(form.headingFont) }}>
          {form.promise || "Your brand promise appears here"}
        </p>
        <p className="text-sm" style={{ fontFamily: fontStack(form.bodyFont) }}>
          {form.pillars[0]?.message || "Body text in your chosen font, so you can judge how easy it is to read."}{" "}
          <span className="underline" style={{ color: primary ?? "inherit" }}>Learn more</span>
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className="px-3 py-1.5 text-sm font-semibold"
            style={{
              backgroundColor: primary ?? "var(--foreground)",
              color: primary ? readableTextOn(primary) : "var(--background)",
              borderRadius: radius,
              fontFamily: fontStack(form.bodyFont),
            }}
          >
            {form.tagline ? "Get started" : "Book a call"}
          </span>
          {colors.secondary ? (
            <span
              className="px-3 py-1.5 text-sm"
              style={{ backgroundColor: colors.secondary, color: readableTextOn(colors.secondary), borderRadius: radius, fontFamily: fontStack(form.bodyFont) }}
            >
              Panel
            </span>
          ) : null}
        </div>
      </div>
    </figure>
  );
}

function FontCard({
  heading,
  body,
  note,
  reasons,
  selected,
  onPick,
}: {
  heading: string;
  body: string;
  note: string;
  reasons: string[];
  selected: boolean;
  onPick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        aria-pressed={selected}
        onClick={onPick}
        className={cn(
          "grid h-full w-full gap-1.5 rounded-lg border bg-card p-3 text-left transition-all ease-terminal hover:-translate-y-0.5 hover:shadow-soft",
          selected && "border-terminal-green/60 ring-2 ring-terminal-green/30",
        )}
      >
        <span className="text-2xl leading-none" style={{ fontFamily: fontStack(heading) }}>Aa Bb</span>
        <span className="text-sm" style={{ fontFamily: fontStack(body) }}>The quick brown fox jumps over the lazy dog.</span>
        <span className="font-mono text-caption font-medium">{heading} + {body}</span>
        <span className="font-mono text-caption text-muted-foreground">{note}</span>
        {reasons.length ? (
          <span className="font-mono text-caption text-terminal-green">Fits: {reasons.join(", ")}</span>
        ) : null}
      </button>
    </li>
  );
}

const FONT_SUGGESTIONS = [
  "Inter", "Roboto", "Open Sans", "Lato", "Source Sans 3", "Work Sans", "DM Sans", "Nunito Sans",
  "Manrope", "Poppins", "Montserrat", "Playfair Display", "Merriweather", "Lora",
  "Fraunces", "Space Grotesk", "IBM Plex Sans", "Libre Baskerville",
];

function FontInput({ id, label, value, onChange }: { id: string; label: string; value?: string; onChange: (v: string | undefined) => void }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} list={`${id}-list`} value={value ?? ""} onChange={(e) => onChange(e.target.value || undefined)} maxLength={60} placeholder="e.g. Inter" />
      <datalist id={`${id}-list`}>
        {FONT_SUGGESTIONS.map((font) => <option key={font} value={font} />)}
      </datalist>
    </div>
  );
}

function ColorField({ id, role, value, onChange }: { id: string; role: ColorRole; value?: string; onChange: (v: string) => void }) {
  const [text, setText] = useState(value ?? "");
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    setText(value ?? "");
  }
  const invalid = text.trim() !== "" && !normalizeHex(text);
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{ROLE_NAMES[role]}</Label>
      <p id={`${id}-help`} className="font-mono text-caption text-muted-foreground">{COLOR_HELP[role]}</p>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`Pick ${ROLE_NAMES[role].toLowerCase()} colour`}
          value={value ?? DEFAULT_PICKER_COLOR}
          onChange={(e) => onChange(e.target.value)}
          className="size-9 shrink-0 cursor-pointer rounded-md border bg-transparent p-0.5"
        />
        <Input
          id={id}
          aria-describedby={`${id}-help`}
          aria-invalid={invalid || undefined}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (!e.target.value.trim() || normalizeHex(e.target.value)) onChange(e.target.value);
          }}
          placeholder="Not set"
          maxLength={7}
          className={cn("font-mono", invalid && "border-terminal-red")}
        />
      </div>
    </div>
  );
}
