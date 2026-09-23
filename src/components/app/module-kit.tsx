import { Component, useState, type ErrorInfo, type ReactNode } from "react";
import { Link } from "react-router";
import { AlertTriangle, Loader2 } from "lucide-react";
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
  neutral: "border-border text-muted-foreground",
  green:
    "border-terminal-green/40 bg-terminal-green-soft text-terminal-green",
  amber: "border-terminal-amber/40 bg-terminal-amber-soft text-terminal-amber",
  red: "border-terminal-red/40 bg-terminal-red-soft text-terminal-red",
  blue: "border-terminal-blue/40 bg-terminal-blue-soft text-terminal-blue",
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
      className={cn("font-mono text-caption", TONE_CLASS[tone], className)}
    >
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
      className={cn("font-mono text-caption text-muted-foreground", className)}
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
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: "green" | "amber" | "red";
}) {
  return (
    <div className="rounded-md border bg-card p-4 shadow-card">
      <p className="font-mono text-caption text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-1 font-mono text-metric",
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

/* ── Confirm delete: consistent destructive confirmation ──────────────── */

export function ConfirmDelete({
  what,
  onConfirm,
  trigger,
}: {
  what: string;
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
          <DialogTitle className="font-mono text-h3">
            Delete {what}?
          </DialogTitle>
          <DialogDescription className="font-mono text-caption">
            This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={run} disabled={busy}>
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
 *  render "No … yet" during that window. */
export function ModuleSkeleton({
  label = "Loading…",
  rows = 2,
}: {
  label?: string;
  rows?: number;
}) {
  return (
    <div role="status" className="grid gap-3">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          aria-hidden
          className="h-16 animate-pulse rounded-md border bg-card shadow-card"
        />
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
      className="rounded-md border border-terminal-red/40 bg-terminal-red-soft p-6 text-center"
    >
      <AlertTriangle className="mx-auto size-5 text-terminal-red" />
      <p className="mt-2 font-mono text-small font-medium">{title}</p>
      <p className="mt-1 font-mono text-caption text-muted-foreground">{hint}</p>
      {onRetry && (
        <div className="mt-3 flex justify-center">
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
      className="mt-8 flex flex-wrap items-center gap-x-3 gap-y-1 border-t pt-4"
    >
      <span className="font-mono text-caption text-muted-foreground">
        related:
      </span>
      {modules.map((m) => (
        <Link
          key={m}
          to={`/app/${projectId}/${m}`}
          className="font-mono text-caption text-terminal-green hover:underline"
        >
          {MODULE_LABEL[m] ?? m}
        </Link>
      ))}
    </nav>
  );
}

/* ── Module empty state ───────────────────────────────────────────────── */

export function ModuleEmpty({
  icon: Icon,
  title,
  hint,
  action,
}: {
  icon: React.ElementType;
  title: string;
  hint: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-dashed p-10 text-center">
      <Icon className="mx-auto size-6 text-muted-foreground" />
      <p className="mt-3 font-mono text-small font-medium">{title}</p>
      <p className="mx-auto mt-1 max-w-md font-mono text-caption text-muted-foreground">
        {hint}
      </p>
      {action && <div className="mt-4 flex justify-center">{action}</div>}
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
