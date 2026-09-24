import React, { useState } from "react";
import { useAction, useQuery } from "convex/react";
import type { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { Copy, ExternalLink, Globe, Loader2, Rocket } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  deployWebsiteAction,
  hostingStateView,
  needsPreparedRelease,
  publicSiteUrl,
  publishButtonLabel,
  siteHostingStatusQuery,
  type HostingTone,
} from "./publishToWebState";

/* ── Publish to web ────────────────────────────────────────────────────────
 *
 * Puts the customer's website on the web at `/s/<slug>-website` (owner
 * decision, 24 Sep 2026). The badge reads "Live" only when the server says
 * `state === "live"` (AGENTS.md rule 5); everything else is an honest
 * not-yet / in-progress / failed state.
 *
 * `prepare` (optional) runs first — the Build workspace passes the
 * "prepare release" mutation so one click prepares the release and then
 * deploys it. Without it (Site panel) the button deploys the releases that
 * were already prepared page by page.
 */

const TONE_CLASS: Record<HostingTone, string> = {
  live: "border-terminal-green/40 bg-terminal-green-soft text-terminal-green",
  progress: "border-terminal-blue/40 bg-terminal-blue-soft text-terminal-blue",
  failed: "border-terminal-red/40 bg-terminal-red-soft text-terminal-red",
  neutral: "border-border bg-muted/60 text-muted-foreground",
};

const TONE_DOT: Record<HostingTone, string> = {
  live: "bg-terminal-green",
  progress: "bg-terminal-blue",
  failed: "bg-terminal-red",
  neutral: "bg-muted-foreground/60",
};

function HostingBadge({ tone, text }: { tone: HostingTone; text: string }) {
  return (
    <span
      data-tone={tone}
      className={cn(
        "inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-caption font-medium",
        TONE_CLASS[tone],
      )}
    >
      <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", TONE_DOT[tone])} />
      <span className="truncate" title={text}>
        {text}
      </span>
    </span>
  );
}

type PublishToWebProps = {
  projectId: Id<"projects">;
  /** Runs before the deploy (e.g. prepare the release). Throw to stop. */
  prepare?: () => Promise<unknown>;
  /** Disable the primary button (e.g. no page has content yet). */
  disabled?: boolean;
  disabledReason?: string;
  /** Single-row layout for the Site panel. */
  compact?: boolean;
  className?: string;
};

function PublishToWebInner({
  projectId,
  prepare,
  disabled,
  disabledReason,
  compact,
  className,
}: PublishToWebProps) {
  const status = useQuery(siteHostingStatusQuery, { projectId });
  const deploy = useAction(deployWebsiteAction);
  const [step, setStep] = useState<"idle" | "preparing" | "deploying">("idle");
  const [releaseHint, setReleaseHint] = useState(false);

  const busy = step !== "idle";
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const url = publicSiteUrl(origin, status?.path);
  const view = busy
    ? hostingStateView({ state: "deploying", error: null })
    : hostingStateView(status);

  const copy = async (link: string) => {
    try {
      await navigator.clipboard.writeText(link);
      toast.success("Link copied");
    } catch {
      toast.error("Could not copy the link", { description: link });
    }
  };

  const publish = async () => {
    if (busy) return;
    setReleaseHint(false);
    let phase: "preparing" | "deploying" = "deploying";
    try {
      if (prepare) {
        phase = "preparing";
        setStep(phase);
        await prepare();
      }
      phase = "deploying";
      setStep(phase);
      const res = await deploy({ projectId });
      const link = publicSiteUrl(origin, res.path);
      toast.success("Your website is on the web", {
        description: link ?? res.path,
        action: link
          ? {
              label: "Open",
              onClick: () => window.open(link, "_blank", "noopener,noreferrer"),
            }
          : undefined,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Try again.";
      if (needsPreparedRelease(message)) setReleaseHint(true);
      toast.error(phase === "preparing" ? "Release preparation failed" : "Publish failed", {
        description: message,
      });
    } finally {
      setStep("idle");
    }
  };

  const label = busy
    ? step === "preparing"
      ? "Preparing release…"
      : "Publishing…"
    : publishButtonLabel(status);

  return (
    <section
      aria-label="Publish to web"
      className={cn(
        "flex flex-wrap items-center gap-2 font-mono text-caption",
        compact ? "rounded-md border bg-card p-3 shadow-card" : "border-b px-3 py-2",
        className,
      )}
    >
      <Globe aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
      <div role="status" aria-live="polite" className="flex min-w-0 items-center gap-2">
        {status === undefined ? (
          <span className="text-muted-foreground">Checking web status…</span>
        ) : (
          <HostingBadge tone={view.tone} text={view.text} />
        )}
      </div>

      {url ? (
        view.isLive ? (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="min-w-0 truncate text-foreground underline-offset-2 hover:underline focus-visible:rounded-sm focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            {url}
          </a>
        ) : (
          <span className="min-w-0 truncate text-muted-foreground" title={url}>
            {url}
            <span className="sr-only"> (not live yet)</span>
          </span>
        )
      ) : null}

      <div className="ml-auto flex items-center gap-1.5">
        {url && (
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Copy website link"
            onClick={() => void copy(url)}
          >
            <Copy className="size-3.5" />
          </Button>
        )}
        {url && view.isLive && (
          <Button size="icon-sm" variant="ghost" asChild>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Open live website in a new tab"
            >
              <ExternalLink className="size-3.5" />
            </a>
          </Button>
        )}
        <Button
          size="sm"
          onClick={() => void publish()}
          disabled={busy || disabled || status === undefined}
          title={disabled ? disabledReason : undefined}
          aria-busy={busy}
        >
          {busy ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Rocket className="size-3.5" aria-hidden="true" />
          )}
          {label}
        </Button>
      </div>

      {(releaseHint || compact) && (
        <p
          className={cn(
            "w-full",
            releaseHint ? "text-terminal-amber" : "text-muted-foreground",
          )}
        >
          {prepare
            ? "Publishing prepares a release of your pages, then puts that release on the web."
            : "Only prepared releases go on the web — use “Prepare release” on each page first."}
        </p>
      )}
      {disabled && disabledReason && !compact && (
        <p className="w-full text-muted-foreground">{disabledReason}</p>
      )}
    </section>
  );
}

/** Keeps the rest of the page usable if the hosting backend is unavailable. */
class PublishToWebBoundary extends React.Component<
  { compact?: boolean; className?: string; children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <section
        aria-label="Publish to web"
        className={cn(
          "flex items-center gap-2 font-mono text-caption",
          this.props.compact ? "rounded-md border bg-card p-3 shadow-card" : "border-b px-3 py-2",
          this.props.className,
        )}
      >
        <Globe aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
        <HostingBadge tone="neutral" text="Publishing to the web is unavailable right now" />
      </section>
    );
  }
}

export function PublishToWeb(props: PublishToWebProps) {
  return (
    <PublishToWebBoundary compact={props.compact} className={props.className}>
      <PublishToWebInner {...props} />
    </PublishToWebBoundary>
  );
}
