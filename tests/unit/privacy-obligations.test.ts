import { describe, expect, it } from "vitest";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { newBackend, seedProject, seedUser } from "./helpers";

describe("BP-05 obligations inspector", () => {
  it("returns registry metadata and project counts only to the owning tenant", async () => {
    const t = newBackend();
    const owner = await seedUser(t);
    const foreign = await seedUser(t, { email: "foreign@example.com" });
    const projectId = await seedProject(t, owner.userId);
    await t.run((ctx) => ctx.db.insert("contentPieces", {
      projectId: projectId as Id<"projects">, title: "Count me", status: "draft",
      createdBy: owner.userId as Id<"users">, createdAt: 10, updatedAt: 10,
    }));

    const registry = await owner.as.query(api.modules.privacy.obligations.registry, {});
    expect(registry.tableCount).toBe(Object.keys(registry.entries).length);
    expect(registry.entries.socialCredentials.export).toBe("excluded");
    const report = await owner.as.query(api.modules.privacy.obligations.project, { projectId: projectId as Id<"projects"> });
    expect(report.counts.contentPieces.count).toBe(1);
    await expect(foreign.as.query(api.modules.privacy.obligations.project, { projectId: projectId as Id<"projects"> })).rejects.toThrow("Not found");
  });

  it("limits pending deletion reports to platform operators", async () => {
    const t = newBackend();
    const regular = await seedUser(t);
    await expect(regular.as.query(api.modules.privacy.obligations.pendingDeletions, {})).rejects.toThrow("Platform admin only");
  });

  it("caps project obligation counts and pages admin deletion reports", async () => {
    const t = newBackend();
    const owner = await seedUser(t);
    const projectId = await seedProject(t, owner.userId);
    await t.run(async (ctx) => {
      for (let index = 0; index < 103; index += 1) {
        await ctx.db.insert("contacts", { projectId: projectId as Id<"projects">, name: `Contact ${index}`, createdAt: index });
      }
      await ctx.db.patch(owner.userId as Id<"users">, { deletionRequestedAt: 10 });
      await ctx.db.insert("platformAdmins", { email: "test@example.com", userId: owner.userId as Id<"users">, status: "active", createdAt: 1, updatedAt: 1 });
    });
    const report = await owner.as.query(api.modules.privacy.obligations.project, { projectId: projectId as Id<"projects"> });
    expect(report.counts.contacts).toEqual({ count: 100, capped: true });
    const page = await owner.as.query(api.modules.privacy.obligations.pendingDeletions, { cursor: undefined });
    expect(page.pending.map((entry) => entry.userId)).toContain(owner.userId);
  });

  it("never reports account deletion ready when a later organization has an active subscription", async () => {
    const t = newBackend();
    const owner = await seedUser(t);
    const now = Date.now();
    const organizations = await t.run(async (ctx) => {
      const firstId = await ctx.db.insert("organizations", { name: "First workspace", kind: "business", ownerId: owner.userId as Id<"users">, createdAt: now, updatedAt: now });
      await ctx.db.insert("memberships", { organizationId: firstId, userId: owner.userId as Id<"users">, role: "owner", status: "active", createdAt: now, updatedAt: now });
      const secondId = await ctx.db.insert("organizations", { name: "Later workspace", kind: "business", ownerId: owner.userId as Id<"users">, createdAt: now + 1, updatedAt: now + 1 });
      await ctx.db.insert("memberships", { organizationId: secondId, userId: owner.userId as Id<"users">, role: "owner", status: "active", createdAt: now, updatedAt: now });
      for (const [index, status] of ["canceled", "active"].entries()) {
        await ctx.db.insert("subscriptions", { organizationId: secondId, provider: "stripe", subscriptionId: `sub_obligation_${index}`, customerId: "cus_obligation", plan: "starter", status, livemode: false, cancelAtPeriodEnd: false, dunningStage: 0, lastEventCreated: now, lastVerifiedAt: now, createdAt: now + index, updatedAt: now + index });
      }
      return { firstId, secondId };
    });
    expect(organizations.firstId).not.toBe(organizations.secondId);
    await owner.as.mutation(api.billing.requestAccountDeletion, {});
    const account = await owner.as.query(api.modules.privacy.obligations.account, {});
    expect(account.canFinalize).toBe(false);
    expect(account.blockedReason).toContain("active subscription");
  });
});
