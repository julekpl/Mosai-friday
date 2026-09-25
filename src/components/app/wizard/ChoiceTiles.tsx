import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export type ChoiceTile<T extends string> = {
  value: T;
  label: string;
  hint?: string;
};

/**
 * Large answer tiles as one radio group: Tab reaches the group, arrow keys
 * move between tiles, Space picks one (Radix radio group). Every tile is at
 * least 44 px tall (`min-h-11`) and shows a visible focus ring.
 */
export function ChoiceTiles<T extends string>({
  options,
  value,
  onChange,
  labelledBy,
  describedBy,
}: {
  options: readonly ChoiceTile<T>[];
  value: T | undefined;
  onChange: (value: T) => void;
  labelledBy: string;
  describedBy?: string;
}) {
  return (
    <RadioGroupPrimitive.Root
      value={value ?? ""}
      onValueChange={(next) => {
        const picked = options.find((option) => option.value === next);
        if (picked) onChange(picked.value);
      }}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      className="grid grid-cols-1 gap-3 sm:grid-cols-2"
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <RadioGroupPrimitive.Item
            key={option.value}
            value={option.value}
            className={cn(
              "flex min-h-11 w-full items-start gap-3 rounded-lg border bg-card p-4 text-left transition-colors ease-terminal",
              "hover:border-terminal-green/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              selected && "border-terminal-green bg-terminal-green-soft",
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                "mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border",
                selected && "border-terminal-green bg-terminal-green text-primary-foreground",
              )}
            >
              {selected && <Check className="size-3" />}
            </span>
            <span className="min-w-0">
              <span className="block font-mono text-small font-semibold text-foreground">{option.label}</span>
              {option.hint && <span className="mt-1 block font-mono text-caption text-muted-foreground">{option.hint}</span>}
            </span>
          </RadioGroupPrimitive.Item>
        );
      })}
    </RadioGroupPrimitive.Root>
  );
}
