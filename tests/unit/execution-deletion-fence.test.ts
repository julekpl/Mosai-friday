import { describe, expect, it } from "vitest";
import { api, internal } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { newBackend, seedUser, type TestBackend } from "./helpers";

async function seedApprovedChange(t: TestBackend) {
  const owner = await seedUser(t, { plan: "scale" });
  const projectId = await owner.as.mutation(api.projects.create, {
    name: "Deletion fence test",
  });
  const changeId = await t.run((ctx) =>
    ctx.db.insert("adsChangeRequests", {
      projectId,
      platform: "google",
      accountId: "test-account",
      campaignId: "test-campaign",
      campaignName: "Test campaign",
      kind: "pause",
      origin: "user",
      status: "approved",
      idempotencyKey: `test-operation-${Date.now()}`,
      requestedBy: owner.userId as Id<"users">,
      createdAt: Date.now(),
    }),
  );
  return { owner, projectId, changeId };
}

async function drainProjectDeletion(
  t: TestBackend,
  jobId: Id<"privacyJobs">,
  maxSteps = 1_000,
) {
  let latest: { completed?: boolean; [key: string]: unknown } = {};
  for (let step = 0; step < maxSteps; step += 1) {
    latest = await t.mutation(
      internal.modules.privacy.deletionJobs.processProjectDeletion,
      { jobId },
    );
    const job = await t.run((ctx) => ctx.db.get(jobId));
    if (latest.completed || job?.blockedReason) return { latest, job };
  }
  throw new Error("project deletion did not block or finish within the step limit");
}

async function drainAccountDeletion(
  t: TestBackend,
  userId: Id<"users">,
  now: number,
  maxSteps = 1_000,
) {
  let latest: { status: string; blockedReason?: string } = { status: "running" };
  for (let step = 0; step < maxSteps; step += 1) {
    latest = await t.mutation(
      internal.modules.privacy.deletionJobs.finalizeUser,
      { userId, now },
    );
    const job = await t.run((ctx) =>
      ctx.db
        .query("privacyJobs")
        .withIndex("by_user_kind", (q) =>
          q.eq("userId", userId).eq("kind", "account_deletion"),
        )
        .order("desc")
        .first(),
    );
    if (latest.status === "succeeded" || job?.blockedReason) {
      return { latest, job };
    }
  }
  throw new Error("account deletion did not block or finish within the step limit");
}

describe("BP-07/BP-05 execution and deletion fence", () => {
  it("refuses a new ads claim after project deletion is queued", async () => {
    const t = newBackend();
    const { owner, projectId, changeId } = await seedApprovedChange(t);

    await owner.as.mutation(api.projects.remove, { id: projectId });
    const claim = await t.mutation(internal.ads.control.claimExecution, {
      changeId,
    });

    expect(claim.status).toBe("deletion_pending");
    expect(await t.run((ctx) => ctx.db.get(projectId))).toBeTruthy();
    expect((await t.run((ctx) => ctx.db.get(changeId)))?.status).toBe("approved");
  });

  it("refuses a new ads claim after owner account deletion is requested", async () => {
    const t = newBackend();
    const { owner, projectId, changeId } = await seedApprovedChange(t);

    await owner.as.mutation(api.billing.requestAccountDeletion, {});
    const claim = await t.mutation(internal.ads.control.claimExecution, {
      changeId,
    });

    expect(claim.status).toBe("deletion_pending");
    expect(await t.run((ctx) => ctx.db.get(projectId))).toBeTruthy();
    expect((await t.run((ctx) => ctx.db.get(changeId)))?.status).toBe("approved");
  });

  it.each(["project", "account"] as const)(
    "%s deletion waits for an in-flight ads receipt before cascading project rows",
    async (kind) => {
      const t = newBackend();
      const { owner, projectId, changeId } = await seedApprovedChange(t);
      const claim = await t.mutation(internal.ads.control.claimExecution, {
        changeId,
      });
      if (claim.status !== "claimed") throw new Error("Expected ads execution claim");

      let projectJobId: Id<"privacyJobs"> | undefined;
      let accountDeletionAt: number | undefined;
      if (kind === "project") {
        const job = await owner.as.mutation(api.projects.remove, { id: projectId });
        projectJobId = job.jobId;
      } else {
        const request = await owner.as.mutation(api.billing.requestAccountDeletion, {});
        accountDeletionAt = request.effectiveAt + 1;
      }

      const blocked =
        kind === "project"
          ? await drainProjectDeletion(t, projectJobId!)
          : await drainAccountDeletion(t, owner.userId as Id<"users">, accountDeletionAt!);
      expect(blocked.job?.status).toBe("running");
      expect(blocked.job?.blockedReason).toMatch(/ads change.*receipt/i);
      expect(await t.run((ctx) => ctx.db.get(projectId))).toBeTruthy();
      expect((await t.run((ctx) => ctx.db.get(changeId)))?.status).toBe("executing");
      expect(
        await t.run((ctx) =>
          ctx.db
            .query("adsExecutions")
            .withIndex("by_change", (q) => q.eq("changeId", changeId))
            .collect(),
        ),
      ).toHaveLength(0);

      const receipt = await t.mutation(internal.ads.control.recordExecution, {
        changeId,
        claimToken: claim.claimToken,
        result: { ok: true as const, providerRef: "test-provider-campaign" },
        executedBy: owner.userId as Id<"users">,
      });
      expect(receipt.applied).toBe(true);
      expect(
        await t.run((ctx) =>
          ctx.db
            .query("adsExecutions")
            .withIndex("by_change", (q) => q.eq("changeId", changeId))
            .collect(),
        ),
      ).toHaveLength(1);

      if (kind === "project") {
        const finished = await drainProjectDeletion(t, projectJobId!);
        expect(finished.job?.status).toBe("succeeded");
        expect(finished.job?.blockedReason).toBeUndefined();
      } else {
        const finished = await drainAccountDeletion(
          t,
          owner.userId as Id<"users">,
          accountDeletionAt!,
        );
        expect(finished.latest.status).toBe("succeeded");
        expect(finished.job?.blockedReason).toBeUndefined();
      }
      expect(await t.run((ctx) => ctx.db.get(projectId))).toBeNull();
    },
  );

  it("keeps deletion blocked until a failed execution outcome is recorded", async () => {
    const t = newBackend();
    const { owner, projectId, changeId } = await seedApprovedChange(t);
    const claim = await t.mutation(internal.ads.control.claimExecution, {
      changeId,
    });
    if (claim.status !== "claimed") throw new Error("Expected ads execution claim");
    const deletion = await owner.as.mutation(api.projects.remove, { id: projectId });

    const blocked = await drainProjectDeletion(t, deletion.jobId);
    expect(blocked.job?.blockedReason).toMatch(/ads change.*receipt/i);
    expect((await t.run((ctx) => ctx.db.get(changeId)))?.status).toBe("executing");

    const recorded = await t.mutation(internal.ads.control.recordExecution, {
      changeId,
      claimToken: claim.claimToken,
      result: { ok: false as const, error: "Provider rejected the requested change." },
      executedBy: owner.userId as Id<"users">,
    });
    expect(recorded.applied).toBe(true);
    expect((await t.run((ctx) => ctx.db.get(changeId)))?.status).toBe("failed");
    expect(
      await t.run((ctx) =>
        ctx.db
          .query("adsExecutions")
          .withIndex("by_change", (q) => q.eq("changeId", changeId))
          .first(),
      ),
    ).toMatchObject({ result: "error", errorDetail: "Provider rejected the requested change." });

    const finished = await drainProjectDeletion(t, deletion.jobId);
    expect(finished.job?.status).toBe("succeeded");
    expect(finished.job?.blockedReason).toBeUndefined();
    expect(await t.run((ctx) => ctx.db.get(projectId))).toBeNull();
  });
});
