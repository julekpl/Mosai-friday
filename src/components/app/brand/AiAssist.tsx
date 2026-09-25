import { useId, useState, type ReactNode } from "react";
import { Loader2, Plus, Sparkles } from "lucide-react";
import type { Id } from "@/convex/_generated/dataModel";
import { ChipInput } from "@/components/app/ChipInput";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useBrandAssist, type AssistField } from "./useBrandAssist";

const QUICK_ASKS = ["Improve", "Shorter", "Simpler", "Bolder", "Warmer", "More specific"] as const;

/**
 * "Write with AI" / "Improve" next to a text field: three options to pick
 * from, with one-tap instructions or a free-text request. Nothing is saved
 * until the owner picks an option and saves the kit.
 */
export function AiTextAssist({
  projectId,
  field,
  value,
  related,
  label,
  onPick,
}: {
  projectId: Id<"projects">;
  field: AssistField;
  value: string;
  related?: string;
  label: string;
  onPick: (value: string) => void;
}) {
  const uid = useId();
  const { run, busy, error } = useBrandAssist(projectId);
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState("");
  const [options, setOptions] = useState<string[] | null>(null);
  const empty = !value.trim();

  const ask = async (instruction?: string) => {
    const result = await run({ field, current: value || undefined, related, instruction });
    if (result?.kind === "text") setOptions(result.options);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next && options === null && !busy) void ask();
      }}
    >
      <PopoverTrigger asChild>
        <Button type="button" size="sm" variant="ghost" className="h-7 gap-1 px-2 text-terminal-green" aria-label={`${empty ? "Write" : "Improve"} ${label} with AI`}>
          <Sparkles className="size-3.5" aria-hidden="true" />
          <span className="font-mono text-caption">{empty ? "Write with AI" : "Improve"}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="grid w-80 max-w-full gap-3">
        <p className="font-mono text-caption font-medium">{empty ? `Draft: ${label}` : `Improve: ${label}`}</p>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Quick requests">
          {QUICK_ASKS.map((instruction) => (
            <button
              key={instruction}
              type="button"
              disabled={busy}
              onClick={() => void ask(instruction === "Improve" ? undefined : instruction)}
              className="rounded-full border px-2.5 py-1 font-mono text-caption text-muted-foreground transition-colors hover:border-terminal-green/40 hover:text-foreground disabled:opacity-50"
            >
              {instruction}
            </button>
          ))}
        </div>
        <form
          className="flex gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            if (custom.trim()) void ask(custom.trim());
          }}
        >
          <Label htmlFor={`${uid}-ask`} className="sr-only">Tell AI what to change</Label>
          <Input id={`${uid}-ask`} value={custom} onChange={(e) => setCustom(e.target.value)} maxLength={200} placeholder="Or say what to change…" className="h-8" />
          <Button type="submit" size="sm" variant="outline" disabled={busy || !custom.trim()}>Ask</Button>
        </form>
        <div aria-live="polite" className="grid gap-2">
          {busy ? (
            <p className="flex items-center gap-2 font-mono text-caption text-muted-foreground" role="status">
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> Thinking…
            </p>
          ) : error ? (
            <p className="font-mono text-caption text-terminal-red" role="alert">{error}</p>
          ) : options?.length === 0 ? (
            <p className="font-mono text-caption text-muted-foreground">No suggestions this time. Try another request.</p>
          ) : (
            options?.map((option, index) => (
              <div key={index} className="grid gap-1.5 rounded-md border bg-card p-2">
                <p className="text-sm">{option}</p>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="h-7 w-fit"
                  onClick={() => {
                    onPick(option);
                    setOpen(false);
                  }}
                >
                  Use this
                </Button>
              </div>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** One-tap "+ item" buttons: curated starters or AI suggestions. */
export function SuggestionChips({
  suggestions,
  values,
  onAdd,
  max,
  label,
  tone = "starter",
}: {
  suggestions: readonly string[];
  values: string[];
  onAdd: (item: string) => void;
  max: number;
  label: string;
  tone?: "starter" | "ai";
}) {
  const taken = new Set(values.map((value) => value.toLowerCase()));
  const open = suggestions.filter((item) => !taken.has(item.toLowerCase()));
  if (!open.length) return null;
  const full = values.length >= max;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label={label}>
      {open.map((item) => (
        <li key={item} className="min-w-0 max-w-full">
          <button
            type="button"
            disabled={full}
            onClick={() => onAdd(item)}
            className={cn(
              "inline-flex max-w-full items-center gap-1 whitespace-normal break-words rounded-full border border-dashed px-2.5 py-1 text-left font-mono text-caption transition-colors disabled:opacity-40",
              tone === "ai"
                ? "border-terminal-green/50 text-terminal-green hover:bg-terminal-green-soft"
                : "text-muted-foreground hover:border-foreground/40 hover:text-foreground",
            )}
          >
            <Plus className="size-3 shrink-0" aria-hidden="true" />
            <span className="min-w-0">{item}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * A chip list with starter suggestions and "Suggest with AI". Used for
 * personality, write-like/never-like, words and imagery.
 */
export function ChipField({
  projectId,
  id,
  label,
  help,
  field,
  values,
  onChange,
  max,
  starters = [],
  placeholder,
  aiLabel = "Suggest with AI",
  related,
  children,
}: {
  projectId: Id<"projects">;
  id: string;
  label: string;
  help?: string;
  field: AssistField;
  values: string[];
  onChange: (next: string[]) => void;
  max: number;
  starters?: readonly string[];
  placeholder?: string;
  aiLabel?: string;
  related?: string;
  children?: ReactNode;
}) {
  const { run, busy, error } = useBrandAssist(projectId);
  const [aiItems, setAiItems] = useState<string[]>([]);
  const [asked, setAsked] = useState(false);
  const add = (item: string) => {
    if (values.length < max && !values.some((value) => value.toLowerCase() === item.toLowerCase())) onChange([...values, item]);
  };
  const suggest = async () => {
    const result = await run({ field, currentList: values, related });
    setAsked(true);
    if (result?.kind === "list") setAiItems(result.items);
  };
  return (
    <div className="grid min-w-0 gap-1.5">
      <div className="flex flex-wrap items-center justify-between gap-1">
        <Label htmlFor={id}>{label}</Label>
        <Button type="button" size="sm" variant="ghost" className="h-7 gap-1 px-2 text-terminal-green" onClick={suggest} disabled={busy}>
          {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Sparkles className="size-3.5" aria-hidden="true" />}
          <span className="font-mono text-caption">{aiLabel}</span>
        </Button>
      </div>
      {help ? <p id={`${id}-help`} className="font-mono text-caption text-muted-foreground">{help}</p> : null}
      <ChipInput id={id} ariaDescribedBy={help ? `${id}-help` : undefined} values={values} onChange={onChange} maxItems={max} placeholder={placeholder} />
      <div aria-live="polite" className="grid gap-1.5">
        {error ? <p className="font-mono text-caption text-terminal-red" role="alert">{error}</p> : null}
        {asked && !busy && !error && !aiItems.filter((item) => !values.includes(item)).length ? (
          <p className="font-mono text-caption text-muted-foreground">
            {field === "proofPoints" ? "No facts found in your website or files. Add proof you can stand behind." : "No new suggestions."}
          </p>
        ) : null}
        <SuggestionChips suggestions={aiItems} values={values} onAdd={add} max={max} label={`AI suggestions for ${label}`} tone="ai" />
        <SuggestionChips suggestions={starters} values={values} onAdd={add} max={max} label={`Starter ideas for ${label}`} />
      </div>
      {children}
    </div>
  );
}
