import { internalMutation, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import { RELEASE_PREPARED } from "./cms";

/* ── Idempotent migration: `published` → `release_prepared` ─────────────
 *
 * Owner decision (24 Sep 2026): the page-level state `published` is renamed
 * to the honest `release_prepared`. Promoting a page revision is a LOCAL
 * preparation; only a verified deployment receipt (`lib/deliveryGate.ts`)
 * proves external delivery, and public serving is still gated on that
 * receipt. The rename is additive: the schema keeps `published` as a legacy
 * literal on `cmsPages.status` and `pageRevisions.state`, every reader
 * accepts both (`isPreparedPageStatus` / `isPreparedRevisionState` in
 * `cms.ts`), and no writer produces `published` any more.
 *
 * This migration rewrites the remaining legacy rows in batches:
 *  - it walks one table at a time (`pageRevisions`, then `cmsPages`) with a
 *    pagination cursor, patching only rows still at `published`; the patch
 *    does not change the paginated order (creation time), so the cursor is
 *    stable while it runs;
 *  - each batch schedules the next one until both tables are done, unless
 *    `autoContinue` is false (tests, or an operator stepping by hand);
 *  - idempotent: a row already at `release_prepared` (or any other state)
 *    is left untouched, so re-running — whole or from any cursor — converts
 *    zero rows and is always safe.
 *
 * Run it once per deployment from the Convex dashboard or CLI:
 *   npx convex run cmsReleaseMigration:migratePublishedToReleasePrepared
 * It is an `internalMutation` — no client can call it.
 *
 * ROLLBACK NOTE. The migration only renames a state literal; revision ids,
 * `publishedRevisionId` pointers, release audits and deployment receipts are
 * untouched, so public serving is identical before and after. Rolling back
 * the migration alone is unnecessary (current readers accept both names).
 * To roll back the whole change to the pre-rename code:
 *   1. while the CURRENT code (whose schema accepts both literals) is still
 *      deployed, rewrite rows back with the mirror of this migration: patch
 *      `pageRevisions.state` and `cmsPages.status` from `release_prepared`
 *      to `published`, in the same batched, idempotent way;
 *   2. then deploy the previous code. Its schema has no `release_prepared`
 *      literal, so deploying it before step 1 is refused by Convex schema
 *      validation — a guard, not data loss.
 */

type MigratedTable = "pageRevisions" | "cmsPages";

const DEFAULT_BATCH_SIZE = 100;
const MAX_BATCH_SIZE = 500;

const self = makeFunctionReference<
  "mutation",
  {
    table?: MigratedTable;
    cursor?: string | null;
    batchSize?: number;
    autoContinue?: boolean;
  }
>("cmsReleaseMigration:migratePublishedToReleasePrepared");

export type MigrationBatchResult = {
  table: MigratedTable;
  scanned: number;
  converted: number;
  isDone: boolean;
  continueCursor: string;
  /** The table and cursor the next batch would start from, or null when
   *  both tables are finished. */
  next: { table: MigratedTable; cursor: string | null } | null;
};

/**
 * One batch over one table. Exported so tests (and a future runner) can
 * drive it directly; it is not a registered function.
 */
export async function migrateReleasePreparedBatch(
  ctx: MutationCtx,
  args: { table: MigratedTable; cursor: string | null; batchSize: number },
): Promise<MigrationBatchResult> {
  const numItems = Math.max(1, Math.min(MAX_BATCH_SIZE, Math.floor(args.batchSize)));
  let scanned = 0;
  let converted = 0;
  let isDone: boolean;
  let continueCursor: string;

  if (args.table === "pageRevisions") {
    const page = await ctx.db
      .query("pageRevisions")
      .paginate({ cursor: args.cursor, numItems });
    for (const row of page.page) {
      scanned += 1;
      if (row.state === "published") {
        await ctx.db.patch(row._id, { state: RELEASE_PREPARED });
        converted += 1;
      }
    }
    isDone = page.isDone;
    continueCursor = page.continueCursor;
  } else {
    const page = await ctx.db
      .query("cmsPages")
      .paginate({ cursor: args.cursor, numItems });
    for (const row of page.page) {
      scanned += 1;
      if (row.status === "published") {
        await ctx.db.patch(row._id, { status: RELEASE_PREPARED });
        converted += 1;
      }
    }
    isDone = page.isDone;
    continueCursor = page.continueCursor;
  }

  const next: MigrationBatchResult["next"] = !isDone
    ? { table: args.table, cursor: continueCursor }
    : args.table === "pageRevisions"
      ? { table: "cmsPages", cursor: null }
      : null;

  return { table: args.table, scanned, converted, isDone, continueCursor, next };
}

export const migratePublishedToReleasePrepared = internalMutation({
  args: {
    table: v.optional(v.union(v.literal("pageRevisions"), v.literal("cmsPages"))),
    cursor: v.optional(v.union(v.string(), v.null())),
    batchSize: v.optional(v.number()),
    autoContinue: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<MigrationBatchResult> => {
    const batchSize = args.batchSize ?? DEFAULT_BATCH_SIZE;
    const result = await migrateReleasePreparedBatch(ctx, {
      table: args.table ?? "pageRevisions",
      cursor: args.cursor ?? null,
      batchSize,
    });
    if (result.next && args.autoContinue !== false) {
      await ctx.scheduler.runAfter(0, self, {
        table: result.next.table,
        cursor: result.next.cursor,
        batchSize,
        autoContinue: true,
      });
    }
    return result;
  },
});
