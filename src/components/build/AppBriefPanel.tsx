import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, CheckCircle2, FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { briefGaps } from "@/components/build/appBriefGaps";

type SourceRef =
  | { kind: "persona"; id: Id<"personas">; label: string; sourceVersion: string }
  | { kind: "journeyMap"; id: Id<"journeyMaps">; label: string; sourceVersion: string }
  | { kind: "contentPiece"; id: Id<"contentPieces">; label: string; sourceVersion: string };

export type AppBuild = {
  _id: Id<"builds">;
  projectId: Id<"projects">;
  name: string;
  idea?: string;
  appRequirements?: {
    state: "draft" | "reviewed";
    audience: "customer_facing" | "internal_team" | "both";
    goal: string;
    targetUsers: string;
    coreWorkflows: string[];
    constraints: string[];
    sourceRefs: SourceRef[];
    editedAt: number;
    reviewedAt?: number;
    reviewedBy?: Id<"users">;
  };
};

type Draft = {
  audience: "" | "customer_facing" | "internal_team" | "both";
  goal: string;
  targetUsers: string;
  coreWorkflows: string;
  constraints: string;
  sourceRefs: Array<{ kind: SourceRef["kind"]; id: string }>;
};

const APP_BRIEF_STEPS = ["Idea", "Audience", "Workflows", "Project context"] as const;
const APP_AUDIENCES = [
  { value: "customer_facing", title: "Customers", detail: "An app your customers use directly." },
  { value: "internal_team", title: "Your team", detail: "A tool that helps your team do its work." },
  { value: "both", title: "Both", detail: "One app serving customers and your team." },
] as const;

export function AppBriefPanel({ build }: { build: AppBuild }) {
  const personasResult = useQuery(api.personas.list, { projectId: build.projectId });
  const journeysResult = useQuery(api.journeys.list, { projectId: build.projectId });
  const contentResult = useQuery(api.content.list, { projectId: build.projectId });
  const sourcesLoaded = personasResult !== undefined && journeysResult !== undefined && contentResult !== undefined;
  const personas = personasResult ?? [];
  const journeys = journeysResult ?? [];
  const content = contentResult ?? [];
  const save = useMutation(api.builds.saveAppRequirements);
  const review = useMutation(api.builds.reviewAppRequirements);
  const reviewStatus = useQuery(api.builds.getAppRequirementsStatus, { buildId: build._id });
  const [draft, setDraft] = useState<Draft>(() => ({
    audience: build.appRequirements?.audience ?? "",
    goal: build.appRequirements?.goal ?? build.idea ?? "",
    targetUsers: build.appRequirements?.targetUsers ?? "",
    coreWorkflows: build.appRequirements?.coreWorkflows.join("\n") ?? "",
    constraints: build.appRequirements?.constraints.join("\n") ?? "",
    sourceRefs: build.appRequirements?.sourceRefs.map(({ kind, id }) => ({ kind, id })) ?? [],
  }));
  const [saving, setSaving] = useState(false);
  const [step, setStep] = useState(0);
  const reviewed = reviewStatus?.status === "fresh";
  const stale = reviewStatus?.status === "stale";
  const normalizedDraft = {
    audience: draft.audience,
    goal: draft.goal.trim(),
    targetUsers: draft.targetUsers.trim(),
    coreWorkflows: draft.coreWorkflows.split("\n").map((x) => x.trim()).filter(Boolean),
    constraints: draft.constraints.split("\n").map((x) => x.trim()).filter(Boolean),
    sourceRefs: draft.sourceRefs.map(({ kind, id }) => ({ kind, id })),
  };
  const persisted = build.appRequirements ? {
    audience: build.appRequirements.audience,
    goal: build.appRequirements.goal,
    targetUsers: build.appRequirements.targetUsers,
    coreWorkflows: build.appRequirements.coreWorkflows,
    constraints: build.appRequirements.constraints,
    sourceRefs: build.appRequirements.sourceRefs.map(({ kind, id }) => ({ kind, id })),
  } : null;
  const hasUnsavedChanges = !persisted || JSON.stringify(normalizedDraft) !== JSON.stringify(persisted);
  const canReview = Boolean(build.appRequirements && !hasUnsavedChanges &&
    normalizedDraft.goal && normalizedDraft.targetUsers && normalizedDraft.coreWorkflows.length > 0);
  const gaps = briefGaps(normalizedDraft);
  const stepComplete = [
    Boolean(normalizedDraft.goal),
    Boolean(normalizedDraft.audience && normalizedDraft.targetUsers),
    normalizedDraft.coreWorkflows.length > 0,
    true,
  ];
  const sources = [
    ...personas.map((x) => ({ kind: "persona" as const, id: x._id, label: x.name, detail: x.role ?? "Persona" })),
    ...journeys.map((x) => ({ kind: "journeyMap" as const, id: x._id, label: x.name, detail: "Customer journey" })),
    ...content.map((x) => ({ kind: "contentPiece" as const, id: x._id, label: x.title, detail: x.contentType ?? "Content" })),
  ];
  const missingRefs = sourcesLoaded
    ? draft.sourceRefs.filter((ref) => !sources.some((source) => source.kind === ref.kind && source.id === ref.id))
    : [];
  const toggleSource = (kind: SourceRef["kind"], id: string) => {
    const exists = draft.sourceRefs.some((ref) => ref.kind === kind && ref.id === id);
    setDraft((d) => ({ ...d, sourceRefs: exists
      ? d.sourceRefs.filter((ref) => ref.kind !== kind || ref.id !== id)
      : [...d.sourceRefs, { kind, id }] }));
  };
  const persist = async () => {
    setSaving(true);
    try {
      await save({
        buildId: build._id,
        requirements: {
          audience: draft.audience as Exclude<Draft["audience"], "">,
          goal: draft.goal.trim(),
          targetUsers: draft.targetUsers.trim(),
          coreWorkflows: draft.coreWorkflows.split("\n").map((x) => x.trim()).filter(Boolean),
          constraints: draft.constraints.split("\n").map((x) => x.trim()).filter(Boolean),
          sourceRefs: draft.sourceRefs.map((ref) => ({ ...ref, id: ref.id as never })),
        },
      });
      toast.success("Requirements saved", { description: "Context references are project records, not verification or execution evidence." });
    } catch (error) {
      toast.error("Could not save requirements", { description: error instanceof Error ? error.message : "Try again." });
    } finally {
      setSaving(false);
    }
  };
  const markReviewed = async () => {
    setSaving(true);
    try {
      await review({ buildId: build._id });
      toast.success("Requirements reviewed", { description: "This records your review; no app has been generated or run." });
    } catch (error) {
      toast.error("Could not record review", { description: error instanceof Error ? error.message : "Save requirements first." });
    } finally {
      setSaving(false);
    }
  };

  const sourceGroups = [
    { title: "Audiences", hint: "Who the app should serve", items: sources.filter((source) => source.kind === "persona") },
    { title: "Journeys", hint: "What people need to accomplish", items: sources.filter((source) => source.kind === "journeyMap") },
    { title: "Content", hint: "Existing material to build on", items: sources.filter((source) => source.kind === "contentPiece") },
  ];

  return <div>
    <div className="grid gap-5">
      <div className="flex items-start gap-3 rounded-md border bg-card p-3 text-muted-foreground">
        <FileText className="mt-0.5 size-4 shrink-0 text-terminal-green" aria-hidden="true" />
        <p className="font-mono text-caption">The brief is optional. Every chat request already uses it, plus your personas, journeys and products. Filling it in gives the AI sharper direction.</p>
      </div>

      <nav aria-label="App brief steps">
        <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {APP_BRIEF_STEPS.map((label, index) => (
            <li key={label}>
              <button type="button" aria-current={step === index ? "step" : undefined} onClick={() => setStep(index)} className={cn("flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left font-mono text-caption transition-colors", step === index ? "border-primary bg-accent text-foreground" : "bg-card text-muted-foreground hover:bg-accent")}>
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full border text-caption">{stepComplete[index] ? <CheckCircle2 className="size-4 text-terminal-green" aria-label="Complete" /> : index + 1}</span>
                <span>{label}</span>
              </button>
            </li>
          ))}
        </ol>
      </nav>

      <section className="grid gap-5 rounded-lg border bg-card p-5 sm:p-6" aria-labelledby="app-step-title">
        <div>
          <p className="font-mono text-caption text-muted-foreground">Step {step + 1} of {APP_BRIEF_STEPS.length}</p>
          <h2 id="app-step-title" className="mt-1 font-mono text-h2 font-semibold">
            {["What should your app help people do?", "Who is it for?", "What should people be able to do?", "What should the app learn from this project?"][step]}
          </h2>
          <p className="mt-2 font-mono text-caption text-muted-foreground">
            {["Start with the outcome. A sentence is enough; you can refine it later.", "Choose the main audience. You can describe the people in your own words.", "List the first important tasks, one per line. Keep the first version focused.", "Choose saved audiences, journeys, and content that should inform the brief."][step]}
          </p>
        </div>

        {step === 0 && <div className="grid gap-2">
          <Label htmlFor="app-goal">App idea</Label>
          <Textarea id="app-goal" autoFocus rows={6} value={draft.goal} onChange={(e) => setDraft({ ...draft, goal: e.target.value })} placeholder="For example: An app that helps customers compare service plans and request a quote." />
          <p className="font-mono text-caption text-muted-foreground">You can start with the problem you want to solve; no technical specification needed.</p>
        </div>}

        {step === 1 && <div className="grid gap-5">
          <fieldset className="grid gap-2">
            <legend className="font-mono text-small font-medium">Who should use this app?</legend>
            <div className="grid gap-2 sm:grid-cols-3">
              {APP_AUDIENCES.map((option) => <label key={option.value} className={cn("flex cursor-pointer items-start gap-3 rounded-md border p-4 transition-colors hover:bg-accent", draft.audience === option.value && "border-primary bg-accent")}>
                <input type="radio" name="app-audience" value={option.value} checked={draft.audience === option.value} onChange={() => setDraft({ ...draft, audience: option.value })} className="mt-1 accent-primary" />
                <span><span className="block font-mono text-small font-medium">{option.title}</span><span className="mt-1 block font-mono text-caption text-muted-foreground">{option.detail}</span></span>
              </label>)}
            </div>
          </fieldset>
          <div className="grid gap-2"><Label htmlFor="app-users">Describe the people who will use it</Label><Input id="app-users" value={draft.targetUsers} onChange={(e) => setDraft({ ...draft, targetUsers: e.target.value })} placeholder="For example: small business owners comparing providers" /></div>
        </div>}

        {step === 2 && <div className="grid gap-4">
          <div className="grid gap-2"><Label htmlFor="app-workflows">First things people need to do</Label><Textarea id="app-workflows" rows={5} value={draft.coreWorkflows} onChange={(e) => setDraft({ ...draft, coreWorkflows: e.target.value })} placeholder={"Find a service\nCompare options\nRequest a quote"} /><p className="font-mono text-caption text-muted-foreground">These become the core flows to design first. Add one action per line.</p></div>
          <details className="rounded-md border px-4 py-3">
            <summary className="cursor-pointer font-mono text-caption font-medium">Add constraints or must-haves (optional)</summary>
            <div className="mt-3 grid gap-2"><Label htmlFor="app-constraints">Anything the design must respect?</Label><Textarea id="app-constraints" rows={3} value={draft.constraints} onChange={(e) => setDraft({ ...draft, constraints: e.target.value })} placeholder={"Use our existing sign-in\nMeet accessibility requirements"} /><p className="font-mono text-caption text-muted-foreground">Add one requirement per line. You can leave this blank for now.</p></div>
          </details>
        </div>}

        {step === 3 && <section className="grid gap-4" aria-labelledby="app-context-heading">
          <div className="flex flex-wrap items-baseline justify-between gap-2"><div><h3 id="app-context-heading" className="font-mono text-small font-semibold">Project context</h3><p className="font-mono text-caption text-muted-foreground">Select records to reference in the brief. Saved labels don’t verify that the information is accurate.</p></div><span className="font-mono text-caption text-muted-foreground">{draft.sourceRefs.length} selected</span></div>
          {!sourcesLoaded ? <p role="status" className="rounded-md border p-3 font-mono text-caption text-muted-foreground">Loading saved project context…</p> : sources.length === 0 ? <p className="rounded-md border border-dashed p-4 font-mono text-caption text-muted-foreground">No audiences, journeys, or content saved yet. You can finish the brief and add context later.</p> : sourceGroups.filter((group) => group.items.length > 0).map((group) => <fieldset key={group.title} className="grid gap-2"><legend className="font-mono text-small font-medium">{group.title}<span className="ml-2 font-normal text-muted-foreground">{group.hint}</span></legend><div className="grid gap-2 sm:grid-cols-2">{group.items.map((source) => {
            const checked = draft.sourceRefs.some((ref) => ref.kind === source.kind && ref.id === source.id);
            return <label key={`${source.kind}:${source.id}`} className={cn("flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors hover:bg-accent", checked && "border-primary bg-accent")}><input type="checkbox" checked={checked} onChange={() => toggleSource(source.kind, source.id)} aria-label={`Use ${source.detail}: ${source.label}`} className="mt-1 accent-primary" /><span className="min-w-0"><span className="block break-words font-mono text-caption font-medium">{source.label}</span><span className="mt-1 block font-mono text-caption text-muted-foreground">{source.detail}</span></span></label>;
          })}</div></fieldset>)}
          {missingRefs.map((ref) => <div key={`missing:${ref.kind}:${ref.id}`} className="flex items-center justify-between gap-3 rounded-md border border-terminal-amber/40 p-3 font-mono text-caption text-terminal-amber"><span>Unavailable saved reference ({ref.kind})</span><Button variant="outline" size="sm" onClick={() => setDraft((d) => ({ ...d, sourceRefs: d.sourceRefs.filter((item) => item.kind !== ref.kind || item.id !== ref.id) }))}>Remove</Button></div>)}
          {build.appRequirements?.sourceRefs.length ? <details className="rounded-md border px-4 py-3"><summary className="cursor-pointer font-mono text-caption font-medium">Previously saved references</summary><div className="mt-2 grid gap-1 font-mono text-caption text-muted-foreground"><p>Saved {new Date(build.appRequirements.editedAt).toLocaleString()}:</p>{build.appRequirements.sourceRefs.map((ref) => <p key={`${ref.kind}:${ref.id}`}>{ref.label} · {ref.kind === "journeyMap" ? "Journey" : ref.kind === "contentPiece" ? "Content" : "Audience"}</p>)}</div></details> : null}
        </section>}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <Button variant="ghost" onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0}><ArrowLeft className="size-4" /> Back</Button>
          {step < APP_BRIEF_STEPS.length - 1 ? <Button onClick={() => setStep(Math.min(APP_BRIEF_STEPS.length - 1, step + 1))}>Continue <ArrowRight className="size-4" /></Button> : <div className="grid w-full gap-3 sm:w-auto sm:min-w-64">
            <div><p className="font-mono text-caption text-muted-foreground">Brief status: <strong>{reviewStatus === undefined ? "Checking…" : stale ? "Needs another review" : reviewed ? "Reviewed" : hasUnsavedChanges ? "Not saved yet" : "Draft saved"}</strong>{reviewed && reviewStatus?.status === "fresh" && reviewStatus.reviewedAt ? ` · ${new Date(reviewStatus.reviewedAt).toLocaleString()}` : ""}</p>{stale ? <p role="status" className="mt-1 font-mono text-caption text-terminal-amber">A saved source changed. Save the brief again, then review it.</p> : hasUnsavedChanges && build.appRequirements ? <p role="status" className="mt-1 font-mono text-caption text-terminal-amber">Save your changes before marking the brief reviewed.</p> : null}</div>
            <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={persist} disabled={saving || !draft.audience || !draft.goal.trim() || !draft.targetUsers.trim()}>{saving ? <Loader2 className="size-4 animate-spin" /> : null}Save brief</Button><Button onClick={markReviewed} disabled={saving || !canReview || reviewed || stale || reviewStatus === undefined}>{saving ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}Mark reviewed</Button></div>
          </div>}
        </div>
        {step === APP_BRIEF_STEPS.length - 1 && (gaps.save.length > 0 || gaps.review.length > 0) ? <div role="status" className="rounded-md border border-terminal-amber/40 p-3 font-mono text-caption text-terminal-amber">
          <p>{gaps.save.length > 0 ? "To save the brief, finish:" : "Before marking the brief reviewed, add:"}</p>
          <ul className="mt-2 grid gap-1">{[...gaps.save, ...gaps.review].map((gap) => <li key={gap.label}><button type="button" onClick={() => setStep(gap.step)} className="underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{gap.label} (step {gap.step + 1}: {APP_BRIEF_STEPS[gap.step]})</button></li>)}</ul>
        </div> : null}
      </section>
    </div>
  </div>;
}
