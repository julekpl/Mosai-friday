/**
 * Theme bridge for the WebGL effects.
 *
 * WebGL cannot read CSS custom properties, and the design tokens are authored
 * in `oklch()` (see `src/index.css`), which three.js cannot parse. Instead of
 * duplicating the palette as literals (AGENTS.md rule 15: no hex in feature
 * code) we let the browser resolve each token: read the computed value from
 * `:root`, paint it into a 1×1 2D canvas and read the sRGB pixel back. That
 * works for every colour syntax the browser understands and follows `.dark`
 * automatically.
 */

/** An opaque sRGB colour with channels in 0…1. */
export type RGB = readonly [number, number, number];

/** The mosaic tile tokens, in brand order. */
export const FIELD_TILE_TOKENS = [
  "--tile-teal",
  "--tile-coral",
  "--tile-violet",
  "--tile-sky",
  "--tile-rose",
  "--tile-lime",
  "--tile-amber",
] as const;

export interface FieldPalette {
  /** Resolved tile colours (only tokens that resolved are included). */
  tiles: RGB[];
  /** Resting colour for uncoloured tiles. */
  neutral: RGB;
  /** Page paper colour; coloured tiles are blended towards it. */
  background: RGB;
  /** Ink colour; used for a faint lift on neutral tiles. */
  foreground: RGB;
}

let probe: CanvasRenderingContext2D | null | undefined;

function getProbe(): CanvasRenderingContext2D | null {
  if (probe !== undefined) return probe;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    probe = canvas.getContext("2d", { willReadFrequently: true });
  } catch {
    probe = null;
  }
  return probe;
}

/** Resolve any CSS colour string to opaque sRGB, or `null` if it cannot be. */
export function resolveCssColor(value: string): RGB | null {
  const ctx = getProbe();
  const input = value.trim();
  if (!ctx || !input) return null;
  ctx.clearRect(0, 0, 1, 1);
  // Reset first: an invalid assignment leaves the previous fillStyle intact.
  ctx.fillStyle = "rgba(0, 0, 0, 0)";
  ctx.fillStyle = input;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
  if (a === 0) return null;
  return [r / 255, g / 255, b / 255];
}

/** Read one design token (e.g. `--tile-teal`) from `:root` as sRGB. */
export function readTokenColor(
  token: string,
  root: Element = document.documentElement,
): RGB | null {
  return resolveCssColor(getComputedStyle(root).getPropertyValue(token));
}

export function mixRGB(a: RGB, b: RGB, t: number): RGB {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

const MID_GREY: RGB = [0.5, 0.5, 0.5];

/** Snapshot the current theme's palette for the mosaic field. */
export function readFieldPalette(): FieldPalette {
  const background = readTokenColor("--background") ?? MID_GREY;
  const foreground = readTokenColor("--foreground") ?? MID_GREY;
  const muted = readTokenColor("--muted") ?? background;
  const tiles = FIELD_TILE_TOKENS.map((t) => readTokenColor(t)).filter(
    (c): c is RGB => c !== null,
  );
  return {
    tiles: tiles.length ? tiles : [foreground],
    neutral: mixRGB(muted, foreground, 0.05),
    background,
    foreground,
  };
}

/**
 * Call `onChange` whenever the theme may have changed: a class/style/data
 * attribute change on `<html>` (the `.dark` toggle) or an OS colour-scheme
 * change. Returns an unsubscribe function.
 */
export function observeTheme(onChange: () => void): () => void {
  const root = document.documentElement;
  const mo = new MutationObserver(onChange);
  mo.observe(root, {
    attributes: true,
    attributeFilter: ["class", "style", "data-theme"],
  });
  const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
  mq?.addEventListener("change", onChange);
  return () => {
    mo.disconnect();
    mq?.removeEventListener("change", onChange);
  };
}
