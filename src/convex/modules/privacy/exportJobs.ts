import { v } from "convex/values";
import { anyApi } from "convex/server";
import { internalMutation, mutation, query } from "../../_generated/server";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";
import { requireUser } from "../../guards";
import { projectForExportJob, ownedProjectExportPage } from "../../dal";
import { DATA_REGISTRY } from "../../lib/dataRegistry";

const privacyInternal = anyApi.modules.privacy;
export const EXPORT_CHUNK_MAX_BYTES = 900_000;
const EXPORT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const ACTIVE_MEMBERSHIP_CHECK_LIMIT = 100;
const EXCLUDED_TABLES = Object.keys(DATA_REGISTRY).filter((table) => DATA_REGISTRY[table].export === "excluded");
const TABLES = Object.entries(DATA_REGISTRY).filter(([, entry]) => entry.scope === "project" && entry.export === "included").map(([table]) => table);
type IndexQuery = { eq(field: string, value: unknown): IndexQuery };
type Page = { page: Array<Record<string, unknown> & { _id: string }>; continueCursor: string; isDone: boolean };
type LooseDb = { query(table: string): { withIndex(index: string, cb: (q: IndexQuery) => IndexQuery): { first(): Promise<(Record<string, unknown> & { _id: string }) | null>; paginate(args: { numItems: number; cursor: string | null }): Promise<Page>; take(count: number): Promise<Array<Record<string, unknown> & { _id: string }>> } }; };
type Cursor = { mode: "account" | "project"; projectId?: string; projectCursor: string | null; projectDone?: boolean; projectPageDone?: boolean; tableIndex: number; rowCursor: string | null; parentId: string | null; parentCursor: string | null; parentDone: boolean; sequence: number };
const emptyCursor = (mode: Cursor["mode"], projectId?: string): Cursor => ({ mode, projectId, projectCursor: null, tableIndex: 0, rowCursor: null, parentId: null, parentCursor: null, parentDone: false, sequence: 0 });
function readCursor(raw?: string): Cursor | null {
  try { const c = JSON.parse(raw ?? "") as Cursor; return c && (c.mode === "account" || c.mode === "project") && Number.isInteger(c.tableIndex) ? c : null; }
  catch { return null; }
}
async function writeChunk(ctx: MutationCtx, jobId: Id<"privacyJobs">, sequence: number, payload: unknown, now: number, projectId?: Id<"projects">) {
  const json = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(json).byteLength;
  if (bytes > EXPORT_CHUNK_MAX_BYTES) return false;
  await ctx.db.insert("privacyExportChunks", { jobId, exportProjectId: projectId, sequence, json, bytes, createdAt: now, expiresAt: now + EXPORT_TTL_MS });
  return true;
}
async function initialScheduleMarker(ctx: MutationCtx, now: number) {
  const jobs = await Promise.all([
    ctx.db.query("privacyJobs").withIndex("by_status_kind_served", (q) => q.eq("status", "queued").eq("kind", "account_export")).order("desc").first(),
    ctx.db.query("privacyJobs").withIndex("by_status_kind_served", (q) => q.eq("status", "queued").eq("kind", "project_export")).order("desc").first(),
    ctx.db.query("privacyJobs").withIndex("by_status_kind_served", (q) => q.eq("status", "running").eq("kind", "account_export")).order("desc").first(),
    ctx.db.query("privacyJobs").withIndex("by_status_kind_served", (q) => q.eq("status", "running").eq("kind", "project_export")).order("desc").first(),
  ]);
  return Math.max(now, ...jobs.map((job) => Math.max(job?.lastServedAt ?? 0, job?.createdAt ?? 0)));
}
export async function startAccountExport(ctx: MutationCtx, userId: Id<"users">, now = Date.now()) {
  const active = await ctx.db.query("privacyJobs").withIndex("by_user_kind", (q) => q.eq("userId", userId).eq("kind", "account_export")).first();
  if (active && ["queued", "running"].includes(active.status)) return { jobId: active._id, status: active.status };
  const lastServedAt = await initialScheduleMarker(ctx, now);
  const jobId = await ctx.db.insert("privacyJobs", { kind: "account_export", userId, status: "queued", idempotencyKey: `account-export:${userId}:${now}`, requestedAt: now, cursor: JSON.stringify(emptyCursor("account")), completedCount: 0, lastServedAt, createdAt: now, updatedAt: now });
  const user = await ctx.db.get(userId);
  const profile = user ? { _id: user._id, name: user.name, email: user.email, emailVerificationTime: user.emailVerificationTime, plan: user.plan, planStatus: user.planStatus } : null;
  if (!await writeChunk(ctx, jobId, 0, { profile, excludedTables: EXCLUDED_TABLES, storageBytesIncluded: false }, now)) await ctx.db.patch(jobId, { status: "failed", blockedReason: "The profile record exceeds the export chunk limit.", updatedAt: now });
  await ctx.scheduler.runAfter(0, privacyInternal.exportJobs.processBatch, {});
  return { jobId, status: "queued" as const };
}
async function startProjectExport(ctx: MutationCtx, userId: Id<"users">, projectId: Id<"projects">, now = Date.now()) {
  const lastServedAt = await initialScheduleMarker(ctx, now);
  const jobId = await ctx.db.insert("privacyJobs", { kind: "project_export", userId, exportProjectId: projectId, status: "queued", idempotencyKey: `project-export:${userId}:${projectId}:${now}`, requestedAt: now, cursor: JSON.stringify(emptyCursor("project", String(projectId))), completedCount: 0, lastServedAt, createdAt: now, updatedAt: now });
  await ctx.scheduler.runAfter(0, privacyInternal.exportJobs.processBatch, {});
  return { jobId, status: "queued" as const };
}
export const create = mutation({ args: {}, handler: async (ctx) => await startAccountExport(ctx, await requireUser(ctx)) });
async function projectExportAccess(ctx: QueryCtx | MutationCtx, projectId: Id<"projects">, userId: Id<"users">) {
  const project = await projectForExportJob(ctx, projectId);
  if (!project) return null;
  if (!project.organizationId) return project.ownerId === userId ? project : null;
  const membership = await ctx.db.query("memberships").withIndex("by_organization_user", (q) => q.eq("organizationId", project.organizationId!).eq("userId", userId)).first();
  return membership?.status === "active" ? project : null;
}
async function hasOtherActiveOrganizationMember(ctx: QueryCtx | MutationCtx, organizationId: Id<"organizations">, userId: Id<"users">) {
  const members = await ctx.db.query("memberships").withIndex("by_organization_status_user", (q) => q.eq("organizationId", organizationId).eq("status", "active")).take(ACTIVE_MEMBERSHIP_CHECK_LIMIT + 1);
  return members.length > ACTIVE_MEMBERSHIP_CHECK_LIMIT || members.some((member) => member.userId !== userId);
}
async function accountProjectExportAccess(ctx: QueryCtx | MutationCtx, projectId: Id<"projects">, userId: Id<"users">) {
  const project = await projectForExportJob(ctx, projectId);
  if (!project || project.ownerId !== userId) return null;
  if (!project.organizationId) return project;
  if (!await projectExportAccess(ctx, projectId, userId)) return null;
  if (await hasOtherActiveOrganizationMember(ctx, project.organizationId, userId)) return null;
  return project;
}
export const createProject = mutation({ args: { projectId: v.id("projects") }, handler: async (ctx, { projectId }) => { const userId = await requireUser(ctx); if (!await projectExportAccess(ctx, projectId, userId)) throw new Error("Not found"); return await startProjectExport(ctx, userId, projectId); } });
export const status = query({ args: { jobId: v.id("privacyJobs") }, handler: async (ctx, { jobId }) => { const userId = await requireUser(ctx); const job = await ctx.db.get(jobId); if (!job || job.userId !== userId || !["account_export", "project_export"].includes(job.kind)) throw new Error("Not found"); return { status: job.status, chunks: job.completedCount + (job.kind === "account_export" ? 1 : 0), reason: job.blockedReason ?? null, updatedAt: job.updatedAt }; } });
export const chunk = query({ args: { jobId: v.id("privacyJobs"), sequence: v.number() }, handler: async (ctx, { jobId, sequence }) => {
  const userId = await requireUser(ctx);
  const job = await ctx.db.get(jobId);
  if (!job || job.userId !== userId || !["account_export", "project_export"].includes(job.kind)) throw new Error("Not found");
  const chunk = await ctx.db.query("privacyExportChunks").withIndex("by_job_sequence", (q) => q.eq("jobId", jobId).eq("sequence", sequence)).first();
  if (!chunk) return null;
  const projectId = chunk.exportProjectId ?? (job.kind === "project_export" ? job.exportProjectId : undefined);
  if (job.kind === "project_export" && !projectId) return null;
  if (projectId) {
    if (job.kind === "account_export") {
      if (!await accountProjectExportAccess(ctx, projectId, userId)) return null;
    } else {
      const project = await projectExportAccess(ctx, projectId, userId);
      if (!project || project.organizationId && await hasOtherActiveOrganizationMember(ctx, project.organizationId, userId)) return null;
    }
  } else if (job.kind === "account_export" && sequence > 0) {
    const payload = JSON.parse(chunk.json) as { omittedSharedProject?: boolean; accountExportComplete?: boolean };
    if (!payload.omittedSharedProject && !payload.accountExportComplete) return null;
  }
  return chunk;
} });

async function nextRow(ctx: MutationCtx, projectId: Id<"projects">, c: Cursor) {
  const db = ctx.db as unknown as LooseDb;
  if (c.tableIndex >= TABLES.length) return { done: true as const, cursor: c };
  const table = TABLES[c.tableIndex]!;
  const entry = DATA_REGISTRY[table]!;
  if (table === "projects") {
    const row = await projectForExportJob(ctx, projectId);
    return row ? { done: false as const, row, cursor: { ...c, tableIndex: c.tableIndex + 1, rowCursor: null } } : { done: false as const, cursor: { ...c, tableIndex: c.tableIndex + 1 } };
  }
  if (entry.deletion.kind === "account-parent") {
    const rule = entry.deletion;
    if (c.parentId) {
      const page = await db.query(table).withIndex(rule.childIndex, (q) => q.eq(rule.childField, c.parentId)).paginate({ numItems: 1, cursor: c.rowCursor });
      if (page.page[0]) return { done: false as const, row: page.page[0], cursor: { ...c, rowCursor: page.continueCursor } };
      if (!page.isDone) return { done: false as const, cursor: { ...c, rowCursor: page.continueCursor } };
      return { done: false as const, cursor: { ...c, parentId: null, rowCursor: null, parentDone: false } };
    }
    if (c.parentDone) return { done: false as const, cursor: { ...c, tableIndex: c.tableIndex + 1, rowCursor: null, parentId: null, parentCursor: null, parentDone: false } };
    const parents = await db.query(rule.parentTable).withIndex(rule.parentIndex, (q) => q.eq("projectId", projectId)).paginate({ numItems: 1, cursor: c.parentCursor });
    if (parents.page[0]) return { done: false as const, cursor: { ...c, parentId: parents.page[0]._id, parentCursor: parents.continueCursor, parentDone: parents.isDone, rowCursor: null } };
    if (!parents.isDone) return { done: false as const, cursor: { ...c, parentCursor: parents.continueCursor } };
    return { done: false as const, cursor: { ...c, parentDone: true } };
  }
  const rule = entry.deletion;
  if (rule.kind !== "account-index" && rule.kind !== "project-cascade") return { done: false as const, cursor: { ...c, tableIndex: c.tableIndex + 1 } };
  const page = await db.query(table).withIndex(rule.index, (q) => q.eq(rule.field, projectId)).paginate({ numItems: 1, cursor: c.rowCursor });
  if (page.page[0]) return { done: false as const, row: page.page[0], cursor: { ...c, rowCursor: page.continueCursor } };
  if (!page.isDone) return { done: false as const, cursor: { ...c, rowCursor: page.continueCursor } };
  return { done: false as const, cursor: { ...c, tableIndex: c.tableIndex + 1, rowCursor: null } };
}

async function processOne(ctx: MutationCtx, job: Doc<"privacyJobs">, now: number) {
  const c = readCursor(job.cursor);
  if (!c) { await ctx.db.patch(job._id, { status: "failed", blockedReason: "Export cursor is invalid; request a new export.", updatedAt: now }); return { processed: true, completed: true }; }
  let next = c;
  let payload: unknown;
  let chunkProjectId: Id<"projects"> | undefined = c.projectId as Id<"projects"> | undefined;
  if (c.mode === "project") {
    const projectId = c.projectId as Id<"projects">;
    const project = await projectExportAccess(ctx, projectId, job.userId);
    if (!project) { await ctx.db.patch(job._id, { status: "failed", blockedReason: "Project access changed before export.", updatedAt: now }); return { processed: true, completed: true }; }
    if (project.organizationId && await hasOtherActiveOrganizationMember(ctx, project.organizationId, job.userId)) {
      await ctx.db.patch(job._id, {
        status: "failed",
        blockedReason: "Project export is unavailable while another active organization member shares this project. Use an account export for personal data; shared project data is omitted.",
        updatedAt: now,
      });
      return { processed: true, completed: true };
    } else {
      const step = await nextRow(ctx, projectId, c);
      if (step.done) { await ctx.db.patch(job._id, { status: "succeeded", cursor: undefined, updatedAt: now }); return { processed: true, completed: true }; }
      next = step.cursor;
      if (step.row) payload = { table: TABLES[c.tableIndex], row: step.row, excludedTables: EXCLUDED_TABLES };
    }
  } else {
    if (c.projectId) {
      const project = await accountProjectExportAccess(ctx, c.projectId as Id<"projects">, job.userId);
      if (!project) { next = { ...c, projectId: undefined, tableIndex: 0, rowCursor: null, parentId: null, parentCursor: null, parentDone: false }; chunkProjectId = undefined; payload = { omittedSharedProject: true, excludedTables: EXCLUDED_TABLES }; }
      else {
        const step = await nextRow(ctx, project._id, c);
        if (step.done) { next = { ...c, projectId: undefined, tableIndex: 0, rowCursor: null, parentId: null, parentCursor: null, parentDone: false }; payload = { projectDataComplete: true }; }
        else { next = step.cursor; if (step.row) payload = { table: TABLES[c.tableIndex], row: step.row, excludedTables: EXCLUDED_TABLES }; }
      }
    } else {
      if (c.projectPageDone) {
        payload = { accountExportComplete: true, excludedTables: EXCLUDED_TABLES };
        next = { ...c, projectDone: true };
      } else {
        const projects = await ownedProjectExportPage(ctx, job.userId, c.projectCursor);
        const row = projects.page[0];
        if (!row) { payload = { accountExportComplete: true, excludedTables: EXCLUDED_TABLES }; next = { ...c, projectDone: true }; }
        else {
          const shared = !await accountProjectExportAccess(ctx, row._id, job.userId);
          if (shared) {
            payload = { omittedSharedProject: true, excludedTables: EXCLUDED_TABLES };
            next = { ...c, projectCursor: projects.continueCursor, projectPageDone: projects.isDone };
          } else {
            chunkProjectId = row._id;
            payload = { project: row, excludedTables: EXCLUDED_TABLES };
            next = { ...c, projectId: String(row._id), projectCursor: projects.continueCursor, projectPageDone: projects.isDone, tableIndex: 0, rowCursor: null, parentId: null, parentCursor: null, parentDone: false };
          }
        }
      }
    }
  }
  const sequence = c.sequence + 1;
  if (!await writeChunk(ctx, job._id, sequence, payload, now, chunkProjectId)) { await ctx.db.patch(job._id, { status: "failed", blockedReason: `A single export row exceeds the ${EXPORT_CHUNK_MAX_BYTES}-byte chunk limit; contact support for assisted export.`, updatedAt: now }); return { processed: true, completed: true }; }
  next.sequence = sequence;
  const complete = c.mode === "project" && next.tableIndex >= TABLES.length || c.mode === "account" && next.projectDone === true;
  await ctx.db.patch(job._id, { status: complete ? "succeeded" : "running", cursor: complete ? undefined : JSON.stringify(next), completedCount: job.completedCount + 1, updatedAt: now });
  return { processed: true, completed: complete, sequence };
}

export const processBatch = internalMutation({ args: { now: v.optional(v.number()) }, handler: async (ctx, { now: given }) => {
  const now = given ?? Date.now();
  const candidates = await Promise.all([
    ctx.db.query("privacyJobs").withIndex("by_status_kind_served", (q) => q.eq("status", "queued").eq("kind", "account_export")).first(),
    ctx.db.query("privacyJobs").withIndex("by_status_kind_served", (q) => q.eq("status", "queued").eq("kind", "project_export")).first(),
    ctx.db.query("privacyJobs").withIndex("by_status_kind_served", (q) => q.eq("status", "running").eq("kind", "account_export")).first(),
    ctx.db.query("privacyJobs").withIndex("by_status_kind_served", (q) => q.eq("status", "running").eq("kind", "project_export")).first(),
  ]);
  const job = candidates.filter((candidate) => candidate !== null).sort((a, b) => (a.lastServedAt ?? 0) - (b.lastServedAt ?? 0) || a.createdAt - b.createdAt)[0];
  if (!job) return { processed: false };
  const logicalNow = Math.max(now, ...candidates.map((candidate) => Math.max(candidate?.lastServedAt ?? 0, candidate?.createdAt ?? 0))) + 1;
  await ctx.db.patch(job._id, { lastServedAt: logicalNow });
  const result = await processOne(ctx, job, now);
  await ctx.scheduler.runAfter(0, privacyInternal.exportJobs.processBatch, {});
  return result;
} });

export const expireCompletedExports = internalMutation({ args: { now: v.optional(v.number()) }, handler: async (ctx, { now: given }) => {
  const now = given ?? Date.now();
  const chunk = await ctx.db.query("privacyExportChunks").withIndex("by_expires", (q) => q.lte("expiresAt", now)).first();
  if (!chunk) return { deletedChunks: 0 };
  const job = await ctx.db.get(chunk.jobId);
  if (!job || !["succeeded", "partially_succeeded", "canceled", "failed"].includes(job.status)) return { deletedChunks: 0 };
  await ctx.db.delete(chunk._id);
  const remaining = await ctx.db.query("privacyExportChunks").withIndex("by_job_sequence", (q) => q.eq("jobId", job._id)).first();
  if (!remaining) await ctx.db.delete(job._id);
  await ctx.scheduler.runAfter(0, privacyInternal.exportJobs.expireCompletedExports, { now });
  return { deletedChunks: 1 };
} });
