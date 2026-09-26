import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { SinceLastVisitSummary } from "@/shared/sinceLastVisit";

/** How long Home stays open before this visit counts as "seen". */
const MARK_SEEN_DELAY_MS = 5_000;

/**
 * U7 "Since you were away", as data (HM-2). Home no longer shows it as its
 * own card: the summary becomes one subline under the top "For you now"
 * item on a return visit. `null` on a first visit, while loading, or when
 * nothing changed.
 *
 * The visit is marked seen once, a few seconds after Home renders, so the
 * next visit starts fresh; the first summary this visit saw is kept so the
 * subline does not vanish when the live query turns null after marking.
 */
export function useSinceYouWereAway(projectId: Id<"projects">): SinceLastVisitSummary | null {
  const summary = useQuery(api.visits.sinceLastVisit, { projectId });
  const markSeen = useMutation(api.visits.markSeen);
  const marked = useRef<Id<"projects"> | null>(null);
  const [shown, setShown] = useState<{
    projectId: Id<"projects">;
    summary: SinceLastVisitSummary;
  } | null>(null);
  if (summary && shown?.projectId !== projectId) {
    setShown({ projectId, summary });
  }

  useEffect(() => {
    if (marked.current === projectId) return;
    const timer = window.setTimeout(() => {
      marked.current = projectId;
      void markSeen({ projectId }).catch(() => undefined);
    }, MARK_SEEN_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [projectId, markSeen]);

  return shown?.projectId === projectId ? shown.summary : null;
}
