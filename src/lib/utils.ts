import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// The type scale in index.css (`--text-display` … `--text-metric`) adds
// font-size utilities tailwind-merge does not know about. Without this it
// reads `text-caption` as a text colour and drops it when a real colour class
// such as `text-muted-foreground` appears in the same `cn()` call.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ["display", "h1", "h2", "h3", "body", "small", "caption", "metric"],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
