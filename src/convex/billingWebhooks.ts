import { v } from "convex/values";
import {
  internalMutation,
  type MutationCtx,
} from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import {
  MOSAI_ORG_METADATA_KEY,
  MOSAI_PLAN_METADATA_KEY,
  WIND_DOWN_GRACE_MS,
  planForSubscription,
  planStatusForState,
  stateIsEntitled,
} from "./lib/billingCatalog";
import { reconcileBilling } from "./lib/billingReconcile";
import { isPlan } from "./lib/capabilities";

/**
 * Billing webhook apply (MOSAI pack T2.4).
 *
 * The **only** code that may move the local plan mirror in response to Stripe.
 * The HTTP route in `http.ts` verifies the signature and calls `applyEvent`;
 * the reconciliation job calls `applyReconciliation`. Both are internal — a
 * client cannot reach them (`AGENTS.md` §5 rules 2/5).
 *
 * Truth guarantees:
 *   - **Idempotent**: `billingEvents.eventId` is the unique provider event id.
 *     A duplicate delivery finds the row and returns without touching anything.
 *   - **Out-of-order safe**: a subscription event older than the last applied
 *     one (`subscriptions.lastEventCreated`) is a no-op, so a late replay
 *     cannot un-do a newer state.
 *   - **Receipts**: a handler that claims money moved inserts a
 *     `billingReceipts` row sourced from the event.
 *   - **Nothing is invented**: an unknown price maps to `free`, never a guess.
 */

// ── Stripe object shapes (loose: only the fields we read) ───────────────────

interface StripeObject {
  id?: string;
  object?: string;
  customer?: string | { id?: string };
  subscription?: string | { id?: string };
  client_reference_id?: string;
  status?: string;
  metadata?: Record<string, string> | null;
  current_period_end?: number;
  cancel_at_period_end?: boolean;
  next_payment_attempt?: number | null;
  attempt_count?: number;
  amount_due?: number;
  amount_paid?: number;
  currency?: string;
  hosted_invoice_url?: string | null;
  paid?: boolean;
  items?: {
    data?: Array<{
      price?: {
        id?: string;
        metadata?: Record<string, string> | null;
      };
    }>;
  };
  subscription_details?: { metadata?: Record<string, string> | null } | null;
}

function idOf(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "id" in value) {
    const id = (value as { id?: unknown }).id;
    return typeof id === "string" ? id : undefined;
  }
  return undefined;
}

function metadataOrganizationId(data: StripeObject): string | undefined {
  const fromMetadata = data.metadata?.[MOSAI_ORG_METADATA_KEY];
  if (fromMetadata) return fromMetadata;
  const fromSubscriptionDetails =
    data.subscription_details?.metadata?.[MOSAI_ORG_METADATA_KEY];
  if (fromSubscriptionDetails) return fromSubscriptionDetails;
  return data.client_reference_id ?? undefined;
}

async function asOrganizationId(
  ctx: MutationCtx,
  raw: string | undefined,
): Promise<Id<"organizations"> | null> {
  if (!raw) return null;
  const organization = await ctx.db.get(raw as Id<"organizations">);
  return organization ? organization._id : null;
}

/** The subscription that governs an organization's entitlement: an entitling
 *  one if present, then a warning state, then wind-down, then terminal. */
async function governingSubscription(
  ctx: MutationCtx,
  organizationId: Id<"organizations">,
) {
  const rows = await ctx.db
    .query("subscriptions")
    .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
    .collect();
  const rank = (status: string) =>
    status === "active" || status === "trialing"
      ? 0
      : status === "past_due" || status === "unpaid"
        ? 1
        : status === "wind_down"
          ? 2
          : 3;
  return [...rows].sort((a, b) => rank(a.status) - rank(b.status))[0] ?? null;
}

/** Write the local entitlement mirror (the org owner's `plan`/`planStatus`,
 *  which is exactly what `guards.planForOrganization` reads). */
async function syncEntitlement(
  ctx: MutationCtx,
  organizationId: Id<"organizations">,
): Promise<{ plan: string; planStatus: string }> {
  const organization = await ctx.db.get(organizationId);
  if (!organization) return { plan: "free", planStatus: "canceled" };
  const governing = await governingSubscription(ctx, organizationId);

  const plan =
    governing && stateIsEntitled(governing.status) && isPlan(governing.plan)
      ? governing.plan
      : "free";
  const planStatus = governing
    ? planStatusForState(governing.status)
    : "canceled";

  await ctx.db.patch(organization.ownerId, { plan, planStatus });
  return { plan, planStatus };
}

interface ApplyOutcome {
  status: "processed" | "ignored" | "failed";
  note?: string;
}

async function insertReceipt(
  ctx: MutationCtx,
  input: {
    objectType: string;
    objectId: string;
    eventId: string;
    eventType: string;
    organizationId?: Id<"organizations">;
    amountMinor?: number;
    currency?: string;
    livemode: boolean;
  },
) {
  await ctx.db.insert("billingReceipts", {
    provider: "stripe",
    objectType: input.objectType,
    objectId: input.objectId,
    eventId: input.eventId,
    eventType: input.eventType,
    organizationId: input.organizationId,
    amountMinor: input.amountMinor,
    currency: input.currency,
    livemode: input.livemode,
    createdAt: Date.now(),
  });
}

// ── Subscription upsert ─────────────────────────────────────────────────────

async function upsertSubscription(
  ctx: MutationCtx,
  input: {
    subscription: StripeObject;
    eventCreated: number;
    eventId: string;
    livemode: boolean;
  },
): Promise<ApplyOutcome> {
  const subscriptionId = input.subscription.id;
  if (!subscriptionId) return { status: "ignored", note: "no subscription id" };

  const organizationId = await asOrganizationId(
    ctx,
    metadataOrganizationId(input.subscription),
  );
  if (!organizationId) {
    return {
      status: "ignored",
      note: "subscription has no MOSAI organization metadata",
    };
  }

  const price = input.subscription.items?.data?.[0]?.price;
  const plan = planForSubscription({
    priceId: price?.id,
    planMetadata:
      input.subscription.metadata?.[MOSAI_PLAN_METADATA_KEY] ??
      price?.metadata?.[MOSAI_PLAN_METADATA_KEY],
  });

  const existing = await ctx.db
    .query("subscriptions")
    .withIndex("by_subscription", (q) => q.eq("subscriptionId", subscriptionId))
    .first();

  // Out-of-order guard: an older event changes nothing.
  if (existing && input.eventCreated < existing.lastEventCreated) {
    return { status: "ignored", note: "out-of-order delivery" };
  }

  const customerId =
    idOf(input.subscription.customer) ?? existing?.customerId ?? null;
  const status = input.subscription.status ?? existing?.status ?? "incomplete";
  const now = Date.now();
  const patch = {
    organizationId,
    provider: "stripe" as const,
    subscriptionId,
    customerId: customerId ?? "",
    priceId: price?.id,
    plan,
    status,
    livemode: input.livemode,
    currentPeriodEnd: input.subscription.current_period_end
      ? input.subscription.current_period_end * 1000
      : existing?.currentPeriodEnd,
    cancelAtPeriodEnd: input.subscription.cancel_at_period_end ?? false,
    // A warning state starts the wind-down clock once; a good state clears it.
    windDownAt:
      status === "past_due" || status === "unpaid"
        ? (existing?.windDownAt ?? now + WIND_DOWN_GRACE_MS)
        : undefined,
    dunningStage: existing?.dunningStage ?? 0,
    lastEventCreated: input.eventCreated,
    lastEventId: input.eventId,
    updatedAt: now,
  };

  if (existing) {
    await ctx.db.patch(existing._id, patch);
  } else {
    await ctx.db.insert("subscriptions", {
      ...patch,
      createdAt: now,
    });
  }

  await syncEntitlement(ctx, organizationId);
  return { status: "processed", note: `subscription ${status}` };
}

// ── Checkout / invoice handlers ─────────────────────────────────────────────

async function handleCheckoutCompleted(
  ctx: MutationCtx,
  input: {
    eventId: string;
    type: string;
    created: number;
    livemode: boolean;
    data: StripeObject;
  },
): Promise<ApplyOutcome> {
  const organizationId = await asOrganizationId(
    ctx,
    metadataOrganizationId(input.data),
  );
  if (!organizationId) {
    return { status: "ignored", note: "checkout has no organization metadata" };
  }
  const customerId = idOf(input.data.customer);
  if (customerId) {
    const existing = await ctx.db
      .query("billingCustomers")
      .withIndex("by_customer", (q) => q.eq("customerId", customerId))
      .first();
    if (!existing) {
      await ctx.db.insert("billingCustomers", {
        organizationId,
        provider: "stripe",
        customerId,
        livemode: input.livemode,
        createdBy: (await ctx.db.get(organizationId))!.ownerId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }
  }

  await insertReceipt(ctx, {
    objectType: "checkout.session",
    objectId: input.data.id ?? "unknown",
    eventId: input.eventId,
    eventType: input.type,
    organizationId,
    amountMinor: input.data.amount_paid,
    currency: input.data.currency,
    livemode: input.livemode,
  });

  // Deliberately does NOT grant a plan. A completed checkout is a receipt, not
  // an entitlement: `customer.subscription.*` is what writes the mirror. This
  // is the "a browser redirect alone never grants a plan" rule made structural.
  return {
    status: "processed",
    note: "checkout recorded; entitlement waits for the subscription event",
  };
}

async function handleInvoice(
  ctx: MutationCtx,
  input: {
    eventId: string;
    type: string;
    created: number;
    livemode: boolean;
    data: StripeObject;
    paid: boolean;
  },
): Promise<ApplyOutcome> {
  const invoiceId = input.data.id;
  if (!invoiceId) return { status: "ignored", note: "no invoice id" };

  const subscriptionId = idOf(input.data.subscription);
  const subscriptionRow = subscriptionId
    ? await ctx.db
        .query("subscriptions")
        .withIndex("by_subscription", (q) =>
          q.eq("subscriptionId", subscriptionId),
        )
        .first()
    : null;
  // Defect fix (T2.4): an invoice event can arrive before its subscription is
  // mirrored (out-of-order delivery across object types). `syncEntitlement`
  // below would then find no governing subscription and downgrade the mirror
  // to `free` — a real customer losing access because a delivery raced. Until
  // the subscription is mirrored, the invoice is ignored; its own event is the
  // one that resolves entitlement.
  if (subscriptionId && !subscriptionRow) {
    return {
      status: "ignored",
      note: "invoice arrived before its subscription was mirrored",
    };
  }

  let organizationId = await asOrganizationId(
    ctx,
    metadataOrganizationId(input.data),
  );
  organizationId = organizationId ?? subscriptionRow?.organizationId ?? null;
  if (!organizationId) {
    return { status: "ignored", note: "invoice has no resolvable organization" };
  }

  const now = Date.now();
  const status = input.data.status ?? (input.paid ? "paid" : "open");
  const existing = await ctx.db
    .query("billingInvoices")
    .withIndex("by_invoice", (q) => q.eq("invoiceId", invoiceId))
    .first();
  const attemptCount = input.data.attempt_count ?? existing?.attemptCount ?? 0;
  const patch = {
    organizationId,
    subscriptionId,
    invoiceId,
    status,
    amountDueMinor: input.data.amount_due ?? existing?.amountDueMinor ?? 0,
    amountPaidMinor: input.data.amount_paid ?? existing?.amountPaidMinor ?? 0,
    currency: input.data.currency ?? existing?.currency ?? "eur",
    hostedInvoiceUrl:
      input.data.hosted_invoice_url ?? existing?.hostedInvoiceUrl ?? undefined,
    attemptCount,
    nextRetryAt: input.data.next_payment_attempt
      ? input.data.next_payment_attempt * 1000
      : undefined,
    paidAt: input.paid ? now : existing?.paidAt,
    livemode: input.livemode,
    updatedAt: now,
  };
  if (existing) {
    await ctx.db.patch(existing._id, patch);
  } else {
    await ctx.db.insert("billingInvoices", { ...patch, createdAt: now });
  }

  if (input.paid) {
    await insertReceipt(ctx, {
      objectType: "invoice",
      objectId: invoiceId,
      eventId: input.eventId,
      eventType: input.type,
      organizationId,
      amountMinor: input.data.amount_paid,
      currency: input.data.currency,
      livemode: input.livemode,
    });
  } else if (subscriptionRow) {
    // Dunning: a failed attempt advances the stage and starts the wind-down
    // clock. No email is claimed (there is no email gateway yet).
    await ctx.db.patch(subscriptionRow._id, {
      dunningStage: subscriptionRow.dunningStage + 1,
      windDownAt: subscriptionRow.windDownAt ?? now + WIND_DOWN_GRACE_MS,
      updatedAt: now,
    });
  }

  await syncEntitlement(ctx, organizationId);
  return { status: "processed", note: `invoice ${status}` };
}

// ── Entry point ─────────────────────────────────────────────────────────────

/**
 * Apply one verified provider event. The route verifies the signature first;
 * this function is the transactional apply. Duplicate event ids are no-ops.
 */
export const applyEvent = internalMutation({
  args: {
    eventId: v.string(),
    type: v.string(),
    created: v.number(),
    livemode: v.boolean(),
    objectId: v.optional(v.string()),
    data: v.any(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("billingEvents")
      .withIndex("by_event_id", (q) => q.eq("eventId", args.eventId))
      .first();
    if (existing) {
      return { applied: false, duplicate: true, note: "duplicate delivery" };
    }

    const data = (args.data ?? {}) as StripeObject;
    let outcome: ApplyOutcome;
    try {
      if (args.type.startsWith("customer.subscription.")) {
        if (args.type === "customer.subscription.deleted") {
          const result = await upsertSubscription(ctx, {
            subscription: { ...data, status: "canceled", cancel_at_period_end: false },
            eventCreated: args.created,
            eventId: args.eventId,
            livemode: args.livemode,
          });
          outcome = result;
        } else {
          outcome = await upsertSubscription(ctx, {
            subscription: data,
            eventCreated: args.created,
            eventId: args.eventId,
            livemode: args.livemode,
          });
        }
      } else if (args.type === "checkout.session.completed") {
        outcome = await handleCheckoutCompleted(ctx, {
          eventId: args.eventId,
          type: args.type,
          created: args.created,
          livemode: args.livemode,
          data,
        });
      } else if (
        args.type === "invoice.paid" ||
        args.type === "invoice.payment_succeeded"
      ) {
        outcome = await handleInvoice(ctx, {
          eventId: args.eventId,
          type: args.type,
          created: args.created,
          livemode: args.livemode,
          data,
          paid: true,
        });
      } else if (
        args.type === "invoice.payment_failed" ||
        args.type === "invoice.payment_action_required"
      ) {
        outcome = await handleInvoice(ctx, {
          eventId: args.eventId,
          type: args.type,
          created: args.created,
          livemode: args.livemode,
          data,
          paid: false,
        });
      } else {
        outcome = { status: "ignored", note: `unhandled event type ${args.type}` };
      }
    } catch (error) {
      outcome = {
        status: "failed",
        note: error instanceof Error ? error.message.slice(0, 300) : "handler failed",
      };
    }

    await ctx.db.insert("billingEvents", {
      eventId: args.eventId,
      type: args.type,
      objectId: args.objectId,
      status: outcome.status,
      livemode: args.livemode,
      note: outcome.note,
      created: args.created,
      receivedAt: Date.now(),
      processedAt: outcome.status === "failed" ? undefined : Date.now(),
    });

    return {
      applied: outcome.status === "processed",
      duplicate: false,
      note: outcome.note,
    };
  },
});

/**
 * Apply a reconciliation snapshot. The cron fetches the provider side and calls
 * this; tests call it directly with a synthetic snapshot. It only **reports**
 * drift (target 0) — it never auto-changes an entitlement, because acting on a
 * possibly-partial provider snapshot is exactly how a mirror gets corrupted.
 */
export const applyReconciliation = internalMutation({
  args: {
    source: v.string(),
    providerRows: v.array(
      v.object({
        organizationId: v.string(),
        subscriptionId: v.string(),
        plan: v.string(),
        status: v.string(),
        priceId: v.optional(v.string()),
      }),
    ),
    startedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const localRows = await ctx.db.query("subscriptions").collect();
    const localSubscriptions = localRows.map((row) => ({
      organizationId: row.organizationId as string,
      subscriptionId: row.subscriptionId,
      plan: row.plan,
      status: row.status,
      priceId: row.priceId,
    }));

    // The provider snapshot may name orgs we have never mirrored; read the
    // entitlement mirror for every org either side knows about.
    const organizationIds = new Set<string>([
      ...localSubscriptions.map((row) => row.organizationId),
      ...args.providerRows.map((row) => row.organizationId),
    ]);
    const localEntitlements = [];
    for (const organizationId of organizationIds) {
      const organization = await ctx.db.get(
        organizationId as Id<"organizations">,
      );
      if (!organization) continue;
      const owner = await ctx.db.get(organization.ownerId);
      localEntitlements.push({
        organizationId,
        plan: owner?.plan ?? null,
        planStatus: owner?.planStatus ?? null,
      });
    }

    const result = reconcileBilling({
      localSubscriptions,
      localEntitlements,
      providerSubscriptions: args.providerRows,
    });

    const now = Date.now();
    await ctx.db.insert("reconciliationRuns", {
      source: args.source,
      startedAt: args.startedAt ?? now,
      finishedAt: now,
      checked: result.checked,
      driftCount: result.driftCount,
      drifts: result.drifts.map((drift) => ({
        ...drift,
        organizationId: drift.organizationId as
          | Id<"organizations">
          | undefined,
      })),
      createdAt: now,
    });

    return { checked: result.checked, driftCount: result.driftCount, drifts: result.drifts };
  },
});

/**
 * Wind-down sweep (cron). A subscription whose failed payment has been
 * unresolved past the grace period moves to the honest `wind_down` state and
 * the entitlement mirror is refreshed. Nothing is deleted; obligations are not
 * silently dropped (`AGENTS.md` §5 rule 5).
 */
export const windDownSweep = internalMutation({
  args: { now: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    const rows = await ctx.db
      .query("subscriptions")
      .withIndex("by_status", (q) => q.eq("status", "past_due"))
      .collect();
    const unpaid = await ctx.db
      .query("subscriptions")
      .withIndex("by_status", (q) => q.eq("status", "unpaid"))
      .collect();
    let moved = 0;
    for (const row of [...rows, ...unpaid]) {
      if (!row.windDownAt || row.windDownAt > now) continue;
      await ctx.db.patch(row._id, {
        status: "wind_down",
        windDownAt: undefined,
        updatedAt: now,
      });
      await syncEntitlement(ctx, row.organizationId);
      moved += 1;
    }
    return { moved };
  },
});
