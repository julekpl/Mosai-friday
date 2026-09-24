import type { ReactNode } from "react";
import {
  AnimatePresence,
  motion,
  useReducedMotion,
  type TargetAndTransition,
} from "framer-motion";
import { MOSAI_EASE, MOTION } from "@/components/motion";

/**
 * Route / section transitions for MOSAI.
 *
 * Built on framer-motion and the shared motion tokens in
 * `src/components/motion.tsx`. Only `opacity` and `transform` animate. When
 * the user prefers reduced motion every preset collapses to a short opacity
 * cross-fade (no travel, no scale, no blur) — content still changes, it just
 * does not move.
 *
 * @example Route transition (keyed by path)
 *   const location = useLocation();
 *   <PageTransition transitionKey={location.pathname}>
 *     <Outlet />
 *   </PageTransition>
 *
 * @example Scroll reveal for a section
 *   <ScrollReveal preset="rise" delay={0.08}>
 *     <FeatureGrid />
 *   </ScrollReveal>
 */

export type TransitionPreset = "rise" | "fade" | "scale" | "mosaic";

type Frames = {
  initial: TargetAndTransition;
  animate: TargetAndTransition;
  exit: TargetAndTransition;
};

const PRESETS: Record<TransitionPreset, Frames> = {
  /** Small upward travel — the default for content swaps. */
  rise: {
    initial: { opacity: 0, y: 12 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -8 },
  },
  /** Opacity only. */
  fade: {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    exit: { opacity: 0 },
  },
  /** Gentle zoom — dialogs, cards, hero media. */
  scale: {
    initial: { opacity: 0, scale: 0.97 },
    animate: { opacity: 1, scale: 1 },
    exit: { opacity: 0, scale: 0.985 },
  },
  /** A tile settling into place: rise + a hint of rotation. */
  mosaic: {
    initial: { opacity: 0, y: 16, rotate: -1.5, scale: 0.98 },
    animate: { opacity: 1, y: 0, rotate: 0, scale: 1 },
    exit: { opacity: 0, y: -8, rotate: 0.75, scale: 0.99 },
  },
};

const REDUCED: Frames = PRESETS.fade;

type MotionTag = "div" | "section" | "main" | "article" | "li";

const TAGS = {
  div: motion.div,
  section: motion.section,
  main: motion.main,
  article: motion.article,
  li: motion.li,
} as const;

function framesFor(preset: TransitionPreset, reduced: boolean): Frames {
  return reduced ? REDUCED : PRESETS[preset];
}

export interface PageTransitionProps {
  children: ReactNode;
  /**
   * Identity of the current content. Changing it plays the exit of the old
   * content, then the enter of the new one (e.g. `location.pathname`). Omit
   * for a one-off enter animation on mount.
   */
  transitionKey?: string | number;
  /** Motion preset (default `"rise"`). */
  preset?: TransitionPreset;
  /** Enter duration in seconds (default `MOTION.slow`, 240 ms). */
  duration?: number;
  /** Enter delay in seconds (default 0). */
  delay?: number;
  /** Element to render (default `div`). */
  as?: MotionTag;
  className?: string;
  /**
   * Play the enter animation on first mount too (default true). Set false
   * for the app's first paint so the initial route appears instantly.
   */
  animateOnMount?: boolean;
}

/**
 * Animates content in and out when `transitionKey` changes. Focus
 * management stays with the caller (move focus to the new heading after
 * navigation); this component never steals focus.
 */
export function PageTransition({
  children,
  transitionKey,
  preset = "rise",
  duration = MOTION.slow,
  delay = 0,
  as = "div",
  className,
  animateOnMount = true,
}: PageTransitionProps) {
  const reduced = useReducedMotion() ?? false;
  const frames = framesFor(preset, reduced);
  const Tag = TAGS[as];
  return (
    <AnimatePresence mode="wait" initial={animateOnMount}>
      <Tag
        key={transitionKey ?? "static"}
        className={className}
        initial={frames.initial}
        animate={{
          ...frames.animate,
          transition: {
            duration: reduced ? MOTION.fast : duration,
            delay: reduced ? 0 : delay,
            ease: MOSAI_EASE,
          },
        }}
        exit={{
          ...frames.exit,
          transition: { duration: MOTION.fast, ease: MOSAI_EASE },
        }}
      >
        {children}
      </Tag>
    </AnimatePresence>
  );
}

export interface ScrollRevealProps {
  children: ReactNode;
  /** Motion preset (default `"rise"`). */
  preset?: TransitionPreset;
  /** Delay in seconds — use small steps (0.06–0.08) to stagger siblings. */
  delay?: number;
  /** Duration in seconds (default 0.5 — a section entrance, not feedback). */
  duration?: number;
  /** Share of the element that must be visible before it reveals (0–1). */
  amount?: number;
  /** Element to render (default `div`). */
  as?: MotionTag;
  className?: string;
}

/**
 * Reveals its children once when they scroll into view. With reduced motion
 * the content is simply shown — no fade, no travel — so nothing is ever
 * hidden from a user who opted out of animation.
 */
export function ScrollReveal({
  children,
  preset = "rise",
  delay = 0,
  duration = 0.5,
  amount = 0.2,
  as = "div",
  className,
}: ScrollRevealProps) {
  const reduced = useReducedMotion() ?? false;
  const Tag = TAGS[as];
  if (reduced) {
    return <Tag className={className}>{children}</Tag>;
  }
  const frames = PRESETS[preset];
  return (
    <Tag
      className={className}
      initial={frames.initial}
      whileInView={frames.animate}
      viewport={{ once: true, amount }}
      transition={{ duration, delay, ease: MOSAI_EASE }}
    >
      {children}
    </Tag>
  );
}
