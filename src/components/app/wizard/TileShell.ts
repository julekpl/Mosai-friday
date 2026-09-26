import { cn } from "@/lib/utils";

/**
 * The one answer-tile shell shared by ChoiceTiles (radio) and
 * MultiChoiceTiles (checkbox): border, card surface, 44 px minimum height,
 * hover and selected colours, and the visible focus ring. `focus: "self"`
 * rings the tile when it is the focused control (a Radix radio item);
 * `focus: "input"` rings it when a native input inside it has focus.
 */
export function tileShellClass({
  selected,
  focus,
  className,
}: {
  selected: boolean;
  focus: "self" | "input";
  className?: string;
}) {
  return cn(
    "flex min-h-11 w-full rounded-lg border bg-card transition-colors ease-terminal hover:border-terminal-green/50",
    focus === "self"
      ? "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      : "has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-ring has-[input:focus-visible]:ring-offset-2",
    selected && "border-terminal-green bg-terminal-green-soft",
    className,
  );
}
