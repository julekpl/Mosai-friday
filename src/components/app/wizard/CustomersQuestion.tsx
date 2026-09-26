import type { CustomerGroup } from "@/shared/starterKit";
import { MultiChoiceTiles } from "@/components/app/wizard/MultiChoiceTiles";
import { AnythingElseNote, OtherNote } from "@/components/app/wizard/OtherNote";
import { CUSTOMER_OPTIONS } from "@/components/app/wizard/questionOptions";

/** Q5 "Who are your customers?" plus the optional "Anything we should know?" */
export function CustomersQuestion({
  value,
  onChange,
  otherNote,
  onOtherNoteChange,
  anythingElse,
  onAnythingElseChange,
}: {
  value: readonly CustomerGroup[];
  onChange: (value: CustomerGroup[]) => void;
  otherNote: string;
  onOtherNoteChange: (value: string) => void;
  anythingElse: string;
  onAnythingElseChange: (value: string) => void;
}) {
  return (
    <section className="grid gap-5 rounded-lg border bg-card p-4 shadow-card sm:p-7">
      <MultiChoiceTiles
        options={CUSTOMER_OPTIONS}
        value={value}
        onChange={onChange}
        describedBy="q-customers-help"
        legend={
          <>
            <h1 id="q-customers-title" className="font-mono text-h1">Who are your customers?</h1>
            <p id="q-customers-help" className="mt-2 font-mono text-caption text-muted-foreground">
              Pick all that fit. The first one you pick is the main one.
            </p>
          </>
        }
      >
        <OtherNote value={otherNote} onChange={onOtherNoteChange} placeholder="e.g. Dog owners" />
      </MultiChoiceTiles>
      <div className="border-t pt-5">
        <AnythingElseNote value={anythingElse} onChange={onAnythingElseChange} />
      </div>
    </section>
  );
}
