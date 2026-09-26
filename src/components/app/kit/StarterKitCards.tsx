import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import type { StarterKitPartName } from "@/shared/starterKit";
import { isStaleKit } from "@/shared/starterKitJob";
import { KIT_PART_ORDER, kitAnnouncement } from "@/components/app/kit/kit-model";
import { PlanCard } from "@/components/app/kit/PlanCard";
import { WebsiteCard } from "@/components/app/kit/WebsiteCard";
import { PostsCard } from "@/components/app/kit/PostsCard";

/**
 * "Your starter kit" on Home (docs/ux/first-run-blueprint.md §2–§3, §7):
 * the plan, website and posts cards fill in as the server job finishes each
 * part. Renders nothing when there is no kit, the owner hid it, or it is
 * still drafting (Home's "For you now" item covers that).
 */
export function StarterKitCards({
  projectId,
  modules,
  modulesLoading,
  onFixFacts,
}: {
  projectId: Id<"projects">;
  modules: string[];
  modulesLoading: boolean;
  onFixFacts: () => void;
}) {
  const kit = useQuery(api.starterKit.get, { projectId });
  const visible = !!kit && kit.dismissedAt === undefined;
  const content = useQuery(api.starterKit.content, visible ? { projectId } : "skip");
  const start = useMutation(api.starterKit.start);
  const dismiss = useMutation(api.starterKit.dismiss);
  const [retrying, setRetrying] = useState(false);
  const [hiding, setHiding] = useState(false);
  // Read once per visit: a kit untouched for a while is stale, not drafting.
  const [openedAt] = useState(() => Date.now());

  // Announce each part once per page load, when it finishes. Derived while
  // rendering (React's "adjust state when a prop changes" pattern), so no
  // effect is needed.
  const [announced, setAnnounced] = useState<{ parts: ReadonlySet<StarterKitPartName>; text: string }>(
    () => ({ parts: new Set(), text: "" }),
  );
  const parts = kit?.parts;
  if (parts) {
    const fresh = KIT_PART_ORDER.flatMap((name) => {
      if (announced.parts.has(name)) return [];
      const line = kitAnnouncement(name, parts[name]);
      return line ? [{ name, line }] : [];
    });
    if (fresh.length) {
      setAnnounced({
        parts: new Set([...announced.parts, ...fresh.map((item) => item.name)]),
        text: fresh.map((item) => item.line).join(" "),
      });
    }
  }

  if (!kit || !visible) return null;
  // HM-2: while the kit is drafting, Home's "For you now" list shows it as
  // one progress item (its detail view is the kit loader); the cards
  // appear once there is something to look at, retry or resume.
  // A stale kit (its run died) keeps its cards, so "Try again" stays reachable.
  if ((kit.status === "queued" || kit.status === "running") && !isStaleKit(kit, openedAt)) return null;

  const retry = async () => {
    setRetrying(true);
    try {
      // Resumes only the parts that did not finish; drafts already made stay.
      await start({ projectId });
    } catch (error) {
      toast.error("Could not try again", {
        description: error instanceof Error ? error.message : "Please try again in a moment.",
      });
    } finally {
      setRetrying(false);
    }
  };

  const hide = async () => {
    setHiding(true);
    try {
      await dismiss({ projectId });
    } catch (error) {
      toast.error("Could not hide the kit", {
        description: error instanceof Error ? error.message : "Please try again in a moment.",
      });
      setHiding(false);
    }
  };

  const onRetry = () => void retry();
  const hasBuild = !modulesLoading && modules.includes("build");

  return (
    <section aria-labelledby="starter-kit-title" className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="starter-kit-title" className="text-h2">
            Your starter kit
          </h2>
          <p className="font-mono text-caption text-muted-foreground">Your first plan, website &amp; posts</p>
        </div>
        <Button variant="ghost" className="min-h-11 text-muted-foreground" onClick={() => void hide()} disabled={hiding}>
          Hide the kit
        </Button>
      </div>

      <p className="sr-only" role="status" aria-live="polite" data-testid="kit-announcer">
        {announced.text}
      </p>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <PlanCard
          part={kit.parts.plan}
          plan={content === undefined ? undefined : (content?.plan ?? null)}
          onFixFacts={onFixFacts}
          onRetry={onRetry}
          retrying={retrying}
        />
        <WebsiteCard
          projectId={projectId}
          part={kit.parts.site}
          buildId={content?.website?.buildId}
          hasBuild={hasBuild}
          onRetry={onRetry}
          retrying={retrying}
        />
        <PostsCard
          projectId={projectId}
          part={kit.parts.posts}
          posts={content?.posts ?? []}
          onRetry={onRetry}
          retrying={retrying}
        />
      </div>
    </section>
  );
}
