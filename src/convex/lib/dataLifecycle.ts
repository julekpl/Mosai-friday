import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { DATA_REGISTRY, SUBSCRIPTION_VERIFICATION_MAX_AGE_MS } from "./dataRegistry";

const BLOCKING_SUBSCRIPTION_STATES = new Set(["active", "trialing", "past_due", "unpaid"]);
const PAGE_SIZE = 1;
const OBLIGATION_ORGANIZATION_LIMIT = 25;
const OBLIGATION_SUBSCRIPTION_LIMIT = 100;
const OBLIGATION_SCAN_LIMIT_REASON = "Billing obligations could not all be verified within the safe inspection limit; deletion is not ready.";

type IndexQuery = {
  eq(field: string, value: unknown): IndexQuery;
  gt(field: string, value: unknown): IndexQuery;
  lt(field: string, value: unknown): IndexQuery;
};
type IndexRange = {
  first(): Promise<(Record<string, unknown> & { _id: string }) | null>;
  paginate(options: { numItems: number; cursor: string | null }): Promise<{
    page: Array<Record<string, unknown> & { _id: string }>;
    continueCursor: string;
    isDone: boolean;
  }>;
  take(count: number): Promise<Array<Record<string, unknown> & { _id: string }>>;
  first(): Promise<(Record<string, unknown> & { _id: string }) | null>;
};
type LooseDb = {
  query(table: string): {
    withIndex(index: string, callback: (q: IndexQuery) => IndexQuery): IndexRange;
  };
  get(id: string): Promise<(Record<string, unknown> & { _id: string }) | null>;
  delete(id: string): Promise<void>;
  patch(id: string, value: Record<string, unknown>): Promise<void>;
};

export type DeletionObligations = { blocked: boolean; reason?: string };
export type ObligationCursor = {
  organizationCursor: string | null;
  organizationId: string | null;
  subscriptionCursor: string | null;
  sawSubscription: boolean;
  stage: "subscription" | "customer";
};
export const EMPTY_OBLIGATION_CURSOR: ObligationCursor = {
  organizationCursor: null, organizationId: null, subscriptionCursor: null, sawSubscription: false, stage: "subscription",
};

export type DeletionCursor = {
  phase: "obligations" | "projects" | "organizations" | "account_cleanup" | "final_obligations";
  obligation: ObligationCursor;
  projectId?: string;
  projectCascade?: import("../dal").ProjectCascadeCursor;
  organizationId?: string;
  organizationRuleIndex?: number;
  accountRuleIndex?: number;
  accountPolicyIndex?: number;
  parentCursor?: string | null;
  parentId?: string | null;
  childRuleIndex?: number;
};

export const EMPTY_DELETION_CURSOR: DeletionCursor = {
  phase: "obligations", obligation: EMPTY_OBLIGATION_CURSOR,
};

type OwnershipResolution =
  | { shared: false }
  | { shared: true; successorId?: Id<"users">; reason?: string };

async function sharedOwnership(
  ctx: QueryCtx | MutationCtx,
  organizationId: Id<"organizations">,
  userId: Id<"users">,
): Promise<OwnershipResolution> {
  const db = ctx.db as unknown as LooseDb;
  const activeBefore = await db.query("memberships").withIndex("by_organization_status_user", (q) =>
    q.eq("organizationId", organizationId).eq("status", "active").lt("userId", userId),
  ).first();
  const activeAfter = await db.query("memberships").withIndex("by_organization_status_user", (q) =>
    q.eq("organizationId", organizationId).eq("status", "active").gt("userId", userId),
  ).first();
  if (!activeBefore && !activeAfter) return { shared: false };

  const otherOwners = await db.query("memberships").withIndex("by_organization_status_role_user", (q) =>
    q.eq("organizationId", organizationId).eq("status", "active").eq("role", "owner"),
  ).take(3);
  const otherOwnersExcludingCurrent = otherOwners.filter((owner) => owner.userId !== userId);
  if (otherOwnersExcludingCurrent.length > 1) {
    return { shared: true, reason: "Resolve the successor owner before account deletion: multiple other active owners remain." };
  }
  const successor = otherOwnersExcludingCurrent[0];
  if (!successor) {
    return { shared: true, reason: "Transfer organization ownership before account deletion: active members have no other active owner." };
  }
  return { shared: true, successorId: successor.userId as Id<"users"> };
}

/** Inspects one owned organization/subscription record and returns a resumable cursor. */
export async function inspectNextDeletionObligation(
  ctx: MutationCtx,
  userId: Id<"users">,
  cursor: ObligationCursor,
  now: number,
): Promise<{ cursor: ObligationCursor; done: boolean; blocked?: string }> {
  const db = ctx.db as unknown as LooseDb;
  let current = cursor;
  if (!current.organizationId) {
    const page = await db.query("organizations").withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .paginate({ numItems: PAGE_SIZE, cursor: current.organizationCursor });
    const organization = page.page[0];
    if (!organization) return { cursor: current, done: page.isDone };
    current = {
      organizationCursor: page.continueCursor,
      organizationId: organization._id,
      subscriptionCursor: null,
      sawSubscription: false,
      stage: "subscription",
    };
    return { cursor: current, done: false };
  }

  const organizationId = current.organizationId as Id<"organizations">;
  const organization = await db.get(organizationId);
  if (!organization || organization.ownerId !== userId) {
    return { cursor: { ...current, organizationId: null, subscriptionCursor: null, sawSubscription: false }, done: false };
  }
  const ownership = await sharedOwnership(ctx, organizationId, userId);
  if (ownership.shared) {
    return ownership.reason
      ? { cursor: current, done: false, blocked: `${ownership.reason} Workspace: ${organization.name}.` }
      : { cursor: { ...current, organizationId: null, subscriptionCursor: null, sawSubscription: false }, done: false };
  }

  const page = await db.query("subscriptions").withIndex("by_organization", (q) => q.eq("organizationId", organizationId)).paginate({ numItems: 1, cursor: current.subscriptionCursor });
  const subscription = page.page[0];
  if (subscription) {
    if (!subscription.lastVerifiedAt || now - Number(subscription.lastVerifiedAt) > SUBSCRIPTION_VERIFICATION_MAX_AGE_MS) return { cursor: current, done: false, blocked: `Subscription status for ${organization.name} is stale. Refresh billing status before deletion.` };
    if (BLOCKING_SUBSCRIPTION_STATES.has(String(subscription.status))) return { cursor: current, done: false, blocked: `Cancel the active ${subscription.status} subscription for ${organization.name} in the Stripe billing portal, then retry deletion after Stripe confirms cancellation.` };
    return { cursor: { ...current, subscriptionCursor: page.continueCursor, sawSubscription: true }, done: false };
  }
  if (!current.sawSubscription) {
    const customer = await db.query("billingCustomers").withIndex("by_organization", (q) => q.eq("organizationId", organizationId)).first();
    if (customer) return { cursor: current, done: false, blocked: `Subscription status for ${organization.name} could not be verified. Retry after billing is available.` };
  }
  return { cursor: { ...current, organizationId: null, subscriptionCursor: null, sawSubscription: false, stage: "subscription" }, done: false };
}

/** Retained for read-only obligation reports; the deletion worker uses the paginated inspector above. */
export async function inspectDeletionObligations(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  now: number,
): Promise<DeletionObligations> {
  const db = ctx.db as unknown as LooseDb;
  const organizations = await db.query("organizations").withIndex("by_owner", (q) => q.eq("ownerId", userId)).take(OBLIGATION_ORGANIZATION_LIMIT + 1);
  if (organizations.length > OBLIGATION_ORGANIZATION_LIMIT) return { blocked: true, reason: OBLIGATION_SCAN_LIMIT_REASON };
  let subscriptionCount = 0;
  for (const organization of organizations) {
    const organizationId = organization._id as Id<"organizations">;
    const ownership = await sharedOwnership(ctx, organizationId, userId);
    if (ownership.shared && ownership.reason) return { blocked: true, reason: `${ownership.reason} Workspace: ${organization.name}.` };
    if (ownership.shared) continue;
    const remaining = OBLIGATION_SUBSCRIPTION_LIMIT - subscriptionCount;
    const subscriptions = await db.query("subscriptions").withIndex("by_organization", (q) => q.eq("organizationId", organizationId)).take(remaining + 1);
    if (subscriptions.length > remaining) return { blocked: true, reason: OBLIGATION_SCAN_LIMIT_REASON };
    subscriptionCount += subscriptions.length;
    const customer = await db.query("billingCustomers").withIndex("by_organization", (q) => q.eq("organizationId", organizationId)).first();
    if (customer && subscriptions.length === 0) return { blocked: true, reason: `Subscription status for ${organization.name} could not be verified.` };
    for (const subscription of subscriptions) {
      if (!subscription.lastVerifiedAt || now - Number(subscription.lastVerifiedAt) > SUBSCRIPTION_VERIFICATION_MAX_AGE_MS) return { blocked: true, reason: `Subscription status for ${organization.name} is stale.` };
      if (BLOCKING_SUBSCRIPTION_STATES.has(String(subscription.status))) return { blocked: true, reason: `Cancel the active subscription for ${organization.name} in the Stripe billing portal.` };
    }
  }
  return { blocked: false };
}

/** Selects or transfers one project owned by the departing user. */
export async function prepareNextOwnedProject(
  ctx: MutationCtx,
  userId: Id<"users">,
): Promise<{ projectId?: Id<"projects">; progressed: boolean; blocked?: string }> {
  const project = await ctx.db.query("projects").withIndex("by_owner", (q) => q.eq("ownerId", userId)).first();
  if (!project) return { progressed: false };
  if (project.organizationId) {
    const organization = await (ctx.db as unknown as LooseDb).get(String(project.organizationId));
    if (organization) {
      const ownership = await sharedOwnership(ctx, organization._id as Id<"organizations">, userId);
      if (ownership.shared && ownership.reason) return { progressed: false, blocked: `${ownership.reason} Workspace: ${organization.name}.` };
      if (ownership.shared && ownership.successorId) {
        await ctx.db.patch(project._id, { ownerId: ownership.successorId });
        return { progressed: true };
      }
    }
  }
  return { projectId: project._id, progressed: true };
}

export type OrganizationCleanupCursor = { organizationId?: string; ruleIndex: number };

async function billingDeletionBlock(
  db: LooseDb,
  organizationId: Id<"organizations">,
  name: string,
  now = Date.now(),
): Promise<string | undefined> {
  const subscriptions = await db.query("subscriptions").withIndex("by_organization", (q) => q.eq("organizationId", organizationId)).take(101);
  if (subscriptions.length > 100) return `Subscription records for ${name} exceed the safe deletion check limit. Retry after billing records are reconciled.`;
  for (const subscription of subscriptions) {
    if (!subscription.lastVerifiedAt || now - Number(subscription.lastVerifiedAt) > SUBSCRIPTION_VERIFICATION_MAX_AGE_MS) return `Subscription status for ${name} is stale. Refresh billing status before deletion.`;
    if (BLOCKING_SUBSCRIPTION_STATES.has(String(subscription.status))) return `Cancel the active ${subscription.status} subscription for ${name} in the Stripe billing portal, then retry deletion after Stripe confirms cancellation.`;
  }
  if (subscriptions.length === 0) {
    const customer = await db.query("billingCustomers").withIndex("by_organization", (q) => q.eq("organizationId", organizationId)).first();
    if (customer) return `Subscription status for ${name} could not be verified. Retry after billing is available.`;
  }
  return undefined;
}

export async function cleanupNextOwnedOrganization(
  ctx: MutationCtx,
  userId: Id<"users">,
  cursor: OrganizationCleanupCursor,
): Promise<{ cursor: OrganizationCleanupCursor; progressed: boolean; done: boolean; projectId?: Id<"projects">; blocked?: string }> {
  const db = ctx.db as unknown as LooseDb;
  const organization = cursor.organizationId
    ? await db.get(cursor.organizationId)
    : await ctx.db.query("organizations").withIndex("by_owner", (q) => q.eq("ownerId", userId)).first();
  if (!organization) return { cursor: { ruleIndex: 0 }, progressed: false, done: true };
  const organizationId = organization._id as Id<"organizations">;
  if (organization.ownerId !== userId) {
    return { cursor: { ruleIndex: 0 }, progressed: true, done: false };
  }
  const ownership = await sharedOwnership(ctx, organizationId, userId);
  if (ownership.shared && ownership.reason) return { cursor, progressed: false, done: false, blocked: `${ownership.reason} Workspace: ${organization.name}.` };
  if (ownership.shared && ownership.successorId) {
    await ctx.db.patch(organizationId, { ownerId: ownership.successorId, updatedAt: Date.now() });
    return { cursor: { ruleIndex: 0 }, progressed: true, done: false };
  }

  const entries = Object.entries(DATA_REGISTRY).filter(([, entry]) => entry.scope === "organization" && (entry.deletion.kind === "organization-policy" || entry.deletion.kind === "organization-links"));
  // A checkout can be started by another active organization member while
  // deletion is running. Recheck the billing mirror at the billing-row step.
  const activeEntry = entries[cursor.ruleIndex];
  if (activeEntry && ["billingCustomers", "subscriptions", "billingInvoices"].includes(activeEntry[0])) {
    const blocked = await billingDeletionBlock(db, organizationId, String(organization.name));
    if (blocked) return { cursor, progressed: false, done: false, blocked };
  }

  const [table, entry] = entries[cursor.ruleIndex] ?? [];
  if (table && entry) {
    const db = ctx.db as unknown as LooseDb;
    const rule = entry.deletion;
    if (rule.kind === "organization-policy") {
      const row = await db.query(table).withIndex(rule.index, (q) => q.eq(rule.field, organizationId)).first();
      if (row) await db.delete(row._id);
      else return { cursor: { organizationId: String(organizationId), ruleIndex: cursor.ruleIndex + 1 }, progressed: true, done: false };
      return { cursor: { organizationId: String(organizationId), ruleIndex: cursor.ruleIndex }, progressed: true, done: false };
    }
    if (rule.kind === "organization-links") {
      const agencyLink = await db.query(table).withIndex(rule.agencyIndex, (q) => q.eq(rule.agencyField, organizationId)).first();
      const clientLink = agencyLink ? null : await db.query(table).withIndex(rule.clientIndex, (q) => q.eq(rule.clientField, organizationId)).first();
      const link = agencyLink ?? clientLink;
      if (link) await db.delete(link._id);
      else return { cursor: { organizationId: String(organizationId), ruleIndex: cursor.ruleIndex + 1 }, progressed: true, done: false };
      return { cursor: { organizationId: String(organizationId), ruleIndex: cursor.ruleIndex }, progressed: true, done: false };
    }
  }
  if (cursor.ruleIndex === entries.length) {
    const membership = await db.query("memberships").withIndex("by_organization", (q) => q.eq("organizationId", organizationId)).first();
    if (membership) {
      const ruleIndex = entries.findIndex(([table]) => table === "memberships");
      return { cursor: { organizationId: String(organizationId), ruleIndex }, progressed: true, done: false };
    }
    const blocked = await billingDeletionBlock(db, organizationId, String(organization.name));
    if (blocked) return { cursor, progressed: false, done: false, blocked };
    await db.delete(organizationId);
    return { cursor: { ruleIndex: 0 }, progressed: true, done: false };
  }
  return {
    cursor,
    progressed: false,
    done: false,
    blocked: "Organization deletion cursor is invalid. Resume with a valid lifecycle cursor before retrying deletion.",
  };
}

export type AccountCleanupCursor = {
  ruleIndex: number;
  policyIndex: number;
  parentCursor: string | null;
  parentId: string | null;
  childRuleIndex: number;
};

export const EMPTY_ACCOUNT_CLEANUP_CURSOR: AccountCleanupCursor = {
  ruleIndex: 0, policyIndex: 0, parentCursor: null, parentId: null, childRuleIndex: 0,
};

/** Executes one user-row cleanup step declared by the central data registry. */
export async function cleanupNextAccountRow(
  ctx: MutationCtx,
  userId: Id<"users">,
  cursor: AccountCleanupCursor,
): Promise<{ cursor: AccountCleanupCursor; progressed: boolean; done: boolean }> {
  const cleanupEntries = Object.entries(DATA_REGISTRY)
    .flatMap(([table, entry]) => (entry.accountCleanup ?? []).filter((rule) => rule.kind !== "lifecycle").map((rule) => ({ table, rule })));
  const item = cleanupEntries[cursor.ruleIndex];
  if (!item) return { cursor, progressed: false, done: true };
  const { table, rule } = item;
  const db = ctx.db as unknown as LooseDb;
  if (rule.kind === "index") {
    const user = rule.source === "email" ? await ctx.db.get(userId) : null;
    const value = rule.source === "email" ? user?.email?.trim().toLowerCase() : userId;
    if (!value) return { cursor: { ...cursor, ruleIndex: cursor.ruleIndex + 1, policyIndex: 0 }, progressed: true, done: false };
      const row = await db.query(table).withIndex(rule.index, (q) => q.eq(rule.field, value)).first();
    if (row) await db.delete(row._id);
    else return { cursor: { ...cursor, ruleIndex: cursor.ruleIndex + 1, policyIndex: 0 }, progressed: true, done: false };
    return { cursor, progressed: true, done: false };
  }
  if (rule.kind === "parent-children") {
    if (!cursor.parentId) {
      const page = await db.query(table).withIndex(rule.parentIndex, (q) => q.eq(rule.parentField, userId)).paginate({ numItems: PAGE_SIZE, cursor: cursor.parentCursor });
      if (!page.page[0]) {
        if (!page.isDone) return { cursor: { ...cursor, parentCursor: page.continueCursor }, progressed: true, done: false };
        return { cursor: { ...cursor, ruleIndex: cursor.ruleIndex + 1, policyIndex: 0, parentCursor: null }, progressed: true, done: false };
      }
      return { cursor: { ...cursor, parentId: page.page[0]._id, parentCursor: page.continueCursor, childRuleIndex: 0 }, progressed: true, done: false };
    }
    const parent = await db.get(cursor.parentId);
    if (!parent) return { cursor: { ...cursor, parentId: null, childRuleIndex: 0 }, progressed: true, done: false };
    const child = rule.children[cursor.childRuleIndex];
    if (child) {
      const row = await db.query(child.table).withIndex(child.index, (q) => q.eq(child.field, cursor.parentId)).first();
      if (row) await db.delete(row._id);
      else return { cursor: { ...cursor, childRuleIndex: cursor.childRuleIndex + 1 }, progressed: true, done: false };
      return { cursor, progressed: true, done: false };
    }
    await db.delete(cursor.parentId);
    return { cursor: { ...cursor, parentId: null, childRuleIndex: 0 }, progressed: true, done: false };
  }
  if (rule.kind === "export-jobs") {
    if (!cursor.parentId) {
      for (const kind of rule.parentKinds) {
        const parent = await db.query("privacyJobs").withIndex("by_user_kind", (q) => q.eq(rule.parentField, userId).eq(rule.parentKindField, kind)).first();
        if (parent) return { cursor: { ...cursor, parentId: parent._id }, progressed: true, done: false };
      }
      return { cursor: { ...cursor, ruleIndex: cursor.ruleIndex + 1, parentId: null }, progressed: true, done: false };
    }
    const chunk = await db.query(table).withIndex(rule.childIndex, (q) => q.eq(rule.childField, cursor.parentId)).first();
    if (chunk) await db.delete(chunk._id);
    else {
      await db.delete(cursor.parentId);
      return { cursor: { ...cursor, parentId: null }, progressed: true, done: false };
    }
    return { cursor, progressed: true, done: false };
  }
  return { cursor: { ...cursor, ruleIndex: cursor.ruleIndex + 1 }, progressed: true, done: false };
}

/** Registry table set used by export jobs and the project deletion engine. */
export const EXPORTABLE_PROJECT_TABLES = Object.entries(DATA_REGISTRY)
  .filter(([, entry]) => entry.scope === "project" && entry.export === "included")
  .map(([table]) => table);
