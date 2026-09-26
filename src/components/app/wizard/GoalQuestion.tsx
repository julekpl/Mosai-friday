import { defaultGoalFor, type BusinessType, type PrimaryGoal } from "@/shared/starterKit";
import { MultiChoiceTiles } from "@/components/app/wizard/MultiChoiceTiles";
import { OtherNote } from "@/components/app/wizard/OtherNote";
import { GOAL_OPTIONS, goalLabel } from "@/components/app/wizard/questionOptions";

/** Q3 "What do you want more of?" Several can be picked; skipping uses the
 *  default for the main business type (none for an agency). */
export function GoalQuestion({
  businessType,
  value,
  onChange,
  otherNote,
  onOtherNoteChange,
}: {
  businessType: BusinessType | undefined;
  value: readonly PrimaryGoal[];
  onChange: (value: PrimaryGoal[]) => void;
  otherNote: string;
  onOtherNoteChange: (value: string) => void;
}) {
  const fallback = defaultGoalFor(businessType);
  return (
    <section className="grid gap-5 rounded-lg border bg-card p-4 shadow-card sm:p-7">
      <MultiChoiceTiles
        options={GOAL_OPTIONS}
        value={value}
        onChange={onChange}
        describedBy="q-goal-help"
        legend={
          <>
            <h1 id="q-goal-title" className="font-mono text-h1">What do you want more of?</h1>
            <p id="q-goal-help" className="mt-2 font-mono text-caption text-muted-foreground">
              {value.length
                ? "Pick all that matter. The first one you pick is the main one."
                : fallback
                  ? `Pick all that matter, or skip and we’ll start with “${goalLabel(fallback)}”.`
                  : "Pick all that matter, or skip this if you are not sure yet."}
            </p>
          </>
        }
      >
        <OtherNote value={otherNote} onChange={onOtherNoteChange} placeholder="e.g. Fill the quiet Tuesday slots" />
      </MultiChoiceTiles>
    </section>
  );
}
