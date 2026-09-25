import { defaultGoalFor, type BusinessType, type PrimaryGoal } from "@/shared/starterKit";
import { ChoiceTiles } from "@/components/app/wizard/ChoiceTiles";
import { goalLabel, PRIMARY_GOAL_OPTIONS } from "@/components/app/wizard/questionOptions";

/** Q3 "What do you want most right now?" — optional; skipping uses the
 *  default for the business type (none for an agency). */
export function GoalQuestion({
  businessType,
  value,
  onChange,
}: {
  businessType: BusinessType | undefined;
  value: PrimaryGoal | undefined;
  onChange: (value: PrimaryGoal) => void;
}) {
  const fallback = defaultGoalFor(businessType);
  return (
    <section className="grid gap-5 rounded-lg border bg-card p-4 shadow-card sm:p-7" aria-labelledby="q-goal-title">
      <div>
        <h1 id="q-goal-title" className="font-mono text-h1">What do you want most right now?</h1>
        <p id="q-goal-help" className="mt-2 font-mono text-caption text-muted-foreground">
          {fallback
            ? `Skip this and we’ll start with “${goalLabel(fallback)}”.`
            : "Skip this if you are not sure yet."}
        </p>
      </div>
      <ChoiceTiles
        options={PRIMARY_GOAL_OPTIONS}
        value={value}
        onChange={onChange}
        labelledBy="q-goal-title"
        describedBy="q-goal-help"
      />
    </section>
  );
}
