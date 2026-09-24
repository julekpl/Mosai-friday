import { lazy, Suspense, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { Link } from "react-router";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import {
  Boxes,
  BrainCircuit,
  Loader2,
  MessageSquare,
  Pen,
  Plus,
  Route,
  Search,
  Sparkles,
  Trash2,
  Users,
} from "lucide-react";

import { ModuleHeader } from "@/components/app/AppShell";
import {
  ModuleErrorBoundary,
  ModuleSkeleton,
  RelatedModules,
} from "@/components/app/module-kit";
import { PersonaChat } from "@/components/app/PersonaChat";
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
import { Separator } from "@/components/ui/separator";

function PersonaForm({
  projectId,
  personaId,
  onDone,
}: {
  projectId: Id<"projects">;
  personaId?: Id<"personas">;
  onDone: () => void;
}) {
  const existing = useQuery(
    api.personas.get,
    personaId ? { id: personaId } : "skip",
  );
  const create = useMutation(api.personas.create);
  const update = useMutation(api.personas.update);

  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [goals, setGoals] = useState("");
  const [pains, setPains] = useState("");
  const [evidence, setEvidence] = useState("");
  const [country, setCountry] = useState("");
  const [demographics, setDemographics] = useState("");
  const [culturalContext, setCulturalContext] = useState("");
  const [bigFive, setBigFive] = useState<{
    openness: number;
    conscientiousness: number;
    extraversion: number;
    agreeableness: number;
    neuroticism: number;
  } | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Seed once loaded when editing
  if (existing && !name && !role && existing.name) {
    setName(existing.name);
    setRole(existing.role ?? "");
    setGoals((existing.goals ?? []).join(", "));
    setPains((existing.pains ?? []).join(", "));
    setEvidence(existing.evidence ?? "");
    setCountry(existing.country ?? "");
    setDemographics(existing.demographics ?? "");
    setCulturalContext(existing.culturalContext ?? "");
    setBigFive(existing.bigFive ?? null);
  }

  const split = (s: string) =>
    s.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);

  const handleSave = async () => {
    if (!name.trim()) return;
    setIsSaving(true);
    try {
      const payload = {
        name: name.trim(),
        role: role.trim() || undefined,
        goals: split(goals),
        pains: split(pains),
        evidence: evidence.trim() || undefined,
        country: country.trim() || undefined,
        demographics: demographics.trim() || undefined,
        culturalContext: culturalContext.trim() || undefined,
        bigFive: bigFive ?? undefined,
      };
      if (personaId) {
        await update({ id: personaId, ...payload });
      } else {
        await create({ projectId, ...payload });
      }
      toast.success(personaId ? "Persona updated" : "Persona created");
      onDone();
    } catch (e) {
      toast.error("Save failed", {
        description: e instanceof Error ? e.message : "Try again.",
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor="pf-name">Persona name</Label>
        <Input
          id="pf-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Office manager Ingrid"
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="pf-role">Role / context</Label>
        <Input
          id="pf-role"
          value={role}
          onChange={(e) => setRole(e.target.value)}
          placeholder="e.g. buys coffee for a 12-person office"
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="pf-goals">Goals</Label>
          <Textarea
            id="pf-goals"
            value={goals}
            onChange={(e) => setGoals(e.target.value)}
            rows={2}
            placeholder="Comma separated"
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="pf-pains">Pains</Label>
          <Textarea
            id="pf-pains"
            value={pains}
            onChange={(e) => setPains(e.target.value)}
            rows={2}
            placeholder="Comma separated"
          />
        </div>
      </div>
      <div className="grid gap-2">
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="grid gap-2"><Label htmlFor="pf-country">Country / market</Label><Input id="pf-country" value={country} onChange={(e) => setCountry(e.target.value)} placeholder="e.g. Netherlands" /></div>
          <div className="grid gap-2"><Label htmlFor="pf-demo">Useful context (optional)</Label><Input id="pf-demo" value={demographics} onChange={(e) => setDemographics(e.target.value)} placeholder="e.g. 35–44, urban, B2B buyer" /></div>
        </div>
      </div>
      <details className="rounded-md border p-3">
        <summary className="cursor-pointer font-mono text-caption">Advanced personality (Big Five, optional)</summary>
        <p className="mt-2 font-mono text-caption text-muted-foreground">Add only if it helps your decisions. Scores are 0–100 and are hypotheses, not clinical assessments.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {([
            ["openness", "Openness"],
            ["conscientiousness", "Conscientiousness"],
            ["extraversion", "Extraversion"],
            ["agreeableness", "Agreeableness"],
            ["neuroticism", "Emotional sensitivity"],
          ] as const).map(([key, label]) => (
            <div className="grid gap-1" key={key}>
              <Label htmlFor={`pf-bigfive-${key}`}>{label} (0–100)</Label>
              <Input
                id={`pf-bigfive-${key}`}
                type="number"
                min={0}
                max={100}
                value={bigFive?.[key] ?? ""}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  if (!Number.isFinite(value) || value < 0 || value > 100) return;
                  setBigFive((current) => ({
                    openness: current?.openness ?? 50,
                    conscientiousness: current?.conscientiousness ?? 50,
                    extraversion: current?.extraversion ?? 50,
                    agreeableness: current?.agreeableness ?? 50,
                    neuroticism: current?.neuroticism ?? 50,
                    [key]: value,
                  }));
                }}
                placeholder="Optional"
              />
            </div>
          ))}
        </div>
      </details>
      <div className="grid gap-2">
        <Label htmlFor="pf-culture">Language &amp; cultural context (optional)</Label>
        <Textarea
          id="pf-culture"
          value={culturalContext}
          onChange={(event) => setCulturalContext(event.target.value)}
          rows={2}
          placeholder="Use observed or owner-provided market details; avoid assumptions based only on nationality."
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="pf-ev">Evidence</Label>
        <Textarea
          id="pf-ev"
          value={evidence}
          onChange={(e) => setEvidence(e.target.value)}
          rows={2}
          placeholder="Where did this persona come from? Interviews, GA4, support tickets…"
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={isSaving || !name.trim()}>
          {isSaving && <Loader2 className="size-4 animate-spin" />}
          {personaId ? "Save changes" : "Create persona"}
        </Button>
      </div>
    </div>
  );
}

/** AI persona generator: one click builds a persona from project details. */
function AiPersonaDialog({
  projectId,
  onDone,
}: {
  projectId: Id<"projects">;
  onDone: (personaId?: Id<"personas">) => void;
}) {
  const generate = useAction(api.ai.generatePersona);
  const create = useMutation(api.personas.create);

  const [hint, setHint] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      const p = await generate({
        projectId,
        hint: hint.trim() || undefined,
      });
      const id = await create({
        projectId,
        name: p.name,
        role: p.role,
        goals: p.goals,
        pains: p.pains,
        objections: p.objections,
        channels: p.channels,
        country: p.country,
        demographics: p.demographics,
        bigFive: p.bigFive,
        culturalContext: p.culturalContext,
        evidence: p.evidence,
      });
      toast.success(`Persona "${p.name}" created`, {
        description: "Generated from your project details and files.",
      });
      setHint("");
      onDone(id);
    } catch (e) {
      toast.error("Generation failed", {
        description: e instanceof Error ? e.message : "Try again.",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-4">
      <p className="font-mono text-caption text-muted-foreground">
        AI builds a realistic buyer persona from your project details, website
        scan and attached files.
      </p>
      <div className="grid gap-2">
        <Label htmlFor="ai-hint">Guidance (optional)</Label>
        <Input
          id="ai-hint"
          value={hint}
          onChange={(e) => setHint(e.target.value)}
          placeholder="e.g. focus on the B2B office manager segment"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !busy) void run();
          }}
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => onDone()} disabled={busy}>
          Cancel
        </Button>
        <Button onClick={run} disabled={busy}>
          {busy ? (
            <>
              <Loader2 className="size-4 animate-spin" /> Generating…
            </>
          ) : (
            <>
              <Sparkles className="size-4" /> Generate persona
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

const RelationMap = lazy(() => import("@/components/app/RelationMap"));

export default function Understand({
  projectId,
}: {
  projectId: Id<"projects">;
}) {
  const personasResult = useQuery(api.personas.list, { projectId });
  const personas = personasResult ?? [];
  const loading = personasResult === undefined;
  const remove = useMutation(api.personas.remove);

  const [open, setOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [editing, setEditing] = useState<Id<"personas"> | undefined>();
  const [chatPersona, setChatPersona] = useState<Id<"personas"> | null>(null);


  const chatTarget = personas.find((p) => p._id === chatPersona) ?? null;

  return (
    <div>
      <ModuleHeader
        icon={Search}
        title="Understand"
        subtitle="Start with what you know about your business — the audiences, goals and evidence every other component builds on"
      >
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setAiOpen(true)}>
            <Sparkles className="size-4" /> AI persona
          </Button>
          <Dialog
            open={open}
            onOpenChange={(o) => {
              setOpen(o);
              if (!o) setEditing(undefined);
            }}
          >
            <DialogTrigger asChild>
              <Button>
                <Plus className="size-4" /> New persona
              </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[85vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle className="font-mono text-h3">
                  {editing ? "Edit persona" : "New persona"}
                </DialogTitle>
                <DialogDescription className="font-mono text-caption">
                  Everything here feeds content briefs, campaigns and the builder.
                </DialogDescription>
              </DialogHeader>
              <PersonaForm
                projectId={projectId}
                personaId={editing}
                onDone={() => setOpen(false)}
              />
            </DialogContent>
          </Dialog>
        </div>
      </ModuleHeader>

      {/* Relationship map: an optional 3D view over the same facts the
          list below shows — the list is always present and complete. */}
      <section className="mb-8">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="font-mono text-h3">Relationship map</h2>
          <span className="font-mono text-caption text-muted-foreground">
            your business, audiences, journeys and content — how they connect
          </span>
          <Button
            size="sm"
            variant="outline"
            className="ml-auto"
            aria-expanded={mapOpen}
            onClick={() => setMapOpen((v) => !v)}
          >
            <Boxes className="size-3.5" />
            {mapOpen ? "Hide map" : "Open map"}
          </Button>
        </div>
        {mapOpen && (
          <ModuleErrorBoundary>
            <Suspense
              fallback={<ModuleSkeleton label="Loading the relationship map…" />}
            >
              <RelationMap projectId={projectId} />
            </Suspense>
          </ModuleErrorBoundary>
        )}
      </section>

      {/* AI generation dialog */}
      <Dialog open={aiOpen} onOpenChange={setAiOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-mono text-h3">
              Generate persona with AI
            </DialogTitle>
            <DialogDescription className="font-mono text-caption">
              Built from this project's details, scan data and attached files.
            </DialogDescription>
          </DialogHeader>
          <AiPersonaDialog
            projectId={projectId}
            onDone={(id) => {
              setAiOpen(false);
              if (id) setChatPersona(id);
            }}
          />
        </DialogContent>
      </Dialog>

      {/* Chat with a persona */}
      <Dialog
        open={chatPersona !== null}
        onOpenChange={(o) => {
          if (!o) setChatPersona(null);
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          {chatTarget && (
            <>
              <DialogHeader>
                <DialogTitle className="font-mono text-h3 flex items-center gap-2">
                  <BrainCircuit className="size-5 text-terminal-green" />
                  {chatTarget.name}
                </DialogTitle>
                <DialogDescription className="font-mono text-caption">
                  Talk to the persona, or switch to analyst mode for marketing
                  advice grounded in this persona.
                </DialogDescription>
              </DialogHeader>
              <PersonaChat
                projectId={projectId}
                personaId={chatTarget._id}
                persona={{
                  name: chatTarget.name,
                  role: chatTarget.role,
                  goals: chatTarget.goals,
                  pains: chatTarget.pains,
                  objections: chatTarget.objections,
                  channels: chatTarget.channels,
                  evidence: chatTarget.evidence,
                }}
              />
            </>
          )}
        </DialogContent>
      </Dialog>

      {loading ? (
        <ModuleSkeleton label="Loading audiences…" />
      ) : personas.length === 0 ? (
        <div className="rounded-md border border-dashed p-10 text-center">
          <Users className="mx-auto size-6 text-muted-foreground" />
          <p className="mt-3 font-mono text-small font-medium">
            Your next audience starts here
          </p>
          <p className="mt-1 font-mono text-caption text-muted-foreground">
            Write one down — what they're trying to do, what gets in the way —
            or let AI draft one from your project details.
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Button onClick={() => setOpen(true)}>
              <Plus className="size-4" /> New persona
            </Button>
            <Button variant="outline" onClick={() => setAiOpen(true)}>
              <Sparkles className="size-4" /> Draft one with AI
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {personas.map((p) => (
            <div key={p._id} className="rounded-md border bg-card p-4 shadow-card">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-mono text-small font-medium">{p.name}</p>
                  {p.role && (
                    <p className="font-mono text-caption text-muted-foreground">
                      {p.role}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7"
                    onClick={() => setChatPersona(p._id)}
                  >
                    <MessageSquare className="size-3.5" /> Chat
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7"
                    asChild
                  >
                    <Link to={`/app/${projectId}/journeys`} title="Map a journey in the Journeys module">
                      <Route className="size-3.5" /> Journey
                    </Link>
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Edit ${p.name}`}
                    onClick={() => {
                      setEditing(p._id);
                      setOpen(true);
                    }}
                  >
                    <Pen className="size-3.5" />
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Delete ${p.name}`}
                    className="text-destructive"
                    onClick={async () => {
                      try {
                        await remove({ id: p._id });
                        toast.success("Persona deleted");
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
              {(p.goals?.length || p.pains?.length) && (
                <>
                  <Separator className="my-3" />
                  <div className="flex flex-wrap gap-1.5">
                    {(p.goals ?? []).map((g) => (
                      <Badge
                        key={g}
                        variant="outline"
                        className="border-terminal-green/40 bg-terminal-green-soft font-mono text-caption text-terminal-green"
                      >
                        goal: {g}
                      </Badge>
                    ))}
                    {(p.pains ?? []).map((pain) => (
                      <Badge
                        key={pain}
                        variant="outline"
                        className="border-terminal-amber/40 bg-terminal-amber-soft font-mono text-caption text-terminal-amber"
                      >
                        pain: {pain}
                      </Badge>
                    ))}
                  </div>
                </>
              )}
              {(p.country || p.demographics || p.culturalContext || p.bigFive) && (
                <div className="mt-3 grid gap-1 font-mono text-caption text-muted-foreground">
                  {p.country && <p>market: {p.country}</p>}
                  {p.demographics && <p>context: {p.demographics}</p>}
                  {p.culturalContext && <p>language &amp; culture: {p.culturalContext}</p>}
                  {p.bigFive && (
                    <p>Big Five hypotheses: openness {p.bigFive.openness}, conscientiousness {p.bigFive.conscientiousness}, extraversion {p.bigFive.extraversion}, agreeableness {p.bigFive.agreeableness}, emotional sensitivity {p.bigFive.neuroticism} / 100</p>
                  )}
                </div>
              )}
              {p.evidence && (
                <p className="mt-3 font-mono text-caption text-muted-foreground">
                  evidence: {p.evidence}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      <RelatedModules
        projectId={projectId}
        modules={["create", "customers", "grow"]}
      />
    </div>
  );
}
