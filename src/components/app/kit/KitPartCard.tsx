import type { ReactNode } from "react";
import { Link } from "react-router";
import { Loader2, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/app/module-kit";
import type { StarterKitPart, StarterKitPartName } from "@/shared/starterKit";
import { PART_TITLE, kitCardCopy } from "@/components/app/kit/kit-model";

/** Plan options live at the workspace-level billing route. */
const PLAN_ROUTE = "/app/billing";

/**
 * One starter-kit card in any of its five states (blueprint §3). The card
 * owns the working, failed and locked states; the part's own card supplies
 * what a finished draft shows (`result`), its one primary button
 * (`actions`) and, for a partial draft, the one button that fixes the gap
 * (`fixAction`).
 */
export function KitPartCard({
  name,
  part,
  badge,
  onRetry,
  retrying,
  result,
  actions,
  fixAction,
}: {
  name: StarterKitPartName;
  part: StarterKitPart;
  /** Replaces the state label, only for a server-confirmed state. */
  badge?: string;
  onRetry: () => void;
  retrying: boolean;
  result?: ReactNode;
  actions?: ReactNode;
  fixAction?: ReactNode;
}) {
  const copy = kitCardCopy(name, part);
  const titleId = `kit-${name}-title`;

  return (
    <article
      aria-labelledby={titleId}
      data-kit-part={name}
      data-kit-state={copy.state}
      className="grid min-w-0 content-start gap-4 rounded-xl border bg-card p-5 shadow-soft"
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={titleId} className="text-body font-semibold">
          {PART_TITLE[name]}
        </h3>
        <StatusBadge status={badge ?? copy.badge} />
      </header>

      <div className="grid gap-1">
        <p className="flex items-center gap-2 text-body font-medium">
          {copy.state === "working" ? (
            // Decoration only: the words carry the state, and the pulse
            // runs only when the owner has not asked for reduced motion.
            <span aria-hidden="true" data-kit-pulse className="size-2 shrink-0 rounded-full bg-primary motion-safe:animate-pulse" />
          ) : null}
          {copy.headline}
        </p>
        {copy.detail ? <p className="text-small text-muted-foreground">{copy.detail}</p> : null}
      </div>

      {copy.state === "succeeded" || copy.state === "partially_succeeded" ? result : null}

      {copy.state === "succeeded" && actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      {copy.state === "partially_succeeded" && fixAction ? (
        <div className="flex flex-wrap gap-2">{fixAction}</div>
      ) : null}

      {copy.state === "failed" ? (
        <div className="flex flex-wrap gap-2">
          <Button className="min-h-11" onClick={onRetry} disabled={retrying}>
            {retrying ? (
              <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden="true" />
            ) : (
              <RotateCcw className="size-4" aria-hidden="true" />
            )}
            Try again
          </Button>
        </div>
      ) : null}

      {copy.state === "locked" ? (
        <div className="flex flex-wrap gap-2">
          <Button asChild className="min-h-11">
            <Link to={PLAN_ROUTE}>See plans</Link>
          </Button>
        </div>
      ) : null}
    </article>
  );
}
