import { describe, expect, it } from "vitest";
import {
  LENGTH_PRESETS_MS,
  LIMITS,
  compositionFingerprint,
  emptyComposition,
  fitToTarget,
  readMsFor,
  renderIssues,
  totalDurationMs,
  validateComposition,
  type Composition,
  type Scene,
} from "@/shared/video/composition";

/** E3.11 V1 — the shared video composition contract. */

function scene(id: string, text: string, durationMs = 2_500, withVisual = true): Scene {
  return {
    id,
    onScreenText: text,
    visual: withVisual ? { kind: "brand_graphic", layout: "statement" } : null,
    durationMs,
    transitionIn: "cut",
  };
}

function composition(scenes: Scene[], targetMs = 5_000): Composition {
  return { ...emptyComposition("9:16", targetMs), scenes };
}

describe("readability minimum", () => {
  it("gives a line 1 s plus 0.4 s per word, never under the scene minimum", () => {
    expect(readMsFor("")).toBe(LIMITS.minSceneMs);
    expect(readMsFor("Fresh bread")).toBe(1_800);
    expect(readMsFor("one two three four five six seven eight")).toBe(4_200);
  });
});

describe("5-second videos", () => {
  it("accept a single-scene 5 s composition as renderable", () => {
    const c = composition([scene("a", "Fresh bread daily", 5_000)]);
    expect(renderIssues(c)).toEqual([]);
    expect(totalDurationMs(c)).toBe(5_000);
  });

  it("reject a composition shorter than 5 s", () => {
    const c = composition([scene("a", "Hi", 4_900)]);
    expect(renderIssues(c).map((i) => i.code)).toContain("total_range");
  });

  it("reject a target below 5 s", () => {
    expect(validateComposition(composition([], 4_000)).map((i) => i.code)).toContain("target_range");
  });
});

describe("fitToTarget", () => {
  const scenes = [
    scene("a", "Fresh bread daily", 3_000),
    scene("b", "Baked before sunrise every morning", 3_000),
    scene("c", "Order before 9am", 3_000),
  ];

  for (const target of LENGTH_PRESETS_MS) {
    it(`fits three scenes to ${target / 1000} s without breaking readability`, () => {
      const fitted = fitToTarget(composition(scenes, target), target);
      for (const s of fitted.scenes) {
        expect(s.durationMs).toBeGreaterThanOrEqual(readMsFor(s.onScreenText));
        expect(s.durationMs).toBeLessThanOrEqual(LIMITS.maxSceneMs);
      }
      const minimums = scenes.reduce((sum, s) => sum + readMsFor(s.onScreenText), 0);
      if (minimums <= target) expect(totalDurationMs(fitted)).toBe(target);
      else expect(totalDurationMs(fitted)).toBe(minimums);
    });
  }

  it("gives a capped scene's extra time to the other scenes", () => {
    // Two scenes carry all the weight and would each pass the 20 s cap; the
    // third must absorb the overflow so 60 s is reached.
    const weighted = [scene("a", "Fresh", 10_000), scene("b", "Bread", 1_500), scene("c", "Daily", 10_000)];
    const fitted = fitToTarget(composition(weighted, 60_000), 60_000);
    expect(totalDurationMs(fitted)).toBe(60_000);
    for (const s of fitted.scenes) expect(s.durationMs).toBeLessThanOrEqual(LIMITS.maxSceneMs);
  });

  it("stops at the scene maximums when the target is out of reach", () => {
    const two = [scene("a", "Fresh"), scene("b", "Bread")];
    const fitted = fitToTarget(composition(two, 60_000), 60_000);
    expect(fitted.scenes.map((s) => s.durationMs)).toEqual([LIMITS.maxSceneMs, LIMITS.maxSceneMs]);
  });

  it("keeps each scene at its readability minimum when the target is too short", () => {
    // Three scenes need 7.4 s to be readable; a 5 s target cannot hold them.
    const fitted = fitToTarget(composition(scenes, 5_000), 5_000);
    expect(fitted.scenes.map((s) => s.durationMs)).toEqual(
      scenes.map((s) => readMsFor(s.onScreenText)),
    );
    expect(renderIssues(fitted).map((i) => i.code)).not.toContain("scene_readability");
  });
});

describe("validation", () => {
  it("rejects on-screen text over 8 words", () => {
    const c = composition([scene("a", "one two three four five six seven eight nine", 6_000)]);
    expect(validateComposition(c).map((i) => i.code)).toContain("text_length");
  });

  it("rejects duplicate scene ids", () => {
    const c = composition([scene("a", "One"), scene("a", "Two")]);
    expect(validateComposition(c).map((i) => i.code)).toContain("scene_id");
  });

  it("allows a scene without a visual while editing but not for export", () => {
    const c = composition([scene("a", "Fresh bread", 5_000, false)]);
    expect(validateComposition(c)).toEqual([]);
    expect(renderIssues(c).map((i) => i.code)).toContain("visual_missing");
  });

  it("flags a media visual that points at an unknown asset", () => {
    const c = composition([
      { ...scene("a", "Fresh bread", 5_000), visual: { kind: "upload", assetId: "x", fit: "cover", motion: "none" } },
    ]);
    expect(validateComposition(c, new Set(["y"])).map((i) => i.code)).toContain("asset_missing");
    expect(validateComposition(c, new Set(["x"]))).toEqual([]);
  });

  it("flags a line shown too briefly to read", () => {
    const c = composition([scene("a", "one two three four five six seven eight", 5_000)], 5_000);
    // 8 words need 4.2 s; 5 s is fine.
    expect(renderIssues(c)).toEqual([]);
    const tooFast = composition([
      scene("a", "one two three four five six seven eight", 2_000),
      scene("b", "Order now", 3_000),
    ]);
    expect(renderIssues(tooFast).map((i) => i.code)).toContain("scene_readability");
  });
});

describe("fingerprint", () => {
  it("does not depend on object key order", () => {
    const a = composition([scene("a", "Fresh bread", 5_000)]);
    const reordered = JSON.parse(
      JSON.stringify({ scenes: a.scenes, targetMs: a.targetMs, style: a.style, fps: a.fps, aspect: a.aspect, version: a.version }),
    ) as Composition;
    expect(compositionFingerprint(reordered)).toBe(compositionFingerprint(a));
  });

  it("changes when the content changes", () => {
    const a = composition([scene("a", "Fresh bread", 5_000)]);
    const b = composition([scene("a", "Fresh bagels", 5_000)]);
    expect(compositionFingerprint(a)).not.toBe(compositionFingerprint(b));
  });
});
