import { v } from "convex/values";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { moduleMutation, moduleQuery } from "../../guards";
import {
  LIMITS,
  compositionFingerprint,
  emptyComposition,
  validateComposition,
  type Composition,
} from "../../../shared/video/composition";
import { aspectValidator, compositionValidator } from "./validators";

/**
 * Create → Video (E3.11): the video record and its composition.
 *
 * Every function is a `create` module function: the capability is enforced
 * before the handler runs and each record is authorized through the caller's
 * organization (`access.ownedRow` / `access.requireProject`). A foreign or
 * missing record reads as "Not found".
 */

function cleanTitle(title: string): string {
  const trimmed = title.trim().replace(/\s+/g, " ");
  if (!trimmed) throw new Error("Give the video a title.");
  return trimmed.slice(0, LIMITS.maxTitleChars);
}

function assertTarget(targetMs: number) {
  if (!Number.isInteger(targetMs) || targetMs < LIMITS.minTotalMs || targetMs > LIMITS.maxTotalMs) {
    throw new Error(
      `Length must be between ${LIMITS.minTotalMs / 1000} and ${LIMITS.maxTotalMs / 1000} seconds.`,
    );
  }
}

async function assetsOf(ctx: QueryCtx | MutationCtx, videoId: Id<"videos">) {
  return await ctx.db
    .query("videoAssets")
    .withIndex("by_video", (q) => q.eq("videoId", videoId))
    .collect();
}

/** Media assets a composition may reference (not exports). */
function mediaAssetIds(assets: Doc<"videoAssets">[]): Set<string> {
  return new Set(assets.filter((a) => a.kind !== "export").map((a) => a._id as string));
}

export const list = moduleQuery("create", {
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }, access) => {
    const scope = await access.ownedProject(projectId);
    if (!scope) return [];
    const rows = await ctx.db
      .query("videos")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
    return rows
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((video) => ({
        _id: video._id,
        title: video.title,
        pieceId: video.pieceId ?? null,
        status: video.status,
        storyboardStatus: video.storyboardStatus ?? null,
        aspect: video.composition.aspect,
        targetMs: video.composition.targetMs,
        sceneCount: video.composition.scenes.length,
        updatedAt: video.updatedAt,
      }));
  },
});

export const get = moduleQuery("create", {
  args: { videoId: v.id("videos") },
  handler: async (ctx, { videoId }, access) => {
    const video = await access.ownedRow(await ctx.db.get(videoId));
    if (!video) return null;
    const assets = await assetsOf(ctx, videoId);
    const withUrls = await Promise.all(
      assets
        .sort((a, b) => b.createdAt - a.createdAt)
        .map(async (asset) => ({
          _id: asset._id,
          kind: asset.kind,
          name: asset.name ?? null,
          mimeType: asset.mimeType,
          sizeBytes: asset.sizeBytes,
          width: asset.width ?? null,
          height: asset.height ?? null,
          durationMs: asset.durationMs ?? null,
          provider: asset.source.provider,
          fingerprint: asset.fingerprint ?? null,
          codec: asset.codec ?? null,
          createdAt: asset.createdAt,
          url: await ctx.storage.getUrl(asset.storageId),
        })),
    );
    return { video, assets: withUrls };
  },
});

export const create = moduleMutation("create", {
  args: {
    projectId: v.id("projects"),
    pieceId: v.optional(v.id("contentPieces")),
    title: v.optional(v.string()),
    aspect: aspectValidator,
    targetMs: v.number(),
  },
  handler: async (ctx, { projectId, pieceId, title, aspect, targetMs }, access) => {
    const { userId } = await access.requireProject(projectId);
    assertTarget(targetMs);
    let pieceTitle: string | undefined;
    if (pieceId) {
      const piece = await ctx.db.get(pieceId);
      // The piece must belong to the same project; anything else reads as
      // not found so a foreign id discloses nothing.
      if (!piece || piece.projectId !== projectId) throw new Error("Not found");
      if (piece.contentType !== "video_script") {
        throw new Error("Only a video script can be turned into a video.");
      }
      pieceTitle = piece.title;
    }
    const composition = emptyComposition(aspect, targetMs);
    const now = Date.now();
    return await ctx.db.insert("videos", {
      projectId,
      ...(pieceId ? { pieceId } : {}),
      title: cleanTitle(title ?? pieceTitle ?? "Untitled video"),
      composition,
      fingerprint: compositionFingerprint(composition),
      revision: 1,
      status: "draft",
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Replace the composition. `baseRevision` must match the stored revision, so
 * two tabs editing the same video cannot silently overwrite each other; the
 * loser gets a conflict and reloads. Partial compositions (a scene without a
 * visual yet) are allowed; exports check `renderIssues` separately.
 */
export const save = moduleMutation("create", {
  args: {
    videoId: v.id("videos"),
    composition: compositionValidator,
    baseRevision: v.number(),
  },
  handler: async (ctx, { videoId, composition, baseRevision }, access) => {
    const video = await access.ownedRow(await ctx.db.get(videoId));
    if (!video) throw new Error("Not found");
    if (video.status === "archived") throw new Error("Restore the video before editing it.");
    if (video.revision !== baseRevision) {
      throw new Error("Conflict: this video was changed elsewhere. Reload to see the latest version.");
    }
    const next = composition as Composition;
    const issues = validateComposition(next, mediaAssetIds(await assetsOf(ctx, videoId)));
    if (issues.length) throw new Error(issues.map((i) => i.message).join(" "));
    const fingerprint = compositionFingerprint(next);
    if (fingerprint === video.fingerprint) return { revision: video.revision };
    const revision = video.revision + 1;
    await ctx.db.patch(videoId, {
      composition: next,
      fingerprint,
      revision,
      // An earlier export no longer matches what the user sees.
      status: "draft",
      updatedAt: Date.now(),
    });
    return { revision };
  },
});

export const rename = moduleMutation("create", {
  args: { videoId: v.id("videos"), title: v.string() },
  handler: async (ctx, { videoId, title }, access) => {
    const video = await access.ownedRow(await ctx.db.get(videoId));
    if (!video) throw new Error("Not found");
    await ctx.db.patch(videoId, { title: cleanTitle(title), updatedAt: Date.now() });
  },
});

export const setArchived = moduleMutation("create", {
  args: { videoId: v.id("videos"), archived: v.boolean() },
  handler: async (ctx, { videoId, archived }, access) => {
    const video = await access.ownedRow(await ctx.db.get(videoId));
    if (!video) throw new Error("Not found");
    await ctx.db.patch(videoId, {
      status: archived ? "archived" : "draft",
      updatedAt: Date.now(),
    });
  },
});

/** Delete a video, its assets and their stored files. */
export const remove = moduleMutation("create", {
  args: { videoId: v.id("videos") },
  handler: async (ctx, { videoId }, access) => {
    const video = await access.ownedRow(await ctx.db.get(videoId));
    if (!video) throw new Error("Not found");
    for (const asset of await assetsOf(ctx, videoId)) {
      await ctx.storage.delete(asset.storageId);
      await ctx.db.delete(asset._id);
    }
    await ctx.db.delete(videoId);
  },
});
