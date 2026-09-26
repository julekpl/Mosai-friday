import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { ForYouNow, type IntentAction } from "@/components/app/NextAction";
import { sinceSubline } from "@/components/app/next-action-model";
import { useSinceYouWereAway } from "@/components/app/SinceYouWereAway";
import { KitBootloader } from "@/components/app/kit/KitBootloader";
import type { HomePriorityItem } from "@/shared/homePriorities";

/** Move focus to the kit cards' heading, if they are on the page. */
function focusKitCards(): boolean {
  const target = document.getElementById("starter-kit-title");
  if (!target) return false;
  target.setAttribute("tabindex", "-1");
  target.focus();
  target.scrollIntoView({ block: "start" });
  return true;
}

/**
 * HM-2: Home's one "For you now" list, wired to the server ranking
 * (`home.priorities`). In-page intents:
 *
 *   - `show_kit_progress` opens the kit loader ("Mosaic assembles") as a
 *     view, never on its own;
 *   - `start_kit` and `retry_kit_part` call the same `starterKit.start` the
 *     kit cards' "Try again" uses (it resumes only unfinished parts), then
 *     show the progress;
 *   - `open_kit` takes the owner to the kit cards (or the progress view when
 *     the cards are not shown).
 *
 * Nothing here decides what is live or done: the list re-ranks from the
 * server once the job writes its state.
 */
export function HomeForYouNow({ projectId }: { projectId: Id<"projects"> }) {
  const result = useQuery(api.home.priorities, { projectId });
  // Anything but a list (not expected from the server) reads as "nothing
  // ranked", never as a crash.
  const items = result === undefined ? undefined : Array.isArray(result) ? result : [];
  const since = useSinceYouWereAway(projectId);
  const start = useMutation(api.starterKit.start);
  const [busyItemId, setBusyItemId] = useState<string | null>(null);
  const [progressOpen, setProgressOpen] = useState(false);
  // Read once per visit: the subline's "Since Tuesday" is relative to now.
  const [openedAt] = useState(() => Date.now());

  const runKit = async (item: HomePriorityItem, failure: string) => {
    setBusyItemId(item.id);
    try {
      await start({ projectId });
      setProgressOpen(true);
    } catch (error) {
      toast.error(failure, {
        description: error instanceof Error ? error.message : "Please try again in a moment.",
      });
    } finally {
      setBusyItemId(null);
    }
  };

  const onIntent = (item: HomePriorityItem, action: IntentAction) => {
    switch (action.intent) {
      case "show_kit_progress":
        setProgressOpen(true);
        return;
      case "open_kit":
        if (!focusKitCards()) setProgressOpen(true);
        return;
      case "start_kit":
        void runKit(item, "Could not start your kit");
        return;
      case "retry_kit_part":
        void runKit(item, "Could not try again");
        return;
    }
  };

  return (
    <>
      <ForYouNow
        items={items}
        subline={sinceSubline(since, openedAt)}
        busyItemId={busyItemId}
        onIntent={onIntent}
      />
      <KitBootloader projectId={projectId} open={progressOpen} onClose={() => setProgressOpen(false)} />
    </>
  );
}
