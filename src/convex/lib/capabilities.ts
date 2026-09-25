/**
 * Capability registry (MOSAI pack T2.3).
 *
 * One canonical, typed source of truth for **what a caller may do in a module**.
 * Before T2.3 the answer was spread over four places that could disagree: the
 * tier list `PLAN_MODULES` in `billing.ts`, the hard-coded module lists in
 * `AppShell.tsx` / `App.tsx` / `Billing.tsx`, per-module `assertModule("sell")`
 * calls, and nothing at all for the other seven modules — so a `free` plan
 * could call `builds.create` or `cms.publishPage` straight from the client even
 * though the UI hid the module.
 *
 * Everything now derives from this file:
 *
 *   - `MODULE_DEFINITIONS` — the add-ons and the actions each one defines;
 *   - `PLAN_MODULES` — which add-ons a plan includes (re-exported by
 *     `billing.ts`, so `billing.currentPlan` keeps working);
 *   - `ROLE_MODULE_ACTIONS` — which actions a role may perform inside a module
 *     (the role half of the matrix; `lib/roles.ts` stays the org-admin half);
 *   - `resolveCapabilityState` — plan + role + country + setup → one of
 *     `included | locked | needs_setup | unavailable` (blueprint §3 states);
 *   - `CONVEX_FILE_OWNERS` — which convex file belongs to which module, so
 *     `scripts/audit-module-capabilities.mjs` can fail CI when a module
 *     function is reachable without a capability check or a documented
 *     exemption, and no other file has to keep a module list.
 *
 * `guards.ts` enforces from here (`moduleQuery` / `moduleMutation` /
 * `moduleAction`), the audit reads it, the tests assert against it and the UI
 * renders it. Keep this module small and dependency-free (only `./roles`)
 * because the audit script imports it directly.
 *
 * Money, tax and legal questions are explicitly **not** modelled here — see the
 * country-matrix stub, which is a placeholder until the owner answers
 * `STATUS.md` §6 #4.
 */

import { ORG_ROLES, type OrgRole } from "./roles";

// ── Plans ───────────────────────────────────────────────────────────────────

/** The commercial tiers. Billing itself is T2.4. */
export const PLANS = ["free", "starter", "growth", "scale"] as const;
export type Plan = (typeof PLANS)[number];

/** Launch posture: a user with no plan is `free`, in every read AND write path
 *  (`billing.ts` re-exports this so the old import sites keep working). */
export const DEFAULT_PLAN: Plan = "free";

export function isPlan(value: string): value is Plan {
  return (PLANS as readonly string[]).includes(value);
}

// ── Modules (the add-ons) ───────────────────────────────────────────────────

export const MODULE_IDS = [
  "understand",
  "journeys",
  "create",
  "build",
  "customers",
  "promote",
  "sell",
  "grow",
] as const;
export type ModuleId = (typeof MODULE_IDS)[number];

/** What a capability lets you do. The verb set is deliberately small: a
 *  capability is `<module>.<action>` and nothing else, so the matrix stays
 *  readable and a new module cannot invent its own vocabulary. */
export const CAPABILITY_ACTIONS = [
  "view",
  "edit",
  "manage",
  "publish",
  "spend",
] as const;
export type CapabilityAction = (typeof CAPABILITY_ACTIONS)[number];

export type CapabilityKey = `${ModuleId}.${CapabilityAction}`;

export interface ModuleDefinition {
  id: ModuleId;
  label: string;
  summary: string;
  /** The actions this module defines. A module that defines no `spend` action
   *  cannot be spent from, whatever the role says. */
  actions: readonly CapabilityAction[];
}

export const MODULE_DEFINITIONS: readonly ModuleDefinition[] = [
  {
    id: "understand",
    label: "Understand",
    summary: "Personas and the business context every other module builds on.",
    actions: ["view", "edit"],
  },
  {
    id: "journeys",
    label: "Journeys",
    summary: "Journey maps: stages, lanes and the experience score.",
    actions: ["view", "edit"],
  },
  {
    id: "create",
    label: "Create",
    summary: "Content gaps, topics and written pieces.",
    actions: ["view", "edit", "publish"],
  },
  {
    id: "build",
    label: "Build",
    summary: "Sites, pages, revisions and publishing.",
    actions: ["view", "edit", "manage", "publish"],
  },
  {
    id: "customers",
    label: "Customers",
    summary: "Contacts and their marketing consent.",
    actions: ["view", "edit"],
  },
  {
    id: "promote",
    label: "Promote",
    summary: "Social posts, campaigns and paid ads — external writes live here.",
    actions: ["view", "edit", "manage", "publish", "spend"],
  },
  {
    id: "sell",
    label: "Sell",
    summary: "Products, variants, media, collections and feeds.",
    actions: ["view", "edit", "manage", "publish"],
  },
  {
    id: "grow",
    label: "Grow",
    summary: "Insights and the provider connections that feed them.",
    actions: ["view", "edit", "manage"],
  },
];

export const MODULE_BY_ID: Record<ModuleId, ModuleDefinition> =
  MODULE_DEFINITIONS.reduce(
    (acc, definition) => {
      acc[definition.id] = definition;
      return acc;
    },
    {} as Record<ModuleId, ModuleDefinition>,
  );

export function isModuleId(value: string): value is ModuleId {
  return (MODULE_IDS as readonly string[]).includes(value);
}

// ── Capabilities ────────────────────────────────────────────────────────────

export function capabilityKey(
  module: ModuleId,
  action: CapabilityAction,
): CapabilityKey {
  return `${module}.${action}`;
}

/** Every capability in the system — `<module>.<action>`, 34 in total for the
 *  eight modules above. Modules do not get their own copies of this list. */
export const CAPABILITIES: readonly CapabilityKey[] = MODULE_DEFINITIONS.flatMap(
  (definition) =>
    definition.actions.map((action) => capabilityKey(definition.id, action)),
);

export function capabilitiesOf(module: ModuleId): readonly CapabilityKey[] {
  return MODULE_BY_ID[module].actions.map((action) =>
    capabilityKey(module, action),
  );
}

export function isCapabilityKey(value: string): value is CapabilityKey {
  return (CAPABILITIES as readonly string[]).includes(value);
}

/** Split a capability, or null when the key is not in the registry (a typo in
 *  a call site is therefore a runtime-refused key, not silent access). */
export function parseCapability(
  value: string,
): { module: ModuleId; action: CapabilityAction } | null {
  const dot = value.lastIndexOf(".");
  if (dot <= 0) return null;
  const module = value.slice(0, dot);
  const action = value.slice(dot + 1);
  if (!isModuleId(module)) return null;
  if (!(CAPABILITY_ACTIONS as readonly string[]).includes(action)) return null;
  if (!MODULE_BY_ID[module].actions.includes(action as CapabilityAction)) {
    return null;
  }
  return { module, action: action as CapabilityAction };
}

// ── plan × module ───────────────────────────────────────────────────────────

/** What each plan unlocks. The single source of truth: `billing.PLAN_MODULES`
 *  is this value, and the UI reads it from the server. */
export const PLAN_MODULES: Record<Plan, readonly ModuleId[]> = {
  free: ["understand", "journeys", "create"],
  starter: ["understand", "journeys", "create", "build", "customers", "promote"],
  growth: [
    "understand",
    "journeys",
    "create",
    "build",
    "customers",
    "promote",
    "sell",
  ],
  scale: [...MODULE_IDS],
};

/** The unified core bundle (owner decision, 24 Sep 2026): Understand
 *  (personas), Journeys and Create are always included; every other module is
 *  added on top by a plan or an individual add-on. */
export const CORE_MODULES: readonly ModuleId[] = ["understand", "journeys", "create"];

/**
 * One tenant's module set: the core bundle, plus the modules of its plan
 * (the operator's catalog definition when one is active, else the built-in
 * registry tier), plus the modules of its active add-ons. Deduplicated and in
 * registry order so the UI and tests see a stable list.
 */
export function entitledModules(input: {
  plan: Plan;
  catalogPlanModules?: readonly string[] | null;
  addonModules?: readonly string[];
}): ModuleId[] {
  const planModules = input.catalogPlanModules
    ? input.catalogPlanModules.filter(isModuleId)
    : modulesForPlan(input.plan);
  const wanted = new Set<string>([
    ...CORE_MODULES,
    ...planModules,
    ...(input.addonModules ?? []).filter(isModuleId),
  ]);
  return MODULE_IDS.filter((module) => wanted.has(module));
}

export function modulesForPlan(plan: Plan): readonly ModuleId[] {
  return PLAN_MODULES[plan] ?? PLAN_MODULES[DEFAULT_PLAN];
}

export function planIncludesModule(plan: Plan, module: ModuleId): boolean {
  return modulesForPlan(plan).includes(module);
}

/** The plan's capabilities — the plan half of the matrix, before any role,
 *  country or setup rule is applied. */
export function planCapabilities(plan: Plan): readonly CapabilityKey[] {
  return modulesForPlan(plan).flatMap((module) => capabilitiesOf(module));
}

// ── role × action ───────────────────────────────────────────────────────────

/** Which actions a role may perform **inside** a module it can see.
 *
 *  `lib/roles.ts` stays the canonical map for organization administration
 *  (`member.invite`, `organization.delete`, …); this is the module half of the
 *  same idea, and the two are combined by `resolveCapabilityState`.
 *
 *  member  — uses the module (view + edit).
 *  admin   — runs it: settings (`manage`) and publishing (`publish`).
 *  owner   — spends money and authorizes external spend. */
export const ROLE_MODULE_ACTIONS: Record<
  OrgRole,
  readonly CapabilityAction[]
> = {
  owner: ["view", "edit", "manage", "publish", "spend"],
  admin: ["view", "edit", "manage", "publish"],
  member: ["view", "edit"],
};

export function roleAllows(role: OrgRole, action: CapabilityAction): boolean {
  return ROLE_MODULE_ACTIONS[role]?.includes(action) ?? false;
}

export function isValidOrgRoleKey(value: string): value is OrgRole {
  return (ORG_ROLES as readonly string[]).includes(value);
}

// ── Capability states (blueprint §3) ────────────────────────────────────────

/** The states a capability can be in. `included` is the only state that may
 *  execute; the rest are honest UI states, never simulated data
 *  (`AGENTS.md` §5 rule 5). */
export const CAPABILITY_STATES = [
  "included",
  "locked",
  "needs_setup",
  "unavailable",
] as const;
export type CapabilityState = (typeof CAPABILITY_STATES)[number];

/** Why a capability is not `included` — drives the message the caller sees. */
export type CapabilityReason = "country" | "plan" | "role" | "setup" | null;

export interface CapabilityResolution {
  state: CapabilityState;
  reason: CapabilityReason;
}

export interface CapabilityInput {
  plan: Plan;
  role: OrgRole;
  module: ModuleId;
  action: CapabilityAction;
  /** ISO country code, or the default policy when omitted. */
  country?: string;
  /** False when a required connection/provider setup is missing. Writes are
   *  then `needs_setup`; reads stay available (view what you already have). */
  setup?: boolean;
  /** The tenant's resolved module set (core bundle + catalog plan + add-ons,
   *  see `entitledModules`). When present it replaces the static plan map. */
  modules?: readonly ModuleId[];
}

export function resolveCapabilityState(
  input: CapabilityInput,
): CapabilityResolution {
  const policy = countryPolicy(input.country);
  if (!policy.modules.includes(input.module)) {
    return { state: "unavailable", reason: "country" };
  }
  if (!MODULE_BY_ID[input.module].actions.includes(input.action)) {
    return { state: "unavailable", reason: "country" };
  }
  const entitled = input.modules
    ? input.modules.includes(input.module)
    : planIncludesModule(input.plan, input.module);
  if (!entitled) {
    return { state: "locked", reason: "plan" };
  }
  if (!roleAllows(input.role, input.action)) {
    return { state: "locked", reason: "role" };
  }
  if (input.setup === false && input.action !== "view") {
    return { state: "needs_setup", reason: "setup" };
  }
  return { state: "included", reason: null };
}

/** The user-facing message for a non-`included` state. Kept here so the UI and
 *  the server say the same thing, and so the plan message stays byte-identical
 *  to the one `assertModule` has always thrown. */
export function capabilityMessage(
  resolution: CapabilityResolution,
  input: Pick<CapabilityInput, "module" | "action">,
): string | null {
  switch (resolution.state) {
    case "included":
      return null;
    case "locked":
      return resolution.reason === "role"
        ? "Your role in this organization does not allow that action."
        : `Your current plan does not include "${input.module}". Upgrade to unlock it.`;
    case "needs_setup":
      return `"${input.module}" needs to be set up before you can do that.`;
    case "unavailable":
      return `"${input.module}" is not available in your country yet.`;
  }
}

// ── Country matrix (stub) ───────────────────────────────────────────────────

/** The wildcard policy used when a deployment has no country entry. */
export const DEFAULT_COUNTRY = "*";

export interface CountryPolicy {
  label: string;
  /** The modules available under this policy. */
  modules: readonly ModuleId[];
  note?: string;
}

/**
 * **Stub.** The real matrix (which countries and languages are polished at
 * launch, which add-ons are regulated) is blocked on the owner's answer to
 * `STATUS.md` §6 #4, so today there is exactly one wildcard policy and no
 * country-specific legal claim is made — inventing one is not a code decision.
 * The seam exists so the matrix can be filled in without touching the guards,
 * the UI or the tests.
 */
export const COUNTRY_MATRIX: Record<string, CountryPolicy> = {
  [DEFAULT_COUNTRY]: {
    label: "Default",
    modules: [...MODULE_IDS],
    note: "Placeholder — no country-specific restriction is modelled yet (owner decision #4).",
  },
};

export function countryPolicy(country?: string): CountryPolicy {
  const key = (country ?? DEFAULT_COUNTRY).toUpperCase();
  return (
    COUNTRY_MATRIX[key] ??
    COUNTRY_MATRIX[DEFAULT_COUNTRY] ??
    { label: "Default", modules: [] }
  );
}

// ── Module × plan × role matrix (what the UI renders) ───────────────────────

export interface ModuleCapabilityView {
  module: ModuleId;
  label: string;
  summary: string;
  state: CapabilityState;
  actions: Array<{
    action: CapabilityAction;
    capability: CapabilityKey;
    state: CapabilityState;
  }>;
}

/** The resolved matrix for one (plan, role, country) triple. A module's overall
 *  state is the best state any of its actions is in, so a `member` still sees
 *  the module as `included` (they can view and edit) even though publishing is
 *  locked for their role. */
export function capabilityMatrix(input: {
  plan: Plan;
  role: OrgRole;
  country?: string;
  setup?: boolean;
  modules?: readonly ModuleId[];
}): ModuleCapabilityView[] {
  return MODULE_DEFINITIONS.map((definition) => {
    const actions = definition.actions.map((action) => ({
      action,
      capability: capabilityKey(definition.id, action),
      state: resolveCapabilityState({
        plan: input.plan,
        role: input.role,
        module: definition.id,
        action,
        country: input.country,
        setup: input.setup,
        modules: input.modules,
      }).state,
    }));
    const state: CapabilityState = actions.some((a) => a.state === "included")
      ? "included"
      : (actions[0]?.state ?? "unavailable");
    return {
      module: definition.id,
      label: definition.label,
      summary: definition.summary,
      state,
      actions,
    };
  });
}

// ── Convex file ownership (the gate's map) ──────────────────────────────────

/** A convex file is owned by a module, or is one of the three module-independent
 *  categories:
 *
 *  - `base`    — the shared spine (projects, files, billing, organizations…).
 *                Authenticated and ownership-checked, but no single add-on owns
 *                it, so it is not capability-gated.
 *  - `service` — a cross-module service (the AI/scraping actions). It is called
 *                by several modules, declares no module and takes no record
 *                argument, so it cannot resolve a tenant; the module mutation
 *                that persists its output owns the entitlement. Revisited by
 *                T0.4 / T2.9 (`ModelGateway`), which gives these calls a
 *                server-loaded project id.
 *  - `internal`— helper/library file that must export **no** public function.
 *                The audit fails if one appears.
 */
export type FileOwner = ModuleId | "base" | "service" | "internal";

export const CONVEX_FILE_OWNERS: Record<string, FileOwner> = {
  // ── modules ──
  personas: "understand",
  personaChat: "understand",
  journeys: "journeys",
  content: "create",
  contentPlanning: "create",
  contentSources: "create",
  contentSourceImport: "create",
  communications: "create",
  "modules/video/videos": "create",
  builds: "build",
  buildPages: "build",
  buildWorkspace: "build",
  buildChat: "build",
  cms: "build",
  siteHosting: "build",
  "modules/buildApp/workspace": "build",
  "modules/buildApp/generate": "internal",
  contacts: "customers",
  posts: "promote",
  campaigns: "promote",
  "social/copilot": "promote",
  "social/executor": "promote",
  "social/oauth": "promote",
  "ads/control": "promote",
  "ads/copilot": "promote",
  "ads/oauth": "promote",
  "ads/sync": "promote",
  products: "sell",
  variants: "sell",
  media: "sell",
  collections: "sell",
  sellAI: "sell",
  "sell/queries": "sell",
  shopifySync: "sell",
  storefront: "sell",
  insights: "grow",
  connections: "grow",
  "google/insights": "grow",
  "google/oauth": "grow",
  "google/sync": "grow",

  // ── base spine ──
  projects: "base",
  files: "base",
  users: "base",
  billing: "base",
  billingPlans: "base",
  "modules/privacy/deletionJobs": "base",
  "modules/privacy/exportJobs": "base",
  "modules/privacy/obligations": "base",
  billingWebhooks: "base",
  admin: "base",
  aiModels: "base",
  aiBudget: "base",
  organizations: "base",
  // First-run starter kit (U3): spans Create, Build and Promote, so each part
  // checks its own capability inside the job; start/get are org-scoped.
  starterKit: "base",
  // U7: per-member "since you were away" timestamps and summary.
  visits: "base",
  http: "base",
  crons: "base",
  auth: "base",
  "auth.config": "base",
  "auth/emailOtp": "base",
  "auth/namecraneMailer": "internal",
  "auth/otpDelivery": "internal",
  "auth/smtpNode": "internal",
  guards: "base",
  dal: "base",
  entitlements: "base",

  // ── cross-module services ──
  ai: "service",
  research: "service",
  scraping: "service",
  buildPlan: "service",

  // ── internal helpers / libraries (no public functions) ──
  schema: "internal",
  stock: "internal", // U5: Pexels search/import and owner-photo import, internal only
  stockStore: "internal", // U5: stock cache, file rows and sweep (non-node half of stock)
  "lib/pexels": "internal", // U5: pure Pexels adapter
  "test.setup": "internal",
  buildInternals: "internal",
  cmsReleaseMigration: "internal", // internalMutation only (published → release_prepared)
  commerceEvents: "internal",
  "ads/adapters": "internal",
  "ads/credentialActions": "internal",
  "ads/credentials": "internal",
  "ads/platforms": "internal",
  "google/config": "internal",
  "google/credentials": "internal",
  "google/tokens": "internal",
  "social/adapters": "internal",
  "social/credentialActions": "internal",
  "social/copilotData": "internal",
  "social/credentials": "internal",
  "social/platforms": "internal",
  "sell/feed": "internal",
  "sell/readiness": "internal",
  "lib/dataRegistry": "internal",
  "modules/video/validators": "internal",
  "lib/modelGateway": "internal",
  "lib/dataLifecycle": "internal",
  "lib/deliveryGate": "internal",
  "lib/roles": "internal",
  "lib/safeFetch": "internal",
  "lib/capabilities": "internal",
  "lib/oauthBaseUrl": "internal",
  "lib/contextPack": "internal",
  "lib/platformAdmin": "internal",
  "lib/stripe": "internal",
  "lib/billingCatalog": "internal",
  "lib/billingReconcile": "internal",
  "lib/websiteScan": "internal",
  "lib/sourceText": "internal",
  "lib/googleMaps": "internal",
  "lib/brandDesign": "internal",
  "lib/brandProfile": "internal",
  "lib/businessProfile": "internal",
  "lib/aiModelCatalog": "internal",
  "lib/aiBudget": "internal",
  "lib/sitePaths": "internal",
  "lib/siteHtml": "internal",
  "lib/publicSites": "internal",
};

export function fileOwner(file: string): FileOwner | null {
  return CONVEX_FILE_OWNERS[file] ?? null;
}

export function filesForModule(module: ModuleId): string[] {
  return Object.entries(CONVEX_FILE_OWNERS)
    .filter(([, owner]) => owner === module)
    .map(([file]) => file)
    .sort();
}

// ── Documented exemptions ───────────────────────────────────────────────────

export interface CapabilityExemption {
  /** `<convex file>::<exported function>` — the audit's key format. */
  function: string;
  /** Why this function cannot carry a module capability. Never empty. */
  reason: string;
}

/**
 * Functions that are intentionally **not** capability-checked. Every entry needs
 * a reason and a reviewer; the audit fails on a missing/blank reason, on a stale
 * entry, and on any module write that is neither gated nor listed here. This is
 * deliberately a different (and much smaller) list than
 * `scripts/public-functions-allowlist.json`: the allow-list silences the
 * T0.6 **authorization** gate for anonymous callers, this one records why a
 * *module* function has no capability to check.
 */
export const CAPABILITY_EXEMPTIONS: readonly CapabilityExemption[] = [
  {
    function: "src/convex/ads/copilot.ts::copilotModel",
    reason:
      "Global admin setting (appSettings row), not project data: there is no tenant to resolve, and the value is a model name, not a customer fact.",
  },
  {
    function: "src/convex/ads/copilot.ts::setCopilotModel",
    reason:
      "Same global setting, guarded by the platform-admin role check. Moving it behind a module capability would let any paying tenant change an app-wide model.",
  },
  {
    function: "src/convex/sellAI.ts::generateAltText",
    reason:
      "AI proposal action with no project argument: it returns text and persists nothing, so no organization or plan can be resolved server-side. The entitlement is enforced by the Sell mutation that applies the proposal (media.setAlt).",
  },
  {
    function: "src/convex/sellAI.ts::generateSeo",
    reason:
      "AI proposal action with no project argument (same shape as generateAltText): returns seoTitle/seoDescription and writes nothing. Revisited with the server-loaded context in T0.4 / the ModelGateway in T2.9.",
  },
];

export function exemptionReason(fileFn: string): string | null {
  const entry = CAPABILITY_EXEMPTIONS.find((e) => e.function === fileFn);
  return entry ? entry.reason : null;
}

/** Module-owned convex files, for the audit's report. */
export function moduleFileCounts(): Array<{ module: ModuleId; files: number }> {
  return MODULE_IDS.map((module) => ({
    module,
    files: filesForModule(module).length,
  }));
}
