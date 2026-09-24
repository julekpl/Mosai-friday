/**
 * Imperative three.js scene behind `<MosaicField>`.
 *
 * This module never imports three.js statically: `loadThree()` pulls it in
 * with a dynamic `import("three")`, so the library lands in its own chunk and
 * is only downloaded when a field actually mounts. Everything else here is
 * plain maths over typed arrays so one frame of ~1.5k instanced tiles costs a
 * fraction of a millisecond.
 */
import type * as ThreeNS from "three";
import { mixRGB, type FieldPalette, type RGB } from "./theme";

export type Three = typeof ThreeNS;
export type MosaicVariant = "hero" | "ambient";

/** Load three.js on demand (separate chunk). */
export function loadThree(): Promise<Three> {
  return import("three");
}

interface VariantConfig {
  cols: number;
  rows: number;
  /** Share of tiles that carry a module colour at rest. */
  colourRatio: number;
  /** How far coloured tiles move from paper towards their tile colour. */
  strength: number;
  /** Wave height multiplier. */
  amplitude: number;
  /** Wave speed multiplier. */
  speed: number;
  /** Plane tilt (radians) — the "looking across a floor" angle. */
  tiltX: number;
  tiltZ: number;
  /** Fraction of the grid height the camera frames. */
  frame: number;
  /** How much far rows fade into the paper colour. */
  depthFade: number;
}

const VARIANTS: Record<MosaicVariant, VariantConfig> = {
  hero: {
    cols: 44,
    rows: 34,
    colourRatio: 0.3,
    strength: 0.92,
    amplitude: 1,
    speed: 1,
    tiltX: -0.92,
    tiltZ: 0.2,
    frame: 0.52,
    depthFade: 0.7,
  },
  ambient: {
    cols: 48,
    rows: 30,
    colourRatio: 0.16,
    strength: 0.55,
    amplitude: 0.55,
    speed: 0.55,
    tiltX: -0.45,
    tiltZ: -0.1,
    frame: 0.62,
    depthFade: 0.35,
  },
};

const TILE = 0.86;
const FOV = 38;
/** Time (s) at which the entrance sweep has fully settled. */
export const INTRO_DONE_AT = 3.2;

export interface MosaicSceneOptions {
  variant: MosaicVariant;
  palette: FieldPalette;
  intensity: number;
}

export interface MosaicScene {
  /**
   * True when WebGL runs on a CPU rasteriser (SwiftShader, llvmpipe, …).
   * Animating there burns CPU and battery, so callers draw a static frame.
   */
  readonly softwareRendering: boolean;
  /** Draw one frame at `time` seconds since the field started. */
  render(time: number): void;
  resize(width: number, height: number, pixelRatio: number): void;
  setPalette(palette: FieldPalette): void;
  setIntensity(intensity: number): void;
  /** Pointer in normalised device coords (-1…1), or `null` when away. */
  setPointer(ndc: { x: number; y: number } | null): void;
  dispose(): void;
}

/** Deterministic PRNG so the tile layout is stable across renders/themes. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function toLinear(c: RGB): RGB {
  return [srgbToLinear(c[0]), srgbToLinear(c[1]), srgbToLinear(c[2])];
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** easeOutBack — a little overshoot, matching the `ease-mosaic` curve. */
function easeOutBack(t: number): number {
  const c1 = 1.4;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

const SOFTWARE_RENDERERS = /swiftshader|llvmpipe|softpipe|software|basic render/i;

function detectSoftwareRenderer(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
): boolean {
  try {
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const name = String(
      gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? "",
    );
    return SOFTWARE_RENDERERS.test(name);
  } catch {
    return false;
  }
}

/**
 * Build the scene on `canvas`. Throws if a WebGL context cannot be created —
 * callers catch that and fall back to the CSS gradient.
 */
export function createMosaicScene(
  THREE: Three,
  canvas: HTMLCanvasElement,
  options: MosaicSceneOptions,
): MosaicScene {
  const cfg = VARIANTS[options.variant];
  let intensity = options.intensity;

  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    powerPreference: "low-power",
  });
  renderer.setClearAlpha(0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 200);

  const group = new THREE.Group();
  group.rotation.set(cfg.tiltX, 0, cfg.tiltZ);
  scene.add(group);

  const count = cfg.cols * cfg.rows;
  const geometry = new THREE.PlaneGeometry(TILE, TILE);
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  // Creates the instanceColor attribute; we then write its array directly.
  mesh.setColorAt(0, new THREE.Color());
  const colorAttr = mesh.instanceColor;
  if (!colorAttr) throw new Error("instanceColor unavailable");
  colorAttr.setUsage(THREE.DynamicDrawUsage);
  const colors = colorAttr.array as Float32Array;
  mesh.frustumCulled = false;
  group.add(mesh);

  // Per-tile static data.
  const rand = mulberry32(options.variant === "hero" ? 7 : 19);
  const baseX = new Float32Array(count);
  const baseY = new Float32Array(count);
  const phase = new Float32Array(count);
  const delay = new Float32Array(count);
  const depth = new Float32Array(count); // 0 near … 1 far
  const tileIndex = new Int16Array(count); // -1 = neutral
  const accentIndex = new Int16Array(count);
  const halfW = (cfg.cols - 1) / 2;
  const halfH = (cfg.rows - 1) / 2;
  for (let r = 0, i = 0; r < cfg.rows; r++) {
    for (let c = 0; c < cfg.cols; c++, i++) {
      baseX[i] = c - halfW;
      baseY[i] = r - halfH;
      phase[i] = rand() * Math.PI * 2;
      depth[i] = r / (cfg.rows - 1);
      // Diagonal sweep from the near-left corner, with a little jitter.
      delay[i] = (c / cfg.cols) * 0.9 + (r / cfg.rows) * 0.9 + rand() * 0.35;
      tileIndex[i] = rand() < cfg.colourRatio ? Math.floor(rand() * 1000) : -1;
      accentIndex[i] = Math.floor(rand() * 1000);
    }
  }

  // Palette-derived linear colours (recomputed on theme change).
  const base = new Float32Array(count * 3);
  const accent = new Float32Array(count * 3);
  let bgLinear: RGB = [0, 0, 0];

  function applyPalette(palette: FieldPalette) {
    const strength = clamp01(cfg.strength * intensity);
    const n = palette.tiles.length;
    bgLinear = toLinear(palette.background);
    const neutral = toLinear(palette.neutral);
    for (let i = 0; i < count; i++) {
      const own = tileIndex[i];
      const accentColour = toLinear(palette.tiles[accentIndex[i] % n]);
      const b =
        own >= 0
          ? mixRGB(bgLinear, toLinear(palette.tiles[own % n]), strength)
          : neutral;
      // Far rows melt into the paper so the field has depth, not edges.
      const fade = depth[i] * cfg.depthFade;
      const faded = mixRGB(b, bgLinear, fade);
      base[i * 3] = faded[0];
      base[i * 3 + 1] = faded[1];
      base[i * 3 + 2] = faded[2];
      const a = mixRGB(accentColour, bgLinear, fade);
      accent[i * 3] = a[0];
      accent[i * 3 + 1] = a[1];
      accent[i * 3 + 2] = a[2];
    }
  }
  let palette = options.palette;
  applyPalette(palette);

  // Pointer → plane intersection, in the group's local space.
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const plane = new THREE.Plane();
  const hit = new THREE.Vector3();
  let pointerTarget: { x: number; y: number } | null = null;
  let px = 0;
  let py = 0;
  let pStrength = 0;
  let hasPointerPos = false;

  function updatePlane() {
    group.updateMatrixWorld(true);
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(
      group.quaternion,
    );
    plane.setFromNormalAndCoplanarPoint(normal, group.position);
  }
  updatePlane();

  function fitCamera(aspect: number) {
    const tan = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    // Frame a slice of the grid small enough that the tilted plane always
    // overfills the viewport (no visible edges), on wide and tall screens.
    const visH = Math.min(cfg.rows * cfg.frame, (cfg.cols * 0.62) / aspect);
    const distance = visH / 2 / tan;
    camera.position.set(0, 0, distance);
    camera.lookAt(0, 0, 0);
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
  }
  fitCamera(1);

  const dummy = new THREE.Object3D();

  function render(time: number) {
    const t = time * cfg.speed;
    const amp = cfg.amplitude * Math.min(intensity, 1.5);

    // Ease pointer influence in and out.
    if (pointerTarget) {
      ndc.set(pointerTarget.x, pointerTarget.y);
      raycaster.setFromCamera(ndc, camera);
      if (raycaster.ray.intersectPlane(plane, hit)) {
        group.worldToLocal(hit);
        if (!hasPointerPos) {
          px = hit.x;
          py = hit.y;
          hasPointerPos = true;
        }
        px += (hit.x - px) * 0.14;
        py += (hit.y - py) * 0.14;
      }
      pStrength += (1 - pStrength) * 0.06;
    } else {
      pStrength += (0 - pStrength) * 0.04;
      if (pStrength < 0.002) hasPointerPos = false;
    }
    const pointerOn = pStrength > 0.002;
    const reach2 = 9;

    for (let i = 0; i < count; i++) {
      const x = baseX[i];
      const y = baseY[i];
      const wave =
        Math.sin(x * 0.3 + t * 0.7 + phase[i] * 0.35) * 0.5 +
        Math.sin(y * 0.38 - t * 0.5) * 0.5;
      let z = wave * 0.26 * amp;
      let rx = wave * 0.16 * amp;
      let ry = Math.cos(x * 0.25 - t * 0.55 + phase[i] * 0.4) * 0.1 * amp;
      let glow = 0;

      if (pointerOn) {
        const dx = x - px;
        const dy = y - py;
        const d2 = dx * dx + dy * dy;
        const fall = Math.exp(-d2 / reach2);
        if (fall > 0.004) {
          const ring = Math.sin(Math.sqrt(d2) * 1.15 - time * 3.4);
          z += (fall * 0.7 + ring * fall * 0.28) * pStrength * amp;
          rx += dy * fall * 0.09 * pStrength;
          ry -= dx * fall * 0.09 * pStrength;
          glow = fall * pStrength;
        }
      }

      // Entrance sweep: tiles pop in along a diagonal.
      const p = clamp01((time - delay[i]) / 0.7);
      const s = p <= 0 ? 0.0001 : p >= 1 ? 1 : Math.max(0.0001, easeOutBack(p));

      dummy.position.set(x, y, z);
      dummy.rotation.set(rx, ry, 0);
      dummy.scale.set(s, s, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);

      // Cheap "lighting": brighten crests, dim troughs, light up near pointer.
      const shade = 1 + wave * 0.06 * amp;
      const k = i * 3;
      const g = glow * 0.75;
      colors[k] = (base[k] + (accent[k] - base[k]) * g) * shade;
      colors[k + 1] = (base[k + 1] + (accent[k + 1] - base[k + 1]) * g) * shade;
      colors[k + 2] = (base[k + 2] + (accent[k + 2] - base[k + 2]) * g) * shade;
    }
    mesh.instanceMatrix.needsUpdate = true;
    colorAttr!.needsUpdate = true;
    renderer.render(scene, camera);
  }

  return {
    softwareRendering: detectSoftwareRenderer(renderer.getContext()),
    render,
    resize(width, height, pixelRatio) {
      if (width <= 0 || height <= 0) return;
      renderer.setPixelRatio(pixelRatio);
      renderer.setSize(width, height, false);
      fitCamera(width / height);
    },
    setPalette(next) {
      palette = next;
      applyPalette(palette);
    },
    setIntensity(next) {
      intensity = next;
      applyPalette(palette);
    },
    setPointer(next) {
      pointerTarget = next;
    },
    dispose() {
      group.remove(mesh);
      mesh.dispose();
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
