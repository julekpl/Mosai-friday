import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { sinceLines, type SinceLastVisitSummary } from "@/shared/sinceLastVisit";
import { Button } from "@/components/ui/button";

/** How long Home stays open before this visit counts as "seen". */
const MARK_SEEN_DELAY_MS = 5_000;

/**
 * U7 — "Since you were away". Renders nothing on a first visit or when
 * nothing changed; otherwise one short line per change and a "Got it".
 */
export function SinceYouWereAway({ projectId }: { projectId: Id<"projects"> }) {
  const summary = useQuery(api.visits.sinceLastVisit, { projectId });
  const markSeen = useMutation(api.visits.markSeen);
  const marked = useRef<Id<"projects"> | null>(null);
  // Keep the first summary this visit saw: the delayed markSeen below makes
  // the live query return null, and the owner should still read what changed.
  const [shown, setShown] = useState<{
    projectId: Id<"projects">;
    summary: SinceLastVisitSummary;
  } | null>(null);
  const [dismissed, setDismissed] = useState<Id<"projects"> | null>(null);
  if (summary && shown?.projectId !== projectId) {
    setShown({ projectId, summary });
  }

  // Mark this visit seen once, a few seconds after Home renders, so the
  // next visit starts fresh. The summary on screen stays until reload.
  useEffect(() => {
    if (marked.current === projectId) return;
    const timer = window.setTimeout(() => {
      marked.current = projectId;
      void markSeen({ projectId }).catch(() => undefined);
    }, MARK_SEEN_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [projectId, markSeen]);

  const current = shown?.projectId === projectId ? shown.summary : null;
  const lines = current && dismissed !== projectId ? sinceLines(current) : [];

  return (
    <div role="status" aria-live="polite">
      {lines.length > 0 ? (
        <section
          aria-labelledby="since-away-title"
          className="flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-soft sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="min-w-0">
            <h2 id="since-away-title" className="text-sm font-semibold text-foreground">
              Since you were away
            </h2>
            <ul className="mt-1 grid gap-0.5 text-sm text-muted-foreground">
              {lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="self-start sm:self-center"
            onClick={() => {
              marked.current = projectId;
              setDismissed(projectId);
              void markSeen({ projectId }).catch(() => undefined);
            }}
          >
            Got it
          </Button>
        </section>
      ) : null}
    </div>
  );
}
