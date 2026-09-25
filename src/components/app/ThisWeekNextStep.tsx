import { useState } from "react";
import { useQuery } from "convex/react";

import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { NextAction } from "@/components/app/NextAction";
import {
  getNextActionModel,
  isContactable,
  postCountsFrom,
  websiteStateFrom,
} from "@/components/app/next-action-model";

function NextActionSkeleton() {
  return (
    <div role="status" className="grid grid-cols-1 gap-6 rounded-xl border bg-card p-5 shadow-soft md:grid-cols-2 md:p-7">
      <span className="sr-only">Finding your next step…</span>
      <div aria-hidden="true" className="grid content-start gap-3">
        <span className="h-6 w-40 animate-pulse rounded-full bg-muted" />
        <span className="h-8 w-3/4 animate-pulse rounded-md bg-muted" />
        <span className="h-4 w-full animate-pulse rounded-sm bg-muted" />
        <span className="mt-4 h-10 w-40 animate-pulse rounded-md bg-muted" />
      </div>
      <div aria-hidden="true" className="grid gap-2">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className="h-14 animate-pulse rounded-md bg-muted" />
        ))}
      </div>
    </div>
  );
}

/**
 * The "This week" card: builds the outcome snapshot from existing queries
 * only. Module queries are skipped when the plan does not include the
 * module (the server would read nothing), which the model then shows as a
 * locked step instead of guessing.
 */
export function ThisWeekNextStep({
  projectId,
  project,
  modules,
  modulesLoading,
  personaCount,
  journeyCount,
  contentCount,
}: {
  projectId: Id<"projects">;
  project: Doc<"projects"> | null | undefined;
  modules: string[];
  modulesLoading: boolean;
  personaCount: number | undefined;
  journeyCount: number | undefined;
  contentCount: number | undefined;
}) {
  // "This week" is measured from when Home opened (stable across renders).
  const [openedAt] = useState(() => Date.now());
  const hasBuild = !modulesLoading && modules.includes("build");
  const hasPromote = !modulesLoading && modules.includes("promote");
  const hasGrow = !modulesLoading && modules.includes("grow");

  const builds = useQuery(api.builds.list, hasBuild ? { projectId } : "skip");
  const hosting = useQuery(api.siteHosting.status, hasBuild ? { projectId } : "skip");
  const posts = useQuery(api.posts.list, hasPromote ? { projectId } : "skip");
  const google = useQuery(api.google.oauth.status, hasGrow ? { projectId } : "skip");

  const loading =
    modulesLoading ||
    project === undefined ||
    (hasBuild && (builds === undefined || hosting === undefined)) ||
    (hasPromote && posts === undefined) ||
    (hasGrow && google === undefined);
  if (loading) return <NextActionSkeleton />;

  const model = getNextActionModel({
    modules,
    website: hasBuild ? websiteStateFrom(builds, hosting) : undefined,
    posts: hasPromote ? postCountsFrom(posts, openedAt) : undefined,
    contactable: isContactable(project),
    resultsConnected: hasGrow ? google?.connection?.status === "connected" : undefined,
    personaCount,
    journeyCount,
    contentCount,
  });

  return <NextAction projectId={projectId} model={model} />;
}
