import { useMemo, useState } from "react";
import { Link } from "react-router";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import {
  Download,
  FileUp,
  Loader2,
  Map,
  Pen,
  Plus,
  Route,
  Sparkles,
  Trash2,
} from "lucide-react";

import { ModuleHeader } from "@/components/app/AppShell";
import { ModuleEmpty } from "@/components/app/module-kit";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { journeySourceForNewMap } from "@/lib/journey-origin";

type Stage = { stage: string; cells: string[]; score?: number };
type JourneyDoc = {
  _id: Id<"journeyMaps">;
  projectId: Id<"projects">;
  personaId?: Id<"personas">;
  name: string;
  goal?: string;
  lanes?: string[];
  stages: Stage[];
  source: "manual" | "ai" | "csv";
  createdAt: number;
};

const FALLBACK_LANES = [
  "Actions",
  "Thoughts",
  "Feelings",
  "Pain points",
  "Opportunities",
];

/* ── CSV import: mcoulthurst/user-journey layout ───────────────────────── *
 * First column = row title, second = color (ignored). TITLE_BLOCK row
 * carries the stage names. SCORE row carries the experience scores.
 * Any other row becomes a lane with that title.
 */
function parseJourneyCsv(text: string): {
  name: string;
  lanes: string[];
  stages: Stage[];
} | null {
  const rows = text
    .split(/\r?\n/)
    .map((r) => r.split(",").map((c) => c.trim()))
    .filter((r) => r.some((c) => c !== ""));
  if (rows.length < 2) return null;

  let titleRow: string[] | null = null;
  const laneRows: Array<{ title: string; values: string[] }> = [];
  const scores: Array<number | undefined> = [];
  let mapName = "Imported journey";

  for (const row of rows) {
    const title = row[0];
    const values = row.slice(2); // skip color column
    if (title.startsWith("V1") || title.startsWith("v1")) {
      mapName = values.find((v) => v) ?? mapName;
    } else if (title.toUpperCase() === "SCORE") {
      for (const v of values) {
        const n = Number.parseFloat(v);
        scores.push(Number.isFinite(n) ? n : undefined);
      }
    } else if (title.toUpperCase() === "TITLE_BLOCK") {
      titleRow = values;
    } else if (title) {
      laneRows.push({ title, values });
    }
  }
  if (!titleRow) return null;

  const stageNames = titleRow
    .map((s) => s.trim())
    .filter((s) => s !== "" && s.toUpperCase() !== "SCORE");
  if (!stageNames.length) return null;

  const stages: Stage[] = stageNames.map((stage, i) => ({
    stage,
    cells: laneRows.map((lr) => lr.values[i] ?? ""),
    score: scores[i],
  }));

  return {
    name: mapName,
    lanes: laneRows.map((lr) => lr.title),
    stages,
  };
}

/* ── Editor ────────────────────────────────────────────────────────────── */

function JourneyEditor({
  projectId,
  initial,
  onDone,
}: {
  projectId: Id<"projects">;
  initial: JourneyDoc | null;
  onDone: () => void;
}) {
  const personas = useQuery(api.personas.list, { projectId }) ?? [];
  const create = useMutation(api.journeys.create);
  const update = useMutation(api.journeys.update);
  const generate = useAction(api.ai.generateJourneyMap);

  const [name, setName] = useState(initial?.name ?? "");
  const [goal, setGoal] = useState(initial?.goal ?? "");
  const [personaId, setPersonaId] = useState<string>(initial?.personaId ?? "");
  const [lanes, setLanes] = useState<string[]>(
    initial?.lanes ?? FALLBACK_LANES,
  );
  const [stages, setStages] = useState<Stage[]>(initial?.stages ?? []);
  const [aiScenario, setAiScenario] = useState("");
  const [busy, setBusy] = useState(false);
  const [aiDraftGenerated, setAiDraftGenerated] = useState(false);
  const [saving, setSaving] = useState(false);

  const laneCount = lanes.length;

  const setStage = (i: number, patch: Partial<Stage>) =>
    setStages((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));

  const addStage = () =>
    setStages((prev) => [
      ...prev,
      { stage: "", cells: Array.from({ length: laneCount }, () => "") },
    ]);

  const addLane = () =>
    setLanes((prev) => {
      const next = [...prev, "New lane"];
      setStages((ss) =>
        ss.map((s) => ({ ...s, cells: [...s.cells, ""] })),
      );
      return next;
    });

  const removeLane = (idx: number) => {
    setLanes((prev) => prev.filter((_, i) => i !== idx));
    setStages((ss) =>
      ss.map((s) => ({ ...s, cells: s.cells.filter((_, i) => i !== idx) })),
    );
  };

  const runAi = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const persona = personas.find((p) => p._id === personaId);
      const result = await generate({
        projectId,
        personaId: persona?._id,
        scenario: aiScenario.trim() || goal.trim() || undefined,
        stageCount: Math.max(4, Math.min(7, stages.length || 5)),
      });
      if (!name) setName(result.name);
      if (!goal && result.goal) setGoal(result.goal);
      setLanes(FALLBACK_LANES);
      setStages(result.stages);
      setAiDraftGenerated(true);
      toast.success("Journey drafted with AI", {
        description: "Everything is editable — tweak and save.",
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
    const cleanStages = stages
      .map((s) => ({
        stage: s.stage.trim(),
        cells: s.cells.slice(0, laneCount).map((c) => c.trim()),
        score:
          typeof s.score === "number" && !Number.isNaN(s.score)
            ? s.score
            : undefined,
      }))
      .filter((s) => s.stage !== "");
    if (!name.trim() || !cleanStages.length) {
      toast.error("Give the journey a name and at least one stage");
      return;
    }
    setSaving(true);
    try {
      if (initial) {
        await update({
          id: initial._id,
          name: name.trim(),
          goal: goal.trim() || undefined,
          personaId: (personaId || undefined) as Id<"personas"> | undefined,
          lanes,
          stages: cleanStages,
        });
      } else {
        await create({
          projectId,
          name: name.trim(),
          goal: goal.trim() || undefined,
          personaId: (personaId || undefined) as Id<"personas"> | undefined,
          lanes,
          stages: cleanStages,
          source: journeySourceForNewMap(aiDraftGenerated),
        });
      }
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
      {/* Meta */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="jm-name">Journey name</Label>
          <Input
            id="jm-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. First office coffee order"
          />
        </div>
        <div className="grid gap-1.5">
          <Label>Persona (optional)</Label>
          <Select value={personaId || "none"} onValueChange={setPersonaId}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="No specific persona" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No specific persona</SelectItem>
              {personas.map((p) => (
                <SelectItem key={p._id} value={p._id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="jm-goal">Scenario / job-to-be-done (optional)</Label>
        <Input
          id="jm-goal"
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          placeholder="e.g. replace the office's stale bean supply before Q4"
        />
      </div>

      {/* AI row */}
      <div className="flex flex-wrap items-end gap-2 rounded-md border border-dashed p-3">
        <div className="min-w-48 flex-1">
          <Label htmlFor="jm-scenario" className="font-mono text-caption text-muted-foreground">
            AI direction (optional)
          </Label>
          <Input
            id="jm-scenario"
            value={aiScenario}
            onChange={(e) => setAiScenario(e.target.value)}
            placeholder="e.g. focus on the pre-holiday buying rush"
            className="mt-1"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !busy) void runAi();
            }}
          />
        </div>
        <Button variant="outline" onClick={runAi} disabled={busy}>
          {busy ? (
            <>
              <Loader2 className="size-4 animate-spin" /> Generating…
            </>
          ) : (
            <>
              <Sparkles className="size-4" /> Generate with AI
            </>
          )}
        </Button>
      </div>

      {/* Matrix */}
      {stages.length === 0 ? (
        <div className="rounded-md border border-dashed p-6 text-center">
          <p className="font-mono text-caption text-muted-foreground">
            No stages yet — generate with AI above, or start from scratch.
          </p>
          <Button variant="outline" className="mt-3" onClick={addStage}>
            <Plus className="size-4" /> Add first stage
          </Button>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full min-w-[720px] border-collapse">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="w-40 p-2 text-left font-mono text-caption text-muted-foreground">
                  lanes
                </th>
                {stages.map((s, i) => (
                  <th key={i} className="min-w-40 p-1 align-bottom">
                    <Input
                      value={s.stage}
                      onChange={(e) => setStage(i, { stage: e.target.value })}
                      placeholder={`Stage ${i + 1}`}
                      className="h-8 border-0 bg-transparent font-mono text-caption font-medium shadow-none focus-visible:ring-0"
                    />
                  </th>
                ))}
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {lanes.map((lane, li) => (
                <tr key={li} className="border-b last:border-b-0">
                  <td className="p-1">
                    <div className="flex items-center gap-1">
                      <span className="min-w-0 flex-1 truncate px-1 font-mono text-caption">
                        {lane}
                      </span>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Remove lane ${lane}`}
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => removeLane(li)}
                      >
                        <Trash2 className="size-3" />
                      </Button>
                    </div>
                  </td>
                  {stages.map((s, si) => (
                    <td key={si} className="p-1 align-top">
                      <Textarea
                        value={s.cells[li] ?? ""}
                        onChange={(e) =>
                          setStage(si, {
                            cells: s.cells.map((c, ci) =>
                              ci === li ? e.target.value : c,
                            ),
                          })
                        }
                        rows={2}
                        className="min-h-16 border-0 bg-transparent font-mono text-caption shadow-none focus-visible:ring-1"
                      />
                    </td>
                  ))}
                </tr>
              ))}
              {/* Experience score row */}
              <tr className="border-t bg-muted/30">
                <td className="p-1 px-2 font-mono text-caption text-muted-foreground">
                  experience (0–10)
                </td>
                {stages.map((s, i) => (
                  <td key={i} className="p-1">
                    <Input
                      type="number"
                      min={0}
                      max={10}
                      value={s.score ?? ""}
                      onChange={(e) => {
                        const n = e.target.value === "" ? undefined : Number(e.target.value);
                        setStage(i, {
                          score:
                            n === undefined
                              ? undefined
                              : Math.max(0, Math.min(10, n)),
                        });
                      }}
                      className="h-8 font-mono text-caption"
                    />
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
          <div className="flex gap-2 border-t p-2">
            <Button size="sm" variant="ghost" onClick={addStage}>
              <Plus className="size-3.5" /> Stage
            </Button>
            <Button size="sm" variant="ghost" onClick={addLane}>
              <Plus className="size-3.5" /> Lane
            </Button>
          </div>
        </div>
      )}

      {/* Experience curve preview */}
      {stages.length > 1 &&
        stages.some((s) => typeof s.score === "number") && (
          <ExperienceCurve stages={stages} />
        )}

      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={save} disabled={saving}>
          {saving && <Loader2 className="size-4 animate-spin" />}
          {initial ? "Save changes" : "Create journey"}
        </Button>
      </div>
    </div>
  );
}

/* ── Experience curve (inline SVG, mirrors the reference renderer) ─────── */

function ExperienceCurve({ stages }: { stages: Stage[] }) {
  const pts = stages
    .map((s, i) => ({ x: i, score: s.score }))
    .filter((p): p is { x: number; score: number } => typeof p.score === "number");
  if (pts.length < 2) return null;

  const W = 560;
  const H = 120;
  const padX = 30;
  const padY = 16;
  const stepX = (W - padX * 2) / (stages.length - 1);
  const toXY = (p: { x: number; score: number }) => ({
    x: padX + p.x * stepX,
    y: H - padY - (p.score / 10) * (H - padY * 2),
  });
  const path = pts
    .map((p, i) => {
      const { x, y } = toXY(p);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <div className="rounded-md border bg-card p-3">
      <p className="font-mono text-caption text-muted-foreground">
        experience curve
      </p>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-1 w-full">
        <line x1={padX} y1={H - padY} x2={W - padX} y2={H - padY} className="stroke-border" />
        <line x1={padX} y1={padY} x2={padX} y2={H - padY} className="stroke-border" />
        <path d={path} fill="none" className="stroke-terminal-green" strokeWidth={2} />
        {pts.map((p) => {
          const { x, y } = toXY(p);
          return (
            <circle key={p.x} cx={x} cy={y} r={3} className="fill-terminal-green" />
          );
        })}
        {stages.map((s, i) => (
          <text
            key={i}
            x={padX + i * stepX}
            y={H - 3}
            textAnchor="middle"
            className="fill-muted-foreground"
            fontSize={8}
          >
            {s.stage.slice(0, 12) || i + 1}
          </text>
        ))}
      </svg>
    </div>
  );
}

/* ── Main page ─────────────────────────────────────────────────────────── */

function toCsv(map: JourneyDoc): string {
  const lanes = map.lanes ?? FALLBACK_LANES;
  const esc = (v: string) => (v.includes(",") ? `"${v}"` : v);
  const lines: string[] = [];
  lines.push(`V1.1,${map.name}`);
  lines.push(`TITLE_BLOCK,,${map.stages.map((s) => esc(s.stage)).join(",")}`);
  for (let li = 0; li < lanes.length; li++) {
    lines.push(
      `${esc(lanes[li])},,${map.stages.map((s) => esc(s.cells[li] ?? "")).join(",")}`,
    );
  }
  if (map.stages.some((s) => typeof s.score === "number")) {
    lines.push(`SCORE,,${map.stages.map((s) => s.score ?? "").join(",")}`);
  }
  return lines.join("\n");
}

export default function Journeys({
  projectId,
}: {
  projectId: Id<"projects">;
}) {
  const journeysRaw = useQuery(api.journeys.list, { projectId });
  const journeys = useMemo(() => journeysRaw ?? [], [journeysRaw]);
  const personas = useQuery(api.personas.list, { projectId }) ?? [];
  const create = useMutation(api.journeys.create);
  const removeMap = useMutation(api.journeys.remove);

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Id<"journeyMaps"> | null>(null);
  const [csvOpen, setCsvOpen] = useState(false);
  const [csvText, setCsvText] = useState("");
  const [csvPersona, setCsvPersona] = useState("");
  const [importing, setImporting] = useState(false);
  const [personaFilter, setPersonaFilter] = useState("all");
  const visibleJourneys = personaFilter === "all"
    ? journeys
    : journeys.filter((j) => personaFilter === "unassigned" ? !j.personaId : j.personaId === personaFilter);

  const editingDoc = useMemo(
    () => journeys.find((j) => j._id === editing) ?? null,
    [journeys, editing],
  );

  const importCsv = async () => {
    const parsed = parseJourneyCsv(csvText);
    if (!parsed) {
      toast.error("Could not parse that CSV", {
        description:
          "Needs a TITLE_BLOCK row with stage names (user-journey format).",
      });
      return;
    }
    setImporting(true);
    try {
      await create({
        projectId,
        name: parsed.name,
        lanes: parsed.lanes,
        stages: parsed.stages,
        personaId: (csvPersona || undefined) as Id<"personas"> | undefined,
        source: "csv",
      });
      toast.success(`Imported "${parsed.name}" (${parsed.stages.length} stages)`);
      setCsvText("");
      setCsvPersona("");
      setCsvOpen(false);
    } catch (e) {
      toast.error("Import failed", {
        description: e instanceof Error ? e.message : "Try again.",
      });
    } finally {
      setImporting(false);
    }
  };

  return (
    <div>
      <ModuleHeader
        icon={Route}
        title="Journeys"
        subtitle="Journey maps — the emotional and practical path each persona takes, feeding content research in Create"
      >
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setCsvOpen(true)}>
            <FileUp className="size-4" /> Import CSV
          </Button>
          <Button
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
          >
            <Plus className="size-4" /> New journey
          </Button>
        </div>
      </ModuleHeader>

      {/* Editor dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle className="font-mono text-h3">
              {editingDoc ? "Edit journey" : "New journey"}
            </DialogTitle>
            <DialogDescription className="font-mono text-caption">
              Build it yourself or let AI draft the whole matrix from your
              project context — every cell stays editable.
            </DialogDescription>
          </DialogHeader>
          <JourneyEditor
            key={editing ?? "new"}
            projectId={projectId}
            initial={editingDoc}
            onDone={() => setOpen(false)}
          />
        </DialogContent>
      </Dialog>

      {/* CSV import dialog */}
      <Dialog open={csvOpen} onOpenChange={setCsvOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-mono text-h3">Import CSV</DialogTitle>
            <DialogDescription className="font-mono text-caption">
              user-journey format: TITLE_BLOCK row for stages, SCORE row for the
              curve, other rows become lanes.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label>Attach to persona (optional)</Label>
              <Select value={csvPersona || "none"} onValueChange={setCsvPersona}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="No specific persona" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No specific persona</SelectItem>
                  {personas.map((p) => (
                    <SelectItem key={p._id} value={p._id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <input
              type="file"
              accept=".csv,text/csv"
              className="font-mono text-caption"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) setCsvText(await f.text());
              }}
            />
            <Textarea
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
              rows={7}
              placeholder={"TITLE_BLOCK,,Trigger,Research,Compare,Decide\nActions,,searches Google,reads reviews,…\nSCORE,,3,5,6,8"}
              className="font-mono text-caption"
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setCsvOpen(false)}>
                Cancel
              </Button>
              <Button onClick={importCsv} disabled={importing || !csvText.trim()}>
                {importing && <Loader2 className="size-4 animate-spin" />}
                Import
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {journeys.length === 0 ? (
        <ModuleEmpty
          icon={Map}
          title="No journey maps yet"
          hint="Map the path personas take — with AI from project details, by hand, or imported from CSV."
          action={
            <Button onClick={() => setOpen(true)}>
              <Plus className="size-4" /> New journey
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3">
          <div className="flex items-center gap-2">
            <Label htmlFor="journey-persona-filter" className="font-mono text-caption text-muted-foreground">Filter by persona</Label>
            <Select value={personaFilter} onValueChange={setPersonaFilter}>
              <SelectTrigger id="journey-persona-filter" className="w-56"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">All personas</SelectItem><SelectItem value="unassigned">Unassigned</SelectItem>{personas.map((p) => <SelectItem key={p._id} value={p._id}>{p.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        <div className="grid gap-3 md:grid-cols-2">
          {visibleJourneys.map((j) => {
            const persona = personas.find((p) => p._id === j.personaId);
            const scores = j.stages.map((s) => s.score).filter((s): s is number => typeof s === "number");
            const avg = scores.length
              ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1)
              : null;
            return (
              <div key={j._id} className="rounded-md border bg-card p-4 shadow-card">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-mono text-small font-medium">{j.name}</p>
                    <p className="font-mono text-caption text-muted-foreground">
                      {j.stages.length} stages · {j.lanes?.length ?? 5} lanes
                      {persona ? ` · ${persona.name}` : ""}
                      {avg ? ` · avg ${avg}/10` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Badge
                      variant="outline"
                      className="font-mono text-caption text-muted-foreground"
                    >
                      {j.source === "ai"
                        ? "AI draft"
                        : j.source === "csv"
                          ? "CSV import"
                          : "Manual"}
                    </Badge>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Download ${j.name}`}
                      onClick={() => {
                        const blob = new Blob([toCsv(j as unknown as JourneyDoc)], {
                          type: "text/csv",
                        });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = `${j.name.replace(/[^\w-]+/g, "-")}.csv`;
                        a.click();
                        URL.revokeObjectURL(url);
                      }}
                    >
                      <Download className="size-3.5" />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Edit ${j.name}`}
                      onClick={() => {
                        setEditing(j._id);
                        setOpen(true);
                      }}
                    >
                      <Pen className="size-3.5" />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Delete ${j.name}`}
                      className="text-destructive"
                      onClick={async () => {
                        try {
                          await removeMap({ id: j._id });
                          toast.success("Journey deleted");
                        } catch (e) {
                          toast.error("Delete failed", {
                            description:
                              e instanceof Error ? e.message : "Try again.",
                          });
                        }
                      }}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>
                {j.goal && (
                  <p className="mt-2 font-mono text-caption text-muted-foreground">
                    {j.goal}
                  </p>
                )}
                <p className="mt-3 font-mono text-caption text-muted-foreground">
                  Stage bars show the persona’s experience score from 0–10: green is 7–10,
                  amber is 4–6, red is 0–3. Gray means no score was entered.
                </p>
                {/* Mini stage strip */}
                <div className="mt-3 flex items-end gap-1">
                  {j.stages.map((s, i) => (
                    <div
                      key={i}
                      className="min-w-0 flex-1"
                      title={`${s.stage}: ${typeof s.score === "number" ? `${s.score}/10 experience score` : "no score entered"}${s.cells.length ? `\n${s.cells.join("\n")}` : ""}`}
                    >
                      <div
                        className={cn(
                          "rounded-t-sm",
                          typeof s.score === "number"
                            ? s.score >= 7
                              ? "bg-terminal-green/70"
                              : s.score >= 4
                                ? "bg-terminal-amber/70"
                                : "bg-terminal-red/70"
                            : "bg-muted",
                        )}
                        style={{
                          height: `${typeof s.score === "number" ? 18 + s.score * 3 : 18}px`,
                        }}
                      />
                      <p className="truncate pt-1 text-center font-mono text-caption text-muted-foreground">
                        {s.stage}
                      </p>
                    </div>
                  ))}
                </div>
                <Button asChild className="mt-4" size="sm" variant="outline">
                  <Link
                    to={`/app/${projectId}/create?personaId=${encodeURIComponent(j.personaId ?? "")}&journeyMapId=${encodeURIComponent(j._id)}`}
                  >
                    Identify content gaps <Route className="size-3.5" />
                  </Link>
                </Button>
              </div>
            );
          })}
        </div>
        </div>
      )}
    </div>
  );
}
