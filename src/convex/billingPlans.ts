import { v } from "convex/values";
import {
  internalQuery,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { operatorEmailFor, requirePlatformAdmin, requireUser } from "./guards";
import {
  CORE_MODULES,
  MODULE_DEFINITIONS,
  PLANS,
  isModuleId,
  modulesForPlan,
  type ModuleId,
} from "./lib/capabilities";

/**
 * Plan & add-on catalog (owner decision, 24 Sep 2026).
 *
 * - Understand, Journeys and Create are the always-included core bundle.
 * - Everything else is sold as a plan (a bundle of modules) or as individual
 *   add-ons the customer mixes and matches.
 * - The platform admin creates and edits plans/add-ons here: name, modules,
 *   price (integer minor units + ISO currency), interval, Stripe price id,
 *   trial days, highlights, status and order.
 *
 * A catalog row never grants anything by itself. Entitlement comes only from
 * a verified Stripe subscription item (billingWebhooks) or an audited operator
 * grant (`grantAddon`). Draft rows are never shown to customers or honoured.
 */

const MAX_ROWS = 60;
const KEY_PATTERN = /^[a-z][a-z0-9-]{1,39}$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const STRIPE_PRICE_PATTERN = /^price_[A-Za-z0-9_]{3,100}$/;

async function recordAudit(
  ctx: MutationCtx,
  actorId: Id<"users">,
  action: string,
  targetType: string,
  targetId: string | undefined,
  detail: string,
) {
  await ctx.db.insert("adminAuditLog", {
    actorId,
    actorEmail: (await operatorEmailFor(ctx, actorId)) ?? undefined,
    action,
    targetType,
    targetId,
    detail: detail.slice(0, 500),
    createdAt: Date.now(),
  });
}

function moduleLabel(module: ModuleId): string {
  return MODULE_DEFINITIONS.find((definition) => definition.id === module)?.label ?? module;
}

function publicRow(row: Doc<"billingPlans">) {
  const modules = row.modules.filter(isModuleId);
  return {
    key: row.key,
    kind: row.kind,
    name: row.name,
    description: row.description,
    priceMinor: row.priceMinor,
    currency: row.currency,
    interval: row.interval,
    trialDays: row.trialDays,
    highlights: row.highlights,
    purchasable: Boolean(row.stripePriceId),
    modules: modules.map((module) => ({ id: module, label: moduleLabel(module) })),
  };
}

/* ── Customer-facing catalog ────────────────────────────────────────────── */

/** Active plans and add-ons for the Billing page, plus the core bundle. */
export const publicCatalog = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const rows = (await ctx.db.query("billingPlans").take(MAX_ROWS))
      .filter((row) => row.status === "active")
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
    return {
      core: CORE_MODULES.map((module) => ({ id: module, label: moduleLabel(module) })),
      plans: rows.filter((row) => row.kind === "plan").map(publicRow),
      addons: rows.filter((row) => row.kind === "addon").map(publicRow),
    };
  },
});

/** Server-side lookup for checkout / add-on purchase / webhook mapping. */
export const rowsForKeys = internalQuery({
  args: { keys: v.array(v.string()) },
  handler: async (ctx, { keys }) => {
    const out: Doc<"billingPlans">[] = [];
    for (const key of keys.slice(0, 20)) {
      const row = await ctx.db
        .query("billingPlans")
        .withIndex("by_key", (q) => q.eq("key", key))
        .unique();
      if (row) out.push(row);
    }
    return out;
  },
});

/** Every non-draft catalog row that has a Stripe price (webhook + reconcile). */
export const catalogPriceRows = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("billingPlans").take(MAX_ROWS);
    return rows
      .filter((row) => row.status !== "draft" && row.stripePriceId)
      .map((row) => ({ key: row.key, kind: row.kind, stripePriceId: row.stripePriceId as string }));
  },
});

/* ── Operator: catalog management ──────────────────────────────────────── */

export const adminList = query({
  args: {},
  handler: async (ctx) => {
    await requirePlatformAdmin(ctx);
    const rows = await ctx.db.query("billingPlans").take(MAX_ROWS);
    return {
      rows: rows.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
      modules: MODULE_DEFINITIONS.map((definition) => ({
        id: definition.id,
        label: definition.label,
        core: CORE_MODULES.includes(definition.id),
      })),
    };
  },
});

const rowFields = {
  key: v.string(),
  kind: v.union(v.literal("plan"), v.literal("addon")),
  name: v.string(),
  description: v.optional(v.string()),
  modules: v.array(v.string()),
  priceMinor: v.number(),
  currency: v.string(),
  interval: v.union(v.literal("month"), v.literal("year")),
  stripePriceId: v.optional(v.string()),
  trialDays: v.optional(v.number()),
  highlights: v.array(v.string()),
  status: v.union(v.literal("draft"), v.literal("active"), v.literal("archived")),
  sortOrder: v.number(),
};

type RowInput = {
  key: string;
  kind: "plan" | "addon";
  name: string;
  description?: string;
  modules: string[];
  priceMinor: number;
  currency: string;
  interval: "month" | "year";
  stripePriceId?: string;
  trialDays?: number;
  highlights: string[];
  status: "draft" | "active" | "archived";
  sortOrder: number;
};

/** Validate and normalise an operator's catalog row. Throws plain-language errors. */
export function normaliseCatalogRow(input: RowInput) {
  const key = input.key.trim().toLowerCase();
  if (!KEY_PATTERN.test(key)) {
    throw new Error("Key: 2–40 lowercase letters, digits or dashes, starting with a letter.");
  }
  const name = input.name.trim().slice(0, 60);
  if (!name) throw new Error("Give it a name customers will see.");
  const modules = [...new Set(input.modules.filter(isModuleId))];
  const sellable = modules.filter((module) => !CORE_MODULES.includes(module));
  if (input.kind === "addon" && sellable.length === 0) {
    throw new Error("An add-on must unlock at least one tool outside the core bundle.");
  }
  if (!Number.isSafeInteger(input.priceMinor) || input.priceMinor < 0 || input.priceMinor > 10_000_000) {
    throw new Error("Price must be a whole number of cents between 0 and 100,000.00.");
  }
  const currency = input.currency.trim().toUpperCase();
  if (!CURRENCY_PATTERN.test(currency)) throw new Error("Currency must be a 3-letter code like EUR.");
  const stripePriceId = input.stripePriceId?.trim() || undefined;
  if (stripePriceId && !STRIPE_PRICE_PATTERN.test(stripePriceId)) {
    throw new Error("Stripe price ids look like price_…");
  }
  if (input.status === "active" && input.priceMinor > 0 && !stripePriceId) {
    throw new Error("A paid plan needs its Stripe price id before it can be active. Save it as a draft for now.");
  }
  const trialDays =
    input.trialDays !== undefined && Number.isInteger(input.trialDays) && input.trialDays > 0
      ? Math.min(input.trialDays, 90)
      : undefined;
  return {
    key,
    kind: input.kind,
    name,
    description: input.description?.trim().slice(0, 240) || undefined,
    modules,
    priceMinor: input.priceMinor,
    currency,
    interval: input.interval,
    stripePriceId,
    trialDays,
    highlights: input.highlights.map((item) => item.trim().slice(0, 120)).filter(Boolean).slice(0, 8),
    status: input.status,
    sortOrder: Number.isFinite(input.sortOrder) ? Math.round(input.sortOrder) : 0,
  };
}

export const adminSave = mutation({
  args: { id: v.optional(v.id("billingPlans")), ...rowFields },
  handler: async (ctx, { id, ...input }) => {
    const actorId = await requirePlatformAdmin(ctx);
    const row = normaliseCatalogRow(input);
    const clash = await ctx.db
      .query("billingPlans")
      .withIndex("by_key", (q) => q.eq("key", row.key))
      .unique();
    if (clash && clash._id !== id) throw new Error(`The key "${row.key}" is already used.`);
    if (row.stripePriceId) {
      const priceClash = await ctx.db
        .query("billingPlans")
        .withIndex("by_stripe_price", (q) => q.eq("stripePriceId", row.stripePriceId))
        .first();
      if (priceClash && priceClash._id !== id) {
        throw new Error(`That Stripe price is already used by "${priceClash.name}".`);
      }
    }
    const now = Date.now();
    if (id) {
      const existing = await ctx.db.get(id);
      if (!existing) throw new Error("Not found");
      if (existing.key !== row.key) {
        throw new Error("The key can't change once created (customers may already hold it). Create a new row instead.");
      }
      await ctx.db.patch(id, { ...row, updatedAt: now, updatedBy: actorId });
      await recordAudit(ctx, actorId, "catalog.update", "billingPlans", id, `${row.key}; status=${row.status}; price=${row.priceMinor} ${row.currency}/${row.interval}`);
      return id;
    }
    if ((await ctx.db.query("billingPlans").take(MAX_ROWS + 1)).length >= MAX_ROWS) {
      throw new Error(`Up to ${MAX_ROWS} plans and add-ons can be listed.`);
    }
    const newId = await ctx.db.insert("billingPlans", { ...row, createdAt: now, updatedAt: now, updatedBy: actorId });
    await recordAudit(ctx, actorId, "catalog.create", "billingPlans", newId, `${row.key}; kind=${row.kind}; status=${row.status}`);
    return newId;
  },
});

/**
 * Create draft rows that mirror today's built-in tiers plus one add-on per
 * tool outside the core bundle, so the operator starts from something real.
 * Existing keys are left untouched. Prices are 0 and every row is a draft.
 */
export const adminSeedDefaults = mutation({
  args: { currency: v.optional(v.string()) },
  handler: async (ctx, { currency }) => {
    const actorId = await requirePlatformAdmin(ctx);
    const code = (currency ?? "EUR").trim().toUpperCase();
    if (!CURRENCY_PATTERN.test(code)) throw new Error("Currency must be a 3-letter code like EUR.");
    const now = Date.now();
    let created = 0;
    const insertIfMissing = async (row: Omit<Doc<"billingPlans">, "_id" | "_creationTime" | "createdAt" | "updatedAt" | "updatedBy">) => {
      const existing = await ctx.db
        .query("billingPlans")
        .withIndex("by_key", (q) => q.eq("key", row.key))
        .unique();
      if (existing) return;
      await ctx.db.insert("billingPlans", { ...row, createdAt: now, updatedAt: now, updatedBy: actorId });
      created += 1;
    };
    let order = 0;
    for (const plan of PLANS) {
      await insertIfMissing({
        key: plan,
        kind: "plan",
        name: plan === "free" ? "Core" : `${plan.charAt(0).toUpperCase()}${plan.slice(1)}`,
        description: plan === "free" ? "Customer profiles, journeys and content." : undefined,
        modules: [...modulesForPlan(plan)],
        priceMinor: 0,
        currency: code,
        interval: "month",
        highlights: [],
        status: plan === "free" ? "active" : "draft",
        sortOrder: (order += 10),
      });
    }
    for (const definition of MODULE_DEFINITIONS) {
      if (CORE_MODULES.includes(definition.id)) continue;
      await insertIfMissing({
        key: `addon-${definition.id}`,
        kind: "addon",
        name: definition.label,
        description: definition.summary,
        modules: [definition.id],
        priceMinor: 0,
        currency: code,
        interval: "month",
        highlights: [],
        status: "draft",
        sortOrder: (order += 10),
      });
    }
    await recordAudit(ctx, actorId, "catalog.seed", "billingPlans", undefined, `created=${created}`);
    return { created };
  },
});

/* ── Operator: grant / revoke add-ons (manual mix and match) ───────────── */

export const adminOrganizationAddons = query({
  args: { organizationId: v.id("organizations") },
  handler: async (ctx, { organizationId }) => {
    await requirePlatformAdmin(ctx);
    return await ctx.db
      .query("organizationAddons")
      .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
      .take(50);
  },
});

/** Give an organization an add-on without payment (a comp, a pilot, a fix).
 *  Audited, reason required, never presented as a Stripe purchase. */
export const grantAddon = mutation({
  args: { organizationId: v.id("organizations"), addonKey: v.string(), reason: v.string() },
  handler: async (ctx, { organizationId, addonKey, reason }) => {
    const actorId = await requirePlatformAdmin(ctx);
    const why = reason.trim();
    if (why.length < 3) throw new Error("A reason is required.");
    if (!(await ctx.db.get(organizationId))) throw new Error("Not found");
    const row = await ctx.db
      .query("billingPlans")
      .withIndex("by_key", (q) => q.eq("key", addonKey))
      .unique();
    if (!row || row.kind !== "addon" || row.status === "draft") {
      throw new Error("Only active or archived add-ons can be granted.");
    }
    const existing = await ctx.db
      .query("organizationAddons")
      .withIndex("by_organization_addon", (q) => q.eq("organizationId", organizationId).eq("addonKey", addonKey))
      .first();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, { status: "active", source: "operator", reason: why.slice(0, 200), grantedBy: actorId, updatedAt: now });
    } else {
      await ctx.db.insert("organizationAddons", {
        organizationId,
        addonKey,
        status: "active",
        source: "operator",
        reason: why.slice(0, 200),
        grantedBy: actorId,
        createdAt: now,
        updatedAt: now,
      });
    }
    await recordAudit(ctx, actorId, "organization.grant_addon", "organizations", organizationId, `${addonKey}; ${why}`);
  },
});

/** Remove an operator-granted add-on. Stripe-sourced add-ons are changed in
 *  Stripe (the webhook keeps this table in step), never here. */
export const revokeAddon = mutation({
  args: { organizationId: v.id("organizations"), addonKey: v.string(), reason: v.string() },
  handler: async (ctx, { organizationId, addonKey, reason }) => {
    const actorId = await requirePlatformAdmin(ctx);
    const why = reason.trim();
    if (why.length < 3) throw new Error("A reason is required.");
    const existing = await ctx.db
      .query("organizationAddons")
      .withIndex("by_organization_addon", (q) => q.eq("organizationId", organizationId).eq("addonKey", addonKey))
      .first();
    if (!existing || existing.status !== "active") return;
    if (existing.source === "stripe") {
      throw new Error("This add-on is paid through Stripe. Change the subscription in Stripe instead.");
    }
    await ctx.db.patch(existing._id, { status: "canceled", updatedAt: Date.now() });
    await recordAudit(ctx, actorId, "organization.revoke_addon", "organizations", organizationId, `${addonKey}; ${why}`);
  },
});
