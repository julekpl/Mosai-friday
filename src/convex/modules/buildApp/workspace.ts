import { v } from "convex/values";
import type { Doc, Id } from "../../_generated/dataModel";
import { internal } from "../../_generated/api";
import { internalMutation, internalQuery, type MutationCtx, type QueryCtx } from "../../_generated/server";
import { moduleMutation, moduleQuery } from "../../guards";
import {
  APP_SOURCE_LIMITS,
  STARTER_FILES,
  detectDependencies,
  mergeFiles,
  normalizeAppPath,
  type AppFile,
} from "../../../shared/appBuilder/source";

/**
 * Build → App (BP-15): the chat-first app workspace.
 *
 * One chat turn is one `appRuns` job (queued → running → succeeded /
 * partially_succeeded / failed / canceled). The generator
 * (`generate.ts`) writes an immutable `appSnapshots` version; manual edits and
 * restores write versions too, so chat and hand edits share one history.
 *
 * Nothing here executes generated code. The browser preview bundles it inside
 * an iframe served from the bundler's own origin (AGENTS.md rule 9); nothing
 * is published and no state here means "live".
 */

/** A run still `running` after this long is treated as abandoned. */
export const APP_RUN_STALE_MS = 10 * 60_000;
const HISTORY_LIMIT = 40;

async function sha256(content: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(content));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function headSnapshot(ctx: QueryCtx | MutationCtx, buildId: Id<"builds">) {
  return await ctx.db
    .query("appSnapshots")
    .withIndex("by_build", (q) => q.eq("buildId", buildId))
    .order("desc")
    .first();
}

async function snapshotFiles(ctx: QueryCtx | MutationCtx, snapshot: Doc<"appSnapshots">): Promise<AppFile[]> {
  const files: AppFile[] = [];
  for (const entry of snapshot.files) {
    const row = await ctx.db
      .query("appSourceFiles")
      .withIndex("by_build", (q) => q.eq("buildId", snapshot.buildId).eq("hash", entry.hash))
      .first();
    // A missing body would be a storage bug; keep the path visible, empty.
    files.push({ path: entry.path, content: row?.content ?? "" });
  }
  return files;
}

/** Stores file bodies once per build and writes the next version. */
async function writeSnapshot(
  ctx: MutationCtx,
  build: Doc<"builds">,
  files: AppFile[],
  meta: {
    label: string;
    source: Doc<"appSnapshots">["source"];
    userId: Id<"users">;
    runId?: Id<"appRuns">;
    packages?: string[];
  },
): Promise<number> {
  const head = await headSnapshot(ctx, build._id);
  const version = (head?.version ?? 0) + 1;
  const manifest: Doc<"appSnapshots">["files"] = [];
  const now = Date.now();
  for (const file of files) {
    const hash = await sha256(file.content);
    const existing = await ctx.db
      .query("appSourceFiles")
      .withIndex("by_build", (q) => q.eq("buildId", build._id).eq("hash", hash))
      .first();
    if (!existing) {
      await ctx.db.insert("appSourceFiles", {
        buildId: build._id,
        projectId: build.projectId,
        hash,
        content: file.content,
        createdAt: now,
      });
    }
    manifest.push({ path: file.path, hash, bytes: new TextEncoder().encode(file.content).length });
  }
  const previousPackages = head?.dependencies.map((dependency) => dependency.name) ?? [];
  await ctx.db.insert("appSnapshots", {
    buildId: build._id,
    projectId: build.projectId,
    version,
    label: meta.label.slice(0, 120),
    source: meta.source,
    runId: meta.runId,
    files: manifest,
    dependencies: detectDependencies(files, [...previousPackages, ...(meta.packages ?? [])]),
    createdBy: meta.userId,
    createdAt: now,
  });
  return version;
}

async function ownedApp(
  ctx: QueryCtx | MutationCtx,
  access: { ownedRow: <T extends { projectId: Id<"projects"> }>(row: T | null) => Promise<T | null> },
  buildId: Id<"builds">,
): Promise<Doc<"builds">> {
  const build = await access.ownedRow(await ctx.db.get(buildId));
  if (!build || build.kind !== "app") throw new Error("App build not found");
  return build;
}

/** Queued or running, and not abandoned. A job that never started or stopped
 *  reporting for `APP_RUN_STALE_MS` no longer blocks the chat. */
function isActive(run: Doc<"appRuns">, now: number): boolean {
  if (run.status !== "queued" && run.status !== "running") return false;
  return now - (run.startedAt ?? run.createdAt) < APP_RUN_STALE_MS;
}

function isAbandoned(run: Doc<"appRuns">, now: number): boolean {
  return (run.status === "queued" || run.status === "running") && !isActive(run, now);
}

/** Everything the workspace renders: the current source, versions and chat. */
export const workspace = moduleQuery("build", {
  args: { buildId: v.id("builds") },
  handler: async (ctx, { buildId }, access) => {
    const build = await access.ownedRow(await ctx.db.get(buildId));
    if (!build || build.kind !== "app") return null;
    const head = await headSnapshot(ctx, buildId);
    const versions = await ctx.db
      .query("appSnapshots")
      .withIndex("by_build", (q) => q.eq("buildId", buildId))
      .order("desc")
      .take(HISTORY_LIMIT);
    const runs = await ctx.db
      .query("appRuns")
      .withIndex("by_build", (q) => q.eq("buildId", buildId))
      .order("desc")
      .take(HISTORY_LIMIT);
    const now = Date.now();
    return {
      head: head
        ? {
            version: head.version,
            label: head.label,
            source: head.source,
            createdAt: head.createdAt,
            dependencies: head.dependencies,
            files: await snapshotFiles(ctx, head),
          }
        : null,
      versions: versions.map((snapshot) => ({
        version: snapshot.version,
        label: snapshot.label,
        source: snapshot.source,
        createdAt: snapshot.createdAt,
        fileCount: snapshot.files.length,
      })),
      runs: runs.reverse().map((run) => ({
        _id: run._id,
        prompt: run.prompt,
        mode: run.mode,
        // An abandoned run reads as failed; nothing claims it finished.
        status: isAbandoned(run, now) ? ("failed" as const) : run.status,
        reply: run.reply ?? null,
        error: isAbandoned(run, now) ? "The generation stopped responding." : run.error ?? null,
        changedPaths: run.changedPaths ?? [],
        skippedPaths: run.skippedPaths ?? [],
        snapshotVersion: run.snapshotVersion ?? null,
        createdAt: run.createdAt,
        finishedAt: run.finishedAt ?? null,
      })),
    };
  },
});

/** One chat turn: queues a generation job over the current source. */
export const sendMessage = moduleMutation("build", {
  args: { buildId: v.id("builds"), prompt: v.string() },
  handler: async (ctx, { buildId, prompt }, access) => {
    const userId = await access.requireUser();
    const build = await ownedApp(ctx, access, buildId);
    const text = prompt.trim();
    if (!text) throw new Error("Describe what to build or change.");
    if (text.length > APP_SOURCE_LIMITS.maxPromptChars) {
      throw new Error(`Keep a message under ${APP_SOURCE_LIMITS.maxPromptChars} characters.`);
    }
    const now = Date.now();
    const recent = await ctx.db
      .query("appRuns")
      .withIndex("by_build", (q) => q.eq("buildId", buildId))
      .order("desc")
      .take(5);
    if (recent.some((run) => isActive(run, now))) {
      throw new Error("The previous request is still running. Wait for it or stop it first.");
    }
    for (const run of recent) {
      if (isAbandoned(run, now)) {
        await ctx.db.patch(run._id, { status: "failed", error: "The generation stopped responding.", finishedAt: now });
      }
    }
    let head = await headSnapshot(ctx, buildId);
    if (!head) {
      await writeSnapshot(ctx, build, STARTER_FILES, { label: "Starter", source: "starter", userId });
      head = await headSnapshot(ctx, buildId);
    }
    const runId = await ctx.db.insert("appRuns", {
      buildId,
      projectId: build.projectId,
      userId,
      prompt: text,
      mode: head && head.source !== "starter" ? "edit" : "create",
      status: "queued",
      baseVersion: head?.version,
      createdAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.modules.buildApp.generate.run, { runId });
    return runId;
  },
});

export const cancelRun = moduleMutation("build", {
  args: { runId: v.id("appRuns") },
  handler: async (ctx, { runId }, access) => {
    const run = await access.ownedRow(await ctx.db.get(runId));
    if (!run) throw new Error("Not found");
    if (run.status !== "queued" && run.status !== "running") return;
    await ctx.db.patch(runId, { status: "canceled", finishedAt: Date.now() });
  },
});

/** A hand edit from the code view. Refuses when the source moved on. */
export const saveFile = moduleMutation("build", {
  args: { buildId: v.id("builds"), baseVersion: v.number(), path: v.string(), content: v.string() },
  handler: async (ctx, { buildId, baseVersion, path, content }, access) => {
    const userId = await access.requireUser();
    const build = await ownedApp(ctx, access, buildId);
    const normalized = normalizeAppPath(path);
    if (!normalized) throw new Error("That file path is not allowed.");
    const head = await headSnapshot(ctx, buildId);
    if (!head || head.version !== baseVersion) {
      throw new Error("The app changed since you opened this file. Reload it before saving.");
    }
    const files = mergeFiles(await snapshotFiles(ctx, head), [{ path: normalized, content }]);
    return await writeSnapshot(ctx, build, files, { label: `Edited ${normalized}`, source: "manual", userId });
  },
});

/** Copies an older version forward as the newest one. History is kept. */
export const restoreVersion = moduleMutation("build", {
  args: { buildId: v.id("builds"), version: v.number() },
  handler: async (ctx, { buildId, version }, access) => {
    const userId = await access.requireUser();
    const build = await ownedApp(ctx, access, buildId);
    const target = await ctx.db
      .query("appSnapshots")
      .withIndex("by_build", (q) => q.eq("buildId", buildId).eq("version", version))
      .unique();
    if (!target) throw new Error("Version not found");
    const files = await snapshotFiles(ctx, target);
    return await writeSnapshot(ctx, build, files, {
      label: `Restored version ${version}`,
      source: "restore",
      userId,
      packages: target.dependencies.map((dependency) => dependency.name),
    });
  },
});

/* ── Generator internals (called only by generate.ts) ─────────────────── */

export const claimRun = internalMutation({
  args: { runId: v.id("appRuns") },
  handler: async (ctx, { runId }) => {
    const run = await ctx.db.get(runId);
    if (!run || run.status !== "queued") return null;
    await ctx.db.patch(runId, { status: "running", startedAt: Date.now() });
    return run;
  },
});

/** Server-loaded inputs for one run. Never trusts anything from the client
 *  beyond the prompt text stored on the run (AGENTS.md rule 3). */
export const generationInput = internalQuery({
  args: { runId: v.id("appRuns") },
  handler: async (ctx, { runId }) => {
    const run = await ctx.db.get(runId);
    if (!run) return null;
    const build = await ctx.db.get(run.buildId);
    if (!build || build.kind !== "app" || build.projectId !== run.projectId) return null;
    const head = await headSnapshot(ctx, run.buildId);
    const earlier = await ctx.db
      .query("appRuns")
      .withIndex("by_build", (q) => q.eq("buildId", run.buildId).lt("createdAt", run.createdAt))
      .order("desc")
      .take(6);
    const contentRefs = (build.appRequirements?.sourceRefs ?? []).filter((ref) => ref.kind === "contentPiece");
    const content: Array<{ title: string; excerpt: string }> = [];
    for (const ref of contentRefs.slice(0, 4)) {
      const piece = await ctx.db.get(ref.id as Id<"contentPieces">);
      if (!piece || piece.projectId !== build.projectId) continue;
      content.push({ title: piece.title, excerpt: (piece.body ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 800) });
    }
    return {
      run,
      build: {
        name: build.name,
        idea: build.idea ?? null,
        requirements: build.appRequirements
          ? {
              audience: build.appRequirements.audience,
              goal: build.appRequirements.goal,
              targetUsers: build.appRequirements.targetUsers,
              coreWorkflows: build.appRequirements.coreWorkflows,
              constraints: build.appRequirements.constraints,
              sources: build.appRequirements.sourceRefs.map((ref) => ({ kind: ref.kind, id: ref.id as string })),
            }
          : null,
      },
      headVersion: head?.version ?? null,
      files: head ? await snapshotFiles(ctx, head) : STARTER_FILES,
      history: earlier
        .reverse()
        .filter((prior) => prior.status === "succeeded" || prior.status === "partially_succeeded")
        .map((prior) => ({ prompt: prior.prompt, reply: prior.reply ?? "", changedPaths: prior.changedPaths ?? [] })),
      content,
    };
  },
});

export const completeRun = internalMutation({
  args: {
    runId: v.id("appRuns"),
    files: v.array(v.object({ path: v.string(), content: v.string() })),
    packages: v.array(v.string()),
    reply: v.string(),
    skippedPaths: v.array(v.string()),
  },
  handler: async (ctx, { runId, files, packages, reply, skippedPaths }) => {
    const run = await ctx.db.get(runId);
    // A canceled run's output is discarded, never written.
    if (!run || run.status !== "running") return null;
    const build = await ctx.db.get(run.buildId);
    if (!build) return null;
    const now = Date.now();
    const safe = files.flatMap((file) => {
      const path = normalizeAppPath(file.path);
      return path ? [{ path, content: file.content }] : [];
    });
    if (safe.length === 0) {
      await ctx.db.patch(runId, {
        status: "failed",
        reply: reply.slice(0, 2_000),
        skippedPaths,
        error: "The AI reply contained no usable files. Nothing was changed.",
        finishedAt: now,
      });
      return null;
    }
    const head = await headSnapshot(ctx, run.buildId);
    let merged: AppFile[];
    try {
      merged = mergeFiles(head ? await snapshotFiles(ctx, head) : STARTER_FILES, safe);
    } catch (error) {
      await ctx.db.patch(runId, {
        status: "failed",
        error: error instanceof Error ? error.message : "The generated source could not be saved.",
        finishedAt: now,
      });
      return null;
    }
    const version = await writeSnapshot(ctx, build, merged, {
      label: run.prompt,
      source: "ai",
      userId: run.userId,
      runId,
      packages,
    });
    await ctx.db.patch(runId, {
      status: skippedPaths.length > 0 ? "partially_succeeded" : "succeeded",
      snapshotVersion: version,
      reply: reply.slice(0, 2_000),
      changedPaths: safe.map((file) => file.path),
      skippedPaths,
      finishedAt: now,
    });
    return version;
  },
});

export const failRun = internalMutation({
  args: { runId: v.id("appRuns"), error: v.string() },
  handler: async (ctx, { runId, error }) => {
    const run = await ctx.db.get(runId);
    if (!run || (run.status !== "running" && run.status !== "queued")) return;
    await ctx.db.patch(runId, { status: "failed", error: error.slice(0, 500), finishedAt: Date.now() });
  },
});
