import { useId, useMemo, useState, type ReactNode } from "react";
import { useAction, useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Check, Download, Loader2, RefreshCw, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import {
  COLOR_ROLES,
  DEFAULT_VOICE,
  VOICE_DIMENSIONS,
  VOICE_LABELS,
  brandContrastChecks,
  brandDesignTokens,
  normalizeHex,
  type BrandProfile,
  type ColorRole,
  type MessagePillar,
  type VoiceDimension,
} from "@/convex/lib/brandProfile";
import { ChipInput } from "@/components/app/ChipInput";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

type Project = Doc<"projects">;
type StoredBrand = NonNullable<Project["brandProfile"]>;
type BrandCheck = FunctionReturnType<typeof api.ai.checkBrandFit>;

const EMPTY_BRAND: BrandProfile = {
  positioning: "",
  alternatives: [],
  promise: "",
  pillars: [],
  personality: [],
  voice: DEFAULT_VOICE,
  writeLike: [],
  neverLike: [],
  preferredWords: [],
  avoidWords: [],
  colors: {},
  imageryStyle: [],
};

const COLOR_HELP: Record<ColorRole, string> = {
  primary: "Main colour — buttons, links, highlights",
  secondary: "Supporting colour — panels and sections",
  accent: "Small pops — icons, badges",
  dark: "Text colour",
  light: "Page background",
};

const FONT_SUGGESTIONS = [
  "Inter", "Roboto", "Open Sans", "Lato", "Source Sans 3", "Work Sans", "DM Sans",
  "Manrope", "Poppins", "Montserrat", "Playfair Display", "Merriweather", "Lora",
  "Fraunces", "Space Grotesk", "IBM Plex Sans",
];

function editable(brand: StoredBrand | undefined): BrandProfile {
  if (!brand) return EMPTY_BRAND;
  return {
    ...EMPTY_BRAND,
    positioning: brand.positioning,
    category: brand.category,
    alternatives: brand.alternatives,
    promise: brand.promise,
    tagline: brand.tagline,
    elevatorPitch: brand.elevatorPitch,
    pillars: brand.pillars,
    personality: brand.personality,
    voice: brand.voice,
    writeLike: brand.writeLike,
    neverLike: brand.neverLike,
    preferredWords: brand.preferredWords,
    avoidWords: brand.avoidWords,
    language: brand.language,
    colors: brand.colors,
    headingFont: brand.headingFont,
    bodyFont: brand.bodyFont,
    imageryStyle: brand.imageryStyle,
    shape: brand.shape,
    logoNotes: brand.logoNotes,
  };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message.replace(/^.*Uncaught Error:\s*/s, "").split("\n")[0] : "Try again.";
}

function Field({ id, label, help, children }: { id: string; label: string; help?: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {help ? (
        <p id={`${id}-help`} className="font-mono text-caption text-muted-foreground">
          {help}
        </p>
      ) : null}
      {children}
    </div>
  );
}

function Group({ title, intro, children }: { title: string; intro: string; children: ReactNode }) {
  return (
    <fieldset className="grid min-w-0 gap-4 rounded-md border p-4">
      <legend className="px-1 font-mono text-small font-medium">{title}</legend>
      <p className="-mt-2 font-mono text-caption text-muted-foreground">{intro}</p>
      {children}
    </fieldset>
  );
}

export function BrandStatus({ brand }: { brand: StoredBrand | undefined }) {
  if (!brand) {
    return (
      <Badge variant="outline" className="font-mono text-caption text-muted-foreground">
        Not created yet
      </Badge>
    );
  }
  return brand.status === "confirmed" ? (
    <Badge variant="outline" className="font-mono text-caption border-terminal-green/40 text-terminal-green">
      Confirmed by you
    </Badge>
  ) : (
    <Badge variant="outline" className="font-mono text-caption border-terminal-amber/40 text-terminal-amber">
      Draft — please review
    </Badge>
  );
}

/**
 * Edit project → Brand. One page, three plain-language groups (what you say,
 * how you sound, how you look) plus a copy checker. Behind it: a messaging
 * house, NN/g tone dimensions, WCAG contrast checks and a DTCG token export.
 */
export function BrandKitForm({ project }: { project: Project }) {
  const uid = useId();
  const save = useMutation(api.projects.saveBrandProfile);
  const draft = useAction(api.ai.generateBrandProfile);
  const [form, setForm] = useState<BrandProfile>(() => editable(project.brandProfile));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<"save" | "confirm" | "draft" | null>(null);
  const [manual, setManual] = useState(false);

  // Follow server updates (the AI draft landing) until the owner edits.
  const serverVersion = project.brandProfile?.updatedAt ?? 0;
  const [seenVersion, setSeenVersion] = useState(serverVersion);
  if (serverVersion !== seenVersion && !dirty) {
    setSeenVersion(serverVersion);
    setForm(editable(project.brandProfile));
  }

  const set = <K extends keyof BrandProfile>(key: K, value: BrandProfile[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  };

  const submit = async (confirm: boolean) => {
    setBusy(confirm ? "confirm" : "save");
    try {
      await save({ id: project._id, profile: form, confirm });
      setDirty(false);
      toast.success(confirm ? "Brand confirmed — every AI writer now uses it" : "Saved");
    } catch (error) {
      toast.error("Couldn’t save", { description: errorText(error) });
    } finally {
      setBusy(null);
    }
  };

  const redraft = async () => {
    const confirmed = project.brandProfile?.status === "confirmed";
    if (confirmed && !window.confirm("Replace your confirmed brand with a new AI draft? You can review it before confirming again.")) {
      return;
    }
    setBusy("draft");
    try {
      await draft({ projectId: project._id, replaceConfirmed: confirmed });
      setDirty(false);
      toast.success("Brand draft ready — review it below");
    } catch (error) {
      toast.error("Couldn’t draft your brand", { description: errorText(error) });
    } finally {
      setBusy(null);
    }
  };

  const hasBrand = Boolean(project.brandProfile);

  return (
    <div className="grid grid-cols-1 gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-md border bg-card p-3">
        <div className="grid gap-1">
          <p className="font-mono text-small font-medium">Your brand</p>
          <p className="font-mono text-caption text-muted-foreground">
            What you say, how you sound and how you look. Content, posts, your website and product copy all follow it.
          </p>
        </div>
        <BrandStatus brand={project.brandProfile} />
      </div>

      {!hasBrand && !manual && busy !== "draft" ? (
        <div className="grid gap-3 rounded-md border border-dashed p-4">
          <p className="font-mono text-caption text-muted-foreground">
            MOSAI can draft your brand from your business summary, customers and website in about 20 seconds. You review everything before it’s used as final.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={redraft} className="w-fit">
              <Sparkles className="size-4" aria-hidden="true" /> Draft it for me
            </Button>
            <Button variant="outline" onClick={() => setManual(true)} className="w-fit">
              Fill it in myself
            </Button>
          </div>
        </div>
      ) : null}

      {busy === "draft" ? (
        <p className="flex items-center gap-2 font-mono text-caption text-muted-foreground" role="status">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Drafting your brand…
        </p>
      ) : null}

      {hasBrand || manual ? (
        <>
          <MessagingGroup uid={uid} form={form} set={set} />
          <VoiceGroup uid={uid} form={form} set={set} />
          <LookGroup uid={uid} form={form} set={set} projectName={project.name} />

          <div className="flex flex-wrap gap-2 border-t pt-4">
            <Button onClick={() => submit(true)} disabled={busy !== null}>
              {busy === "confirm" ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
              Save and confirm
            </Button>
            <Button variant="outline" onClick={() => submit(false)} disabled={busy !== null || !dirty}>
              {busy === "save" ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
              Save draft
            </Button>
            <Button variant="ghost" onClick={redraft} disabled={busy !== null}>
              <RefreshCw className="size-4" aria-hidden="true" /> Ask AI to redo it
            </Button>
          </div>

          {hasBrand ? <BrandChecker project={project} /> : null}
        </>
      ) : null}
    </div>
  );
}

type GroupProps = {
  uid: string;
  form: BrandProfile;
  set: <K extends keyof BrandProfile>(key: K, value: BrandProfile[K]) => void;
};

/* ── What you say: positioning and the messaging house ───────────────────── */

function MessagingGroup({ uid, form, set }: GroupProps) {
  const setPillar = (index: number, patch: Partial<MessagePillar>) =>
    set("pillars", form.pillars.map((pillar, i) => (i === index ? { ...pillar, ...patch } : pillar)));

  return (
    <Group title="What you say" intro="One promise, a few key messages, and the proof behind them.">
      <Field id={`${uid}-promise`} label="Brand promise" help="The one thing customers can always count on. Short enough to remember.">
        <Input
          id={`${uid}-promise`}
          aria-describedby={`${uid}-promise-help`}
          value={form.promise}
          onChange={(e) => set("promise", e.target.value)}
          maxLength={400}
          placeholder="e.g. A home designed around your family, on budget"
        />
      </Field>
      <Field id={`${uid}-positioning`} label="Why you, not someone else" help="Who it’s for, what you do better than their alternatives.">
        <Textarea
          id={`${uid}-positioning`}
          aria-describedby={`${uid}-positioning-help`}
          value={form.positioning}
          onChange={(e) => set("positioning", e.target.value)}
          rows={3}
          maxLength={400}
        />
      </Field>

      <div className="grid gap-3">
        <p className="text-sm font-medium">Key messages</p>
        {form.pillars.map((pillar, index) => (
          <div key={index} className="grid gap-2 rounded-md border bg-card p-3">
            <div className="flex items-center gap-2">
              <Label htmlFor={`${uid}-pillar-${index}`} className="sr-only">Key message {index + 1} title</Label>
              <Input
                id={`${uid}-pillar-${index}`}
                value={pillar.title}
                onChange={(e) => setPillar(index, { title: e.target.value })}
                placeholder="Short title, e.g. Fixed fees"
                maxLength={120}
              />
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`Remove key message ${pillar.title || index + 1}`}
                onClick={() => set("pillars", form.pillars.filter((_, i) => i !== index))}
              >
                <X className="size-3.5" aria-hidden="true" />
              </Button>
            </div>
            <Label htmlFor={`${uid}-pillar-${index}-msg`} className="sr-only">Key message {index + 1}</Label>
            <Textarea
              id={`${uid}-pillar-${index}-msg`}
              value={pillar.message}
              onChange={(e) => setPillar(index, { message: e.target.value })}
              rows={2}
              maxLength={400}
              placeholder="The message, in one or two sentences"
            />
            <Label htmlFor={`${uid}-pillar-${index}-proof`} className="font-mono text-caption text-muted-foreground">
              Proof (facts only — AI never claims more than this)
            </Label>
            <ChipInput
              id={`${uid}-pillar-${index}-proof`}
              values={pillar.proofPoints}
              onChange={(v) => setPillar(index, { proofPoints: v })}
              maxItems={4}
              placeholder="e.g. 120 homes designed since 2012"
            />
          </div>
        ))}
        {form.pillars.length < 4 ? (
          <Button
            variant="outline"
            size="sm"
            className="w-fit"
            onClick={() => set("pillars", [...form.pillars, { title: "", message: "", proofPoints: [] }])}
          >
            Add a key message
          </Button>
        ) : null}
      </div>

      <Field id={`${uid}-tagline`} label="Tagline (optional)">
        <Input id={`${uid}-tagline`} value={form.tagline ?? ""} onChange={(e) => set("tagline", e.target.value || undefined)} maxLength={120} />
      </Field>
    </Group>
  );
}

/* ── How you sound: NN/g tone dimensions + concrete rules ────────────────── */

function VoiceGroup({ uid, form, set }: GroupProps) {
  const setVoice = (dimension: VoiceDimension, value: string) => {
    const n = Number(value);
    if (n >= 1 && n <= 5) set("voice", { ...form.voice, [dimension]: n });
  };
  return (
    <Group title="How you sound" intro="Your voice stays the same everywhere; AI adjusts only the tone to the channel.">
      {VOICE_DIMENSIONS.map((dimension) => {
        const { low, high } = VOICE_LABELS[dimension];
        const labelId = `${uid}-voice-${dimension}`;
        return (
          <div key={dimension} className="grid gap-1.5">
            <p id={labelId} className="text-sm font-medium">{low} or {high.toLowerCase()}?</p>
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              aria-labelledby={labelId}
              value={String(form.voice[dimension])}
              onValueChange={(value) => setVoice(dimension, value)}
              className="w-full sm:w-80"
            >
              {[1, 2, 3, 4, 5].map((step) => (
                <ToggleGroupItem
                  key={step}
                  value={String(step)}
                  aria-label={step === 1 ? `Very ${low.toLowerCase()}` : step === 5 ? `Very ${high.toLowerCase()}` : step === 3 ? "Balanced" : step < 3 ? low : high}
                  className="flex-1"
                >
                  {step}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <div className="flex w-full justify-between font-mono text-caption text-muted-foreground sm:w-80" aria-hidden="true">
              <span>{low}</span>
              <span>{high}</span>
            </div>
          </div>
        );
      })}
      <Field id={`${uid}-personality`} label="Personality in a few words">
        <ChipInput id={`${uid}-personality`} values={form.personality} onChange={(v) => set("personality", v)} maxItems={5} placeholder="e.g. Warm" />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id={`${uid}-like`} label="Write like this">
          <ChipInput id={`${uid}-like`} values={form.writeLike} onChange={(v) => set("writeLike", v)} maxItems={6} placeholder="e.g. Plain words" />
        </Field>
        <Field id={`${uid}-never`} label="Never like this">
          <ChipInput id={`${uid}-never`} values={form.neverLike} onChange={(v) => set("neverLike", v)} maxItems={6} placeholder="e.g. Jargon" />
        </Field>
        <Field id={`${uid}-prefer`} label="Words you use">
          <ChipInput id={`${uid}-prefer`} values={form.preferredWords} onChange={(v) => set("preferredWords", v)} maxItems={12} />
        </Field>
        <Field id={`${uid}-avoid`} label="Words you never use">
          <ChipInput id={`${uid}-avoid`} values={form.avoidWords} onChange={(v) => set("avoidWords", v)} maxItems={12} />
        </Field>
      </div>
      <Field id={`${uid}-language`} label="Language and spelling">
        <Input
          id={`${uid}-language`}
          value={form.language ?? ""}
          onChange={(e) => set("language", e.target.value || undefined)}
          maxLength={40}
          placeholder="e.g. British English"
          className="sm:w-80"
        />
      </Field>
    </Group>
  );
}

/* ── How you look: colours with live contrast, fonts, imagery ────────────── */

function LookGroup({ uid, form, set, projectName }: GroupProps & { projectName: string }) {
  const checks = useMemo(() => brandContrastChecks(form.colors), [form.colors]);
  const setColor = (role: ColorRole, value: string) => {
    const next = { ...form.colors };
    const hex = normalizeHex(value);
    if (hex) next[role] = hex;
    else if (!value.trim()) delete next[role];
    else return;
    set("colors", next);
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

  return (
    <Group title="How you look" intro="Colours, fonts and imagery. MOSAI checks the colours are readable for everyone.">
      <div className="grid gap-3 sm:grid-cols-2">
        {COLOR_ROLES.map((role) => (
          <ColorField key={role} id={`${uid}-color-${role}`} role={role} value={form.colors[role]} onChange={(v) => setColor(role, v)} />
        ))}
      </div>

      {checks.length ? (
        <div className="grid gap-1.5" aria-live="polite">
          <p className="text-sm font-medium">Readability check</p>
          <ul className="grid gap-1">
            {checks.map((check) => (
              <li key={check.id} className="flex items-center gap-2 font-mono text-caption">
                {check.passes ? (
                  <Check className="size-3.5 shrink-0 text-terminal-green" aria-hidden="true" />
                ) : (
                  <X className="size-3.5 shrink-0 text-terminal-red" aria-hidden="true" />
                )}
                <span className="min-w-0">
                  {check.label}: {check.ratio}:1{" "}
                  <span className={check.passes ? "text-muted-foreground" : "text-terminal-red"}>
                    {check.passes ? "readable" : `too faint — needs ${check.use === "text" ? "4.5" : "3"}:1`}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <FontField id={`${uid}-heading-font`} listId={`${uid}-fonts`} label="Heading font" value={form.headingFont} onChange={(v) => set("headingFont", v)} />
        <FontField id={`${uid}-body-font`} listId={`${uid}-fonts`} label="Body font" value={form.bodyFont} onChange={(v) => set("bodyFont", v)} />
      </div>
      <datalist id={`${uid}-fonts`}>
        {FONT_SUGGESTIONS.map((font) => <option key={font} value={font} />)}
      </datalist>

      <Field id={`${uid}-shape`} label="Corners">
        <Select value={form.shape ?? ""} onValueChange={(value) => set("shape", value as BrandProfile["shape"])}>
          <SelectTrigger id={`${uid}-shape`} className="w-full sm:w-60">
            <SelectValue placeholder="Choose a style" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="sharp">Sharp — precise, formal</SelectItem>
            <SelectItem value="soft">Soft — friendly, modern</SelectItem>
            <SelectItem value="round">Round — playful, approachable</SelectItem>
          </SelectContent>
        </Select>
      </Field>

      <Field id={`${uid}-imagery`} label="Photo and image style" help="Guides image choices and AI image prompts.">
        <ChipInput
          id={`${uid}-imagery`}
          ariaDescribedBy={`${uid}-imagery-help`}
          values={form.imageryStyle}
          onChange={(v) => set("imageryStyle", v)}
          maxItems={5}
          placeholder="e.g. Natural light, real projects, no stock people"
        />
      </Field>

      <Button variant="outline" size="sm" className="h-auto w-fit whitespace-normal text-left" onClick={downloadTokens}>
        <Download className="size-4" aria-hidden="true" /> Download for designers (design tokens)
      </Button>
    </Group>
  );
}

function FontField({ id, listId, label, value, onChange }: { id: string; listId: string; label: string; value?: string; onChange: (v: string | undefined) => void }) {
  return (
    <Field id={id} label={label}>
      <Input id={id} list={listId} value={value ?? ""} onChange={(e) => onChange(e.target.value || undefined)} maxLength={60} placeholder="e.g. Inter" />
    </Field>
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
      <Label htmlFor={id} className="capitalize">{role}</Label>
      <p id={`${id}-help`} className="font-mono text-caption text-muted-foreground">{COLOR_HELP[role]}</p>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`Pick ${role} colour`}
          value={value ?? "#ffffff"}
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

/* ── Check copy against the brand (brand voice reviewer agent) ───────────── */

const VERDICT_TEXT = {
  on_brand: "On brand",
  needs_work: "Nearly there",
  off_brand: "Off brand",
} as const;

function BrandChecker({ project }: { project: Project }) {
  const uid = useId();
  const check = useAction(api.ai.checkBrandFit);
  const [text, setText] = useState("");
  const [channel, setChannel] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<BrandCheck | null>(null);

  const run = async () => {
    setBusy(true);
    setResult(null);
    try {
      setResult(await check({ projectId: project._id, text, channel: channel || undefined }));
    } catch (error) {
      toast.error("Couldn’t check the copy", { description: errorText(error) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Group title="Check a piece of copy" intro="Paste a post, email or page text. MOSAI scores it against your brand and suggests an on-brand version.">
      <Field id={`${uid}-copy`} label="Copy to check">
        <Textarea id={`${uid}-copy`} value={text} onChange={(e) => setText(e.target.value)} rows={5} maxLength={6000} />
      </Field>
      <Field id={`${uid}-channel`} label="Where it will appear (optional)">
        <Input id={`${uid}-channel`} value={channel} onChange={(e) => setChannel(e.target.value)} maxLength={80} placeholder="e.g. Instagram post, email, website" className="sm:w-80" />
      </Field>
      <Button onClick={run} disabled={busy || !text.trim()} className="w-fit">
        {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Sparkles className="size-4" aria-hidden="true" />}
        Check against my brand
      </Button>

      <div aria-live="polite">
        {result?.status === "needs_setup" ? (
          <p className="font-mono text-caption text-muted-foreground">Save your brand first, then check copy against it.</p>
        ) : result?.status === "checked" ? (
          <div className="grid gap-3 rounded-md border bg-card p-3">
            <p className="font-mono text-small font-medium">
              {VERDICT_TEXT[result.verdict]} · {result.score}/100
            </p>
            {result.issues.length ? (
              <ul className="grid gap-2">
                {result.issues.map((issue, index) => (
                  <li key={index} className="font-mono text-caption">
                    {issue.quote ? <span className="font-medium">“{issue.quote}” </span> : null}
                    <span className="text-muted-foreground">{issue.problem}</span>
                    {issue.fix ? <span className="block">Try: {issue.fix}</span> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="font-mono text-caption text-muted-foreground">No problems found.</p>
            )}
            {result.rewrite ? (
              <div className="grid gap-2 border-t pt-3">
                <p className="text-sm font-medium">On-brand version</p>
                <p className="whitespace-pre-wrap font-mono text-caption">{result.rewrite}</p>
                <Button
                  size="sm"
                  variant="outline"
                  className="w-fit"
                  onClick={() => {
                    void navigator.clipboard.writeText(result.rewrite ?? "").then(
                      () => toast.success("Copied"),
                      () => toast.error("Couldn’t copy"),
                    );
                  }}
                >
                  Copy
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </Group>
  );
}
