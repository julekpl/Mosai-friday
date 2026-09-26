import {
  defaultGoalFor,
  FIRST_RUN_NOTE_LIMITS,
  type BusinessType,
  type CustomerGroup,
  type FirstRunNotes,
  type PostingChannel,
  type PrimaryGoal,
} from "@/shared/starterKit";

/**
 * Pure selection rules for the multi-select answer tiles (first-run wizard
 * and Edit project). Order matters: the first item is the "main" one.
 * No React, no network, so the rules are unit-tested directly.
 */

/** Pick or unpick `value`. Unpicking the main item promotes the next one.
 *  An `exclusive` value (e.g. "agency", "Nowhere yet") clears every other
 *  pick, and picking anything else clears the exclusive ones. */
export function toggleSelection<T extends string>(
  selection: readonly T[],
  value: T,
  exclusive: readonly T[] = [],
): T[] {
  if (selection.includes(value)) return selection.filter((item) => item !== value);
  if (exclusive.includes(value)) return [value];
  return [...selection.filter((item) => !exclusive.includes(item)), value];
}

/** Move `value` to the front so it becomes the main one. A value that is not
 *  picked leaves the selection unchanged. */
export function makeMain<T extends string>(selection: readonly T[], value: T): T[] {
  if (!selection.includes(value)) return [...selection];
  return [value, ...selection.filter((item) => item !== value)];
}

/** What a screen reader should hear after a change of main item, or "" when
 *  the main item did not change. */
export function mainChangeMessage<T extends string>(
  before: readonly T[],
  after: readonly T[],
  labelOf: (value: T) => string,
): string {
  if (before[0] === after[0]) return "";
  if (after[0] === undefined) return "Nothing picked.";
  return `${labelOf(after[0])} is now the main one.`;
}

/** Split an ordered selection into main + the rest. */
export function splitMain<T extends string>(selection: readonly T[]): { main?: T; others: T[] } {
  const [main, ...others] = selection;
  return { main, others };
}

/** The agency's client type (U9): any business type except another agency. */
export type ClientBusinessType = Exclude<BusinessType, "agency">;

export type NoteDrafts = {
  businessType: string;
  goal: string;
  channel: string;
  customers: string;
  anythingElse: string;
};

export const EMPTY_NOTES: NoteDrafts = {
  businessType: "",
  goal: "",
  channel: "",
  customers: "",
  anythingElse: "",
};

/** Everything the owner answered, as the screens hold it. */
export type AnswerDrafts = {
  types: readonly BusinessType[];
  /** Only used when `types` is ["agency"]. */
  clientType?: ClientBusinessType;
  goals: readonly PrimaryGoal[];
  channels: readonly PostingChannel[];
  customers: readonly CustomerGroup[];
  notes: NoteDrafts;
};

export const EXCLUSIVE_TYPES: readonly BusinessType[] = ["agency"];
export const EXCLUSIVE_CHANNELS: readonly PostingChannel[] = ["none"];

export function isAgency(types: readonly BusinessType[]): boolean {
  return types[0] === "agency";
}

/** The type that describes the business the kit is for: the client's type
 *  for an agency, the main type otherwise. */
export function answeredType(drafts: Pick<AnswerDrafts, "types" | "clientType">): BusinessType | undefined {
  return isAgency(drafts.types) ? drafts.clientType : drafts.types[0];
}

function cleanNote(value: string, limit: number): string | undefined {
  const cleaned = value.replace(/\s+/g, " ").trim().slice(0, limit);
  return cleaned || undefined;
}

export type AnswerFields = {
  businessType?: BusinessType;
  otherBusinessTypes?: BusinessType[];
  primaryGoal?: PrimaryGoal;
  otherGoals?: PrimaryGoal[];
  postingChannels?: PostingChannel[];
  customerGroups?: CustomerGroup[];
  firstRunNotes?: FirstRunNotes;
};

/**
 * The drafts as mutation fields: main = first, others = the rest, empty lists
 * and blank notes left out (the server normalizes again; it never trusts the
 * client). For an agency the business type is the client's type and the
 * "Other" type note is not sent (the agency answer describes the owner, not
 * the client). With `defaultGoal`, a skipped goal takes the type's default.
 */
export function toAnswers(drafts: AnswerDrafts, { defaultGoal = false } = {}): AnswerFields {
  const out: AnswerFields = {};
  const agency = isAgency(drafts.types);
  if (agency) {
    if (drafts.clientType) out.businessType = drafts.clientType;
  } else {
    const types = splitMain(drafts.types);
    if (types.main) out.businessType = types.main;
    if (types.others.length) out.otherBusinessTypes = types.others;
  }

  const goals = splitMain(drafts.goals);
  const goal = goals.main ?? (defaultGoal ? defaultGoalFor(out.businessType) : undefined);
  if (goal) out.primaryGoal = goal;
  if (goals.others.length) out.otherGoals = goals.others;

  if (drafts.channels.length) out.postingChannels = [...drafts.channels];
  if (drafts.customers.length) out.customerGroups = [...drafts.customers];

  const other = FIRST_RUN_NOTE_LIMITS.other;
  const notes: FirstRunNotes = {};
  const typeNote = agency ? undefined : cleanNote(drafts.notes.businessType, other);
  if (typeNote) notes.businessType = typeNote;
  const goalNote = cleanNote(drafts.notes.goal, other);
  if (goalNote) notes.goal = goalNote;
  const channelNote = cleanNote(drafts.notes.channel, other);
  if (channelNote) notes.channel = channelNote;
  const customerNote = cleanNote(drafts.notes.customers, other);
  if (customerNote) notes.customers = customerNote;
  const anythingElse = cleanNote(drafts.notes.anythingElse, FIRST_RUN_NOTE_LIMITS.anythingElse);
  if (anythingElse) notes.anythingElse = anythingElse;
  if (Object.keys(notes).length) out.firstRunNotes = notes;
  return out;
}

/** Stored answers back into drafts (Edit project). */
export function fromStored(stored: {
  businessType?: BusinessType;
  otherBusinessTypes?: readonly BusinessType[];
  primaryGoal?: PrimaryGoal;
  otherGoals?: readonly PrimaryGoal[];
  postingChannels?: readonly PostingChannel[];
  customerGroups?: readonly CustomerGroup[];
  firstRunNotes?: FirstRunNotes;
}): AnswerDrafts {
  const notes = stored.firstRunNotes ?? {};
  return {
    types: stored.businessType ? [stored.businessType, ...(stored.otherBusinessTypes ?? [])] : [],
    goals: stored.primaryGoal ? [stored.primaryGoal, ...(stored.otherGoals ?? [])] : [],
    channels: [...(stored.postingChannels ?? [])],
    customers: [...(stored.customerGroups ?? [])],
    notes: {
      businessType: notes.businessType ?? "",
      goal: notes.goal ?? "",
      channel: notes.channel ?? "",
      customers: notes.customers ?? "",
      anythingElse: notes.anythingElse ?? "",
    },
  };
}
