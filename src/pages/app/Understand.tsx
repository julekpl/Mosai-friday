import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { Loader2, Pen, Plus, Search, Trash2, Users } from "lucide-react";

import { ModuleHeader } from "@/components/app/AppShell";
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
  const [isSaving, setIsSaving] = useState(false);

  // Seed once loaded when editing
  if (existing && !name && !role && existing.name) {
    setName(existing.name);
    setRole(existing.role ?? "");
    setGoals((existing.goals ?? []).join(", "));
    setPains((existing.pains ?? []).join(", "));
    setEvidence(existing.evidence ?? "");
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

export default function Understand({
  projectId,
}: {
  projectId: Id<"projects">;
}) {
  const personas = useQuery(api.personas.list, { projectId }) ?? [];
  const remove = useMutation(api.personas.remove);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Id<"personas"> | undefined>();

  return (
    <div>
      <ModuleHeader
        icon={Search}
        title="Understand"
        subtitle="Personas, buyer profiles and journeys — the base every other module uses"
      >
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
      </ModuleHeader>

      {personas.length === 0 ? (
        <div className="rounded-md border border-dashed p-10 text-center">
          <Users className="mx-auto size-6 text-muted-foreground" />
          <p className="mt-3 font-mono text-small font-medium">
            No personas yet
          </p>
          <p className="mt-1 font-mono text-caption text-muted-foreground">
            Create your first persona — it takes about two minutes and powers
            everything downstream.
          </p>
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
              {p.evidence && (
                <p className="mt-3 font-mono text-caption text-muted-foreground">
                  evidence: {p.evidence}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
