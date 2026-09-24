/**
 * MOSAI visual effects.
 *
 * - `LazyMosaicField` — decorative three.js mosaic backdrop (code-split; three
 *   is only fetched when one mounts). Import the eager `MosaicField` from
 *   `@/components/fx/MosaicField` only if you manage your own Suspense —
 *   re-exporting it here would pull it into every importer's chunk.
 * - `FieldFallback` — the static, token-based CSS version of the field.
 * - `PageTransition`, `ScrollReveal` — reduced-motion-aware transitions.
 * - `readFieldPalette`, `readTokenColor`, `observeTheme` — read theme tokens
 *   as sRGB for canvas/WebGL work.
 */
export { LazyMosaicField } from "./LazyMosaicField";
export type { MosaicFieldProps } from "./MosaicField";
export type { MosaicVariant } from "./mosaicScene";
export { FieldFallback } from "./FieldFallback";
export {
  PageTransition,
  ScrollReveal,
  type PageTransitionProps,
  type ScrollRevealProps,
  type TransitionPreset,
} from "./PageTransition";
export {
  observeTheme,
  readFieldPalette,
  readTokenColor,
  resolveCssColor,
  type FieldPalette,
  type RGB,
} from "./theme";
