import { describe, expect, it } from "vitest";
import { api, internal } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { ACCOUNT_DELETION_GRACE_MS } from "@/convex/modules/privacy/deletionJobs";
import { DATA_REGISTRY } from "@/convex/lib/dataRegistry";
import { newBackend, seedUser } from "./helpers";

const at = 1_800_000_000_000;

async function setRequestAge(t: ReturnType<typeof newBackend>, userId: string, requestedAt: number) {
  await t.run(async (ctx) => {
    const id = userId as Id<"users">;
    const job = await ctx.db.query("privacyJobs").withIndex("by_user", (q) => q.eq("userId", id)).first();
    if (!job) throw new Error("expected durable deletion job");
    await ctx.db.patch(id, { deletionRequestedAt: requestedAt });
    await ctx.db.patch(job._id, { requestedAt, effectiveAt: requestedAt + ACCOUNT_DELETION_GRACE_MS, idempotencyKey: `account-deletion:${userId}:${requestedAt}` });
  });
}

async function drainDeletion(t: ReturnType<typeof newBackend>, userId: string, maxSteps = 2000) {
  let result: { status: string; [key: string]: unknown } = { status: "running" };
  for (let step = 0; step < maxSteps; step += 1) {
    result = await t.mutation(internal.modules.privacy.deletionJobs.finalizeUser, { userId: userId as Id<"users">, now: at });
    if (result.status === "succeeded" || result.status === "waiting_for_user" || result.status === "no_request") return result;
  }
  throw new Error("deletion did not reach a terminal state within the bounded test step limit");
}

async function seedSubscription(t: ReturnType<typeof newBackend>, userId: string, status: string, verified = true) {
  const organizationId = await t.run(async (ctx) => {
    const organizationId = await ctx.db.insert("organizations", {
      name: "Paid workspace", kind: "business", ownerId: userId as Id<"users">,
      createdAt: at, updatedAt: at,
    });
    await ctx.db.insert("memberships", {
      organizationId, userId: userId as Id<"users">, role: "owner", status: "active",
      createdAt: at, updatedAt: at,
    });
    await ctx.db.insert("subscriptions", {
      organizationId, provider: "stripe", subscriptionId: "sub_lifecycle",
      customerId: "cus_lifecycle", plan: "starter", status, livemode: false,
      cancelAtPeriodEnd: false, dunningStage: 0, lastEventCreated: at,
      ...(verified ? { lastVerifiedAt: at } : {}), createdAt: at, updatedAt: at,
    });
    return organizationId;
  });
  return organizationId;
}

describe("BP-05 account lifecycle", () => {
  it("records an explicit request and keeps it reversible during the 30-day grace", async () => {
    const t = newBackend();
    const user = await seedUser(t);
    const request = await user.as.mutation(api.billing.requestAccountDeletion, {});
    expect(request).toMatchObject({ status: "queued" });
    expect(request.effectiveAt - request.requestedAt).toBe(ACCOUNT_DELETION_GRACE_MS);
    expect(await t.run((ctx) => ctx.db.get(user.userId as Id<"users">))).toBeTruthy();
    await user.as.mutation(api.billing.cancelAccountDeletion, {});
    expect((await t.run((ctx) => ctx.db.get(user.userId as Id<"users">)))?.deletionRequestedAt).toBeUndefined();
  });

  it("does not finalize before grace and never sweeps users without a request", async () => {
    const t = newBackend();
    const user = await seedUser(t);
    const unrequested = await seedUser(t, { email: "untouched@example.com" });
    await user.as.mutation(api.billing.requestAccountDeletion, {});
    await setRequestAge(t, user.userId, at - ACCOUNT_DELETION_GRACE_MS + 1);
    const early = await t.mutation(internal.modules.privacy.deletionJobs.finalizeDue, { now: at });
    expect(early).toMatchObject({ processed: 0 });
    expect(await t.run((ctx) => ctx.db.get(unrequested.userId as Id<"users">))).toBeTruthy();
  });

  it("blocks active, past_due and unverified subscriptions without deleting account data", async () => {
    for (const status of ["active", "past_due"]) {
      const t = newBackend();
      const user = await seedUser(t);
      await seedSubscription(t, user.userId, status);
      await user.as.mutation(api.billing.requestAccountDeletion, {});
      await setRequestAge(t, user.userId, at - ACCOUNT_DELETION_GRACE_MS);
      const result = await drainDeletion(t, user.userId);
      expect(result.status).toBe("waiting_for_user");
      expect(result.reason).toContain("Stripe billing portal");
      expect(await t.run((ctx) => ctx.db.get(user.userId as Id<"users">))).toBeTruthy();
    }

    const t = newBackend();
    const user = await seedUser(t);
    await seedSubscription(t, user.userId, "canceled", false);
    await user.as.mutation(api.billing.requestAccountDeletion, {});
    await setRequestAge(t, user.userId, at - ACCOUNT_DELETION_GRACE_MS);
    const stale = await drainDeletion(t, user.userId);
    expect(stale).toMatchObject({ status: "waiting_for_user", reason: expect.stringContaining("stale") });
  });

  it("walks subscription pages with an opaque cursor instead of growing a numeric take", async () => {
    const t = newBackend();
    const user = await seedUser(t);
    const organizationId = await t.run(async (ctx) => {
      const organizationId = await ctx.db.insert("organizations", { name: "Many subscription mirrors", kind: "business", ownerId: user.userId as Id<"users">, createdAt: at, updatedAt: at });
      await ctx.db.insert("memberships", { organizationId, userId: user.userId as Id<"users">, role: "owner", status: "active", createdAt: at, updatedAt: at });
      await ctx.db.insert("billingCustomers", { organizationId, provider: "stripe", customerId: "cus_many", livemode: false, createdBy: user.userId as Id<"users">, createdAt: at, updatedAt: at });
      for (const [index, status] of ["canceled", "canceled", "active"].entries()) {
        await ctx.db.insert("subscriptions", { organizationId, provider: "stripe", subscriptionId: `sub_page_${index}`, customerId: "cus_many", plan: "starter", status, livemode: false, cancelAtPeriodEnd: false, dunningStage: 0, lastEventCreated: at, lastVerifiedAt: at, createdAt: at + index, updatedAt: at + index });
      }
      return organizationId;
    });
    await user.as.mutation(api.billing.requestAccountDeletion, {});
    await setRequestAge(t, user.userId, at - ACCOUNT_DELETION_GRACE_MS);
    const result = await drainDeletion(t, user.userId);
    expect(result).toMatchObject({ status: "waiting_for_user", reason: expect.stringContaining("Stripe billing portal") });
    expect(await t.run((ctx) => ctx.db.get(organizationId))).toBeTruthy();
  });

  it("rechecks billing immediately before organization cleanup when a subscription arrives mid-deletion", async () => {
    const t = newBackend();
    const user = await seedUser(t);
    const organizationId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("organizations", { name: "Late checkout", kind: "business", ownerId: user.userId as Id<"users">, createdAt: at, updatedAt: at });
      await ctx.db.insert("memberships", { organizationId: id, userId: user.userId as Id<"users">, role: "owner", status: "active", createdAt: at, updatedAt: at });
      return id;
    });
    await user.as.mutation(api.billing.requestAccountDeletion, {});
    await setRequestAge(t, user.userId, at - ACCOUNT_DELETION_GRACE_MS);

    // Advance the resumable job through its first subscription preflight. Add a
    // provider-shaped active mirror before the destructive organization phase.
    await t.mutation(internal.modules.privacy.deletionJobs.finalizeUser, { userId: user.userId as Id<"users">, now: at });
    await t.run(async (ctx) => {
      await ctx.db.insert("subscriptions", {
        organizationId, provider: "stripe", subscriptionId: "sub_arrived_during_cleanup", customerId: "cus_late",
        plan: "starter", status: "active", livemode: false, cancelAtPeriodEnd: false, dunningStage: 0,
        lastEventCreated: at, lastVerifiedAt: at, createdAt: at, updatedAt: at,
      });
    });

    const result = await drainDeletion(t, user.userId);
    expect(result).toMatchObject({ status: "waiting_for_user", reason: expect.stringContaining("Stripe billing portal") });
    expect(await t.run((ctx) => ctx.db.get(organizationId))).toBeTruthy();
    expect(await t.run((ctx) => ctx.db.query("subscriptions").withIndex("by_organization", (q) => q.eq("organizationId", organizationId)).first())).toMatchObject({ status: "active" });
  });

  it("rechecks subscription status immediately before deleting the organization after billing rows were passed", async () => {
    const t = newBackend();
    const user = await seedUser(t);
    const organizationId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("organizations", { name: "Late final subscription", kind: "business", ownerId: user.userId as Id<"users">, createdAt: at, updatedAt: at });
      await ctx.db.insert("memberships", { organizationId: id, userId: user.userId as Id<"users">, role: "owner", status: "active", createdAt: at, updatedAt: at });
      return id;
    });
    await user.as.mutation(api.billing.requestAccountDeletion, {});
    await setRequestAge(t, user.userId, at - ACCOUNT_DELETION_GRACE_MS);
    const orgEntryCount = Object.entries(DATA_REGISTRY).filter(([, entry]) => entry.scope === "organization" && (entry.deletion.kind === "organization-policy" || entry.deletion.kind === "organization-links")).length;

    let reachedFinalOrganizationStep = false;
    for (let step = 0; step < 2000; step += 1) {
      const job = await t.run((ctx) => ctx.db.query("privacyJobs").withIndex("by_user_kind", (q) => q.eq("userId", user.userId as Id<"users">).eq("kind", "account_deletion")).first());
      const cursor = JSON.parse(job?.cursor ?? "{}") as { phase?: string; organizationId?: string; organizationRuleIndex?: number };
      if (cursor.phase === "organizations" && cursor.organizationId === organizationId && cursor.organizationRuleIndex === orgEntryCount) {
        reachedFinalOrganizationStep = true;
        break;
      }
      await t.mutation(internal.modules.privacy.deletionJobs.finalizeUser, { userId: user.userId as Id<"users">, now: at });
    }
    expect(reachedFinalOrganizationStep).toBe(true);
    await t.run(async (ctx) => {
      await ctx.db.insert("subscriptions", {
        organizationId, provider: "stripe", subscriptionId: "sub_late_final", customerId: "cus_late_final",
        plan: "starter", status: "active", livemode: false, cancelAtPeriodEnd: false, dunningStage: 0,
        lastEventCreated: at, lastVerifiedAt: at, createdAt: at, updatedAt: at,
      });
    });
    const result = await t.mutation(internal.modules.privacy.deletionJobs.finalizeUser, { userId: user.userId as Id<"users">, now: at });
    expect(result).toMatchObject({ status: "waiting_for_user", reason: expect.stringContaining("Stripe billing portal") });
    expect(await t.run((ctx) => ctx.db.get(organizationId))).toBeTruthy();
    expect(await t.run((ctx) => ctx.db.query("subscriptions").withIndex("by_organization", (q) => q.eq("organizationId", organizationId)).first())).toMatchObject({ status: "active" });
  });

  it("fails closed on an out-of-range organization cursor even when billing is active", async () => {
    const t = newBackend();
    const user = await seedUser(t);
    const organizationId = await seedSubscription(t, user.userId, "active");
    await user.as.mutation(api.billing.requestAccountDeletion, {});
    await setRequestAge(t, user.userId, at - ACCOUNT_DELETION_GRACE_MS);
    const entryCount = Object.entries(DATA_REGISTRY).filter(([, entry]) => entry.scope === "organization" && (entry.deletion.kind === "organization-policy" || entry.deletion.kind === "organization-links")).length;
    await t.run(async (ctx) => {
      const job = await ctx.db.query("privacyJobs").withIndex("by_user_kind", (q) => q.eq("userId", user.userId as Id<"users">).eq("kind", "account_deletion")).first();
      if (!job) throw new Error("expected durable deletion job");
      await ctx.db.patch(job._id, { cursor: JSON.stringify({ phase: "organizations", obligation: { organizationCursor: null, organizationId: null, subscriptionCursor: null, sawSubscription: false, stage: "subscription" }, organizationId, organizationRuleIndex: entryCount + 1 }) });
    });

    const result = await t.mutation(internal.modules.privacy.deletionJobs.finalizeUser, { userId: user.userId as Id<"users">, now: at });
    expect(result.status).not.toBe("succeeded");
    expect(await t.run((ctx) => ctx.db.get(organizationId))).toBeTruthy();
    expect(await t.run((ctx) => ctx.db.query("subscriptions").withIndex("by_organization", (q) => q.eq("organizationId", organizationId)).first())).toMatchObject({ status: "active" });
  });

  it("does not delete an organization whose ownership changed after cursor selection", async () => {
    const t = newBackend();
    const departing = await seedUser(t);
    const successor = await seedUser(t, { email: "organization-transfer@example.com" });
    const organizationId = await seedSubscription(t, departing.userId, "canceled");
    await departing.as.mutation(api.billing.requestAccountDeletion, {});
    await setRequestAge(t, departing.userId, at - ACCOUNT_DELETION_GRACE_MS);
    await t.run(async (ctx) => {
      const job = await ctx.db.query("privacyJobs").withIndex("by_user_kind", (q) => q.eq("userId", departing.userId as Id<"users">).eq("kind", "account_deletion")).first();
      if (!job) throw new Error("expected durable deletion job");
      await ctx.db.patch(job._id, { cursor: JSON.stringify({ phase: "organizations", obligation: { organizationCursor: null, organizationId: null, subscriptionCursor: null, sawSubscription: false, stage: "subscription" }, organizationId, organizationRuleIndex: 0 }) });
      await ctx.db.patch(organizationId, { ownerId: successor.userId as Id<"users"> });
      const membership = await ctx.db.query("memberships").withIndex("by_organization_user", (q) => q.eq("organizationId", organizationId).eq("userId", departing.userId as Id<"users">)).first();
      if (membership) await ctx.db.delete(membership._id);
    });

    await drainDeletion(t, departing.userId);
    expect(await t.run((ctx) => ctx.db.get(organizationId))).toMatchObject({ ownerId: successor.userId });
  });

  it("preserves shared organizations and blocks a last owner until ownership is resolved", async () => {
    const t = newBackend();
    const owner = await seedUser(t);
    const other = await seedUser(t, { email: "other@example.com" });
    const organizationId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("organizations", { name: "Shared", kind: "business", ownerId: owner.userId as Id<"users">, createdAt: at, updatedAt: at });
      for (const [userId, role] of [[owner.userId, "owner"], [other.userId, "member"]] as const) {
        await ctx.db.insert("memberships", { organizationId: id, userId: userId as Id<"users">, role, status: "active", createdAt: at, updatedAt: at });
      }
      return id;
    });
    await owner.as.mutation(api.billing.requestAccountDeletion, {});
    await setRequestAge(t, owner.userId, at - ACCOUNT_DELETION_GRACE_MS);
    const blocked = await drainDeletion(t, owner.userId);
    expect(blocked).toMatchObject({ status: "waiting_for_user", reason: expect.stringContaining("owner") });
    expect(await t.run((ctx) => ctx.db.get(organizationId))).toBeTruthy();
    await t.run(async (ctx) => {
      const membership = await ctx.db.query("memberships").withIndex("by_organization_user", (q) => q.eq("organizationId", organizationId).eq("userId", other.userId as Id<"users">)).first();
      if (!membership) throw new Error("expected active successor membership");
      await ctx.db.patch(membership._id, { role: "owner" });
    });
    await owner.as.mutation(api.billing.deleteAccount, {});
    expect(await drainDeletion(t, owner.userId)).toMatchObject({ status: "succeeded" });
    expect(await t.run((ctx) => ctx.db.get(organizationId))).toMatchObject({ ownerId: other.userId });
    expect(await t.run((ctx) => ctx.db.get(owner.userId as Id<"users">))).toBeNull();
    const remaining = await t.run((ctx) => ctx.db.query("memberships").withIndex("by_organization", (q) => q.eq("organizationId", organizationId)).collect());
    expect(remaining.map((membership) => membership.userId)).toEqual([other.userId]);
  });

  it("preserves projects in a shared organization and aligns their owner with the retained organization", async () => {
    const t = newBackend();
    const departing = await seedUser(t);
    const successor = await seedUser(t, { email: "shared-successor@example.com" });
    const { organizationId, projectId } = await t.run(async (ctx) => {
      const organizationId = await ctx.db.insert("organizations", {
        name: "Retained workspace", kind: "business", ownerId: departing.userId as Id<"users">,
        createdAt: at, updatedAt: at,
      });
      await ctx.db.insert("memberships", { organizationId, userId: departing.userId as Id<"users">, role: "owner", status: "active", createdAt: at, updatedAt: at });
      await ctx.db.insert("memberships", { organizationId, userId: successor.userId as Id<"users">, role: "owner", status: "active", createdAt: at, updatedAt: at });
      const projectId = await ctx.db.insert("projects", { ownerId: departing.userId as Id<"users">, organizationId, name: "Retained project", createdAt: at });
      return { organizationId, projectId };
    });
    const solelyOwnedProjectId = await t.run((ctx) => ctx.db.insert("projects", {
      ownerId: departing.userId as Id<"users">, name: "Sole project", createdAt: at,
    }));

    await departing.as.mutation(api.billing.requestAccountDeletion, {});
    await setRequestAge(t, departing.userId, at - ACCOUNT_DELETION_GRACE_MS);
    await drainDeletion(t, departing.userId);

    expect(await t.run((ctx) => ctx.db.get(organizationId))).toMatchObject({ ownerId: successor.userId });
    expect(await t.run((ctx) => ctx.db.get(projectId))).toMatchObject({ ownerId: successor.userId, organizationId });
    expect(await t.run((ctx) => ctx.db.get(solelyOwnedProjectId))).toBeNull();
  });

  it("continues organization cleanup after transferring the first shared organization", async () => {
    const t = newBackend();
    const departing = await seedUser(t);
    const successor = await seedUser(t, { email: "first-org-successor@example.com" });
    const { sharedOrganizationId, solelyOwnedOrganizationId } = await t.run(async (ctx) => {
      const sharedOrganizationId = await ctx.db.insert("organizations", { name: "First shared workspace", kind: "business", ownerId: departing.userId as Id<"users">, createdAt: at, updatedAt: at });
      await ctx.db.insert("memberships", { organizationId: sharedOrganizationId, userId: departing.userId as Id<"users">, role: "owner", status: "active", createdAt: at, updatedAt: at });
      await ctx.db.insert("memberships", { organizationId: sharedOrganizationId, userId: successor.userId as Id<"users">, role: "owner", status: "active", createdAt: at, updatedAt: at });
      const solelyOwnedOrganizationId = await ctx.db.insert("organizations", { name: "Second sole workspace", kind: "business", ownerId: departing.userId as Id<"users">, createdAt: at + 1, updatedAt: at + 1 });
      await ctx.db.insert("memberships", { organizationId: solelyOwnedOrganizationId, userId: departing.userId as Id<"users">, role: "owner", status: "active", createdAt: at + 1, updatedAt: at + 1 });
      return { sharedOrganizationId, solelyOwnedOrganizationId };
    });
    await departing.as.mutation(api.billing.requestAccountDeletion, {});
    await setRequestAge(t, departing.userId, at - ACCOUNT_DELETION_GRACE_MS);

    await drainDeletion(t, departing.userId);

    expect(await t.run((ctx) => ctx.db.get(sharedOrganizationId))).toMatchObject({ ownerId: successor.userId });
    expect(await t.run((ctx) => ctx.db.get(solelyOwnedOrganizationId))).toBeNull();
  });

  it("retries deletion work idempotently and records a durable job", async () => {
    const t = newBackend();
    const user = await seedUser(t);
    const projectId = await t.run((ctx) => ctx.db.insert("projects", { ownerId: user.userId as Id<"users">, name: "One", createdAt: at }));
    await user.as.mutation(api.billing.requestAccountDeletion, {});
    await setRequestAge(t, user.userId, at - ACCOUNT_DELETION_GRACE_MS);
    const first = await t.mutation(internal.modules.privacy.deletionJobs.finalizeUser, { userId: user.userId as Id<"users">, now: at });
    expect(first.status).toBe("running");
    const second = await drainDeletion(t, user.userId);
    expect(second.status).toBe("succeeded");
    expect(await t.run((ctx) => ctx.db.get(projectId))).toBeNull();
    const jobs = await t.run((ctx) => ctx.db.query("privacyJobs").collect());
    expect(jobs.length).toBeGreaterThan(0);
  });

  it("blocks shared organization deletion when successor ownership is ambiguous", async () => {
    const t = newBackend();
    const departing = await seedUser(t);
    const firstOwner = await seedUser(t, { email: "first-owner@example.com" });
    const secondOwner = await seedUser(t, { email: "second-owner@example.com" });
    const { organizationId, projectId } = await t.run(async (ctx) => {
      const organizationId = await ctx.db.insert("organizations", {
        name: "Ambiguous workspace", kind: "business", ownerId: departing.userId as Id<"users">,
        createdAt: at, updatedAt: at,
      });
      for (const userId of [departing.userId, firstOwner.userId, secondOwner.userId]) {
        await ctx.db.insert("memberships", { organizationId, userId: userId as Id<"users">, role: "owner", status: "active", createdAt: at, updatedAt: at });
      }
      const projectId = await ctx.db.insert("projects", { ownerId: departing.userId as Id<"users">, organizationId, name: "Still shared", createdAt: at });
      return { organizationId, projectId };
    });
    await departing.as.mutation(api.billing.requestAccountDeletion, {});
    await setRequestAge(t, departing.userId, at - ACCOUNT_DELETION_GRACE_MS);

    const result = await drainDeletion(t, departing.userId);
    expect(result).toMatchObject({ status: "waiting_for_user", reason: expect.stringContaining("multiple other active owners") });
    expect(await t.run((ctx) => ctx.db.get(organizationId))).toBeTruthy();
    expect(await t.run((ctx) => ctx.db.get(projectId))).toBeTruthy();
  });

  it("does not let cancellation resume after the first project has been deleted", async () => {
    const t = newBackend();
    const user = await seedUser(t);
    const projectIds = await t.run(async (ctx) => [
      await ctx.db.insert("projects", { ownerId: user.userId as Id<"users">, name: "First", createdAt: at }),
      await ctx.db.insert("projects", { ownerId: user.userId as Id<"users">, name: "Second", createdAt: at + 1 }),
    ]);
    await user.as.mutation(api.billing.requestAccountDeletion, {});
    await setRequestAge(t, user.userId, at - ACCOUNT_DELETION_GRACE_MS);
    const firstStep = await t.mutation(internal.modules.privacy.deletionJobs.finalizeUser, { userId: user.userId as Id<"users">, now: at });
    expect(firstStep.status).toBe("running");
    const initialProjects = await t.run((ctx) => ctx.db.query("projects").withIndex("by_owner", (q) => q.eq("ownerId", user.userId as Id<"users">)).collect());
    expect(initialProjects).toHaveLength(2);
    const job = await t.run((ctx) => ctx.db.query("privacyJobs").withIndex("by_user_kind", (q) => q.eq("userId", user.userId as Id<"users">).eq("kind", "account_deletion")).first());
    let deletedOneProject = false;
    for (let index = 0; index < 1000; index += 1) {
      const before = await t.run((ctx) => ctx.db.query("projects").withIndex("by_owner", (q) => q.eq("ownerId", user.userId as Id<"users">)).collect());
      await t.mutation(internal.modules.privacy.deletionJobs.finalizeUser, { userId: user.userId as Id<"users">, now: at });
      const projects = await t.run((ctx) => ctx.db.query("projects").withIndex("by_owner", (q) => q.eq("ownerId", user.userId as Id<"users">)).collect());
      if (projects.length < before.length) { deletedOneProject = true; break; }
    }
    expect(job).toBeTruthy();
    expect(deletedOneProject).toBe(true);
    expect(await t.run((ctx) => ctx.db.get(projectIds[0]!))).toBeNull();
    expect(await t.run((ctx) => ctx.db.get(projectIds[1]!))).toBeTruthy();

    await expect(user.as.mutation(api.billing.cancelAccountDeletion, {})).resolves.toMatchObject({ canceled: false, reason: expect.stringContaining("Finalization has started") });
    expect((await t.run((ctx) => ctx.db.get(user.userId as Id<"users">)))?.deletionRequestedAt).toBeTruthy();
    expect(await t.run((ctx) => ctx.db.get(projectIds[1]!))).toBeTruthy();
  });

  it("denies another tenant from inspecting or canceling a deletion job", async () => {
    const t = newBackend();
    const first = await seedUser(t);
    const second = await seedUser(t, { email: "second@example.com" });
    const request = await first.as.mutation(api.billing.requestAccountDeletion, {});
    await expect(second.as.mutation(api.modules.privacy.deletionJobs.cancel, { jobId: request.jobId })).rejects.toThrow();
    await expect(second.as.query(api.modules.privacy.deletionJobs.status, {})).resolves.toMatchObject({ requested: false });
  });
});
