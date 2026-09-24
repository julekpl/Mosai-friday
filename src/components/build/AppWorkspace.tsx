import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { ArrowLeft, CheckCircle2, Circle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ModuleHeader } from "@/components/app/AppShell";

type SourceRef =
  | { kind: "persona"; id: Id<"personas">; label: string; sourceVersion: string }
  | { kind: "journeyMap"; id: Id<"journeyMaps">; label: string; sourceVersion: string }
  | { kind: "contentPiece"; id: Id<"contentPieces">; label: string; sourceVersion: string };

type Build = {
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

export function AppWorkspace({ build, onBack }: { build: Build; onBack: () => void }) {
  const personas = useQuery(api.personas.list, { projectId: build.projectId }) ?? [];
  const journeys = useQuery(api.journeys.list, { projectId: build.projectId }) ?? [];
  const content = useQuery(api.content.list, { projectId: build.projectId }) ?? [];
  const save = useMutation(api.builds.saveAppRequirements);
  const review = useMutation(api.builds.reviewAppRequirements);
  const [draft, setDraft] = useState<Draft>(() => ({
    audience: build.appRequirements?.audience ?? "",
    goal: build.appRequirements?.goal ?? build.idea ?? "",
    targetUsers: build.appRequirements?.targetUsers ?? "",
    coreWorkflows: build.appRequirements?.coreWorkflows.join("\n") ?? "",
    constraints: build.appRequirements?.constraints.join("\n") ?? "",
    sourceRefs: build.appRequirements?.sourceRefs.map(({ kind, id }) => ({ kind, id })) ?? [],
  }));
  const [saving, setSaving] = useState(false);
  const reviewed = build.appRequirements?.state === "reviewed";
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
  const sources = [
    ...personas.map((x) => ({ kind: "persona" as const, id: x._id, label: x.name, detail: x.role ?? "Persona" })),
    ...journeys.map((x) => ({ kind: "journeyMap" as const, id: x._id, label: x.name, detail: "Customer journey" })),
    ...content.map((x) => ({ kind: "contentPiece" as const, id: x._id, label: x.title, detail: x.contentType ?? "Content" })),
  ];
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

  return <div>
    <ModuleHeader icon={Circle} title={`${build.name} · app requirements`} subtitle="Define and review the app brief. Source context is shown with its project provenance; execution and preview are not available yet.">
      <Button variant="outline" size="sm" onClick={onBack}><ArrowLeft className="size-4" /> Builds</Button>
    </ModuleHeader>
    <div className="grid max-w-3xl gap-5 rounded-lg border bg-card p-5">
      <div className="rounded-md border border-terminal-amber/40 bg-terminal-amber-soft p-3 font-mono text-caption text-terminal-amber">Requirements workspace only. This does not generate source code, run an app, create a preview, or deploy anything.</div>
      <div className="grid gap-2"><Label htmlFor="app-audience">App audience</Label><select id="app-audience" className="h-9 rounded-md border bg-card px-3 font-mono text-small" value={draft.audience} onChange={(e) => setDraft({ ...draft, audience: e.target.value as Draft["audience"] })}><option value="">Choose an audience</option><option value="customer_facing">Customers</option><option value="internal_team">Internal team</option><option value="both">Customers and internal team</option></select></div>
      <div className="grid gap-2"><Label htmlFor="app-goal">App goal</Label><Textarea id="app-goal" rows={3} value={draft.goal} onChange={(e) => setDraft({ ...draft, goal: e.target.value })} /></div>
      <div className="grid gap-2"><Label htmlFor="app-users">Target users</Label><Input id="app-users" value={draft.targetUsers} onChange={(e) => setDraft({ ...draft, targetUsers: e.target.value })} placeholder="Who will use this app?" /></div>
      <div className="grid gap-2"><Label htmlFor="app-workflows">Core workflows</Label><Textarea id="app-workflows" rows={4} value={draft.coreWorkflows} onChange={(e) => setDraft({ ...draft, coreWorkflows: e.target.value })} placeholder="One workflow per line" /></div>
      <div className="grid gap-2"><Label htmlFor="app-constraints">Constraints and requirements</Label><Textarea id="app-constraints" rows={3} value={draft.constraints} onChange={(e) => setDraft({ ...draft, constraints: e.target.value })} placeholder="One constraint per line" /></div>
      <section className="grid gap-2" aria-labelledby="app-context-heading">
        <h2 id="app-context-heading" className="font-mono text-small font-semibold">Project context used</h2>
        <p className="font-mono text-caption text-muted-foreground">Select the records that inform this brief. Labels come from saved project records; their presence does not certify their accuracy.</p>
        {sources.length === 0 ? <p className="rounded-md border p-3 font-mono text-caption text-muted-foreground">No personas, journeys or content are available yet. You can still write requirements and add context later.</p> : sources.map((source) => {
          const checked = draft.sourceRefs.some((ref) => ref.kind === source.kind && ref.id === source.id);
          return <label key={`${source.kind}:${source.id}`} className="flex cursor-pointer items-center gap-3 rounded-md border p-3 font-mono text-caption">
            <input type="checkbox" checked={checked} onChange={() => toggleSource(source.kind, source.id)} aria-label={`Use ${source.detail}: ${source.label}`} />
            <span className="font-semibold">{source.label}</span><span className="text-muted-foreground">{source.detail}</span>
          </label>;
        })}
        {build.appRequirements?.sourceRefs.length ? <div className="grid gap-1 font-mono text-caption text-muted-foreground"><p>Sources saved with this brief on {new Date(build.appRequirements.editedAt).toLocaleString()}:</p>{build.appRequirements.sourceRefs.map((ref) => <p key={`${ref.kind}:${ref.id}`}>{ref.label} · {ref.kind === "journeyMap" ? "Journey" : ref.kind === "contentPiece" ? "Content" : "Persona"}</p>)}</div> : null}
      </section>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
        <div><p className="font-mono text-caption text-muted-foreground">Review status: <strong>{reviewed ? "Reviewed" : "Draft"}</strong>{reviewed && build.appRequirements?.reviewedAt ? ` · ${new Date(build.appRequirements.reviewedAt).toLocaleString()}` : ""}</p>{hasUnsavedChanges ? <p role="status" className="font-mono text-caption text-terminal-amber">Unsaved changes. Save this brief before review.</p> : null}</div>
        <div className="flex gap-2"><Button variant="outline" onClick={persist} disabled={saving || !draft.audience || !draft.goal.trim() || !draft.targetUsers.trim()}>{saving ? <Loader2 className="size-4 animate-spin" /> : null}Save requirements</Button><Button onClick={markReviewed} disabled={saving || !canReview || reviewed}>{saving ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}Mark reviewed</Button></div>
      </div>
    </div>
  </div>;
}
