import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

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
  className,
}: {
  status: string;
  className?: string;
}) {
  const tone: Tone = (STATUS_TONE as Record<string, Tone | undefined>)[status] ?? "neutral";
  return (
    <Badge
      variant="outline"
      className={cn("font-mono text-caption", TONE_CLASS[tone], className)}
    >
      {status.replace(/_/g, " ")}
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
