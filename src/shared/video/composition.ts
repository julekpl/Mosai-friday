/**
 * Video composition contract (E3.11, `docs/implementation/CREATE-VIDEO-BLUEPRINT.md` §4).
 *
 * One versioned document is the source of truth for a Create video: the editor
 * edits it, the preview plays it and the browser export renders it, so what the
 * user previews is what they download. The Convex mirror of this type lives in
 * `src/convex/modules/video/validators.ts`; a unit test keeps the two in step.
 *
 * Dependency-free on purpose: imported by the Convex backend, React components
 * and the Remotion composition alike.
 *
 * MVP scope: silent, text-led video (no voice, music or captions yet). Those
 * arrive as additive optional fields in later tickets.
 */

export const COMPOSITION_VERSION = 1 as const;

export const LIMITS = {
  minScenes: 1,
  maxScenes: 20,
  minTotalMs: 5_000,
  maxTotalMs: 120_000,
  minSceneMs: 1_500,
  maxSceneMs: 20_000,
  maxOnScreenWords: 8,
  maxOnScreenChars: 80,
  maxTitleChars: 120,
} as const;

export const LENGTH_PRESETS_MS = [5_000, 15_000, 30_000, 60_000] as const;

export const FPS = 30 as const;

export const ASPECTS = ["9:16", "1:1", "16:9"] as const;
export type Aspect = (typeof ASPECTS)[number];

export const DIMENSIONS: Record<Aspect, { width: number; height: number }> = {
  "9:16": { width: 1080, height: 1920 },
  "1:1": { width: 1080, height: 1080 },
  "16:9": { width: 1920, height: 1080 },
};

export const STYLE_PRESETS = ["clean", "bold", "minimal"] as const;
export type StylePreset = (typeof STYLE_PRESETS)[number];

export const BRAND_LAYOUTS = ["title", "statement", "cta"] as const;
export type BrandLayout = (typeof BRAND_LAYOUTS)[number];

export const MEDIA_KINDS = ["upload", "stock"] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

export const TRANSITIONS = ["cut", "fade", "slide"] as const;
export type Transition = (typeof TRANSITIONS)[number];

export const MOTIONS = ["none", "zoom_in", "zoom_out"] as const;
export type Motion = (typeof MOTIONS)[number];

export type Visual =
  | { kind: "brand_graphic"; layout: BrandLayout }
  | {
      kind: MediaKind;
      /** `videoAssets` id, stored as a string so this module stays Convex-free. */
      assetId: string;
      fit: "cover" | "contain";
      motion: Motion;
    };

export type Scene = {
  /** Stable id, unique within the composition, never reused. */
  id: string;
  /** The scene's message. May be empty for a pure visual. */
  onScreenText: string;
  /** null = the user has not picked a visual yet (partial state). */
  visual: Visual | null;
  durationMs: number;
  transitionIn: Transition;
};

export type Composition = {
  version: typeof COMPOSITION_VERSION;
  aspect: Aspect;
  fps: typeof FPS;
  /** The length the user asked for; scenes are fitted to it. */
  targetMs: number;
  style: { presetId: StylePreset };
  scenes: Scene[];
};

export type IssueCode =
  | "version"
  | "aspect"
  | "fps"
  | "target_range"
  | "scene_count"
  | "scene_id"
  | "scene_duration"
  | "scene_readability"
  | "text_length"
  | "total_range"
  | "visual_missing"
  | "asset_missing"
  | "enum";

export type Issue = { code: IssueCode; sceneId?: string; message: string };

/** Words in a line of on-screen text (whitespace separated). */
export function wordCount(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

/**
 * Minimum time a line needs on screen to be read in a silent video:
 * about 1 s to notice the line plus 0.4 s per word, never below the scene
 * minimum. An 8-word line needs 4.2 s; a 3-word line 2.2 s.
 */
export function readMsFor(text: string): number {
  return Math.max(LIMITS.minSceneMs, 1_000 + wordCount(text) * 400);
}

export function totalDurationMs(c: Pick<Composition, "scenes">): number {
  return c.scenes.reduce((sum, scene) => sum + scene.durationMs, 0);
}

export function durationInFrames(c: Pick<Composition, "scenes">): number {
  return Math.max(1, Math.round((totalDurationMs(c) / 1000) * FPS));
}

const isOneOf = <T extends string>(list: readonly T[], value: unknown): value is T =>
  typeof value === "string" && (list as readonly string[]).includes(value);

/**
 * Structural and limit checks. Returns every problem instead of throwing, so
 * the editor can show them next to the scene they belong to. `knownAssetIds`,
 * when given, also checks that each media visual points at an asset of this
 * video.
 */
export function validateComposition(
  c: Composition,
  knownAssetIds?: ReadonlySet<string>,
): Issue[] {
  const issues: Issue[] = [];
  if (c.version !== COMPOSITION_VERSION) {
    issues.push({ code: "version", message: `Unsupported composition version ${String(c.version)}.` });
  }
  if (!isOneOf(ASPECTS, c.aspect)) issues.push({ code: "aspect", message: "Unknown aspect ratio." });
  if (c.fps !== FPS) issues.push({ code: "fps", message: `Frame rate must be ${FPS}.` });
  if (!isOneOf(STYLE_PRESETS, c.style?.presetId)) issues.push({ code: "enum", message: "Unknown style preset." });
  if (!Number.isInteger(c.targetMs) || c.targetMs < LIMITS.minTotalMs || c.targetMs > LIMITS.maxTotalMs) {
    issues.push({
      code: "target_range",
      message: `Length must be between ${LIMITS.minTotalMs / 1000} and ${LIMITS.maxTotalMs / 1000} seconds.`,
    });
  }
  if (c.scenes.length > LIMITS.maxScenes) {
    issues.push({ code: "scene_count", message: `A video can have at most ${LIMITS.maxScenes} scenes.` });
  }
  const seen = new Set<string>();
  for (const scene of c.scenes) {
    if (!scene.id || seen.has(scene.id)) {
      issues.push({ code: "scene_id", sceneId: scene.id, message: "Scene ids must be unique." });
    }
    seen.add(scene.id);
    if (
      !Number.isInteger(scene.durationMs) ||
      scene.durationMs < LIMITS.minSceneMs ||
      scene.durationMs > LIMITS.maxSceneMs
    ) {
      issues.push({
        code: "scene_duration",
        sceneId: scene.id,
        message: `Each scene lasts ${LIMITS.minSceneMs / 1000}–${LIMITS.maxSceneMs / 1000} seconds.`,
      });
    }
    if (
      wordCount(scene.onScreenText) > LIMITS.maxOnScreenWords ||
      scene.onScreenText.length > LIMITS.maxOnScreenChars
    ) {
      issues.push({
        code: "text_length",
        sceneId: scene.id,
        message: `On-screen text is at most ${LIMITS.maxOnScreenWords} words.`,
      });
    }
    if (!isOneOf(TRANSITIONS, scene.transitionIn)) {
      issues.push({ code: "enum", sceneId: scene.id, message: "Unknown transition." });
    }
    const visual = scene.visual;
    if (visual) {
      if (visual.kind === "brand_graphic") {
        if (!isOneOf(BRAND_LAYOUTS, visual.layout)) {
          issues.push({ code: "enum", sceneId: scene.id, message: "Unknown layout." });
        }
      } else if (isOneOf(MEDIA_KINDS, visual.kind)) {
        if (!isOneOf(MOTIONS, visual.motion) || (visual.fit !== "cover" && visual.fit !== "contain")) {
          issues.push({ code: "enum", sceneId: scene.id, message: "Unknown media setting." });
        }
        if (knownAssetIds && !knownAssetIds.has(visual.assetId)) {
          issues.push({ code: "asset_missing", sceneId: scene.id, message: "The media for this scene is missing." });
        }
      } else {
        issues.push({ code: "enum", sceneId: scene.id, message: "Unknown visual." });
      }
    }
  }
  return issues;
}

/**
 * Everything `validateComposition` checks, plus what an export needs: at least
 * one scene, a visual on every scene, every line on screen long enough to read
 * and a total inside the length limits.
 */
export function renderIssues(c: Composition, knownAssetIds?: ReadonlySet<string>): Issue[] {
  const issues = validateComposition(c, knownAssetIds);
  if (c.scenes.length < LIMITS.minScenes) {
    issues.push({ code: "scene_count", message: "Add at least one scene." });
  }
  for (const scene of c.scenes) {
    if (!scene.visual) {
      issues.push({ code: "visual_missing", sceneId: scene.id, message: "Pick a visual for this scene." });
    }
    if (scene.durationMs < readMsFor(scene.onScreenText)) {
      issues.push({
        code: "scene_readability",
        sceneId: scene.id,
        message: `This text needs at least ${(readMsFor(scene.onScreenText) / 1000).toFixed(1)} s to be read.`,
      });
    }
  }
  const total = totalDurationMs(c);
  if (c.scenes.length && (total < LIMITS.minTotalMs || total > LIMITS.maxTotalMs)) {
    issues.push({
      code: "total_range",
      message: `The video must last ${LIMITS.minTotalMs / 1000}–${LIMITS.maxTotalMs / 1000} seconds (now ${(total / 1000).toFixed(1)} s).`,
    });
  }
  return issues;
}

export function isRenderable(c: Composition, knownAssetIds?: ReadonlySet<string>): boolean {
  return renderIssues(c, knownAssetIds).length === 0;
}

/** Round to whole frames so the preview, export and stored durations agree. */
function toFrameMs(ms: number): number {
  const frame = 1000 / FPS;
  return Math.round(Math.round(ms / frame) * frame);
}

/**
 * Scale scene durations to `targetMs`, keeping their proportions but never
 * going below a scene's readability minimum or above the scene maximum. When
 * the minimums alone exceed the target, every scene gets its minimum and the
 * total is longer than asked (the editor reports that as an issue only if it
 * breaks the hard limits).
 */
export function fitToTarget(c: Composition, targetMs: number = c.targetMs): Composition {
  if (!c.scenes.length) return { ...c, targetMs };
  const mins = c.scenes.map((s) => readMsFor(s.onScreenText));
  const durations = [...mins];
  // Share the time above the minimums in proportion to each scene's current
  // weight above its own minimum (equal weights when none has any). A scene
  // that reaches the maximum stops growing and its share goes to the others.
  const weights = c.scenes.map((s, i) => Math.max(0, s.durationMs - (mins[i] ?? 0)));
  let remaining = targetMs - mins.reduce((a, b) => a + b, 0);
  let open = durations.map((_, i) => i);
  while (remaining > 0.5 && open.length) {
    const weightSum = open.reduce((sum, i) => sum + (weights[i] ?? 0), 0);
    let given = 0;
    for (const i of open) {
      const share = weightSum > 0 ? (remaining * (weights[i] ?? 0)) / weightSum : remaining / open.length;
      const next = Math.min(LIMITS.maxSceneMs, (durations[i] ?? 0) + share);
      given += next - (durations[i] ?? 0);
      durations[i] = next;
    }
    remaining -= given;
    open = open.filter((i) => (durations[i] ?? 0) < LIMITS.maxSceneMs);
    // Scenes with zero weight get nothing while others have weight; once only
    // zero-weight scenes are open, share equally.
    if (open.length && open.every((i) => (weights[i] ?? 0) === 0)) {
      for (const i of open) weights[i] = 1;
    }
  }
  const rounded = durations.map((d) => Math.min(LIMITS.maxSceneMs, toFrameMs(d)));
  // Put the rounding remainder on the last scene that can take it, so the
  // total matches the target exactly whenever the limits allow.
  const drift = Math.min(targetMs, LIMITS.maxSceneMs * rounded.length) - rounded.reduce((a, b) => a + b, 0);
  if (drift !== 0 && targetMs > mins.reduce((a, b) => a + b, 0)) {
    for (let i = rounded.length - 1; i >= 0; i--) {
      const adjusted = (rounded[i] ?? 0) + drift;
      if (adjusted >= (mins[i] ?? 0) && adjusted <= LIMITS.maxSceneMs) {
        rounded[i] = adjusted;
        break;
      }
    }
  }
  return {
    ...c,
    targetMs,
    scenes: c.scenes.map((s, i) => ({ ...s, durationMs: rounded[i] ?? s.durationMs })),
  };
}

export function emptyComposition(aspect: Aspect, targetMs: number): Composition {
  return {
    version: COMPOSITION_VERSION,
    aspect,
    fps: FPS,
    targetMs,
    style: { presetId: "clean" },
    scenes: [],
  };
}

/** JSON with object keys sorted, so equal compositions serialize equally. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * A stable fingerprint of a composition (FNV-1a over canonical JSON, two
 * 32-bit lanes). It identifies *which* composition an export was made from; it
 * is not a security hash and nothing trusts it as proof.
 */
export function compositionFingerprint(c: Composition): string {
  const text = canonicalJson(c);
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 0x01000193);
    h2 = Math.imul(h2 ^ code, 0x5bd1e995);
  }
  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, "0");
  return `${hex(h1)}${hex(h2)}`;
}

/** Asset ids a composition references. */
export function referencedAssetIds(c: Composition): string[] {
  const ids = new Set<string>();
  for (const scene of c.scenes) {
    if (scene.visual && scene.visual.kind !== "brand_graphic") ids.add(scene.visual.assetId);
  }
  return [...ids];
}
