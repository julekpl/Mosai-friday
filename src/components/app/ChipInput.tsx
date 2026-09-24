import { useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

/**
 * Chip list editor: type and press Enter (or a comma) to add, ✕ or Backspace
 * to remove. `id` ties it to a visible <Label htmlFor>; `ariaLabel` names it
 * when there is no visible label.
 */
export function ChipInput({
  values,
  onChange,
  placeholder,
  renderChip,
  id,
  ariaLabel,
  ariaDescribedBy,
  maxItems = 20,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  renderChip?: (value: string) => ReactNode;
  id?: string;
  ariaLabel?: string;
  ariaDescribedBy?: string;
  maxItems?: number;
}) {
  const [draft, setDraft] = useState("");

  const add = (raw: string) => {
    const value = raw.trim().replace(/,+$/, "");
    if (!value || values.length >= maxItems) return;
    if (values.some((existing) => existing.toLowerCase() === value.toLowerCase())) return;
    onChange([...values, value]);
  };

  const commit = () => {
    add(draft);
    setDraft("");
  };

  return (
    <div className="rounded-md border bg-card p-2">
      {values.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-1.5" aria-label={ariaLabel ? `${ariaLabel}: added` : undefined}>
          {values.map((v) => (
            <li key={v}>
              <Badge
                variant="outline"
                className="gap-1 border-terminal-green/40 bg-terminal-green-soft font-mono text-caption text-terminal-green"
              >
                {renderChip ? renderChip(v) : v}
                <button
                  type="button"
                  aria-label={`Remove ${v}`}
                  className="ml-0.5 rounded-sm opacity-70 transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-ring"
                  onClick={() => onChange(values.filter((x) => x !== v))}
                >
                  <X className="size-3" aria-hidden="true" />
                </button>
              </Badge>
            </li>
          ))}
        </ul>
      )}
      <Input
        id={id}
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedBy}
        value={draft}
        onChange={(e) => {
          const val = e.target.value;
          // A comma commits the chip immediately.
          if (val.includes(",")) {
            const parts = val.split(",");
            add(parts[0]);
            setDraft(parts.slice(1).join(""));
          } else {
            setDraft(val);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
          if (e.key === "Backspace" && !draft && values.length) {
            onChange(values.slice(0, -1));
          }
        }}
        onBlur={commit}
        placeholder={placeholder ?? "Type and press Enter"}
        className="border-0 bg-transparent shadow-none focus-visible:ring-0"
      />
    </div>
  );
}
