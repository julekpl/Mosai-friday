import { useState } from "react";
import { useAction, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { Loader2, Plus, Sparkles, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type JourneyStage = {
  stage: string;
  question: string;
  answer?: string;
};

export function JourneyDialog({
  projectId,
  persona,
  onDone,
}: {
  projectId: Id<"projects">;
  persona: {
    _id: Id<"personas">;
    name: string;
    role?: string;
    goals?: string[];
    pains?: string[];
    objections?: string[];
    channels?: string[];
    evidence?: string;
    journeyStages?: JourneyStage[];
  };
  onDone: () => void;
}) {
  const { snapshot } = useProjectSnapshotSafe(projectId);
  const generate = useAction(api.ai.generateJourney);
  const update = useMutation(api.personas.update);

  const [stages, setStages] = useState<JourneyStage[]>(
    persona.journeyStages ?? [],
  );
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);

  const setStage = (i: number, patch: Partial<JourneyStage>) =>
    setStages((prev) =>
      prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)),
    );

  const runGenerate = async () => {
    if (!snapshot || busy) return;
    setBusy(true);
    try {
      const result = await generate({
        project: snapshot,
        persona: {
          name: persona.name,
          role: persona.role,
          goals: persona.goals,
          pains: persona.pains,
          objections: persona.objections,
          channels: persona.channels,
          evidence: persona.evidence,
        },
      });
      setStages(result.stages);
      toast.success("Journey drafted", {
        description: "Review and tweak the stages, then save.",
      });
    } catch (e) {
      toast.error("Generation failed", {
        description: e instanceof Error ? e.message : "Try again.",
      });
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      const clean = stages.filter((s) => s.stage.trim() && s.question.trim());
      await update({ id: persona._id, journeyStages: clean.length ? clean : [] });
      toast.success("Journey saved");
      onDone();
    } catch (e) {
      toast.error("Save failed", {
        description: e instanceof Error ? e.message : "Try again.",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-4">
      <p className="font-mono text-caption text-muted-foreground">
        The buyer's path: what they ask at each stage, and how the business
        should answer.
      </p>

      {stages.length === 0 ? (
        <Button onClick={runGenerate} disabled={busy || !snapshot} variant="outline">
          {busy ? (
            <>
              <Loader2 className="size-4 animate-spin" /> Mapping journey…
            </>
          ) : (
            <>
              <Sparkles className="size-4" /> Map journey with AI
            </>
          )}
        </Button>
        ) : null}

      <div className="grid gap-3">
        {stages.map((s, i) => (
          <div key={i} className="rounded-md border bg-card p-3">
            <div className="flex items-center gap-2">
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-terminal-green-soft font-mono text-caption text-terminal-green">
                {i + 1}
              </span>
              <Input
                value={s.stage}
                onChange={(e) => setStage(i, { stage: e.target.value })}
                placeholder="Stage name (e.g. consideration)"
                className="h-8 font-mono text-caption"
              />
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`Remove stage ${i + 1}`}
                className="text-destructive"
                onClick={() => setStages((prev) => prev.filter((_, idx) => idx !== i))}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
            <div className="mt-2 grid gap-2">
              <div>
                <Label className="font-mono text-caption text-muted-foreground">
                  buyer asks
                </Label>
                <Input
                  value={s.question}
                  onChange={(e) => setStage(i, { question: e.target.value })}
                  placeholder="What is the buyer really asking here?"
                  className="mt-1 h-8 font-mono text-caption"
                />
              </div>
              <div>
                <Label className="font-mono text-caption text-muted-foreground">
                  business answers with
                </Label>
                <Textarea
                  value={s.answer ?? ""}
                  onChange={(e) => setStage(i, { answer: e.target.value })}
                  rows={2}
                  placeholder="Touchpoint, content, proof…"
                  className="mt-1 font-mono text-caption"
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      {stages.length > 0 && (
        <Button
          variant="ghost"
          className="w-fit"
          onClick={() => setStages((prev) => [...prev, { stage: "", question: "" }])}
        >
          <Plus className="size-4" /> Add stage
        </Button>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={save} disabled={saving}>
          {saving && <Loader2 className="size-4 animate-spin" />}
          Save journey
        </Button>
      </div>
    </div>
  );
}

/* Small local wrapper so this file owns its data need. */
import { useQuery } from "convex/react";
function useProjectSnapshotSafe(projectId: Id<"projects">) {
  const project = useQuery(api.projects.get, { id: projectId });
  const files = useQuery(api.files.list, { projectId });
  if (!project) return { snapshot: undefined };
  return {
    snapshot: {
      name: project.name,
      industry: project.industry,
      description: project.description,
      websiteUrl: project.websiteUrl,
      productsServices: project.productsServices,
      goals: project.goals,
      competitors: project.competitors,
      gmbTitle: project.websiteScan?.gmb?.title,
      gmbCategory: project.websiteScan?.gmb?.category,
      gmbRating: project.websiteScan?.gmb?.rating,
      gmbReviews: project.websiteScan?.gmb?.reviews,
      fileExcerpts: (files ?? [])
        .slice(0, 8)
        .map(
          (f) =>
            `- ${f.name}: ${(f.excerpt ?? "(no text extracted)").slice(0, 600)}`,
        ),
    },
  };
}
