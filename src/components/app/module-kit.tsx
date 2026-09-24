import { Component, useState, type ErrorInfo, type ReactNode } from "react";
import { Link } from "react-router";
import { AlertTriangle, ArrowUpRight, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { Id } from "@/convex/_generated/dataModel";

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
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/* ── Status badge: one visual grammar for every workflow state ─────────── */

const STATUS_TONE = {
  draft: "neutral",
  scheduled: "blue",
  running: "green",
  published: "green",
  generated: "green",
  connected: "green",
  fresh: "green",
  approved: "green",
  done: "green",
  paused: "amber",
  error: "red",
  failed: "red",
  stale: "amber",
  past_due: "amber",
  canceled: "red",
  pending: "amber",
} as const;

type Tone = "neutral" | "green" | "amber" | "red" | "blue";

const TONE_CLASS: Record<Tone, string> = {
  neutral: "border-border bg-muted/60 text-muted-foreground",
  green:
    "border-terminal-green/40 bg-terminal-green-soft text-terminal-green",
  amber: "border-terminal-amber/40 bg-terminal-amber-soft text-terminal-amber",
  red: "border-terminal-red/40 bg-terminal-red-soft text-terminal-red",
  blue: "border-terminal-blue/40 bg-terminal-blue-soft text-terminal-blue",
};

/* Leading dot per tone. The dot only mirrors the tone the status already
 * maps to — it never adds a check mark, pulse or other "confirmed"
 * affordance, so a status can never look more certain than STATUS_TONE
 * says it is. Externally verifiable states belong in ReceiptBadge. */
const TONE_DOT: Record<Tone, string> = {
  neutral: "bg-muted-foreground/60",
  green: "bg-terminal-green",
  amber: "bg-terminal-amber",
  red: "bg-terminal-red",
  blue: "bg-terminal-blue",
};

export function StatusBadge({
  status,
  detail,
  className,
}: {
  status: string;
  /** Short honest qualifier, e.g. "MOSAI-local · awaiting provider verification". */
  detail?: string;
  className?: string;
}) {
  const tone: Tone = (STATUS_TONE as Record<string, Tone | undefined>)[status] ?? "neutral";
  return (
    <Badge
      variant="outline"
      data-tone={tone}
      className={cn("gap-1.5 font-mono text-caption", TONE_CLASS[tone], className)}
    >
      <span
        aria-hidden="true"
        className={cn("size-1.5 shrink-0 rounded-full", TONE_DOT[tone])}
      />
      {status.replace(/_/g, " ")}
      {detail ? (
        <span className="font-sans font-normal text-muted-foreground">· {detail}</span>
      ) : null}
    </Badge>
  );
}

/* ── Source chip: provenance is always visible, never blended silently ── */

export function SourceChip({
  source,
  asOf,
  className,
}: {
  source: string;
  asOf?: number;
  className?: string;
}) {
  const label = asOf
    ? `${source} · ${new Date(asOf).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      })}`
    : source;
  return (
    <Badge
      variant="outline"
      className={cn(
        "bg-card font-mono text-caption text-muted-foreground",
        className,
      )}
    >
      src: {label}
    </Badge>
  );
}

/* ── Stat: small metric card used across module dashboards ────────────── */

export function Stat({
  label,
  value,
  hint,
  tone,
  icon: Icon,
  className,
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: "green" | "amber" | "red";
  /** Optional small glyph shown beside the label. */
  icon?: React.ElementType;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border bg-card p-4 shadow-card transition-shadow duration-200 ease-terminal hover:shadow-pop",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="font-mono text-caption text-muted-foreground">{label}</p>
        {Icon ? (
          <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        ) : null}
      </div>
      <p
        className={cn(
          "mt-1.5 font-mono text-metric tabular-nums",
          tone === "green" && "text-terminal-green",
          tone === "amber" && "text-terminal-amber",
          tone === "red" && "text-terminal-red",
        )}
      >
        {value}
      </p>
      {hint && (
        <p className="mt-1 font-mono text-caption text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  );
}

/* ── Section header: one heading grammar for every module section ─────── */

/** Consistent section heading: optional eyebrow and icon, a title, a
 *  one-line description and a right-aligned action slot that wraps under
 *  the title on narrow screens. Choose the heading level with `as` so the
 *  page outline stays correct. */
export function SectionHeader({
  title,
  description,
  eyebrow,
  icon: Icon,
  actions,
  as: Heading = "h2",
  id,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  /** Small mono label above the title, e.g. "step 2". */
  eyebrow?: ReactNode;
  icon?: React.ElementType;
  actions?: ReactNode;
  as?: "h1" | "h2" | "h3" | "h4";
  /** Heading id, so a surrounding region can use aria-labelledby. */
  id?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mb-4 flex flex-wrap items-end justify-between gap-x-4 gap-y-3",
        className,
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        {Icon ? (
          <span
            aria-hidden="true"
            className="grid size-9 shrink-0 place-items-center rounded-md border bg-card text-muted-foreground shadow-card"
          >
            <Icon className="size-4" />
          </span>
        ) : null}
        <div className="min-w-0">
          {eyebrow ? (
            <p className="font-mono text-caption uppercase text-muted-foreground">
              {eyebrow}
            </p>
          ) : null}
          <Heading id={id} className="font-mono text-h3 text-foreground">
            {title}
          </Heading>
          {description ? (
            <p className="mt-0.5 max-w-prose font-mono text-caption text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}

/* ── Confirm delete: consistent destructive confirmation ──────────────── */

export function ConfirmDelete({
  what,
  description,
  onConfirm,
  trigger,
}: {
  what: string;
  description?: string;
  onConfirm: () => Promise<void>;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      await onConfirm();
      setOpen(false);
    } catch (e) {
      toast.error("Delete failed", {
        description: e instanceof Error ? e.message : "Try again.",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <span
            aria-hidden="true"
            className="mb-1 grid size-10 place-items-center rounded-lg border border-terminal-red/30 bg-terminal-red-soft text-terminal-red"
          >
            <Trash2 className="size-5" />
          </span>
          <DialogTitle className="font-mono text-h3">
            Delete {what}?
          </DialogTitle>
          <DialogDescription className="font-mono text-caption">
            {description ?? "This cannot be undone."}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={run}
            disabled={busy}
            aria-busy={busy || undefined}
          >
            {busy && <Loader2 className="size-4 animate-spin" />}
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── Loading state: never flash an empty state while data is in flight ── */

/** Honest skeleton for a module section that is still loading.
 *  Convex queries return `undefined` until they resolve; pages must not
 *  render "No … yet" during that window. The shimmer comes from
 *  `Skeleton` and stops under prefers-reduced-motion. */
export function ModuleSkeleton({
  label = "Loading…",
  rows = 2,
  variant = "rows",
}: {
  label?: string;
  rows?: number;
  /** "rows" (default) stacks list rows; "cards" lays placeholders in a grid. */
  variant?: "rows" | "cards";
}) {
  return (
    <div
      role="status"
      aria-busy="true"
      className={cn(
        "grid gap-3",
        variant === "cards" && "sm:grid-cols-2 lg:grid-cols-3",
      )}
    >
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          aria-hidden="true"
          className={cn(
            "flex gap-3 rounded-lg border bg-card p-4 shadow-card",
            variant === "cards" ? "min-h-32 flex-col" : "min-h-16 items-center",
          )}
        >
          <Skeleton className="size-8 shrink-0" />
          <div className="grid flex-1 gap-2">
            <Skeleton className="h-3 w-2/5" />
            <Skeleton className={cn("h-3", i % 2 === 0 ? "w-4/5" : "w-3/5")} />
            {variant === "cards" ? <Skeleton className="h-3 w-1/2" /> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── Error state: a query/render failure is shown, never swallowed ────── */

export function ModuleErrorState({
  title = "We couldn't load this section.",
  hint = "Your data is safe. Try again in a moment.",
  onRetry,
}: {
  title?: string;
  hint?: string;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="rounded-lg border border-terminal-red/40 bg-terminal-red-soft px-6 py-8 text-center"
    >
      <span
        aria-hidden="true"
        className="mx-auto grid size-10 place-items-center rounded-lg border border-terminal-red/30 bg-card text-terminal-red shadow-card"
      >
        <AlertTriangle className="size-5" />
      </span>
      <p className="mt-3 font-mono text-small font-medium text-foreground">{title}</p>
      <p className="mx-auto mt-1 max-w-md font-mono text-caption text-muted-foreground">
        {hint}
      </p>
      {onRetry && (
        <div className="mt-4 flex justify-center">
          <Button size="sm" variant="outline" onClick={onRetry}>
            Try again
          </Button>
        </div>
      )}
    </div>
  );
}

/** Per-section error boundary. Convex query errors surface during render;
 *  this keeps one failed section from blanking the whole module page. */
export class ModuleErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.warn("[module] section failed:", error.message, info.componentStack);
  }

  render() {
    if (this.state.failed) {
      return (
        <ModuleErrorState onRetry={() => this.setState({ failed: false })} />
      );
    }
    return this.props.children;
  }
}

/* ── Contextual cross-module links ────────────────────────────────────── */

const MODULE_LABEL: Record<string, string> = {
  understand: "Understand",
  journeys: "Journeys",
  create: "Create",
  build: "Build",
  customers: "Customers",
  promote: "Promote",
  sell: "Sell",
  grow: "Grow",
};

/** "Related" row: contextual, permission-aware links to neighbouring work.
 *  Locked modules simply resolve to their route and the route gate sends a
 *  visitor to the plan screen — the same behaviour as the sidebar. */
export function RelatedModules({
  projectId,
  modules,
}: {
  projectId: Id<"projects">;
  modules: readonly string[];
}) {
  if (modules.length === 0) return null;
  return (
    <nav
      aria-label="Related components"
      className="mt-8 flex flex-wrap items-center gap-2 border-t pt-4"
    >
      <span className="mr-1 font-mono text-caption text-muted-foreground">
        related:
      </span>
      {modules.map((m) => (
        <Link
          key={m}
          to={`/app/${projectId}/${m}`}
          className="group/related inline-flex items-center gap-1 rounded-full border bg-card px-3 py-1 font-mono text-caption text-foreground shadow-card transition-[color,box-shadow,border-color] duration-150 ease-terminal hover:border-terminal-green/50 hover:text-terminal-green hover:shadow-pop focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {MODULE_LABEL[m] ?? m}
          <ArrowUpRight
            aria-hidden="true"
            className="size-3 text-muted-foreground transition-transform duration-150 ease-terminal group-hover/related:text-terminal-green motion-safe:group-hover/related:translate-x-0.5 motion-safe:group-hover/related:-translate-y-0.5"
          />
        </Link>
      ))}
    </nav>
  );
}

/* ── Module empty state ───────────────────────────────────────────────── */

const EMPTY_TILE: Record<"neutral" | "warning" | "error", string> = {
  neutral: "border-border bg-card text-foreground",
  warning: "border-terminal-amber/30 bg-terminal-amber-soft text-terminal-amber",
  error: "border-terminal-red/30 bg-terminal-red-soft text-terminal-red",
};

/** Empty state: an illustrative icon tile, one title, one line of help and
 *  a single clear next step. Use `tone="warning"`/`"error"` when the area is
 *  empty because something is unavailable, not because nothing exists. */
export function ModuleEmpty({
  icon: Icon,
  title,
  hint,
  action,
  tone = "neutral",
  className,
}: {
  icon: React.ElementType;
  title: string;
  hint: string;
  /** One clear next step: a single primary button or link. */
  action?: React.ReactNode;
  tone?: "neutral" | "warning" | "error";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative isolate overflow-hidden rounded-lg border border-dashed bg-muted/30 px-6 py-12 text-center",
        className,
      )}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 bg-dots opacity-70"
      />
      <span
        aria-hidden="true"
        className={cn(
          "relative mx-auto grid size-12 place-items-center rounded-xl border shadow-card",
          EMPTY_TILE[tone],
        )}
      >
        <span className="absolute -top-1.5 -right-1.5 size-3 rounded-sm border bg-terminal-green-soft" />
        <span className="absolute -bottom-1 -left-1.5 size-2 rounded-sm border bg-terminal-blue-soft" />
        <Icon className="size-5" />
      </span>
      <p className="mt-4 font-mono text-small font-medium text-foreground">{title}</p>
      <p className="mx-auto mt-1 max-w-md font-mono text-caption text-muted-foreground">
        {hint}
      </p>
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}

/* ── Connection status strip (used by Overview + Grow) ────────────────── */

export const DATA_PROVIDERS = [
  { id: "ga4", label: "GA4", detail: "Traffic & conversions" },
  { id: "gsc", label: "Search Console", detail: "Queries & indexing" },
  { id: "gads", label: "Google Ads", detail: "Spend & ROAS" },
  { id: "meta", label: "Meta", detail: "Ads & social" },
  { id: "tiktok", label: "TikTok", detail: "Ads & organic" },
  { id: "posthog", label: "PostHog", detail: "Product events" },
  { id: "matomo", label: "Matomo", detail: "Web analytics" },
  { id: "gtm", label: "GTM", detail: "Tag management" },
] as const;
