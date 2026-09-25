import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/* ── Quick-add suggestion row for the interactive "who" step ───────────── */

export function Suggestions({
  options,
  picked,
  onPick,
}: {
  options: string[];
  picked: string[];
  onPick: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const active = picked.includes(o);
        return (
          <button
            key={o}
            type="button"
            aria-pressed={active}
            onClick={() => onPick(o)}
            className={`font-mono text-caption ${cn(
              "flex items-center gap-1 rounded-full border px-2.5 py-1 transition-colors ease-terminal",
              active
                ? "border-terminal-green/60 bg-terminal-green-soft text-terminal-green"
                : "text-muted-foreground hover:border-terminal-green/40 hover:text-terminal-green",
            )}`}
          >
            {active && <Check className="size-3" aria-hidden="true" />}
            {o}
          </button>
        );
      })}
    </div>
  );
}
