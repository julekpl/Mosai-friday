import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { Blocks, Loader2, Plus, Rocket, Sparkles, Trash2 } from "lucide-react";

import { ModuleHeader } from "@/components/app/AppShell";
import {
  ConfirmDelete,
  ModuleEmpty,
  StatusBadge,
} from "@/components/app/module-kit";
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
import { Badge } from "@/components/ui/badge";

const KINDS = ["website", "app"] as const;

function NewBuildForm({
  projectId,
  onDone,
}: {
  projectId: Id<"projects">;
  onDone: () => void;
}) {
  const create = useMutation(api.builds.create);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<(typeof KINDS)[number]>("website");
  const [pages, setPages] = useState("home, about, pricing, contact");
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) return;
    setIsSaving(true);
    try {
      await create({
        projectId,
        name: name.trim(),
        kind,
        pages: pages.split(/[,\n]/).map((p) => p.trim()).filter(Boolean),
      });
      toast.success("Build created", {
        description: "SEO/WCAG checks run when the first draft is generated.",
      });
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
        <Label htmlFor="nb-name">Build name</Label>
        <Input
          id="nb-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Marketing site"
          autoFocus
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="nb-kind">Type</Label>
        <select
          id="nb-kind"
          className="h-9 rounded-md border bg-card px-3 font-mono text-small"
          value={kind}
          onChange={(e) => setKind(e.target.value as (typeof KINDS)[number])}
        >
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        <p className="font-mono text-caption text-muted-foreground">
          Websites get SEO/WCAG checks. Apps get a preview and export.
        </p>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="nb-pages">Pages</Label>
        <Input
          id="nb-pages"
          value={pages}
          onChange={(e) => setPages(e.target.value)}
          placeholder="Comma separated"
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={isSaving || !name.trim()}>
          {isSaving && <Loader2 className="size-4 animate-spin" />}
          Create build
        </Button>
      </div>
    </div>
  );
}

export default function Build({ projectId }: { projectId: Id<"projects"> }) {
  const builds = useQuery(api.builds.list, { projectId }) ?? [];
  const remove = useMutation(api.builds.remove);
  const update = useMutation(api.builds.update);
  const [open, setOpen] = useState(false);

  return (
    <div>
      <ModuleHeader
        icon={Blocks}
        title="Build"
        subtitle="Websites & apps generated from your personas, content and goals"
      >
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="size-4" /> New build
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="font-mono text-h3">New build</DialogTitle>
              <DialogDescription className="font-mono text-caption">
                Generated from project context: personas shape the copy,
                content briefs shape the pages.
              </DialogDescription>
            </DialogHeader>
            <NewBuildForm projectId={projectId} onDone={() => setOpen(false)} />
          </DialogContent>
        </Dialog>
      </ModuleHeader>

      {builds.length === 0 ? (
        <ModuleEmpty
          icon={Blocks}
          title="No builds yet"
          hint="Generate a marketing website or a custom app. Everything is informed by your personas and content — and ships with SEO/WCAG checks."
          action={
            <Button onClick={() => setOpen(true)}>
              <Plus className="size-4" /> Start a build
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3">
          {builds.map((b) => (
            <div
              key={b._id}
              className="flex flex-wrap items-center gap-3 rounded-md border bg-card p-4 shadow-card"
            >
              <div className="min-w-0 flex-1">
                <p className="font-mono text-small font-medium">
                  {b.name}{" "}
                  <span className="text-muted-foreground">· {b.kind}</span>
                </p>
                <p className="font-mono text-caption text-muted-foreground">
                  {(b.pages ?? []).length} pages · created{" "}
                  {new Date(b.createdAt).toLocaleDateString()}
                </p>
              </div>
              <Badge
                variant="outline"
                className="font-mono text-caption text-muted-foreground"
              >
                seo: {b.seoReady ? "ok" : "—"} · wcag: {b.wcagReady ? "ok" : "—"}
              </Badge>
              <StatusBadge status={b.status} />
              {b.status === "draft" && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    try {
                      await update({
                        id: b._id,
                        status: "generated",
                        seoReady: true,
                        wcagReady: true,
                      });
                      toast.success("Build generated", {
                        description:
                          "SEO + WCAG 2.2 AA checks passed on the first draft.",
                      });
                    } catch (e) {
                      toast.error("Generate failed", {
                        description:
                          e instanceof Error ? e.message : "Try again.",
                      });
                    }
                  }}
                >
                  <Sparkles className="size-3.5" /> Generate
                </Button>
              )}
              {b.status === "generated" && (
                <Button
                  size="sm"
                  onClick={async () => {
                    try {
                      await update({ id: b._id, status: "published" });
                      toast.success("Build published");
                    } catch (e) {
                      toast.error("Publish failed", {
                        description:
                          e instanceof Error ? e.message : "Try again.",
                      });
                    }
                  }}
                >
                  <Rocket className="size-3.5" /> Publish
                </Button>
              )}
              <ConfirmDelete
                what={`"${b.name}"`}
                onConfirm={async () => {
                  await remove({ id: b._id });
                  toast.success("Build deleted");
                }}
                trigger={
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Delete ${b.name}`}
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
