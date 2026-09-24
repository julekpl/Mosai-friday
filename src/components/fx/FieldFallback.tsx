import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";
import type { MosaicVariant } from "./mosaicScene";

/**
 * Static CSS stand-in for the WebGL mosaic field.
 *
 * Shown while three.js loads, when WebGL is unavailable, or when the context
 * is lost. Built only from theme tokens (`var(--tile-*)`), so it follows dark
 * mode with no JavaScript and carries no literal colours.
 */
const GRADIENTS: Record<MosaicVariant, CSSProperties> = {
  hero: {
    backgroundImage: [
      "radial-gradient(40% 55% at 78% 30%, color-mix(in oklab, var(--tile-teal) 26%, transparent), transparent 70%)",
      "radial-gradient(35% 45% at 92% 78%, color-mix(in oklab, var(--tile-violet) 22%, transparent), transparent 70%)",
      "radial-gradient(30% 40% at 60% 88%, color-mix(in oklab, var(--tile-coral) 18%, transparent), transparent 70%)",
      "radial-gradient(25% 35% at 70% 5%, color-mix(in oklab, var(--tile-lime) 16%, transparent), transparent 70%)",
    ].join(", "),
  },
  ambient: {
    backgroundImage: [
      "radial-gradient(45% 50% at 15% 20%, color-mix(in oklab, var(--tile-teal) 14%, transparent), transparent 70%)",
      "radial-gradient(40% 45% at 85% 80%, color-mix(in oklab, var(--tile-violet) 12%, transparent), transparent 70%)",
      "radial-gradient(30% 35% at 85% 15%, color-mix(in oklab, var(--tile-coral) 10%, transparent), transparent 70%)",
    ].join(", "),
  },
};

export function FieldFallback({
  variant = "ambient",
  className,
}: {
  variant?: MosaicVariant;
  className?: string;
}) {
  return (
    <div
      aria-hidden="true"
      className={cn("pointer-events-none absolute inset-0", className)}
      style={GRADIENTS[variant]}
    />
  );
}
