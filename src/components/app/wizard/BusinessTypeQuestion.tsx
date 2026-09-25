import type { BusinessType } from "@/shared/starterKit";
import { ChoiceTiles } from "@/components/app/wizard/ChoiceTiles";
import {
  BUSINESS_TYPE_OPTIONS,
  CLIENT_TYPE_OPTIONS,
  type ClientBusinessType,
} from "@/components/app/wizard/questionOptions";

/**
 * Q1 "What kind of business is it?" — optional. Picking "I do marketing for
 * clients" asks, on the same screen, what kind of business the client is
 * (U9); that is optional too.
 */
export function BusinessTypeQuestion({
  value,
  onChange,
  clientType,
  onClientTypeChange,
}: {
  value: BusinessType | undefined;
  onChange: (value: BusinessType) => void;
  clientType?: ClientBusinessType;
  onClientTypeChange?: (value: ClientBusinessType) => void;
}) {
  const forClient = value === "agency" && onClientTypeChange !== undefined;
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
      {forClient ? (
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
      ) : (
        <p className="font-mono text-caption text-muted-foreground">Not sure? Continue without choosing.</p>
      )}
    </section>
  );
}
