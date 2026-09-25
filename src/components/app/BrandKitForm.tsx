import { useId, useState, type ReactNode } from "react";
import { useAction, useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Loader2, Plus, RefreshCw, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import {
  BRAND_USES,
  DEFAULT_VOICE,
  VOICE_DIMENSIONS,
  brandApplies,
  describeVoice,
  type BrandProfile,
  type BrandShape,
  type MessagePillar,
} from "@/convex/lib/brandProfile";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { AiTextAssist, ChipField } from "@/components/app/brand/AiAssist";
import { BrandUseSettings } from "@/components/app/brand/BrandUse";
import { BRAND_USE_COPY } from "@/components/app/brand/brandUseCopy";
import { errorText, useBrandAssist } from "@/components/app/brand/useBrandAssist";
import { LookControls } from "@/components/app/brand/LookControls";
import { VoicePresets, VoiceScaleControl } from "@/components/app/brand/VoiceControls";

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

/** Starter ideas: one tap adds them; the owner edits freely afterwards. */
const STARTERS = {
  personality: ["Warm", "Friendly", "Expert", "Trustworthy", "Bold", "Playful", "Calm", "Honest", "Premium", "Down-to-earth", "Innovative", "Caring", "Confident", "Straightforward", "Energetic", "Thoughtful"],
  writeLike: ["Short sentences", "Plain words a customer uses", "Talk to “you”, not “customers”", "Lead with the benefit", "Specific numbers over adjectives", "Explain any jargon"],
  neverLike: ["Jargon without explanation", "Hype and superlatives", "Pushy sales talk", "Stiff corporate voice", "Walls of text", "Fake urgency"],
  avoidWords: ["cheap", "world-class", "revolutionary", "cutting-edge", "synergy", "best-in-class", "hassle-free"],
  imageryStyle: ["Real photos of our work", "Natural light", "People using the product", "No generic stock photos", "Bright and airy", "Warm and moody", "Clean flat illustrations", "Close-up details"],
} as const;

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

function Group({ step, title, intro, children }: { step?: string; title: string; intro: string; children: ReactNode }) {
  return (
    <fieldset className="grid min-w-0 grid-cols-1 gap-4 rounded-lg border p-4">
      <legend className="flex items-center gap-2 px-1 font-mono text-small font-medium">
        {step ? (
          <span className="grid size-6 place-items-center rounded-full bg-terminal-green-soft font-mono text-caption text-terminal-green-ink" aria-hidden="true">
            {step}
          </span>
        ) : null}
        {title}
      </legend>
      <p className="-mt-2 font-mono text-caption text-muted-foreground">{intro}</p>
      {children}
    </fieldset>
  );
}

/** A text field with "Write with AI" / "Improve" beside its label. */
function AiTextField({
  project,
  id,
  label,
  help,
  field,
  value,
  onChange,
  related,
  multiline,
  maxLength,
  placeholder,
}: {
  project: Project;
  id: string;
  label: string;
  help?: string;
  field: Parameters<typeof AiTextAssist>[0]["field"];
  value: string;
  onChange: (value: string) => void;
  related?: string;
  multiline?: boolean;
  maxLength: number;
  placeholder?: string;
}) {
  return (
    <div className="grid min-w-0 gap-1.5">
      <div className="flex flex-wrap items-center justify-between gap-1">
        <Label htmlFor={id}>{label}</Label>
        <AiTextAssist projectId={project._id} field={field} value={value} related={related} label={label.toLowerCase()} onPick={onChange} />
      </div>
      {help ? <p id={`${id}-help`} className="font-mono text-caption text-muted-foreground">{help}</p> : null}
      {multiline ? (
        <Textarea id={id} aria-describedby={help ? `${id}-help` : undefined} value={value} onChange={(e) => onChange(e.target.value)} rows={3} maxLength={maxLength} placeholder={placeholder} />
      ) : (
        <Input id={id} aria-describedby={help ? `${id}-help` : undefined} value={value} onChange={(e) => onChange(e.target.value)} maxLength={maxLength} placeholder={placeholder} />
      )}
    </div>
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
 * Edit project → Brand. Plain-language groups (what you say, how you sound,
 * how you look, where it's used) with AI help on every field. Behind it: a
 * messaging house, NN/g tone dimensions, WCAG contrast repair, font pairing
 * rules and a DTCG token export.
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
      toast.success(confirm ? "Brand confirmed — AI now writes with it" : "Saved");
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
  const usedIn = BRAND_USES.filter((use) => brandApplies(project.brandUse, use)).map((use) => BRAND_USE_COPY[use].module);

  return (
    <div className="grid grid-cols-1 gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-md border bg-card p-3">
        <div className="grid gap-1">
          <p className="font-mono text-small font-medium">Your brand</p>
          <p className="font-mono text-caption text-muted-foreground">
            What you say, how you sound and how you look. Used by AI in: {usedIn.length ? usedIn.join(", ") : "nowhere yet"}.
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
          <MessagingGroup uid={uid} project={project} form={form} set={set} />
          <VoiceGroup uid={uid} project={project} form={form} set={set} />
          <Group step="3" title="How you look" intro="Colours, fonts and imagery. Everything is checked so it stays readable for everyone.">
            <ShapePicker value={form.shape} onChange={(shape) => set("shape", shape)} />
            <LookControls uid={uid} projectId={project._id} projectName={project.name} form={form} set={set} />
            <ChipField
              projectId={project._id}
              id={`${uid}-imagery`}
              label="Photo and image style"
              help="Guides image choices and AI image prompts."
              field="imageryStyle"
              values={form.imageryStyle}
              onChange={(v) => set("imageryStyle", v)}
              max={5}
              starters={STARTERS.imageryStyle}
            />
          </Group>

          <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap gap-2 border-t bg-background/95 px-1 py-3 backdrop-blur">
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

      <Group step={hasBrand || manual ? "4" : undefined} title="Where AI uses your brand" intro="Switch it off for any area where you want AI to write without it. Changes apply straight away.">
        <BrandUseSettings project={project} />
      </Group>
    </div>
  );
}

type GroupProps = {
  uid: string;
  project: Project;
  form: BrandProfile;
  set: <K extends keyof BrandProfile>(key: K, value: BrandProfile[K]) => void;
};

/* ── What you say: positioning and the messaging house ───────────────────── */

function MessagingGroup({ uid, project, form, set }: GroupProps) {
  const pillarsAi = useBrandAssist(project._id);
  const [suggested, setSuggested] = useState<MessagePillar[]>([]);
  const setPillar = (index: number, patch: Partial<MessagePillar>) =>
    set("pillars", form.pillars.map((pillar, i) => (i === index ? { ...pillar, ...patch } : pillar)));
  const suggestPillars = async () => {
    const result = await pillarsAi.run({
      field: "pillars",
      related: [form.promise && `Promise: ${form.promise}`, ...form.pillars.map((p) => `Existing key message: ${p.title}: ${p.message}`)].filter(Boolean).join("\n") || undefined,
    });
    if (result?.kind === "pillars") setSuggested(result.pillars);
  };
  const taken = new Set(form.pillars.map((pillar) => pillar.title.toLowerCase()));

  return (
    <Group step="1" title="What you say" intro="One promise, a few key messages, and the proof behind them. AI can draft or improve every line.">
      <AiTextField
        project={project}
        id={`${uid}-promise`}
        label="Brand promise"
        help="The one thing customers can always count on. Short enough to remember."
        field="promise"
        value={form.promise}
        onChange={(v) => set("promise", v)}
        related={form.positioning || undefined}
        maxLength={400}
        placeholder="e.g. A home designed around your family, on budget"
      />
      <AiTextField
        project={project}
        id={`${uid}-positioning`}
        label="Why you, not someone else"
        help="Who it’s for, and what you do better than their alternatives."
        field="positioning"
        value={form.positioning}
        onChange={(v) => set("positioning", v)}
        related={form.promise || undefined}
        multiline
        maxLength={400}
      />

      <div className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium">Key messages</p>
          <Button type="button" size="sm" variant="outline" onClick={suggestPillars} disabled={pillarsAi.busy}>
            {pillarsAi.busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Sparkles className="size-4" aria-hidden="true" />}
            {form.pillars.length ? "Suggest more" : "Suggest key messages"}
          </Button>
        </div>
        <p className="-mt-2 font-mono text-caption text-muted-foreground">
          2–4 reasons to believe your promise. Each one becomes a theme for posts, pages and emails.
        </p>

        <div aria-live="polite" className="grid gap-2">
          {pillarsAi.error ? <p className="font-mono text-caption text-terminal-red" role="alert">{pillarsAi.error}</p> : null}
          {suggested.filter((pillar) => !taken.has(pillar.title.toLowerCase())).map((pillar) => (
            <div key={pillar.title} className="grid gap-1.5 rounded-md border border-dashed border-terminal-green/50 bg-terminal-green-soft/40 p-3">
              <p className="font-mono text-small font-medium">{pillar.title}</p>
              <p className="text-sm">{pillar.message}</p>
              {pillar.proofPoints.length ? (
                <p className="font-mono text-caption text-muted-foreground">Proof found: {pillar.proofPoints.join("; ")}</p>
              ) : null}
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="h-7 w-fit"
                disabled={form.pillars.length >= 4}
                onClick={() => set("pillars", [...form.pillars, pillar])}
              >
                <Plus className="size-3.5" aria-hidden="true" /> {form.pillars.length >= 4 ? "Four is the maximum" : "Add this message"}
              </Button>
            </div>
          ))}
        </div>

        {form.pillars.map((pillar, index) => (
          <div key={index} className="grid min-w-0 gap-3 rounded-lg border bg-card p-3">
            <div className="flex items-start gap-2">
              <span className="mt-2 grid size-6 shrink-0 place-items-center rounded-full border font-mono text-caption" aria-hidden="true">{index + 1}</span>
              <div className="grid min-w-0 flex-1 gap-3">
                <AiTextField
                  project={project}
                  id={`${uid}-pillar-${index}`}
                  label={`Key message ${index + 1} title`}
                  field="pillarTitle"
                  value={pillar.title}
                  onChange={(v) => setPillar(index, { title: v })}
                  related={pillar.message || undefined}
                  maxLength={120}
                  placeholder="Short title, e.g. Fixed fees"
                />
                <AiTextField
                  project={project}
                  id={`${uid}-pillar-${index}-msg`}
                  label="Message"
                  field="pillarMessage"
                  value={pillar.message}
                  onChange={(v) => setPillar(index, { message: v })}
                  related={[pillar.title && `Title: ${pillar.title}`, form.promise && `Promise: ${form.promise}`].filter(Boolean).join("; ") || undefined}
                  multiline
                  maxLength={400}
                  placeholder="The message, in one or two sentences"
                />
                <ChipField
                  projectId={project._id}
                  id={`${uid}-pillar-${index}-proof`}
                  label="Proof"
                  help="Facts only. AI never claims more than this."
                  field="proofPoints"
                  aiLabel="Find proof in my website"
                  values={pillar.proofPoints}
                  onChange={(v) => setPillar(index, { proofPoints: v })}
                  max={4}
                  related={`${pillar.title}: ${pillar.message}`}
                  placeholder="e.g. 120 homes designed since 2012"
                />
              </div>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`Remove key message ${pillar.title || index + 1}`}
                onClick={() => set("pillars", form.pillars.filter((_, i) => i !== index))}
              >
                <X className="size-3.5" aria-hidden="true" />
              </Button>
            </div>
          </div>
        ))}
        {form.pillars.length < 4 ? (
          <Button
            variant="ghost"
            size="sm"
            className="w-fit"
            onClick={() => set("pillars", [...form.pillars, { title: "", message: "", proofPoints: [] }])}
          >
            <Plus className="size-4" aria-hidden="true" /> Write one myself
          </Button>
        ) : null}
      </div>

      <AiTextField
        project={project}
        id={`${uid}-tagline`}
        label="Tagline (optional)"
        field="tagline"
        value={form.tagline ?? ""}
        onChange={(v) => set("tagline", v || undefined)}
        related={form.promise || undefined}
        maxLength={120}
      />
      <AiTextField
        project={project}
        id={`${uid}-pitch`}
        label="Elevator pitch (optional)"
        help="How you’d describe the business in 20 seconds."
        field="elevatorPitch"
        value={form.elevatorPitch ?? ""}
        onChange={(v) => set("elevatorPitch", v || undefined)}
        related={form.promise || undefined}
        multiline
        maxLength={600}
      />
    </Group>
  );
}

/* ── How you sound: presets, NN/g tone scales with examples, word rules ──── */

function VoiceGroup({ uid, project, form, set }: GroupProps) {
  return (
    <Group step="2" title="How you sound" intro="Your voice stays the same everywhere; AI adapts only the tone to the channel.">
      <VoicePresets
        voice={form.voice}
        onPick={(preset) => {
          set("voice", preset.voice);
          const merged = [...form.personality];
          for (const trait of preset.personality) {
            if (merged.length < 5 && !merged.some((item) => item.toLowerCase() === trait.toLowerCase())) merged.push(trait);
          }
          set("personality", merged);
        }}
      />
      <p className="font-mono text-caption text-muted-foreground" aria-live="polite">
        Your voice: {describeVoice(form.voice)}.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {VOICE_DIMENSIONS.map((dimension) => (
          <VoiceScaleControl
            key={dimension}
            dimension={dimension}
            value={form.voice[dimension]}
            onChange={(value) => set("voice", { ...form.voice, [dimension]: value })}
          />
        ))}
      </div>
      <ChipField
        projectId={project._id}
        id={`${uid}-personality`}
        label="Personality in a few words"
        field="personality"
        values={form.personality}
        onChange={(v) => set("personality", v)}
        max={5}
        starters={STARTERS.personality}
        placeholder="Type your own and press Enter"
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <ChipField projectId={project._id} id={`${uid}-like`} label="Write like this" field="writeLike" values={form.writeLike} onChange={(v) => set("writeLike", v)} max={6} starters={STARTERS.writeLike} aiLabel="Suggest" />
        <ChipField projectId={project._id} id={`${uid}-never`} label="Never like this" field="neverLike" values={form.neverLike} onChange={(v) => set("neverLike", v)} max={6} starters={STARTERS.neverLike} aiLabel="Suggest" />
        <ChipField projectId={project._id} id={`${uid}-prefer`} label="Words you use" help="Your customers’ own words." field="preferredWords" values={form.preferredWords} onChange={(v) => set("preferredWords", v)} max={12} aiLabel="Suggest" />
        <ChipField projectId={project._id} id={`${uid}-avoid`} label="Words you never use" field="avoidWords" values={form.avoidWords} onChange={(v) => set("avoidWords", v)} max={12} starters={STARTERS.avoidWords} aiLabel="Suggest" />
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

/* ── Corner style as visual choices ──────────────────────────────────────── */

const SHAPES: Array<{ value: BrandShape; name: string; mood: string; radius: string }> = [
  { value: "sharp", name: "Sharp", mood: "Precise, formal", radius: "rounded-sm" },
  { value: "soft", name: "Soft", mood: "Friendly, modern", radius: "rounded-lg" },
  { value: "round", name: "Round", mood: "Playful, approachable", radius: "rounded-2xl" },
];

function ShapePicker({ value, onChange }: { value?: BrandShape; onChange: (shape: BrandShape) => void }) {
  return (
    <div className="grid gap-2">
      <p className="text-sm font-medium" id="brand-shape-label">Corners</p>
      <div role="radiogroup" aria-labelledby="brand-shape-label" className="grid grid-cols-3 gap-2">
        {SHAPES.map((shape) => (
          <button
            key={shape.value}
            type="button"
            role="radio"
            aria-checked={value === shape.value}
            onClick={() => onChange(shape.value)}
            className={cn(
              "grid justify-items-start gap-1.5 rounded-lg border bg-card p-2.5 text-left transition-all ease-terminal hover:shadow-soft",
              value === shape.value && "border-terminal-green/60 ring-2 ring-terminal-green/30",
            )}
          >
            <span className={cn("h-6 w-full border-2 border-foreground/70 bg-muted", shape.radius)} aria-hidden="true" />
            <span className="font-mono text-caption font-medium">{shape.name}</span>
            <span className="font-mono text-caption text-muted-foreground">{shape.mood}</span>
          </button>
        ))}
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
