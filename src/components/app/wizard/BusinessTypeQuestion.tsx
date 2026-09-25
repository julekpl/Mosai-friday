import type { BusinessType } from "@/shared/starterKit";
import { ChoiceTiles } from "@/components/app/wizard/ChoiceTiles";
import { BUSINESS_TYPE_OPTIONS } from "@/components/app/wizard/questionOptions";

/** Q1 "What kind of business is it?" — optional. */
export function BusinessTypeQuestion({
  value,
  onChange,
}: {
  value: BusinessType | undefined;
  onChange: (value: BusinessType) => void;
}) {
  return (
    <section className="grid gap-5 rounded-lg border bg-card p-4 shadow-card sm:p-7" aria-labelledby="q-type-title">
      <div>
        <h1 id="q-type-title" className="font-mono text-h1">What kind of business is it?</h1>
        <p id="q-type-help" className="mt-2 font-mono text-caption text-muted-foreground">
          This sets sensible starting points. You can change anything later.
        </p>
      </div>
      <ChoiceTiles
        options={BUSINESS_TYPE_OPTIONS}
        value={value}
        onChange={onChange}
        labelledBy="q-type-title"
        describedBy="q-type-help"
      />
      <p className="font-mono text-caption text-muted-foreground">Not sure? Continue without choosing.</p>
    </section>
  );
}
