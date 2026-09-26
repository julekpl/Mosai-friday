import type { BusinessType } from "@/shared/starterKit";
import { ChoiceTiles } from "@/components/app/wizard/ChoiceTiles";
import { MultiChoiceTiles } from "@/components/app/wizard/MultiChoiceTiles";
import { OtherNote } from "@/components/app/wizard/OtherNote";
import { BUSINESS_TYPE_OPTIONS, CLIENT_TYPE_OPTIONS } from "@/components/app/wizard/questionOptions";
import { EXCLUSIVE_TYPES, isAgency, type ClientBusinessType } from "@/components/app/wizard/selection";

/**
 * Q1 "What kind of business is it?" Several can be picked; the first is the
 * main one. "I set this up for a client" is picked alone and asks, on the
 * same screen, what kind of business the client is (U9, optional).
 */
export function BusinessTypeQuestion({
  value,
  onChange,
  otherNote,
  onOtherNoteChange,
  clientType,
  onClientTypeChange,
  error,
}: {
  value: readonly BusinessType[];
  onChange: (value: BusinessType[]) => void;
  otherNote: string;
  onOtherNoteChange: (value: string) => void;
  clientType?: ClientBusinessType;
  onClientTypeChange: (value: ClientBusinessType) => void;
  error?: boolean;
}) {
  const forClient = isAgency(value);
  return (
    <section className="grid gap-5 rounded-lg border bg-card p-4 shadow-card sm:p-7">
      <MultiChoiceTiles
        options={BUSINESS_TYPE_OPTIONS}
        value={value}
        onChange={onChange}
        exclusive={EXCLUSIVE_TYPES}
        describedBy={error ? "q-type-help q-type-error" : "q-type-help"}
        legend={
          <>
            <h1 id="q-type-title" className="font-mono text-h1">What kind of business is it?</h1>
            <p id="q-type-help" className="mt-2 font-mono text-caption text-muted-foreground">
              Pick all that fit. The first one you pick is the main one. You can change anything later.
            </p>
          </>
        }
      >
        {!forClient && (
          <OtherNote value={otherNote} onChange={onOtherNoteChange} placeholder="e.g. Dog grooming van" />
        )}
      </MultiChoiceTiles>
      {error && (
        <p id="q-type-error" role="alert" className="font-mono text-caption text-destructive">
          Pick at least one, or describe it under Other, to continue.
        </p>
      )}
      {forClient && (
        <div className="grid gap-3 border-t pt-5">
          <div>
            <h2 id="q-client-type-title" className="font-mono text-h2">What kind of business is your client?</h2>
            <p id="q-client-type-help" className="mt-1 font-mono text-caption text-muted-foreground">
              You set up one client at a time. Not sure? Continue without choosing.
            </p>
          </div>
          <ChoiceTiles
            options={CLIENT_TYPE_OPTIONS}
            value={clientType}
            onChange={onClientTypeChange}
            labelledBy="q-client-type-title"
            describedBy="q-client-type-help"
          />
        </div>
      )}
    </section>
  );
}
