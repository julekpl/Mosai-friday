import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { FieldFallback } from "./FieldFallback";
import {
  INTRO_DONE_AT,
  loadThree,
  createMosaicScene,
  type MosaicScene,
  type MosaicVariant,
} from "./mosaicScene";
import { observeTheme, readFieldPalette } from "./theme";

export interface MosaicFieldProps {
  /**
   * `hero`: dense, tilted, colourful floor of tiles for a page's first screen.
   * `ambient`: sparse, calm, low-contrast backdrop behind cards and forms.
   */
  variant?: MosaicVariant;
  /** Classes for the positioned wrapper (it fills its parent by default). */
  className?: string;
  /**
   * Motion and colour strength, 0…1.5 (default 1). Lower it behind dense
   * content; the field never replaces a scrim for text contrast.
   */
  intensity?: number;
  /** Tiles ripple towards the pointer (default true; off for coarse pointers). */
  interactive?: boolean;
}

type FieldStatus = "loading" | "ready" | "unavailable";

const MAX_DPR = 2;
/** ~60 fps, with headroom for vsync jitter on 60 Hz screens. */
const MIN_FRAME_MS = 14;
/** Frames slower than this (≈ under 15 fps) count towards the guard… */
const SLOW_FRAME_MS = 66;
/** …and this many in a row switch the field to a static frame. */
const SLOW_FRAME_LIMIT = 12;

/**
 * The browser's per-frame animation clock. Unlike `performance.now()` it only
 * advances when the page actually renders a frame, so the loop cannot be
 * made to draw many frames at once (e.g. by fake timers that flush queued
 * rAF callbacks synchronously in tests).
 */
function frameClock(): number {
  const t = document.timeline?.currentTime;
  return typeof t === "number" ? t : performance.now();
}

/**
 * An animated WebGL mosaic of instanced tiles that gently ripple and respond
 * to the pointer. Decorative only: the wrapper and canvas are `aria-hidden`
 * and never take pointer events.
 *
 * - three.js is loaded with a dynamic import (own chunk).
 * - Colours come from the theme tokens at runtime and follow `.dark`.
 * - `prefers-reduced-motion`: one static frame, no loop, no pointer ripple.
 * - The loop pauses while the tab is hidden or the field is offscreen.
 * - If WebGL is unavailable (or the context is lost) a CSS gradient stays.
 *
 * Prefer `LazyMosaicField` from `@/components/fx`, which code-splits this
 * component as well.
 */
export function MosaicField({
  variant = "ambient",
  className,
  intensity = 1,
  interactive = true,
}: MosaicFieldProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<MosaicScene | null>(null);
  /** Redraws once when the loop is not running (static / paused). */
  const redrawRef = useRef<() => void>(() => {});
  const intensityRef = useRef(intensity);
  const [status, setStatus] = useState<FieldStatus>("loading");

  useEffect(() => {
    intensityRef.current = intensity;
    sceneRef.current?.setIntensity(intensity);
    redrawRef.current();
  }, [intensity]);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    const canvas = canvasRef.current;
    if (!wrapper || !canvas) return;

    let disposed = false;
    let scene: MosaicScene | null = null;
    let raf = 0;
    let running = false;
    let elapsed = 0;
    let last = 0;
    let onScreen = true;
    let failed = false;
    const cleanups: Array<() => void> = [];

    const motionQuery = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const coarseQuery = window.matchMedia?.("(pointer: coarse)");
    let reduced = motionQuery?.matches ?? false;

    // Performance guard: software WebGL, or a device that cannot keep up,
    // gets one static frame instead of a loop that would eat the main thread.
    let lowPower = false;
    let slowFrames = 0;

    const staticFrame = () => reduced || lowPower;
    const frameTime = () => (staticFrame() ? INTRO_DONE_AT + 1.5 : elapsed);

    const tick = () => {
      if (!scene) return;
      raf = requestAnimationFrame(tick);
      const now = frameClock();
      const delta = now - last;
      // Frame limiter: at most ~60 fps on high-refresh screens, and never
      // more than one draw per real frame even if rAF is driven faster.
      if (delta < MIN_FRAME_MS) return;
      slowFrames = delta > SLOW_FRAME_MS ? slowFrames + 1 : 0;
      if (slowFrames >= SLOW_FRAME_LIMIT) {
        lowPower = true;
        sync();
        return;
      }
      elapsed += Math.min(delta / 1000, 0.1);
      last = now;
      scene.render(elapsed);
    };

    const stop = () => {
      if (!running) return;
      running = false;
      cancelAnimationFrame(raf);
    };

    const redraw = () => {
      if (scene && !running && !failed) scene.render(frameTime());
    };

    const sync = () => {
      const shouldRun =
        !!scene &&
        !failed &&
        !staticFrame() &&
        onScreen &&
        document.visibilityState === "visible";
      if (shouldRun && !running) {
        running = true;
        last = frameClock() - MIN_FRAME_MS;
        raf = requestAnimationFrame(tick);
      } else if (!shouldRun) {
        stop();
        redraw();
      }
    };

    const resize = () => {
      if (!scene) return;
      const { width, height } = wrapper.getBoundingClientRect();
      scene.resize(
        Math.round(width),
        Math.round(height),
        Math.min(window.devicePixelRatio || 1, MAX_DPR),
      );
      redraw();
    };

    const fail = () => {
      failed = true;
      stop();
      if (!disposed) setStatus("unavailable");
    };

    loadThree()
      .then((THREE) => {
        // StrictMode / fast unmount: never create a context we'd throw away.
        if (disposed) return;
        try {
          scene = createMosaicScene(THREE, canvas, {
            variant,
            palette: readFieldPalette(),
            intensity: intensityRef.current,
          });
        } catch {
          fail();
          return;
        }
        sceneRef.current = scene;
        lowPower = scene.softwareRendering;
        redrawRef.current = redraw;

        const onContextLost = () => fail();
        canvas.addEventListener("webglcontextlost", onContextLost);
        cleanups.push(() =>
          canvas.removeEventListener("webglcontextlost", onContextLost),
        );

        const ro = new ResizeObserver(resize);
        ro.observe(wrapper);
        cleanups.push(() => ro.disconnect());

        if (typeof IntersectionObserver !== "undefined") {
          const io = new IntersectionObserver(
            (entries) => {
              onScreen = entries.some((e) => e.isIntersecting);
              sync();
            },
            { rootMargin: "64px" },
          );
          io.observe(wrapper);
          cleanups.push(() => io.disconnect());
        }

        document.addEventListener("visibilitychange", sync);
        cleanups.push(() =>
          document.removeEventListener("visibilitychange", sync),
        );

        const onMotionChange = () => {
          reduced = motionQuery?.matches ?? false;
          if (reduced) scene?.setPointer(null);
          sync();
        };
        motionQuery?.addEventListener("change", onMotionChange);
        cleanups.push(() =>
          motionQuery?.removeEventListener("change", onMotionChange),
        );

        cleanups.push(
          observeTheme(() => {
            scene?.setPalette(readFieldPalette());
            redraw();
          }),
        );

        if (interactive) {
          const onPointerMove = (e: PointerEvent) => {
            if (
              staticFrame() ||
              coarseQuery?.matches ||
              e.pointerType === "touch"
            ) {
              return;
            }
            const rect = wrapper.getBoundingClientRect();
            const inside =
              e.clientX >= rect.left &&
              e.clientX <= rect.right &&
              e.clientY >= rect.top &&
              e.clientY <= rect.bottom;
            scene?.setPointer(
              inside
                ? {
                    x: ((e.clientX - rect.left) / rect.width) * 2 - 1,
                    y: -(((e.clientY - rect.top) / rect.height) * 2 - 1),
                  }
                : null,
            );
          };
          const onPointerLeave = () => scene?.setPointer(null);
          window.addEventListener("pointermove", onPointerMove, {
            passive: true,
          });
          document.documentElement.addEventListener(
            "pointerleave",
            onPointerLeave,
          );
          cleanups.push(() => {
            window.removeEventListener("pointermove", onPointerMove);
            document.documentElement.removeEventListener(
              "pointerleave",
              onPointerLeave,
            );
          });
        }

        resize();
        setStatus("ready");
        sync();
      })
      .catch(fail);

    return () => {
      disposed = true;
      stop();
      for (const cleanup of cleanups) cleanup();
      redrawRef.current = () => {};
      sceneRef.current = null;
      scene?.dispose();
      scene = null;
    };
  }, [variant, interactive]);

  return (
    <div
      ref={wrapperRef}
      aria-hidden="true"
      className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}
    >
      <FieldFallback
        variant={variant}
        className={cn(
          "transition-opacity duration-700 ease-terminal",
          status === "ready" ? "opacity-0" : "opacity-100",
        )}
      />
      {status !== "unavailable" && (
        <canvas
          // A new canvas per variant: a disposed renderer force-loses its
          // context, which a reused canvas element could not recover.
          key={`${variant}-${interactive ? "i" : "s"}`}
          ref={canvasRef}
          aria-hidden="true"
          className={cn(
            "absolute inset-0 block size-full transition-opacity duration-1000 ease-terminal",
            status === "ready" ? "opacity-100" : "opacity-0",
          )}
        />
      )}
    </div>
  );
}

export default MosaicField;
