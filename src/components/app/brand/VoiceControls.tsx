import { useId, useRef, type KeyboardEvent } from "react";
import { Quote } from "lucide-react";
import {
  VOICE_DIMENSIONS,
  VOICE_LABELS,
  type VoiceDimension,
  type VoiceScale,
} from "@/convex/lib/brandProfile";
import { VOICE_EXAMPLES, VOICE_PRESETS, type VoicePreset } from "@/convex/lib/brandDesign";
import { cn } from "@/lib/utils";

const STEP_WORDS = ["Very", "Quite", "Balanced", "Quite", "Very"] as const;

function stepLabel(dimension: VoiceDimension, value: number): string {
  const { low, high } = VOICE_LABELS[dimension];
  if (value === 3) return "Balanced";
  return `${STEP_WORDS[value - 1]} ${(value < 3 ? low : high).toLowerCase()}`;
}

function sameVoice(a: VoiceScale, b: VoiceScale): boolean {
  return VOICE_DIMENSIONS.every((dimension) => a[dimension] === b[dimension]);
}

/** Starting personalities: one tap sets all four scales and adds traits. */
export function VoicePresets({
  voice,
  onPick,
}: {
  voice: VoiceScale;
  onPick: (preset: VoicePreset) => void;
}) {
  return (
    <div className="grid gap-2">
      <p className="text-sm font-medium">Start from a personality</p>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {VOICE_PRESETS.map((preset) => {
          const active = sameVoice(voice, preset.voice);
          return (
            <li key={preset.id}>
              <button
                type="button"
                aria-pressed={active}
                onClick={() => onPick(preset)}
                className={cn(
                  "grid h-full w-full gap-2 rounded-lg border bg-card p-3 text-left transition-all ease-terminal hover:-translate-y-0.5 hover:shadow-soft",
                  active && "border-terminal-green/60 bg-terminal-green-soft ring-2 ring-terminal-green/30",
                )}
              >
                <span className="font-mono text-small font-medium">{preset.name}</span>
                <span className="font-mono text-caption text-muted-foreground">{preset.description}</span>
                <span className="flex items-end gap-1" aria-hidden="true">
                  {VOICE_DIMENSIONS.map((dimension) => (
                    <span
                      key={dimension}
                      className="w-2 rounded-sm bg-terminal-green/70"
                      style={{ height: `${preset.voice[dimension] * 0.25}rem` }}
                    />
                  ))}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * One tone dimension as a five-stop track (a radio group with arrow-key
 * support) and a live example of what that setting sounds like.
 */
export function VoiceScaleControl({
  dimension,
  value,
  onChange,
}: {
  dimension: VoiceDimension;
  value: number;
  onChange: (value: number) => void;
}) {
  const labelId = useId();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const { low, high } = VOICE_LABELS[dimension];

  const move = (event: KeyboardEvent<HTMLButtonElement>) => {
    const delta = event.key === "ArrowRight" || event.key === "ArrowUp" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowDown" ? -1 : 0;
    const target = event.key === "Home" ? 1 : event.key === "End" ? 5 : value + delta;
    if (target === value || target < 1 || target > 5 || (delta === 0 && event.key !== "Home" && event.key !== "End")) return;
    event.preventDefault();
    onChange(target);
    refs.current[target - 1]?.focus();
  };

  return (
    <div className="grid gap-2 rounded-lg border bg-card p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p id={labelId} className="font-mono text-small font-medium">
          {low} <span className="text-muted-foreground">↔</span> {high}
        </p>
        <span className="rounded-full bg-terminal-green-soft px-2 py-0.5 font-mono text-caption text-terminal-green-ink">
          {stepLabel(dimension, value)}
        </span>
      </div>
      <div role="radiogroup" aria-labelledby={labelId} className="relative flex items-center justify-between px-1 py-2">
        <span aria-hidden="true" className="absolute inset-x-3 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-gradient-to-r from-terminal-blue-soft via-muted to-terminal-green-soft" />
        <span
          aria-hidden="true"
          className="absolute left-3 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-terminal-green/60 transition-all duration-200 ease-terminal"
          style={{ width: `calc((100% - 1.5rem) * ${(value - 1) / 4})` }}
        />
        {[1, 2, 3, 4, 5].map((step) => {
          const selected = step === value;
          return (
            <button
              key={step}
              ref={(node) => { refs.current[step - 1] = node; }}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={stepLabel(dimension, step)}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(step)}
              onKeyDown={move}
              className={cn(
                "relative z-10 grid size-8 place-items-center rounded-full border-2 bg-card transition-all duration-200 ease-terminal focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                selected
                  ? "scale-110 border-terminal-green bg-terminal-green shadow-soft"
                  : "border-border hover:border-terminal-green/60",
              )}
            >
              <span
                aria-hidden="true"
                className={cn("rounded-full", selected ? "size-2.5 bg-background" : "size-1.5 bg-muted-foreground/50")}
              />
            </button>
          );
        })}
      </div>
      <div className="flex justify-between font-mono text-caption text-muted-foreground" aria-hidden="true">
        <span>{low}</span>
        <span>{high}</span>
      </div>
      <p className="flex gap-2 rounded-md bg-muted/50 p-2.5 text-sm" aria-live="polite">
        <Quote className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span>
          <span className="sr-only">Sounds like: </span>
          <em>{VOICE_EXAMPLES[dimension][value - 1]}</em>
        </span>
      </p>
    </div>
  );
}
