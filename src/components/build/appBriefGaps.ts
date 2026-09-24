export type BriefGap = { step: number; label: string };

/** What still blocks saving and reviewing the brief, with the step that fixes each gap. */
export function briefGaps(d: { audience: "" | "customer_facing" | "internal_team" | "both"; goal: string; targetUsers: string; coreWorkflows: string[] }) {
  const save: BriefGap[] = [];
  if (!d.goal) save.push({ step: 0, label: "App idea" });
  if (!d.audience) save.push({ step: 1, label: "Who should use this app" });
  if (!d.targetUsers) save.push({ step: 1, label: "Describe the people who will use it" });
  const review: BriefGap[] = d.coreWorkflows.length === 0 ? [{ step: 2, label: "At least one workflow" }] : [];
  return { save, review };
}
