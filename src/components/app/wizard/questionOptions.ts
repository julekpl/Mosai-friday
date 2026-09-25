import type { BusinessType, PrimaryGoal } from "@/shared/starterKit";
import type { ChoiceTile } from "@/components/app/wizard/ChoiceTiles";

/** Q1 tiles (first-run blueprint §2–§3). */
export const BUSINESS_TYPE_OPTIONS: readonly ChoiceTile<BusinessType>[] = [
  { value: "appointments", label: "Services by appointment", hint: "Hair, physio, trades, coaching" },
  { value: "shop", label: "Shop", hint: "Products" },
  { value: "walk_in", label: "Café, restaurant, salon", hint: "Walk-in" },
  { value: "agency", label: "I do marketing for clients" },
];

/** A client's business type (U9): the Q1 tiles without "agency". */
export type ClientBusinessType = Exclude<BusinessType, "agency">;
export const CLIENT_TYPE_OPTIONS = BUSINESS_TYPE_OPTIONS.filter(
  (option): option is ChoiceTile<ClientBusinessType> => option.value !== "agency",
);

/** Q3 tiles. */
export const PRIMARY_GOAL_OPTIONS: readonly ChoiceTile<PrimaryGoal>[] = [
  { value: "bookings", label: "More bookings / calls" },
  { value: "sales", label: "More sales" },
  { value: "visits", label: "More people through the door" },
  { value: "awareness", label: "Get known locally" },
];

export function goalLabel(goal: PrimaryGoal): string {
  return PRIMARY_GOAL_OPTIONS.find((option) => option.value === goal)?.label ?? goal;
}
