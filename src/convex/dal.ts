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
 * `cascadeDeleteProjectStep` is the ONE bounded project deletion engine.
 * User-facing project deletion and account deletion both resume it from a
 * durable privacy job; never maintain a second table list.
 */

import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireUser } from "./guards";
import { DATA_REGISTRY } from "./lib/dataRegistry";

// ── Authorized context helpers ─────────────────────────────────────────────

/** Signed-in, non-anonymous user. Throws "Not signed in" (fail closed).
 *
 *  Delegates to `guards.requireUser` so the anonymous-account rejection
 *  (T0.2) lives in ONE place: these helpers used to call `getAuthUserId`
 *  directly, which kept a leftover `isAnonymous === true` session able to
 *  reach every dal-guarded path (review finding on T0.2). */
export async function userCtx(ctx: QueryCtx | MutationCtx) {
  const userId = await requireUser(ctx);
  return { userId };
}

/** Authenticated user + project they own. Throws "Not signed in" (including
 *  for anonymous guests — see `userCtx`) or "Not found" (never leaks whether
 *  a foreign project id exists). */
export async function projectCtx(
  ctx: QueryCtx | MutationCtx,
  projectId: Id<"projects">,
) {
  const userId = await requireUser(ctx);
  const project = await ctx.db.get(projectId);
  if (!project || project.ownerId !== userId) throw new Error("Not found");
  return { userId, project };
}

/** Bounded project pagination for the account privacy export worker. */
export async function ownedProjectExportPage(
  ctx: MutationCtx,
  ownerId: Id<"users">,
  cursor: string | null,
) {
  return await ctx.db
    .query("projects")
    .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
    .paginate({ numItems: 1, cursor });
}

/** Ownerless internal export access is allowed only for a durable authorized job. */
export async function projectForExportJob(ctx: QueryCtx | MutationCtx, projectId: Id<"projects">) {
  return await ctx.db.get(projectId);
}

/** Internal workers re-authorize a project against the durable job owner. */
export async function ownedProjectForJob(
  ctx: QueryCtx | MutationCtx,
  projectId: Id<"projects">,
  ownerId: Id<"users">,
) {
  const project = await ctx.db.get(projectId);
  return project?.ownerId === ownerId ? project : null;
}

// ── Project deletion cascade (single source of truth) ─────────────────────

/**
 * Deletes every row that hangs off a project, then the project itself.
 *
 * All table and index selection comes from `DATA_REGISTRY`. Child rows are
 * cleared through their declared parent before parent rows. `oauthStates`
 * stays ephemeral because it has no project index and expires on its own.
 *
 * The queries inside are deliberately loosely typed (local `any` handle):
 * this list must be able to name any table in schema.ts, including ones
 * added after the last codegen run, and union-of-tables generics fight the
 * generated data model. Correctness is enforced by the registry audit and by
 * Convex at runtime.
 */

/** Loose shape for the untyped `db.query(table).withIndex(...)` callback.
 *  The cascade runs over tables named at runtime, so the query builder is
 *  untyped (the `db` handle above); this keeps the callback parameter typed
 *  without an `any` escape hatch. */
type IndexQuery = { eq(field: string, value: unknown): IndexQuery };

export type ProjectCascadeCursor = {
  stage: "children" | "direct" | "project";
  ruleIndex: number;
  parentCursor: string | null;
  parentId: string | null;
};

export const EMPTY_PROJECT_CASCADE_CURSOR: ProjectCascadeCursor = {
  stage: "children", ruleIndex: 0, parentCursor: null, parentId: null,
};

/** Advances a project cascade with at most one row deletion per transaction. */
export async function cascadeDeleteProjectStep(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  cursor: ProjectCascadeCursor = EMPTY_PROJECT_CASCADE_CURSOR,
): Promise<{ cursor: ProjectCascadeCursor; done: boolean; blockedReason?: string }> {
  // The execution claim and this guard share Convex's transaction boundary:
  // if an ad operation is active, retain every project row until its execution
  // result is durably recorded. The by_project_status index keeps this probe
  // bounded to one row.
  const activeAdChange = await ctx.db
    .query("adsChangeRequests")
    .withIndex("by_project_status", (q) =>
      q.eq("projectId", projectId).eq("status", "executing"),
    )
    .first();
  if (activeAdChange) {
    return {
      cursor,
      done: false,
      blockedReason:
        "Project deletion is waiting for an ads change to finish and record its execution receipt.",
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = ctx.db as any;
  const projectEntries = Object.entries(DATA_REGISTRY).filter(([, entry]) => entry.scope === "project");
  const childEntries = projectEntries.filter(([, entry]) => entry.deletion.kind === "account-parent");
  const directEntries = projectEntries.filter(([, entry]) => entry.deletion.kind === "project-cascade" || entry.deletion.kind === "account-index");

  if (cursor.stage === "children") {
    const [table, entry] = childEntries[cursor.ruleIndex] ?? [];
    if (!table || !entry || entry.deletion.kind !== "account-parent") {
      return { cursor: { stage: "direct", ruleIndex: 0, parentCursor: null, parentId: null }, done: false };
    }
    const rule = entry.deletion;
    if (cursor.parentId) {
      const child = await db.query(table)
        .withIndex(rule.childIndex, (q: IndexQuery) => q.eq(rule.childField, cursor.parentId))
        .first();
      if (child) {
        await ctx.db.delete(child._id);
        return { cursor, done: false };
      }
      return { cursor: { ...cursor, parentId: null }, done: false };
    }
    const parentPage = await db.query(rule.parentTable)
      .withIndex(rule.parentIndex, (q: IndexQuery) => q.eq("projectId", projectId))
      .paginate({ numItems: 1, cursor: cursor.parentCursor });
    if (parentPage.page[0]) {
      return {
        cursor: { ...cursor, parentId: parentPage.page[0]._id, parentCursor: parentPage.continueCursor },
        done: false,
      };
    }
    if (!parentPage.isDone) {
      return { cursor: { ...cursor, parentCursor: parentPage.continueCursor }, done: false };
    }
    return { cursor: { ...cursor, ruleIndex: cursor.ruleIndex + 1, parentCursor: null }, done: false };
  }

  if (cursor.stage === "direct") {
    const [table, entry] = directEntries[cursor.ruleIndex] ?? [];
    if (!table || !entry || (entry.deletion.kind !== "project-cascade" && entry.deletion.kind !== "account-index")) {
      return { cursor: { stage: "project", ruleIndex: 0, parentCursor: null, parentId: null }, done: false };
    }
    const rule = entry.deletion;
    if (rule.kind !== "project-cascade" && rule.kind !== "account-index") {
      return { cursor: { ...cursor, ruleIndex: cursor.ruleIndex + 1 }, done: false };
    }
    const row = await db.query(table)
      .withIndex(rule.index, (q: IndexQuery) => q.eq(rule.field, projectId))
      .first();
    if (row) {
      if (table === "projectFiles" || table === "videoAssets") await ctx.storage.delete(row.storageId);
      await ctx.db.delete(row._id);
      return { cursor, done: false };
    }
    return { cursor: { ...cursor, ruleIndex: cursor.ruleIndex + 1 }, done: false };
  }

  await ctx.db.delete(projectId);
  return { cursor, done: true };
}
