import {
  BUSINESS_TYPES,
  BUSINESS_TYPE_LABELS,
  CHANNEL_LABELS,
  CUSTOMER_GROUPS,
  CUSTOMER_GROUP_LABELS,
  GOAL_LABELS,
  POSTING_CHANNELS,
  PRIMARY_GOALS,
  type BusinessType,
  type CustomerGroup,
  type PostingChannel,
  type PrimaryGoal,
} from "@/shared/starterKit";
import type { ChoiceTile } from "@/components/app/wizard/ChoiceTiles";
import type { ClientBusinessType } from "@/components/app/wizard/selection";

/**
 * Answer tiles for the first-run questions and Edit project. The words live
 * in `src/shared/starterKit.ts` (one source of truth); this only shapes them
 * into tiles.
 */
export const BUSINESS_TYPE_OPTIONS: readonly ChoiceTile<BusinessType>[] = BUSINESS_TYPES.map((value) => ({
  value,
  ...BUSINESS_TYPE_LABELS[value],
}));

/** A client's business type (U9): the Q1 tiles without "agency". */
export const CLIENT_TYPE_OPTIONS = BUSINESS_TYPE_OPTIONS.filter(
  (option): option is ChoiceTile<ClientBusinessType> => option.value !== "agency",
);

export const GOAL_OPTIONS: readonly ChoiceTile<PrimaryGoal>[] = PRIMARY_GOALS.map((value) => ({
  value,
  label: GOAL_LABELS[value],
}));

export const CHANNEL_OPTIONS: readonly ChoiceTile<PostingChannel>[] = POSTING_CHANNELS.map((value) => ({
  value,
  label: CHANNEL_LABELS[value],
}));

export const CUSTOMER_OPTIONS: readonly ChoiceTile<CustomerGroup>[] = CUSTOMER_GROUPS.map((value) => ({
  value,
  label: CUSTOMER_GROUP_LABELS[value],
}));

export const businessTypeLabel = (type: BusinessType) => BUSINESS_TYPE_LABELS[type].label;
export const goalLabel = (goal: PrimaryGoal) => GOAL_LABELS[goal];
export const channelLabel = (channel: PostingChannel) => CHANNEL_LABELS[channel];
export const customerLabel = (group: CustomerGroup) => CUSTOMER_GROUP_LABELS[group];
