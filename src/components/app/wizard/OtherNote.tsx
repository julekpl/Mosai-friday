import { useId } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FIRST_RUN_NOTE_LIMITS } from "@/shared/starterKit";

/** "Other: ___" next to a list of tiles: the owner's own words, bounded. */
export function OtherNote({
  value,
  onChange,
  label = "Other",
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  placeholder?: string;
}) {
  const id = useId();
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>
        {label} <span className="font-normal text-muted-foreground">(optional)</span>
      </Label>
      <Input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        maxLength={FIRST_RUN_NOTE_LIMITS.other}
        placeholder={placeholder}
        className="h-12"
      />
    </div>
  );
}

/** "Anything we should know?" with a visible character count. */
export function AnythingElseNote({
  value,
  onChange,
  label = "Anything we should know?",
}: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
}) {
  const id = useId();
  const limit = FIRST_RUN_NOTE_LIMITS.anythingElse;
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>
        {label} <span className="font-normal text-muted-foreground">(optional)</span>
      </Label>
      <Textarea
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value.slice(0, limit))}
        maxLength={limit}
        rows={4}
        aria-describedby={`${id}-count`}
        placeholder="Opening hours, what makes you different, anything to avoid"
      />
      <p id={`${id}-count`} className="font-mono text-caption text-muted-foreground">
        {value.length} of {limit} characters
      </p>
    </div>
  );
}
