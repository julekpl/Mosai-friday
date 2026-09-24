import { useState } from "react";
import { AppWindow, ChevronRight, Globe, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { ConfirmDelete, StatusBadge } from "@/components/app/module-kit";
import { siteStatusForDisplay } from "@/components/cms/releaseLabels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { BuildKind, BuildSlot } from "@/components/build/buildSelection";

export type BuildListRow = {
  _id: string;
  name: string;
  kind: "website" | "app";
  status: string;
  positioning?: string;
  seoReady?: boolean;
  wcagReady?: boolean;
  createdAt: number;
  updatedAt?: number;
};

/** What a build deletion removes, stated before the user confirms. */
export const BUILD_DELETE_DESCRIPTION =
  "This removes the build with its chat history, versions, page plans and release records. Your site's pages stay in the project. This cannot be undone.";

const KIND_COPY: Record<
  BuildKind,
  { title: string; icon: React.ElementType; create: string; emptyHint: string }
> = {
  website: {
    title: "Website",
    icon: Globe,
    create: "Create website",
    emptyHint:
      "One website per project, planned from your idea, personas and journeys.",
  },
  app: {
    title: "App",
    icon: AppWindow,
    create: "Create app",
    emptyHint:
      "One app per project. It starts as a requirements brief; app generation is not available yet.",
  },
};

function DeleteBuildButton<T extends BuildListRow>({
  build,
  onDelete,
}: {
  build: T;
  onDelete: (build: T) => Promise<void>;
}) {
  return (
    <ConfirmDelete
      what={`"${build.name}"`}
      description={BUILD_DELETE_DESCRIPTION}
      onConfirm={() => onDelete(build)}
      trigger={
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={`Delete ${build.name}`}
          className="cursor-pointer text-destructive"
        >
          <Trash2 className="size-3.5" />
        </Button>
      }
    />
  );
}

/** Rename dialog; the trigger button carries the build's name for screen readers. */
function RenameBuildButton<T extends BuildListRow>({
  build,
  onRename,
}: {
  build: T;
  onRename: (build: T, name: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(build.name);
  const [busy, setBusy] = useState(false);
  const inputId = `rename-${build._id}`;

  const save = async () => {
    const next = name.trim();
    if (!next || next === build.name) {
      setOpen(false);
      return;
    }
    setBusy(true);
    try {
      await onRename(build, next);
      setOpen(false);
    } catch (e) {
      toast.error("Rename failed", {
        description: e instanceof Error ? e.message : "Try again.",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setName(build.name);
      }}
    >
      <DialogTrigger asChild>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={`Rename ${build.name}`}
          className="cursor-pointer"
        >
          <Pencil className="size-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="font-mono text-h3">Rename</DialogTitle>
          <DialogDescription className="font-mono text-caption">
            The name is only shown inside MOSAI.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <Label htmlFor={inputId}>Name</Label>
          <Input
            id={inputId}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
          <DialogFooter className="mt-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !name.trim()} aria-busy={busy || undefined}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function BuildSummary({ build }: { build: BuildListRow }) {
  return build.positioning ? (
    <p className="break-words font-mono text-caption text-muted-foreground">
      {build.positioning}
    </p>
  ) : (
    <p className="font-mono text-caption text-muted-foreground">
      created {new Date(build.createdAt).toLocaleDateString()}
    </p>
  );
}

/**
 * One of the project's two build slots ("Website" or "App"). Empty: one
 * primary action that opens the existing creation flow. Filled: the build
 * card with open, rename and delete. Builds of the same kind left over from
 * before the one-per-kind rule are listed under "Older builds".
 */
export function BuildSlotCard<T extends BuildListRow>({
  kind,
  slot,
  onCreate,
  onOpen,
  onRename,
  onDelete,
}: {
  kind: BuildKind;
  slot: BuildSlot<T>;
  onCreate: (kind: BuildKind) => void;
  onOpen: (build: T) => void;
  onRename: (build: T, name: string) => Promise<void>;
  onDelete: (build: T) => Promise<void>;
}) {
  const copy = KIND_COPY[kind];
  const Icon = copy.icon;
  const headingId = `build-slot-${kind}`;
  const build = slot.primary;

  return (
    <section
      aria-labelledby={headingId}
      className="flex min-w-0 flex-col gap-3 rounded-lg border bg-card p-4 shadow-card"
    >
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className="grid size-8 place-items-center rounded-md border bg-muted text-foreground"
        >
          <Icon className="size-4" />
        </span>
        <h2 id={headingId} className="font-mono text-small font-medium">
          {copy.title}
        </h2>
      </div>

      {build ? (
        <div className="flex min-w-0 flex-wrap items-center gap-3 rounded-md border p-3 transition-colors ease-terminal hover:bg-accent">
          <button
            type="button"
            className="min-w-0 flex-1 cursor-pointer rounded-sm text-left focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            onClick={() => onOpen(build)}
            aria-label={`Open ${build.name}`}
          >
            <p className="flex items-center gap-1 break-words font-mono text-small font-medium">
              {build.name}
              <ChevronRight aria-hidden="true" className="size-3.5 text-muted-foreground" />
            </p>
            <BuildSummary build={build} />
          </button>
          <StatusBadge status={siteStatusForDisplay(build.status)} />
          <RenameBuildButton build={build} onRename={onRename} />
          <DeleteBuildButton build={build} onDelete={onDelete} />
        </div>
      ) : (
        <div className="flex flex-col items-start gap-3 rounded-md border border-dashed p-4">
          <p className="font-mono text-caption text-muted-foreground">{copy.emptyHint}</p>
          <Button onClick={() => onCreate(kind)}>
            <Plus className="size-4" /> {copy.create}
          </Button>
        </div>
      )}

      {slot.older.length > 0 && (
        <details className="group rounded-md border">
          <summary className="cursor-pointer rounded-md px-3 py-2 font-mono text-caption text-muted-foreground hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
            Older builds ({slot.older.length})
          </summary>
          <div className="grid gap-2 border-t p-3">
            <p className="font-mono text-caption text-muted-foreground">
              Created before a project could hold only one {kind}. The newest one
              above is this project&apos;s {kind}; open or delete these as you need.
            </p>
            <BuildList builds={slot.older} onOpen={onOpen} onDelete={onDelete} />
          </div>
        </details>
      )}
    </section>
  );
}

/**
 * A plain list of builds. Each row owns its delete confirmation, with the
 * row's trash button as the dialog trigger, so the dialog always opens for
 * the row that was clicked. Used for a slot's older builds.
 */
export function BuildList<T extends BuildListRow>({
  builds,
  onOpen,
  onDelete,
}: {
  builds: readonly T[];
  onOpen: (build: T) => void;
  onDelete: (build: T) => Promise<void>;
}) {
  return (
    <div className="grid min-w-0 gap-2">
      {builds.map((b) => (
        <div
          key={b._id}
          className="flex min-w-0 flex-wrap items-center gap-3 rounded-md border bg-card p-3 transition-colors ease-terminal hover:bg-accent"
        >
          <button
            type="button"
            className="min-w-0 flex-1 cursor-pointer rounded-sm text-left focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            onClick={() => onOpen(b)}
          >
            <p className="break-words font-mono text-small font-medium">
              {b.name} <span className="text-muted-foreground">· {b.kind}</span>
            </p>
            <BuildSummary build={b} />
          </button>
          {b.seoReady === true || b.wcagReady === true ? (
            <Badge variant="outline" className="font-mono text-caption text-muted-foreground">
              {/* BP-03: legacy client claims, shown as unverified. */}
              {b.seoReady === true ? "seo: legacy ok — verify" : "seo: —"} ·{" "}
              {b.wcagReady === true ? "wcag: legacy ok — verify" : "wcag: —"}
            </Badge>
          ) : null}
          <StatusBadge status={siteStatusForDisplay(b.status)} />
          <DeleteBuildButton build={b} onDelete={onDelete} />
        </div>
      ))}
    </div>
  );
}
