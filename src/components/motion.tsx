import type { ReactNode } from "react";
import { MotionConfig, motion } from "framer-motion";

/**
 * MOSAI motion tokens — one place for routine timing.
 *
 * Targets (implementation brief §5): small feedback ~120 ms, routine
 * transitions 120–240 ms, longer flourishes rare and non-blocking.
 * Everything here animates transform/opacity only, and `MotionConfig
 * reducedMotion="user"` disables travel when the OS asks for it — state
 * changes (colour, text, focus) still happen instantly.
 */
export const MOTION = {
  /** Button/toggle feedback. */
  fast: 0.12,
  /** Routine panel/content transitions. */
  base: 0.18,
  /** Section entrances. */
  slow: 0.24,
} as const;

/** The shared easing — the same curve as `ease-terminal` in index.css. */
export const MOSAI_EASE = [0.22, 1, 0.36, 1] as const;

/** App-wide motion config: honours prefers-reduced-motion automatically. */
export function AppMotion({ children }: { children: ReactNode }) {
  return (
    <MotionConfig reducedMotion="user">{children}</MotionConfig>
  );
}

/**
 * Module route transition: a quick 180 ms rise+fade so switching modules
 * reads as "same shell, new content". The shell (sidebar/project switcher)
 * does not move; focus is handled by the caller (heading receives focus).
 */
export function ModuleTransition({ children }: { children: ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: MOTION.base, ease: MOSAI_EASE }}
    >
      {children}
    </motion.div>
  );
}
