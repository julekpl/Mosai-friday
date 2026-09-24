type StepKey = "understand" | "journeys" | "create";
type StepState = "not_started" | "saved" | "locked";

export type SetupSnapshot = {
  personaCount: number;
  journeyCount: number;
  contentCount: number;
  modules: readonly string[];
};

type SetupStep = {
  key: StepKey;
  label: string;
  detail: string;
  state: StepState;
};

export type NextActionModel = {
  title: string;
  description: string;
  module: StepKey;
  locked: boolean;
  steps: SetupStep[];
};

/** Row presence means saved work exists; it does not prove review or completion. */
export function getNextActionModel(snapshot: SetupSnapshot): NextActionModel {
  const { personaCount, journeyCount, contentCount, modules } = snapshot;
  const stateFor = (module: StepKey, count: number): StepState =>
    !modules.includes(module) ? "locked" : count > 0 ? "saved" : "not_started";
  const detailFor = (
    module: StepKey,
    count: number,
    empty: string,
    review: string,
  ): string => {
    if (!modules.includes(module)) {
      return count > 0 ? `${count} saved · access locked` : "Access locked";
    }
    return count > 0 ? `${count} saved · ${review}` : empty;
  };
  const steps: SetupStep[] = [
    {
      key: "understand",
      label: "Audience profile",
      detail: detailFor("understand", personaCount, "No profile saved yet", "review details"),
      state: stateFor("understand", personaCount),
    },
    {
      key: "journeys",
      label: "Customer journey",
      detail: detailFor("journeys", journeyCount, "No journey map saved yet", "review the map"),
      state: stateFor("journeys", journeyCount),
    },
    {
      key: "create",
      label: "Content draft",
      detail: detailFor("create", contentCount, "No content saved yet", "review draft status"),
      state: stateFor("create", contentCount),
    },
  ];

  const next =
    personaCount === 0 ? steps[0] : journeyCount === 0 ? steps[1] : steps[2];
  const locked = next.state === "locked";
  if (next.key === "understand") {
    return {
      title: locked ? "Understand is locked" : "Write your first audience profile",
      description: locked
        ? "Review the available plan options to continue setting up this workspace."
        : "Use what you know about your customers. Saved profiles still need your review before you rely on them.",
      module: "understand",
      locked,
      steps,
    };
  }
  if (next.key === "journeys") {
    return {
      title: locked ? "Journeys is locked" : "Review an audience, then map its journey",
      description: locked
        ? "Review the available plan options to continue setting up this workspace."
        : "An audience profile is saved, not verified. Check its details before using it to draft journey stages, then review the map.",
      module: "journeys",
      locked,
      steps,
    };
  }
  return {
    title: locked
      ? "Create is locked"
      : contentCount > 0
        ? "Review your saved content"
        : "Prepare your first content draft",
    description: locked
      ? "Review the available plan options to continue setting up this workspace."
      : "Create keeps work in draft until you choose what to do with it.",
    module: "create",
    locked,
    steps,
  };
}
