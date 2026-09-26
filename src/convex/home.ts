import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { orgQuery, projectCapability } from "./guards";
import type { CapabilityKey } from "./lib/capabilities";
import { selectConfirmedRelease } from "./lib/deliveryGate";
import { summarizeSinceLastVisit, type SinceDeployment } from "../shared/sinceLastVisit";
import {
  rankHomePriorities,
  type HomePriorityItem,
  type HomePrioritiesKitInput,
  type HomeWebsiteState,
} from "../shared/homePriorities";

/**
 * HM-1 — `home.priorities`: the server-ranked "For you now" list (at most 3
 * items; docs/integration/2026-09-25/MVP-BLUEPRINT-PLAN.md §2 row 6, §5).
 * Reads only shipped tables (starter kit, builds, business profile, posts,
 * `projectVisits`, the confirmed-release gate already used by
 * `visits.sinceLastVisit`) — no new tables, nothing from the deferred agent
 * capability-run machinery.
 */

/** Bounds the posts read: a kit drafts 7; anything beyond a generous margin
 *  of manual drafts still only needs "some are ready", not an exact count. */
const POSTS_SCAN_LIMIT = 100;

async function kitForProject(
  ctx: Pick<QueryCtx, "db">,
  projectId: Id<"projects">,
): Promise<Doc<"starterKits"> | null> {
  return await ctx.db
    .query("starterKits")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .first();
}

async function ownVisit(
  ctx: Pick<QueryCtx, "db">,
  userId: Id<"users">,
  projectId: Id<"projects">,
): Promise<Doc<"projectVisits"> | null> {
  return await ctx.db
    .query("projectVisits")
    .withIndex("by_user_project", (q) => q.eq("userId", userId).eq("projectId", projectId))
    .first();
}

async function included(
  ctx: QueryCtx,
  project: Doc<"projects">,
  userId: Id<"users">,
  capability: CapabilityKey,
): Promise<boolean> {
  const resolution = await projectCapability(ctx, project, userId, capability);
  return resolution?.state === "included";
}

/** The project's confirmed, succeeded website deployment, or none — the
 *  same truth source `siteHosting.status` and `visits.sinceLastVisit` use. */
async function confirmedLiveDeployment(
  ctx: QueryCtx,
  projectId: Id<"projects">,
): Promise<SinceDeployment[]> {
  const publicSite = await ctx.db
    .query("publicSites")
    .withIndex("by_project_kind", (q) => q.eq("projectId", projectId).eq("kind", "website"))
    .first();
  if (!publicSite?.slug) return [];
  const gate = await selectConfirmedRelease(ctx, projectId);
  if (!gate.allowed || !gate.audit.deploymentId) return [];
  const deployment = await ctx.db.get(gate.audit.deploymentId);
  if (!deployment || deployment.projectId !== projectId) return [];
  return deployment.state === "succeeded" ? [deployment] : [];
}

/** "live" only from a confirmed deployment; "draft" from any website build
 *  row; "none" otherwise. Holds with or without a starter kit. */
async function websiteStateFor(
  ctx: QueryCtx,
  projectId: Id<"projects">,
  live: boolean,
): Promise<HomeWebsiteState> {
  if (live) return "live";
  const build = await ctx.db
    .query("builds")
    .withIndex("by_project_kind", (q) => q.eq("projectId", projectId).eq("kind", "website"))
    .first();
  return build ? "draft" : "none";
}

/** Draft posts (bounded scan): how many, and how many still need a picture. */
async function draftPostCounts(
  ctx: QueryCtx,
  projectId: Id<"projects">,
): Promise<{ drafted: number; missingPictures: number }> {
  const drafts = await ctx.db
    .query("posts")
    .withIndex("by_project_status", (q) => q.eq("projectId", projectId).eq("status", "draft"))
    .take(POSTS_SCAN_LIMIT);
  return {
    drafted: drafts.length,
    missingPictures: drafts.filter((post) => !post.mediaUrl).length,
  };
}

/** Published posts (bounded scan), for the "since you were away" summary. */
async function publishedPostsFor(
  ctx: QueryCtx,
  projectId: Id<"projects">,
): Promise<{ status: string; providerRef?: string; publishedAt?: number }[]> {
  return await ctx.db
    .query("posts")
    .withIndex("by_project_status", (q) => q.eq("projectId", projectId).eq("status", "published"))
    .take(POSTS_SCAN_LIMIT);
}

/** A saved business profile with the fields kit drafts and site copy lean
 *  on. `false` (not "complete") when the project has none yet. */
function profileComplete(project: Doc<"projects">): boolean {
  const profile = project.businessProfile;
  return !!profile && profile.summary.trim() !== "" && profile.offerings.length > 0;
}

/** A phone, email or address saved on the project (scan or Google listing).
 *  Mirrors `components/app/next-action-model.ts`'s `isContactable`, kept as
 *  its own tiny copy so the backend never imports from the UI layer
 *  (AGENTS.md §10). */
function contactableFrom(project: Doc<"projects">): boolean {
  const filled = (value: string | undefined) => typeof value === "string" && value.trim() !== "";
  const details = project.websiteScan?.businessDetails;
  const gmb = project.websiteScan?.gmb;
  return (
    (!!details && (filled(details.phone) || filled(details.email) || filled(details.address))) ||
    (!!gmb && (filled(gmb.phone) || filled(gmb.address)))
  );
}

function toKitInput(kit: Doc<"starterKits"> | null): HomePrioritiesKitInput | null {
  if (!kit) return null;
  return {
    status: kit.status,
    parts: {
      plan: { status: kit.parts.plan.status },
      site: { status: kit.parts.site.status },
      posts: { status: kit.parts.posts.status },
    },
  };
}

export const priorities = orgQuery({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }, access): Promise<HomePriorityItem[]> => {
    const scope = await access.ownedProject(projectId);
    if (!scope) return [];
    const { userId, project } = scope;

    const [kitRow, buildIncluded, promoteIncluded, visit] = await Promise.all([
      kitForProject(ctx, projectId),
      included(ctx, project, userId, "build.view"),
      included(ctx, project, userId, "promote.view"),
      ownVisit(ctx, userId, projectId),
    ]);

    const { drafted, missingPictures } = promoteIncluded
      ? await draftPostCounts(ctx, projectId)
      : { drafted: 0, missingPictures: 0 };

    const deployments = buildIncluded ? await confirmedLiveDeployment(ctx, projectId) : [];
    const live = deployments.length > 0;
    const website = buildIncluded ? await websiteStateFor(ctx, projectId, live) : "none";

    let since = null as ReturnType<typeof summarizeSinceLastVisit> | null;
    if (visit) {
      const publishedPosts = promoteIncluded ? await publishedPostsFor(ctx, projectId) : [];
      since = summarizeSinceLastVisit({
        since: visit.lastSeenAt,
        posts: promoteIncluded ? publishedPosts : null,
        contacts: null,
        deployments: buildIncluded ? deployments : null,
      });
    }

    return rankHomePriorities({
      kit: toKitInput(kitRow),
      build: { included: buildIncluded, website },
      promote: { included: promoteIncluded },
      profile: { complete: profileComplete(project) },
      contactable: contactableFrom(project),
      posts: { drafted, missingPictures },
      since,
    });
  },
});
