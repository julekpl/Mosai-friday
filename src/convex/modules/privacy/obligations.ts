import { v } from "convex/values";
import { query } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";
import { projectCtx } from "../../dal";
import { requirePlatformAdmin, requireUser } from "../../guards";
import { DATA_REGISTRY, ACCOUNT_DELETION_GRACE_MS } from "../../lib/dataRegistry";
import { inspectDeletionObligations } from "../../lib/dataLifecycle";

type LooseIndexQuery = { eq(field: string, value: unknown): LooseIndexQuery };
type LooseDb = { query(table: string): { withIndex(name: string, callback: (q: LooseIndexQuery) => LooseIndexQuery): { take(count: number): Promise<unknown[]> } } };

export const registry = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    return { entries: DATA_REGISTRY, tableCount: Object.keys(DATA_REGISTRY).length };
  },
});

export const project = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    await projectCtx(ctx, projectId);
    const db = ctx.db as unknown as LooseDb;
    const counts: Record<string, { count: number; capped: boolean }> = {};
    for (const [table, entry] of Object.entries(DATA_REGISTRY)) {
      if (entry.scope !== "project") continue;
      const rule = entry.deletion;
      if (rule.kind === "project-cascade" || rule.kind === "account-index") {
        const rows = await db.query(table).withIndex(rule.index, (q) => q.eq(rule.field, projectId)).take(101);
        counts[table] = { count: Math.min(rows.length, 100), capped: rows.length > 100 };
      } else if (rule.kind === "account-parent") {
        const parents = await db.query(rule.parentTable).withIndex(rule.parentIndex, (q) => q.eq("projectId", projectId)).take(101) as Array<{ _id: string }>;
        let count = 0;
        let capped = parents.length > 100;
        for (const parent of parents.slice(0, 100)) {
          const children = await db.query(table).withIndex(rule.childIndex, (q) => q.eq(rule.childField, parent._id)).take(101);
          count += Math.min(children.length, 100);
          capped ||= children.length > 100;
        }
        counts[table] = { count, capped };
      }
    }
    return { projectId, counts, exportableTables: Object.entries(DATA_REGISTRY).filter(([, entry]) => entry.scope === "project" && entry.export === "included").map(([table]) => table) };
  },
});

export const account = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const user = await ctx.db.get(userId);
    const obligations = await inspectDeletionObligations(ctx, userId as Id<"users">, Date.now());
    return {
      deletionRequestedAt: user?.deletionRequestedAt ?? null,
      effectiveAt: user?.deletionRequestedAt ? user.deletionRequestedAt + ACCOUNT_DELETION_GRACE_MS : null,
      blockedReason: user?.deletionBlockedReason ?? obligations.reason ?? null,
      canFinalize: Boolean(user?.deletionRequestedAt) && !obligations.blocked,
    };
  },
});

export const pendingDeletions = query({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, { cursor }) => {
    await requirePlatformAdmin(ctx);
    const page = await ctx.db.query("users").withIndex("by_deletion_requested", (q) => q.gt("deletionRequestedAt", 0)).paginate({ numItems: 25, cursor: cursor ?? null });
    const now = Date.now();
    const pending = [];
    for (const user of page.page) {
      if (typeof user.deletionRequestedAt !== "number") continue;
      const obligations = await inspectDeletionObligations(ctx, user._id, now);
      const due = now >= user.deletionRequestedAt + ACCOUNT_DELETION_GRACE_MS;
      pending.push({
        userId: user._id,
        requestedAt: user.deletionRequestedAt,
        ageMs: now - user.deletionRequestedAt,
        effectiveAt: user.deletionRequestedAt + ACCOUNT_DELETION_GRACE_MS,
        state: obligations.blocked ? "blocked" as const : due ? "ready" as const : "waiting" as const,
        reason: user.deletionBlockedReason ?? obligations.reason ?? null,
      });
    }
    return { pending, continueCursor: page.continueCursor, isDone: page.isDone };
  },
});
