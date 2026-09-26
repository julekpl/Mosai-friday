import { AlertCircle, ArrowRight, Check, Loader2, Sparkles, type LucideIcon } from "lucide-react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import {
  FOR_YOU_NOW_EMPTY,
  forYouNowAnnouncement,
  forYouNowTone,
  type ForYouNowTone,
} from "@/components/app/next-action-model";
import type { HomePriorityAction, HomePriorityItem } from "@/shared/homePriorities";
import { cn } from "@/lib/utils";

/** Presentation per tone. Ink tones are the AA-safe `*-ink` tokens. */
const TONE: Record<ForYouNowTone, { icon: LucideIcon; soft: string; ink: string; label: string }> = {
  needs_you: { icon: AlertCircle, soft: "bg-terminal-amber-soft", ink: "text-terminal-amber-ink", label: "Needs you" },
  ready: { icon: Check, soft: "bg-terminal-green-soft", ink: "text-terminal-green-ink", label: "Ready for you" },
  next: { icon: ArrowRight, soft: "bg-tile-sky-soft", ink: "text-tile-sky-ink", label: "Next" },
  working: { icon: Loader2, soft: "bg-tile-violet-soft", ink: "text-tile-violet-ink", label: "Working" },
};

export type IntentAction = Extract<HomePriorityAction, { kind: "intent" }>;

/**
 * "Why this?": the one reason pattern on Home (HM-2). The same list the
 * "This week" card used for "Why this step", now under every item.
 */
export function WhyThis({ lines, className }: { lines: readonly string[]; className?: string }) {
  if (!lines.length) return null;
  return (
    <ul aria-label="Why this?" className={cn("grid gap-1 font-mono text-caption text-muted-foreground", className)}>
      {lines.map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  );
}

function ItemAction({
  item,
  primary,
  busy,
  onIntent,
}: {
  item: HomePriorityItem;
  primary: boolean;
  busy: boolean;
  onIntent: (action: IntentAction) => void;
}) {
  const { action } = item;
  const className = "group min-h-11 w-full sm:w-auto";
  const variant = primary ? "default" : "outline";
  const arrow = (
    <ArrowRight
      aria-hidden="true"
      className="size-4 transition-transform duration-200 ease-terminal motion-safe:group-hover:translate-x-0.5"
    />
  );
  if (action.kind === "link") {
    return (
      <Button asChild variant={variant} className={className}>
        <Link to={action.to}>
          {action.label}
          {arrow}
        </Link>
      </Button>
    );
  }
  return (
    <Button
      type="button"
      variant={variant}
      className={className}
      disabled={busy}
      aria-busy={busy || undefined}
      onClick={() => onIntent(action)}
      data-intent={action.intent}
    >
      {busy ? <Loader2 aria-hidden="true" className="size-4 motion-safe:animate-spin" /> : null}
      {action.label}
      {busy ? null : arrow}
    </Button>
  );
}

/**
 * "For you now" (HM-1/HM-2): the one list on Home. At most three items,
 * ranked on the server (`home.priorities`); this component only draws them.
 * One polite live region names the top item when it changes. On a return
 * visit the "since you were away" line sits under the top item.
 */
export function ForYouNow({
  items,
  subline,
  busyItemId,
  onIntent,
}: {
  /** `undefined` while loading. */
  items: readonly HomePriorityItem[] | undefined;
  subline: string | null;
  busyItemId: string | null;
  onIntent: (item: HomePriorityItem, action: IntentAction) => void;
}) {
  return (
    <section
      aria-labelledby="for-you-now-title"
      data-testid="for-you-now"
      className="rounded-xl border bg-surface-gradient p-4 shadow-lift sm:p-6"
    >
      <h2
        id="for-you-now-title"
        className="inline-flex w-fit items-center gap-1.5 rounded-full border border-terminal-green/30 bg-terminal-green-soft px-2.5 py-1 font-mono text-caption font-medium text-terminal-green-ink"
      >
        <Sparkles aria-hidden="true" className="size-3.5" />
        For you now
      </h2>

      <p className="sr-only" role="status" aria-live="polite" data-testid="for-you-now-announcer">
        {items === undefined ? "" : forYouNowAnnouncement(items)}
      </p>

      {items === undefined ? (
        <div aria-hidden="true" className="mt-4 grid gap-3">
          <span className="h-7 w-3/4 animate-pulse rounded-md bg-muted" />
          <span className="h-4 w-full animate-pulse rounded-sm bg-muted" />
          <span className="h-11 w-40 animate-pulse rounded-md bg-muted" />
        </div>
      ) : items.length === 0 ? (
        <div className="mt-4 grid gap-1">
          <p className="font-mono text-h3">{FOR_YOU_NOW_EMPTY}</p>
          <p className="font-mono text-caption text-muted-foreground">
            Your tools are below whenever you want them.
          </p>
          {subline ? <p className="font-mono text-caption text-muted-foreground">{subline}</p> : null}
        </div>
      ) : (
        <ol className="mt-4 grid gap-3">
          {items.map((item, index) => {
            const tone = TONE[forYouNowTone(item)];
            const Icon = tone.icon;
            const top = index === 0;
            return (
              <li
                key={item.id}
                data-item-id={item.id}
                data-item-kind={item.kind}
                className={cn(
                  "flex min-w-0 gap-3 rounded-lg border p-4 sm:items-start",
                  top ? "bg-card shadow-soft" : "bg-background",
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn("hidden size-10 shrink-0 place-items-center rounded-lg sm:grid", tone.soft, tone.ink)}
                >
                  <Icon className={cn("size-5", item.state === "working" && "motion-safe:animate-spin")} />
                </span>
                <div className="grid min-w-0 flex-1 gap-2">
                  <p className="font-mono text-caption text-muted-foreground">{tone.label}</p>
                  <h3 className={cn("break-words font-mono", top ? "text-h2" : "text-h3")}>{item.title}</h3>
                  {top && subline ? (
                    <p className="font-mono text-caption text-foreground" data-testid="since-subline">
                      {subline}
                    </p>
                  ) : null}
                  <WhyThis lines={[item.reason]} />
                  <div className="pt-1">
                    <ItemAction
                      item={item}
                      primary={top}
                      busy={busyItemId === item.id}
                      onIntent={(action) => onIntent(item, action)}
                    />
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
