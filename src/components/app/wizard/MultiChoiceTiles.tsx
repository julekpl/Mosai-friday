import { useId, useState, type ReactNode } from "react";
import { Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ChoiceTile } from "@/components/app/wizard/ChoiceTiles";
import { mainChangeMessage, makeMain, toggleSelection } from "@/components/app/wizard/selection";

/**
 * Large answer tiles as one checkbox group (fieldset + legend, native
 * checkboxes): Tab moves between tiles, Space picks or unpicks. Several can
 * be picked and order matters: the first pick is the main one and carries a
 * "Main" badge; every other pick offers "Make main". Changes of the main one
 * are announced politely. Tiles are at least 44 px tall, one column on a
 * phone.
 */
export function MultiChoiceTiles<T extends string>({
  options,
  value,
  onChange,
  legend,
  describedBy,
  exclusive = [],
  children,
}: {
  options: readonly ChoiceTile<T>[];
  value: readonly T[];
  onChange: (value: T[]) => void;
  /** The question, rendered inside the `<legend>` (may be the step's h1). */
  legend: ReactNode;
  describedBy?: string;
  /** Options that can only be picked alone ("Nowhere yet", the agency). */
  exclusive?: readonly T[];
  /** Extra controls that belong to the group (e.g. "Other: ___"). */
  children?: ReactNode;
}) {
  const uid = useId();
  const [announcement, setAnnouncement] = useState("");
  const labelOf = (item: T) => options.find((option) => option.value === item)?.label ?? item;

  const change = (next: T[]) => {
    const cleared = value.filter((item) => !next.includes(item)).length;
    const picked = next.find((item) => !value.includes(item));
    let message = mainChangeMessage(value, next, labelOf);
    if (picked && cleared > 0) message = `${message} Your other picks were cleared.`.trim();
    setAnnouncement(message);
    onChange(next);
  };

  return (
    <fieldset className="m-0 grid min-w-0 gap-5 border-0 p-0" aria-describedby={describedBy}>
      <legend className="float-left w-full p-0">{legend}</legend>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {options.map((option, index) => {
          const selected = value.includes(option.value);
          const main = value[0] === option.value;
          const showMain = main && !exclusive.includes(option.value);
          const inputId = `${uid}-opt-${index}`;
          const labelId = `${inputId}-label`;
          const hintId = `${inputId}-hint`;
          const mainId = `${inputId}-main`;
          const described = [option.hint ? hintId : "", showMain ? mainId : ""].filter(Boolean).join(" ");
          return (
            <div
              key={option.value}
              className={cn(
                "flex min-h-11 w-full items-stretch rounded-lg border bg-card transition-colors ease-terminal",
                "hover:border-terminal-green/50 has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-ring has-[input:focus-visible]:ring-offset-2",
                selected && "border-terminal-green bg-terminal-green-soft",
              )}
            >
              <label htmlFor={inputId} className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-start gap-3 p-4">
                <span className="relative mt-0.5 grid size-5 shrink-0 place-items-center">
                  <input
                    id={inputId}
                    type="checkbox"
                    checked={selected}
                    onChange={() => change(toggleSelection(value, option.value, exclusive))}
                    aria-labelledby={labelId}
                    aria-describedby={described || undefined}
                    className={cn(
                      "peer size-5 cursor-pointer appearance-none rounded-sm border border-input bg-background focus-visible:outline-none",
                      "checked:border-terminal-green checked:bg-terminal-green",
                    )}
                  />
                  {selected && (
                    <Check aria-hidden="true" className="pointer-events-none absolute size-3 text-primary-foreground" />
                  )}
                </span>
                <span className="min-w-0">
                  <span id={labelId} className="block font-mono text-small font-semibold text-foreground">
                    {option.label}
                  </span>
                  {option.hint && (
                    <span id={hintId} className="mt-1 block font-mono text-caption text-muted-foreground">
                      {option.hint}
                    </span>
                  )}
                </span>
              </label>
              {showMain ? (
                <span className="flex shrink-0 items-center pr-3">
                  <Badge
                    id={mainId}
                    variant="outline"
                    className="border-terminal-green/40 bg-background font-mono text-caption text-terminal-green-ink"
                  >
                    Main
                  </Badge>
                </span>
              ) : selected && !exclusive.includes(option.value) ? (
                <span className="flex shrink-0 items-center pr-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="min-h-11 min-w-11 font-mono text-caption"
                    onClick={() => change(makeMain(value, option.value))}
                    aria-label={`Make main: ${option.label}`}
                  >
                    Make main
                  </Button>
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
      {children}
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
    </fieldset>
  );
}
