import { useEffect, useState, useSyncExternalStore, type FocusEvent } from "react";
import { useQuery } from "convex/react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  Loader2,
  Lock,
  Pause,
  Play,
  X,
  XCircle,
} from "lucide-react";

import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/app/module-kit";
import { cn } from "@/lib/utils";
import type { StarterKitPartName } from "@/shared/starterKit";
import {
  bootHeading,
  checklistAnnouncement,
  checklistRows,
  isKitSettled,
  mosaicTiles,
  readDismissed,
  shouldShowBootloader,
  writeDismissed,
  type BootPartState,
  type ChecklistRow,
  type TileState,
} from "@/components/app/kit/bootloader-model";
import { EXPLAINERS, EXPLAINER_ROTATE_MS, nextExplainer } from "@/components/app/kit/explainers";

/**
 * "Mosaic assembles": the full-screen loader on Home while a fresh starter
 * kit is being drafted (queued or running). Every tile and line comes from
 * `starterKit.get`; the rotating cards below are general product info and
 * say so. "Go to my kit" is always there, and closing is remembered per kit
 * for this viewer only.
 */
export function KitBootloader({ projectId }: { projectId: Id<"projects"> }) {
  const kit = useQuery(api.starterKit.get, { projectId });
  // Read once: the loader opens only for a kit updated in the last minutes.
  const [now] = useState(() => Date.now());
  const [closed, setClosed] = useState<ReadonlySet<string>>(() => new Set());
  const [openFor, setOpenFor] = useState<string | null>(null);

  // Loading (undefined) and no kit (null) render nothing.
  if (!kit) return null;

  const dismissed = closed.has(kit._id) || readDismissed(browserStorage, kit._id);
  // Open once for a running kit, then stay open (showing "ready") until the
  // owner leaves: the screen never jumps away on its own.
  if (openFor !== kit._id && !dismissed && shouldShowBootloader(kit, { now, dismissed })) {
    setOpenFor(kit._id);
  }
  const open = openFor === kit._id && !dismissed && kit.dismissedAt === undefined;
  if (!open) return null;

  const close = () => {
    writeDismissed(browserStorage, kit._id);
    setClosed((current) => new Set([...current, kit._id]));
  };

  return <BootloaderScreen kit={kit} onClose={close} />;
}

function browserStorage(): Storage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

/* ── Reduced motion, following the setting live ─────────────────────── */

const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeReduced(onChange: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const query = window.matchMedia(REDUCED_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReduced,
    () => typeof window !== "undefined" && !!window.matchMedia && window.matchMedia(REDUCED_QUERY).matches,
    () => true,
  );
}

/* ── The screen ──────────────────────────────────────────────────────── */

function BootloaderScreen({ kit, onClose }: { kit: Doc<"starterKits">; onClose: () => void }) {
  const reduced = usePrefersReducedMotion();
  const rows = checklistRows(kit.parts);
  const settled = isKitSettled(kit.parts);
  const heading = bootHeading(kit.parts);

  // Announce what changed, once per change: derived while rendering from
  // the last snapshot, so re-renders with the same data say nothing.
  const signature = JSON.stringify(rows);
  const [seen, setSeen] = useState<{
    signature: string;
    rows: ChecklistRow[] | null;
    settled: boolean;
    text: string;
  }>({ signature: "", rows: null, settled: false, text: "" });
  if (seen.signature !== signature) {
    const text = checklistAnnouncement(seen.rows, rows, heading, seen.settled, settled);
    setSeen({ signature, rows, settled, text: text ?? seen.text });
  }

  return (
    <DialogPrimitive.Root open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          data-testid="kit-bootloader"
          data-kit-settled={settled ? "true" : "false"}
          className="fixed inset-0 z-50 overflow-y-auto bg-background outline-none"
          onCloseAutoFocus={(event) => {
            // Land on the kit the owner asked to go to.
            const target = document.getElementById("starter-kit-title");
            if (!target) return;
            event.preventDefault();
            target.setAttribute("tabindex", "-1");
            target.focus();
          }}
        >
          <div className="mx-auto grid w-full max-w-3xl gap-6 px-4 py-6 sm:gap-8 sm:px-6 sm:py-10">
            <header className="flex flex-wrap items-start justify-between gap-4">
              <div className="grid min-w-0 gap-1">
                <p className="text-caption font-mono uppercase text-muted-foreground">Starter kit</p>
                <DialogPrimitive.Title className="text-h1">{heading.title}</DialogPrimitive.Title>
                <DialogPrimitive.Description className="text-body text-muted-foreground">
                  {heading.description}
                </DialogPrimitive.Description>
              </div>
              <Button className="min-h-11" onClick={onClose}>
                Go to my kit
                <ArrowRight className="size-4" aria-hidden="true" />
              </Button>
            </header>

            <Mosaic kit={kit} reduced={reduced} />

            <section aria-labelledby="kit-boot-checklist-title" className="grid gap-3">
              <h2 id="kit-boot-checklist-title" className="text-h3">
                What we are doing now
              </h2>
              <ul className="grid gap-2" data-testid="kit-boot-checklist">
                {rows.map((row) => (
                  <ChecklistItem key={row.name} row={row} />
                ))}
              </ul>
              <p className="sr-only" role="status" aria-live="polite" data-testid="kit-boot-announcer">
                {seen.text}
              </p>
            </section>

            <Explainers reduced={reduced} />
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/* ── Mosaic ──────────────────────────────────────────────────────────── */

const PART_FILL: Record<StarterKitPartName, { solid: string; soft: string; edge: string }> = {
  plan: { solid: "bg-tile-teal", soft: "bg-tile-teal-soft", edge: "border-tile-teal" },
  site: { solid: "bg-tile-violet", soft: "bg-tile-violet-soft", edge: "border-tile-violet" },
  posts: { solid: "bg-tile-coral", soft: "bg-tile-coral-soft", edge: "border-tile-coral" },
};

function tileClass(part: StarterKitPartName, state: TileState, reduced: boolean): string {
  const colors = PART_FILL[part];
  switch (state) {
    case "filled":
      return cn(colors.solid, !reduced && "motion-safe:animate-mosaic-pop");
    case "active":
      return cn("border", colors.edge, colors.soft, !reduced && "motion-safe:animate-pulse");
    case "gap":
      return cn("border-2 border-dashed", colors.edge, colors.soft);
    case "failed":
      return "border border-terminal-red/40 bg-terminal-red-soft text-terminal-red";
    case "locked":
      return "border border-border bg-muted text-muted-foreground";
    case "empty":
      return "border border-dashed border-border bg-muted/40";
  }
}

function Mosaic({ kit, reduced }: { kit: Doc<"starterKits">; reduced: boolean }) {
  const tiles = mosaicTiles(kit.parts);
  return (
    // Decoration: the checklist below carries the same facts in words.
    <div aria-hidden="true" className="mx-auto w-full max-w-sm sm:max-w-md" data-testid="kit-mosaic">
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 sm:gap-3">
        {tiles.map((tile) => (
          <div
            key={tile.key}
            data-tile-part={tile.part}
            data-tile-state={tile.state}
            className={cn(
              "flex aspect-square items-center justify-center rounded-md transition-colors duration-500 ease-terminal motion-reduce:transition-none",
              tileClass(tile.part, tile.state, reduced),
            )}
          >
            {tile.state === "failed" ? <X className="size-4" /> : null}
            {tile.state === "locked" ? <Lock className="size-4" /> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Checklist ───────────────────────────────────────────────────────── */

const SWATCH: Record<StarterKitPartName, string> = {
  plan: "bg-tile-teal",
  site: "bg-tile-violet",
  posts: "bg-tile-coral",
};

function StateIcon({ state }: { state: BootPartState }) {
  const common = "size-5 shrink-0";
  switch (state) {
    case "waiting":
      return <Circle className={cn(common, "text-muted-foreground")} aria-hidden="true" />;
    case "working":
      return <Loader2 className={cn(common, "text-foreground motion-safe:animate-spin")} aria-hidden="true" />;
    case "done":
      return <CheckCircle2 className={cn(common, "text-terminal-green-ink")} aria-hidden="true" />;
    case "partial":
      return <AlertTriangle className={cn(common, "text-terminal-amber-ink")} aria-hidden="true" />;
    case "failed":
      return <XCircle className={cn(common, "text-terminal-red")} aria-hidden="true" />;
    case "locked":
      return <Lock className={cn(common, "text-muted-foreground")} aria-hidden="true" />;
  }
}

function ChecklistItem({ row }: { row: ChecklistRow }) {
  return (
    <li
      data-boot-part={row.name}
      data-boot-state={row.state}
      className="flex min-w-0 items-start gap-3 rounded-lg border bg-card p-3 shadow-soft"
    >
      <StateIcon state={row.state} />
      <div className="grid min-w-0 flex-1 gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span aria-hidden="true" className={cn("size-2.5 shrink-0 rounded-sm", SWATCH[row.name])} />
          <span className="text-body font-semibold">{row.title}</span>
          <StatusBadge status={row.badge} />
        </div>
        <p className="text-small text-muted-foreground" data-boot-text>
          {row.text}
        </p>
      </div>
    </li>
  );
}

/* ── While you wait ──────────────────────────────────────────────────── */

function Explainers({ reduced }: { reduced: boolean }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [held, setHeld] = useState(false);
  // WCAG 2.2.2: never rotate under reduced motion, when paused, or while
  // the owner is pointing at or inside the cards.
  const rotating = !reduced && !paused && !held;

  useEffect(() => {
    if (!rotating) return;
    const timer = window.setInterval(() => setIndex((current) => nextExplainer(current, 1)), EXPLAINER_ROTATE_MS);
    return () => window.clearInterval(timer);
  }, [rotating]);

  const card = EXPLAINERS[index];
  const onBlur = (event: FocusEvent<HTMLElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setHeld(false);
  };

  return (
    <section
      aria-labelledby="kit-explainers-title"
      className="grid gap-3 rounded-xl border bg-surface-gradient p-4 sm:p-5"
      data-testid="kit-explainers"
      data-rotating={rotating ? "true" : "false"}
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={onBlur}
    >
      <div className="grid gap-1">
        <h2 id="kit-explainers-title" className="text-h3">
          While you wait: what MOSAI does
        </h2>
        <p className="text-small text-muted-foreground">General info about MOSAI, not your kit&apos;s progress.</p>
      </div>

      <div aria-live={rotating ? "off" : "polite"} aria-atomic="true" className="min-h-24">
        <div
          key={card.id}
          data-testid="kit-explainer"
          data-explainer-id={card.id}
          className={cn("grid gap-1", !reduced && "motion-safe:animate-mosaic-in")}
        >
          <p className="text-caption font-mono uppercase text-muted-foreground">
            {index + 1} of {EXPLAINERS.length}
          </p>
          <h3 className="text-body font-semibold">{card.title}</h3>
          <p className="text-body text-muted-foreground">{card.body}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          className="size-11"
          onClick={() => setIndex((current) => nextExplainer(current, -1))}
          aria-label="Previous tip"
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
        </Button>
        {reduced ? null : (
          <Button variant="outline" className="min-h-11" onClick={() => setPaused((current) => !current)}>
            {paused ? <Play className="size-4" aria-hidden="true" /> : <Pause className="size-4" aria-hidden="true" />}
            {paused ? "Play tips" : "Pause tips"}
          </Button>
        )}
        <Button
          variant="outline"
          size="icon"
          className="size-11"
          onClick={() => setIndex((current) => nextExplainer(current, 1))}
          aria-label="Next tip"
        >
          <ChevronRight className="size-4" aria-hidden="true" />
        </Button>
      </div>
    </section>
  );
}
