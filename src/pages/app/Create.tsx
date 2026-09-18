import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import {
  Check,
  Loader2,
  PenTool,
  Plus,
  Send,
  Trash2,
} from "lucide-react";

import { ModuleHeader } from "@/components/app/AppShell";
import {
  ConfirmDelete,
  ModuleEmpty,
  StatusBadge,
} from "@/components/app/module-kit";
import { Route as RouteIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

const SURFACES = ["website", "email", "social", "ads"] as const;

function ContentForm({
  projectId,
  onDone,
}: {
  projectId: Id<"projects">;
  onDone: () => void;
}) {
  const personas = useQuery(api.personas.list, { projectId }) ?? [];
  const journeys = useQuery(api.journeys.list, { projectId }) ?? [];
  const create = useMutation(api.content.create);
  const [title, setTitle] = useState("");
  const [topic, setTopic] = useState("");
  const [brief, setBrief] = useState("");
  const [surface, setSurface] = useState<(typeof SURFACES)[number]>("website");
  const [personaId, setPersonaId] = useState<string>("");
  const [journeyId, setJourneyId] = useState<string>("");
  const [isSaving, setIsSaving] = useState(false);

  // Content research seeded from the selected journey: lowest-score stages
  // (worst experience) become the strongest content opportunities.
  const selectedJourney = journeys.find((j) => j._id === journeyId);
  const journeyResearch = selectedJourney
    ? [...selectedJourney.stages]
        .sort((a, b) => (a.score ?? 5) - (b.score ?? 5))
        .slice(0, 4)
        .map((s) => ({
          stage: s.stage,
          score: s.score,
          pain: s.cells[3] ?? "",
          opportunity: s.cells[4] ?? "",
        }))
    : [];

  const applyStage = (s: { stage: string; pain: string; opportunity: string }) => {
    if (!topic) setTopic(`${selectedJourney?.name ?? "journey"} — ${s.stage.toLowerCase()}`);
    const parts = [
      s.pain ? `Pain: ${s.pain}` : "",
      s.opportunity ? `Opportunity: ${s.opportunity}` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    setBrief((prev) => (prev ? `${prev}
${parts}` : parts));
  };

  const handleSave = async () =>
    {if (!title.trim()) return;
    setIsSaving(true);
    try {
      await create({
        projectId,
        title: title.trim(),
        topic: topic.trim() || undefined,
        brief: brief.trim() || undefined,
        surface,
        personaId: (personaId || undefined) as Id<"personas"> | undefined,
      });
      toast.success("Content piece created");
      onDone();
    } catch (e) {
      toast.error("Save failed", {
        description: e instanceof Error ? e.message : "Try again.",
      });
      setIsSaving(false);
    }
  };

  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor="cf-title">Title / working title</Label>
        <Input
          id="cf-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Best coffee subscriptions for offices"
          autoFocus
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="cf-topic">Topic cluster</Label>
        <Input
          id="cf-topic"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="e.g. office coffee buying guides"
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="cf-brief">Brief (the gap this fills)</Label>
        <Textarea
          id="cf-brief"
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          rows={3}
          placeholder="What question does this answer, for whom, and why us?"
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="cf-surface">Surface</Label>
          <select
            id="cf-surface"
            className="h-9 rounded-md border bg-card px-3 font-mono text-small"
            value={surface}
            onChange={(e) => setSurface(e.target.value as (typeof SURFACES)[number])}
          >
            {SURFACES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="cf-persona">Persona</Label>
          <select
            id="cf-persona"
            className="h-9 rounded-md border bg-card px-3 font-mono text-small"
            value={personaId}
            onChange={(e) => setPersonaId(e.target.value)}
          >
            <option value="">— none —</option>
            {personas.map((p) => (
              <option key={p._id} value={p._id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      {/* Journey-based content research */}
      {journeys.length > 0 && (
        <div className="grid gap-2 rounded-md border border-dashed p-3">
          <div className="flex items-center gap-2">
            <RouteIcon className="size-4 text-terminal-green" />
            <Label className="font-mono text-caption text-muted-foreground">
              research from a journey map
            </Label>
          </div>
          <select
            className="h-9 rounded-md border bg-card px-3 font-mono text-small"
            value={journeyId}
            onChange={(e) => setJourneyId(e.target.value)}
          >
            <option value="">— pick a journey —</option>
            {journeys.map((j) => (
              <option key={j._id} value={j._id}>
                {j.name} ({j.stages.length} stages)
              </option>
            ))}
          </select>
          {journeyResearch.length > 0 && (
            <div className="grid gap-1.5">
              <p className="font-mono text-caption text-muted-foreground">
                weakest stages first — click to seed this brief:
              </p>
              {journeyResearch.map((s) => (
                <button
                  key={s.stage}
                  type="button"
                  className="rounded-sm border px-2.5 py-1.5 text-left font-mono text-caption ease-terminal hover:border-terminal-green/50 hover:bg-terminal-green-soft"
                  onClick={() => applyStage(s)}
                >
                  <span className="text-terminal-green">{s.stage}</span>
                  {typeof s.score === "number" && (
                    <span className="ml-1 text-muted-foreground">({s.score}/10)</span>
                  )}
                  {s.pain && <span className="ml-2 text-muted-foreground">{s.pain}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={isSaving || !title.trim()}>
          {isSaving && <Loader2 className="size-4 animate-spin" />}
          Create
        </Button>
      </div>
    </div>
  );
}

export default function Create({ projectId }: { projectId: Id<"projects"> }) {
  const pieces = useQuery(api.content.list, { projectId }) ?? [];
  const remove = useMutation(api.content.remove);
  const update = useMutation(api.content.update);
  const [open, setOpen] = useState(false);

  return (
    <div>
      <ModuleHeader
        icon={PenTool}
        title="Create"
        subtitle="Content planning & generation — briefs linked to personas and gaps"
      >
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="size-4" /> New content piece
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="font-mono text-h3">
                New content piece
              </DialogTitle>
              <DialogDescription className="font-mono text-caption">
                Briefs feed the website builder, email and social — with the
                persona baked in.
              </DialogDescription>
            </DialogHeader>
            <ContentForm projectId={projectId} onDone={() => setOpen(false)} />
          </DialogContent>
        </Dialog>
      </ModuleHeader>

      {pieces.length === 0 ? (
        <ModuleEmpty
          icon={PenTool}
          title="No content pieces yet"
          hint="Start from a question your persona asks that no one answers well. Every brief here can flow to the website builder, email or social."
          action={
            <Button onClick={() => setOpen(true)}>
              <Plus className="size-4" /> Create the first brief
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3">
          {pieces.map((c) => (
            <div
              key={c._id}
              className="flex flex-wrap items-center gap-3 rounded-md border bg-card p-4 shadow-card"
            >
              <div className="min-w-0 flex-1">
                <p className="font-mono text-small font-medium">{c.title}</p>
                <p className="font-mono text-caption text-muted-foreground">
                  {c.topic ? `${c.topic} · ` : ""}
                  {c.surface ?? "no surface"} · updated{" "}
                  {new Date(c.updatedAt).toLocaleDateString()}
                </p>
              </div>
              <Badge
                variant="outline"
                className="hidden font-mono text-caption text-muted-foreground sm:inline-flex"
              >
                {c.surface ?? "unassigned"}
              </Badge>
              <StatusBadge status={c.status} />
              {c.status === "draft" && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    try {
                      await update({ id: c._id, status: "approved" });
                      toast.success("Brief approved — ready to generate", {
                        description:
                          "Approved briefs feed the website builder and campaigns.",
                      });
                    } catch (e) {
                      toast.error("Approve failed", {
                        description:
                          e instanceof Error ? e.message : "Try again.",
                      });
                    }
                  }}
                >
                  <Check className="size-3.5" /> Approve
                </Button>
              )}
              {c.status === "approved" && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    try {
                      await update({
                        id: c._id,
                        status: "published",
                        body: c.body ?? `Draft body for: ${c.title}`,
                      });
                      toast.success("Published");
                    } catch (e) {
                      toast.error("Publish failed", {
                        description:
                          e instanceof Error ? e.message : "Try again.",
                      });
                    }
                  }}
                >
                  <Send className="size-3.5" /> Publish
                </Button>
              )}
              <ConfirmDelete
                what={`"${c.title}"`}
                onConfirm={async () => {
                  await remove({ id: c._id });
                  toast.success("Content piece deleted");
                }}
                trigger={
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Delete ${c.title}`}
                    className="text-destructive"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                }
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
