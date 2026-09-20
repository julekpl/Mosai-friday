/**
 * Data-access layer (G2-lite, blueprint review §4 / ADR-2).
 *
 * Every public function that touches project-scoped or user-scoped data calls
 * `projectCtx` / `userCtx` FIRST. Those helpers authenticate, resolve and
 * authorize, and return the already-verified ids — so the tenant boundary
 * lives in one reviewed place instead of being re-implemented inline in every
 * module file. (The installed `convex` package does not yet export
 * `customQuery`/`customMutation`; when it does, these helpers graduate into
 * `projectQuery`/`projectMutation` builders and forgotten calls become
 * compile errors — see ADR-2.)
 *
 * Tenancy today is owner-based (projects.ownerId === user). When
 * organizations / agency workspaces land, these helpers gain org scoping —
 * call sites should not change.
 *
 * `cascadeDeleteProject` is the ONE project deletion path. `projects.remove`
 * and `billing.deleteAccount` both call it; never maintain a second table
 * list (review finding: the two old lists had drifted apart and both missed
 * the CMS, commerce-variant and Build tables).
 */

import { getAuthUserId } from "@convex-dev/auth/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

// ── Authorized context helpers ─────────────────────────────────────────────

/** Signed-in user. Throws "Not signed in" (fail closed). */
export async function userCtx(ctx: QueryCtx | MutationCtx) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Not signed in");
  return { userId };
}

/** Authenticated user + project they own. Throws "Not signed in" or
 *  "Not found" (never leaks whether a foreign project id exists). */
export async function projectCtx(
  ctx: QueryCtx | MutationCtx,
  projectId: Id<"projects">,
) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Not signed in");
  const project = await ctx.db.get(projectId);
  if (!project || project.ownerId !== userId) throw new Error("Not found");
  return { userId, project };
}

// ── Project deletion cascade (single source of truth) ─────────────────────

/** Project-scoped tables with a `by_project` index, children first. */
const PROJECT_TABLES = [
  "contentGaps",
  "contentTopics",
  "communications",
  "insights",
  "contacts",
  "connections",
  "campaigns",
  "posts",
  "socialCredentials",
  "collections",
  "commerceEvents",
  "adsAccounts",
  "adsCampaigns",
  "adsMetrics",
  "adsCopilotMessages",
  "adsChangeRequests",
  "adsExecutions",
  "adsCredentials",
  "projectFiles",
  "buildPages",
  "buildVersions",
  "builds",
  "productVariants",
  "products",
  "personas",
  "contentPieces",
  "pageRevisions",
  "cmsPages",
  "cmsNavigations",
  "cmsRedirects",
  "cmsAssets",
  "sites",
  "journeyMaps",
] as const;

/**
 * Deletes every row that hangs off a project, then the project itself.
 *
 * Tables without a `by_project` index are cleaned via their parent:
 * contentDocs → piece, buildMessages → build, productMedia → product,
 * personaMessages → compound (projectId, personaId) index. `oauthStates`
 * rows are short-lived CSRF state with no project index — they expire on
 * their own; not deleted here (known, accepted gap).
 *
 * The queries inside are deliberately loosely typed (local `any` handle):
 * this list must be able to name any table in schema.ts, including ones
 * added after the last codegen run, and union-of-tables generics fight the
 * generated data model. Correctness is enforced by Convex at runtime — the
 * index names ("by_project", "by_build", …) and field names are validated
 * against the live schema, so a typo fails loudly in tests.
 */
export async function cascadeDeleteProject(
  ctx: MutationCtx,
  projectId: Id<"projects">,
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = ctx.db as any;
  const del = (id: Id<"projects">) => ctx.db.delete(id);
  const byProject = (table: string) =>
    db
      .query(table)
      .withIndex("by_project", (q: any) => q.eq("projectId", projectId))
      .collect();

  // 1. Child tables keyed to a parent row (no by_project index).
  for (const piece of await byProject("contentPieces")) {
    for (const doc of await db
      .query("contentDocs")
      .withIndex("by_piece", (q: any) => q.eq("pieceId", piece._id))
      .collect()) {
      await del(doc._id);
    }
  }
  for (const build of await byProject("builds")) {
    for (const msg of await db
      .query("buildMessages")
      .withIndex("by_build", (q: any) => q.eq("buildId", build._id))
      .collect()) {
      await del(msg._id);
    }
  }
  for (const product of await byProject("products")) {
    for (const media of await db
      .query("productMedia")
      .withIndex("by_product", (q: any) => q.eq("productId", product._id))
      .collect()) {
      await del(media._id);
    }
  }
  for (const row of await db
    .query("personaMessages")
    .withIndex("by_project_persona", (q: any) => q.eq("projectId", projectId))
    .collect()) {
      await del(row._id);
  }

  // 2. Storage blobs behind projectFiles rows (metadata deleted in step 3).
  const files = await byProject("projectFiles");

  // 3. Everything with a by_project index.
  for (const table of PROJECT_TABLES) {
    for (const row of await byProject(table)) {
      await del(row._id);
    }
  }

  // 4. The uploaded bytes themselves.
  for (const file of files) {
    await ctx.storage.delete(file.storageId);
  }

  // 5. The project row.
  await del(projectId);
}
