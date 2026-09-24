import { v } from "convex/values";
import { internalMutation, mutation, query } from "../../_generated/server";
import type { MutationCtx } from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";
import { anyApi } from "convex/server";
import { requireUser } from "../../guards";
import { ACCOUNT_DELETION_GRACE_MS } from "../../lib/dataRegistry";
import {
  cleanupNextAccountRow,
  cleanupNextOwnedOrganization,
  EMPTY_DELETION_CURSOR,
  inspectNextDeletionObligation,
  prepareNextOwnedProject,
  type DeletionCursor,
} from "../../lib/dataLifecycle";
import { cascadeDeleteProjectStep, EMPTY_PROJECT_CASCADE_CURSOR, type ProjectCascadeCursor } from "../../dal";

export { ACCOUNT_DELETION_GRACE_DAYS, ACCOUNT_DELETION_GRACE_MS } from "../../lib/dataRegistry";

const deletionKey = (userId: Id<"users">, requestedAt: number) => `account-deletion:${userId}:${requestedAt}`;
const privacyInternal = anyApi.modules.privacy;

function readDeletionCursor(raw?: string): DeletionCursor {
  if (!raw) return EMPTY_DELETION_CURSOR;
  try {
    const value = JSON.parse(raw) as DeletionCursor;
    if (value && typeof value.phase === "string" && value.obligation) return value;
  } catch { /* an invalid cursor restarts the safe preflight, never skips work */ }
  return EMPTY_DELETION_CURSOR;
}

async function scheduleDeletion(ctx: MutationCtx) {
  await ctx.scheduler.runAfter(0, privacyInternal.deletionJobs.finalizeDue, {});
}

export async function startDeletionRequest(ctx: MutationCtx, userId: Id<"users">, now = Date.now()) {
  const user = await ctx.db.get(userId);
  if (!user) throw new Error("Account not found.");
  if (user.deletionRequestedAt) {
    const key = deletionKey(userId, user.deletionRequestedAt);
    const existing = await ctx.db.query("privacyJobs").withIndex("by_idempotency", (q) => q.eq("idempotencyKey", key)).first();
    if (existing && ["queued", "running", "waiting_for_user"].includes(existing.status)) {
      if (existing.status === "waiting_for_user") {
        await ctx.db.patch(existing._id, { status: "queued", blockedReason: undefined, updatedAt: now });
        await ctx.db.patch(userId, { deletionBlockedReason: undefined });
        await scheduleDeletion(ctx);
        return { jobId: existing._id, status: "queued" as const, requestedAt: existing.requestedAt, effectiveAt: existing.effectiveAt ?? now };
      }
      return { jobId: existing._id, status: existing.status, requestedAt: existing.requestedAt, effectiveAt: existing.effectiveAt ?? now };
    }
  }

  const requestedAt = now;
  const effectiveAt = requestedAt + ACCOUNT_DELETION_GRACE_MS;
  const jobId = await ctx.db.insert("privacyJobs", {
    kind: "account_deletion", userId, status: "queued", idempotencyKey: deletionKey(userId, requestedAt),
    requestedAt, effectiveAt, cursor: JSON.stringify(EMPTY_DELETION_CURSOR), completedCount: 0, lastServedAt: now, createdAt: now, updatedAt: now,
  });
  await ctx.db.patch(userId, { deletionRequestedAt: requestedAt, deletionBlockedReason: undefined });
  await scheduleDeletion(ctx);
  return { jobId, status: "queued" as const, requestedAt, effectiveAt };
}

export async function cancelDeletionRequest(ctx: MutationCtx, userId: Id<"users">, now = Date.now()) {
  const user = await ctx.db.get(userId);
  if (!user?.deletionRequestedAt) return { canceled: false as const, reason: "There is no pending account deletion." };
    const active = await ctx.db.query("privacyJobs").withIndex("by_user_kind", (q) => q.eq("userId", userId).eq("kind", "account_deletion")).order("desc").first();
  if (!active) return { canceled: false as const, reason: "There is no pending account deletion." };
  if (active.status !== "queued" || active.completedCount > 0 || now >= (active.effectiveAt ?? active.requestedAt + ACCOUNT_DELETION_GRACE_MS)) {
    return { canceled: false as const, reason: "Finalization has started or the 30-day grace period has ended; deletion can no longer be canceled." };
  }
  await ctx.db.patch(active._id, { status: "canceled", blockedReason: undefined, updatedAt: now });
  await ctx.db.patch(userId, { deletionRequestedAt: undefined, deletionBlockedReason: undefined });
  return { canceled: true as const };
}

export const status = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const user = await ctx.db.get(userId);
    const job = user?.deletionRequestedAt
      ? await ctx.db.query("privacyJobs").withIndex("by_user_kind", (q) => q.eq("userId", userId).eq("kind", "account_deletion")).order("desc").first()
      : null;
    return {
      requested: Boolean(user?.deletionRequestedAt),
      requestedAt: user?.deletionRequestedAt ?? null,
      effectiveAt: job?.effectiveAt ?? null,
      status: job?.status ?? null,
      blockedReason: user?.deletionBlockedReason ?? job?.blockedReason ?? null,
      completedCount: job?.completedCount ?? 0,
    };
  },
});

export const projectStatus = query({
  args: { jobId: v.id("privacyJobs") },
  handler: async (ctx, { jobId }) => {
    const userId = await requireUser(ctx);
    const job = await ctx.db.get(jobId);
    if (!job || job.userId !== userId || job.kind !== "project_deletion") throw new Error("Not found");
    return { status: job.status, reason: job.blockedReason ?? null, completedCount: job.completedCount };
  },
});

export const cancel = mutation({
  args: { jobId: v.id("privacyJobs") },
  handler: async (ctx, { jobId }) => {
    const userId = await requireUser(ctx);
    const job = await ctx.db.get(jobId);
    if (!job || job.userId !== userId || job.kind !== "account_deletion") throw new Error("Not found");
    return await cancelDeletionRequest(ctx, userId);
  },
});

export const retry = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const user = await ctx.db.get(userId);
    if (!user?.deletionRequestedAt) throw new Error("There is no pending account deletion.");
    const job = await ctx.db.query("privacyJobs").withIndex("by_user_kind", (q) => q.eq("userId", userId).eq("kind", "account_deletion")).order("desc").first();
    if (!job || job.status !== "waiting_for_user") throw new Error("There is no blocked deletion to retry.");
    const now = Date.now();
    await ctx.db.patch(job._id, { status: "queued", blockedReason: undefined, updatedAt: now });
    await ctx.db.patch(userId, { deletionBlockedReason: undefined });
    await scheduleDeletion(ctx);
    return { jobId: job._id, status: "queued" as const };
  },
});

async function saveDeletionProgress(ctx: MutationCtx, job: Doc<"privacyJobs">, cursor: DeletionCursor, now: number, completed = false) {
  await ctx.db.patch(job._id, {
    status: "running", cursor: JSON.stringify(cursor),
    completedCount: job.completedCount + (completed ? 1 : 0), updatedAt: now,
  });
  await scheduleDeletion(ctx);
}

async function processDeletion(ctx: MutationCtx, userId: Id<"users">, now: number) {
  const user = await ctx.db.get(userId);
  const job = await ctx.db.query("privacyJobs").withIndex("by_user_kind", (q) => q.eq("userId", userId).eq("kind", "account_deletion")).order("desc").first();
  if (!job || !["queued", "running"].includes(job.status)) return { status: job?.status ?? "no_request" as const };
  if (!user?.deletionRequestedAt && job.status === "queued") return { status: "canceled" as const };
  if (now < (job.effectiveAt ?? job.requestedAt + ACCOUNT_DELETION_GRACE_MS)) return { status: "queued" as const };

  let cursor = readDeletionCursor(job.cursor);
  if (cursor.phase === "obligations" || cursor.phase === "final_obligations") {
    const checked = await inspectNextDeletionObligation(ctx, userId, cursor.obligation, now);
    if (checked.blocked) {
      await ctx.db.patch(job._id, { status: "waiting_for_user", blockedReason: checked.blocked, updatedAt: now });
      await ctx.db.patch(userId, { deletionBlockedReason: checked.blocked });
      return { status: "waiting_for_user" as const, reason: checked.blocked };
    }
    cursor = { ...cursor, obligation: checked.cursor };
    if (checked.done) {
      cursor = cursor.phase === "obligations"
        ? { ...EMPTY_DELETION_CURSOR, phase: "projects" }
        : { ...cursor, phase: "account_cleanup", accountRuleIndex: 0, accountPolicyIndex: 0, parentCursor: null, parentId: null, childRuleIndex: 0 };
    }
    await saveDeletionProgress(ctx, job, cursor, now);
    return { status: "running" as const, phase: cursor.phase };
  }

  if (cursor.phase === "projects" || cursor.phase === "organizations") {
    if (cursor.projectId) {
      const result = await cascadeDeleteProjectStep(ctx, cursor.projectId as Id<"projects">, cursor.projectCascade ?? EMPTY_PROJECT_CASCADE_CURSOR);
      const projectDone = result.done;
      cursor = { ...cursor, projectId: projectDone ? undefined : cursor.projectId, projectCascade: projectDone ? undefined : result.cursor };
      await saveDeletionProgress(ctx, job, cursor, now, projectDone);
      return { status: "running" as const, phase: cursor.phase, completedCount: job.completedCount + (projectDone ? 1 : 0) };
    }

    if (cursor.phase === "projects") {
      const selected = await prepareNextOwnedProject(ctx, userId);
      if (selected.blocked) {
        await ctx.db.patch(job._id, { status: "waiting_for_user", blockedReason: selected.blocked, updatedAt: now });
        await ctx.db.patch(userId, { deletionBlockedReason: selected.blocked });
        return { status: "waiting_for_user" as const, reason: selected.blocked };
      }
      if (selected.projectId) cursor = { ...cursor, projectId: selected.projectId, projectCascade: EMPTY_PROJECT_CASCADE_CURSOR };
      else if (!selected.progressed) cursor = { ...cursor, phase: "organizations", organizationId: undefined, organizationRuleIndex: 0 };
      await saveDeletionProgress(ctx, job, cursor, now);
      return { status: "running" as const, phase: cursor.phase };
    }

    const organization = await cleanupNextOwnedOrganization(ctx, userId, {
      organizationId: cursor.organizationId, ruleIndex: cursor.organizationRuleIndex ?? 0,
    });
    if (organization.blocked) {
      await ctx.db.patch(job._id, { status: "waiting_for_user", blockedReason: organization.blocked, updatedAt: now });
      await ctx.db.patch(userId, { deletionBlockedReason: organization.blocked });
      return { status: "waiting_for_user" as const, reason: organization.blocked };
    }
    cursor = {
      ...cursor,
      organizationId: organization.cursor.organizationId,
      organizationRuleIndex: organization.cursor.ruleIndex,
      projectId: organization.projectId,
      projectCascade: organization.projectId ? EMPTY_PROJECT_CASCADE_CURSOR : undefined,
    };
    if (organization.done) cursor = { ...cursor, phase: "final_obligations", obligation: { ...EMPTY_DELETION_CURSOR.obligation, organizationCursor: null }, organizationId: undefined, organizationRuleIndex: 0 };
    await saveDeletionProgress(ctx, job, cursor, now);
    return { status: "running" as const, phase: cursor.phase };
  }

  const cleanup = await cleanupNextAccountRow(ctx, userId, {
    ruleIndex: cursor.accountRuleIndex ?? 0,
    policyIndex: cursor.accountPolicyIndex ?? 0,
    parentCursor: cursor.parentCursor ?? null,
    parentId: cursor.parentId ?? null,
    childRuleIndex: cursor.childRuleIndex ?? 0,
  });
  if (!cleanup.done) {
    cursor = {
      ...cursor,
      accountRuleIndex: cleanup.cursor.ruleIndex,
      accountPolicyIndex: cleanup.cursor.policyIndex,
      parentCursor: cleanup.cursor.parentCursor,
      parentId: cleanup.cursor.parentId,
      childRuleIndex: cleanup.cursor.childRuleIndex,
    };
    await saveDeletionProgress(ctx, job, cursor, now);
    return { status: "running" as const, phase: cursor.phase };
  }

  await ctx.db.insert("adminAuditLog", {
    actorId: userId, actorEmail: user?.email, action: "account.deletion.finalized",
    targetType: "user", targetId: userId,
    detail: `Finalized explicit request ${job.requestedAt}`, createdAt: now,
  });
  // The receipt, job state and account removal commit atomically. The retained
  // deletion job is the minimal audit/retry record; all cleanup rows are gone.
  await ctx.db.patch(job._id, { status: "succeeded", cursor: undefined, blockedReason: undefined, updatedAt: now });
  await ctx.db.delete(userId);
  return { status: "succeeded" as const };
}

export const finalizeUser = internalMutation({
  args: { userId: v.id("users"), now: v.optional(v.number()) },
  handler: async (ctx, args) => await processDeletion(ctx, args.userId, args.now ?? Date.now()),
});

async function processProjectDeletionStep(ctx: MutationCtx, jobId: Id<"privacyJobs">) {
    const job = await ctx.db.get(jobId);
    if (!job || job.kind !== "project_deletion" || !["queued", "running"].includes(job.status)) return { processed: false, completed: true };
    let state: { projectId: Id<"projects">; cascade: ProjectCascadeCursor | null };
    try { state = JSON.parse(job.cursor ?? "") as typeof state; }
    catch {
      await ctx.db.patch(jobId, { status: "failed", blockedReason: "The project deletion cursor is invalid.", updatedAt: Date.now() });
      await ctx.scheduler.runAfter(0, privacyInternal.deletionJobs.finalizeDue, {});
      return { processed: true, completed: true };
    }
    if (!state.projectId) {
      await ctx.db.patch(jobId, { status: "failed", blockedReason: "The project reference is missing.", updatedAt: Date.now() });
      await ctx.scheduler.runAfter(0, privacyInternal.deletionJobs.finalizeDue, {});
      return { processed: true, completed: true };
    }
    const result = await cascadeDeleteProjectStep(ctx, state.projectId, state.cascade ?? EMPTY_PROJECT_CASCADE_CURSOR);
    const now = Date.now();
    if (result.done) {
      await ctx.db.patch(jobId, { status: "succeeded", cursor: undefined, completedCount: job.completedCount + 1, updatedAt: now });
      await ctx.scheduler.runAfter(0, privacyInternal.deletionJobs.finalizeDue, {});
      return { processed: true, completed: true };
    }
    await ctx.db.patch(jobId, { status: "running", cursor: JSON.stringify({ ...state, cascade: result.cursor }), updatedAt: now });
    await ctx.scheduler.runAfter(0, privacyInternal.deletionJobs.processProjectDeletion, { jobId });
    return { processed: true, completed: false };
}

export const processProjectDeletion = internalMutation({
  args: { jobId: v.id("privacyJobs") },
  handler: async (ctx, { jobId }) => await processProjectDeletionStep(ctx, jobId),
});

/** One bounded work item per transaction; each successful step schedules its continuation. */
export const finalizeDue = internalMutation({
  args: { now: v.optional(v.number()) },
  handler: async (ctx, { now: suppliedNow }) => {
    const now = suppliedNow ?? Date.now();
    const queuedAccounts = await ctx.db.query("privacyJobs").withIndex("by_status_kind_effective", (q) => q.eq("status", "queued").eq("kind", "account_deletion").lte("effectiveAt", now)).first();
    const runningAccounts = await ctx.db.query("privacyJobs").withIndex("by_status_kind_effective", (q) => q.eq("status", "running").eq("kind", "account_deletion").lte("effectiveAt", now)).first();
    const queuedProjects = await ctx.db.query("privacyJobs").withIndex("by_status_kind_effective", (q) => q.eq("status", "queued").eq("kind", "project_deletion")).first();
    const runningProjects = await ctx.db.query("privacyJobs").withIndex("by_status_kind_effective", (q) => q.eq("status", "running").eq("kind", "project_deletion")).first();
    const projectJob = queuedProjects ?? runningProjects;
    const accountJob = queuedAccounts ?? runningAccounts;
    if (projectJob && (!accountJob || projectJob.createdAt < accountJob.createdAt)) {
      const result = await processProjectDeletionStep(ctx, projectJob._id);
      return { processed: result.processed ? 1 : 0, results: [result] };
    }
    if (!accountJob) return { processed: 0, results: [] };
    const user = await ctx.db.get(accountJob.userId);
    const result = user ? await processDeletion(ctx, accountJob.userId, now) : { status: accountJob.status };
    if (result.status === "succeeded" || result.status === "waiting_for_user" || result.status === "no_request") await ctx.scheduler.runAfter(0, privacyInternal.deletionJobs.finalizeDue, {});
    return { processed: 1, results: [result] };
  },
});
