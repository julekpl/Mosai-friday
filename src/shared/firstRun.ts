/** FR-M: first-run steps in order; "created" means the project was made.
 *  Shared by the wizard and `convex/firstRun.ts`. */
export const FIRST_RUN_STEPS = ["type", "name", "goals", "channels", "customers", "summary", "created"] as const;
export type FirstRunStep = (typeof FIRST_RUN_STEPS)[number];
