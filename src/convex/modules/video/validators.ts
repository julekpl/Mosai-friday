import { v } from "convex/values";

/**
 * Convex mirror of `src/shared/video/composition.ts` (E3.11). The shared file
 * is the contract; `tests/unit/video-composition.test.ts` asserts that this
 * validator accepts exactly the shapes the shared type describes.
 */

export const aspectValidator = v.union(v.literal("9:16"), v.literal("1:1"), v.literal("16:9"));

export const visualValidator = v.union(
  v.object({
    kind: v.literal("brand_graphic"),
    layout: v.union(v.literal("title"), v.literal("statement"), v.literal("cta")),
  }),
  v.object({
    kind: v.union(v.literal("upload"), v.literal("stock")),
    assetId: v.string(),
    fit: v.union(v.literal("cover"), v.literal("contain")),
    motion: v.union(v.literal("none"), v.literal("zoom_in"), v.literal("zoom_out")),
  }),
);

export const sceneValidator = v.object({
  id: v.string(),
  onScreenText: v.string(),
  visual: v.union(visualValidator, v.null()),
  durationMs: v.number(),
  transitionIn: v.union(v.literal("cut"), v.literal("fade"), v.literal("slide")),
});

export const compositionValidator = v.object({
  version: v.literal(1),
  aspect: aspectValidator,
  fps: v.literal(30),
  targetMs: v.number(),
  style: v.object({
    presetId: v.union(v.literal("clean"), v.literal("bold"), v.literal("minimal")),
  }),
  scenes: v.array(sceneValidator),
});

/** AGENTS.md rule 13 job states, used by the storyboard step. */
export const videoJobStatusValidator = v.union(
  v.literal("queued"),
  v.literal("running"),
  v.literal("waiting_for_user"),
  v.literal("succeeded"),
  v.literal("partially_succeeded"),
  v.literal("failed"),
  v.literal("canceled"),
);

export const videoStatusValidator = v.union(
  v.literal("draft"),
  v.literal("ready"),
  v.literal("archived"),
);

export const videoAssetKindValidator = v.union(
  v.literal("upload"),
  v.literal("stock"),
  v.literal("export"),
);

export const videoAssetSourceValidator = v.object({
  /** user | pexels | browser_export */
  provider: v.string(),
  externalId: v.optional(v.string()),
  license: v.optional(v.string()),
  /** Stored for the stock provider's terms; not displayed (owner decision D6). */
  attribution: v.optional(v.string()),
  aiGenerated: v.boolean(),
});
