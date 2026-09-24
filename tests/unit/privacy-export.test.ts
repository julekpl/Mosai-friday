import { describe, expect, it } from "vitest";
import { api, internal } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { EXPORT_CHUNK_MAX_BYTES } from "@/convex/modules/privacy/exportJobs";
import { newBackend, seedProject, seedUser } from "./helpers";

async function drainExport(t: ReturnType<typeof newBackend>, maxSteps = 1000) {
  for (let step = 0; step < maxSteps; step += 1) {
    const result = await t.mutation(internal.modules.privacy.exportJobs.processBatch, { now: 20 });
    if ((result as { processed?: boolean }).processed === false || (result as { completed?: boolean }).completed) return result;
  }
  throw new Error("export did not reach a terminal state within the bounded test step limit");
}

describe("BP-05 privacy exports", () => {
  it("creates a project-scoped archive only for its owner and paginates rows", async () => {
    const t = newBackend();
    const owner = await seedUser(t);
    const foreign = await seedUser(t, { email: "foreign-export@example.com" });
    const projectId = await seedProject(t, owner.userId);
    await t.run(async (ctx) => {
      for (const title of ["Project archive", "Second row"]) await ctx.db.insert("contentPieces", {
        projectId: projectId as Id<"projects">, title, status: "draft",
        createdBy: owner.userId as Id<"users">, createdAt: 10, updatedAt: 10,
      });
    });
    await expect(foreign.as.mutation(api.modules.privacy.exportJobs.createProject, { projectId: projectId as Id<"projects"> })).rejects.toThrow("Not found");
    const job = await owner.as.mutation(api.modules.privacy.exportJobs.createProject, { projectId: projectId as Id<"projects"> });
    const first = await t.mutation(internal.modules.privacy.exportJobs.processBatch, { now: 20 });
    expect(first).toMatchObject({ processed: true, completed: false });
    expect(await t.run((ctx) => ctx.db.query("privacyExportChunks").withIndex("by_job_sequence", (q) => q.eq("jobId", job.jobId)).collect())).toHaveLength(1);
    await drainExport(t);
    const finalStatus = await owner.as.query(api.modules.privacy.exportJobs.status, { jobId: job.jobId });
    expect(finalStatus.status).toBe("succeeded");
    expect(finalStatus.chunks).toBeGreaterThanOrEqual(1);
    const chunks = await Promise.all(Array.from({ length: finalStatus.chunks }, (_, sequence) => owner.as.query(api.modules.privacy.exportJobs.chunk, { jobId: job.jobId, sequence })));
    expect(chunks.some((chunk) => chunk?.json && JSON.parse(chunk.json).row?.title === "Project archive")).toBe(true);
    const chunk = chunks.find((entry) => entry);
    expect(chunk!.bytes).toBe(new TextEncoder().encode(chunk!.json).byteLength);
  });

  it("exports children of the final parent row before advancing the registry cursor", async () => {
    const t = newBackend();
    const owner = await seedUser(t);
    const projectId = await seedProject(t, owner.userId);
    const pieceId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("contentPieces", { projectId: projectId as Id<"projects">, title: "Parent with document", status: "draft", createdBy: owner.userId as Id<"users">, createdAt: 1, updatedAt: 1 });
      await ctx.db.insert("contentDocs", { pieceId: id, updatedAt: 2, updatedBy: owner.userId as Id<"users"> });
      return id;
    });
    const job = await owner.as.mutation(api.modules.privacy.exportJobs.createProject, { projectId: projectId as Id<"projects"> });
    await drainExport(t);
    const status = await owner.as.query(api.modules.privacy.exportJobs.status, { jobId: job.jobId });
    const chunks = await Promise.all(Array.from({ length: status.chunks }, (_, sequence) => owner.as.query(api.modules.privacy.exportJobs.chunk, { jobId: job.jobId, sequence })));
    expect(status.status).toBe("succeeded");
    expect(chunks.some((chunk) => chunk?.json && JSON.parse(chunk.json).table === "contentDocs" && JSON.parse(chunk.json).row.pieceId === pieceId)).toBe(true);
  });

  it("keeps the opaque project page cursor while exporting multiple account projects", async () => {
    const t = newBackend();
    const owner = await seedUser(t);
    const firstProject = await seedProject(t, owner.userId, "First account project");
    const secondProject = await seedProject(t, owner.userId, "Second account project");
    await t.run(async (ctx) => {
      for (const [projectId, title] of [[firstProject, "First distinct content"], [secondProject, "Second distinct content"]] as const) {
        await ctx.db.insert("contentPieces", { projectId: projectId as Id<"projects">, title, status: "draft", createdBy: owner.userId as Id<"users">, createdAt: 1, updatedAt: 1 });
      }
    });
    const job = await owner.as.mutation(api.modules.privacy.exportJobs.create, {});
    await drainExport(t);
    const status = await owner.as.query(api.modules.privacy.exportJobs.status, { jobId: job.jobId });
    const chunks = await Promise.all(Array.from({ length: status.chunks }, (_, sequence) => owner.as.query(api.modules.privacy.exportJobs.chunk, { jobId: job.jobId, sequence })));
    const exportedTitles = chunks.flatMap((chunk) => {
      if (!chunk?.json) return [];
      const payload = JSON.parse(chunk.json) as { table?: string; row?: { title?: string } };
      return payload.table === "contentPieces" && payload.row?.title ? [payload.row.title] : [];
    });
    expect(status.status).toBe("succeeded");
    expect(exportedTitles).toEqual(expect.arrayContaining(["First distinct content", "Second distinct content"]));
  });

  it("exports project content for a sole active organization member", async () => {
    const t = newBackend();
    const organizationOwner = await seedUser(t);
    const member = await seedUser(t, { email: "sole-active-member@example.com" });
    const { projectId } = await t.run(async (ctx) => {
      const organizationId = await ctx.db.insert("organizations", { name: "Member-only active workspace", kind: "business", ownerId: organizationOwner.userId as Id<"users">, createdAt: 1, updatedAt: 1 });
      await ctx.db.insert("memberships", { organizationId, userId: member.userId as Id<"users">, role: "member", status: "active", createdAt: 1, updatedAt: 1 });
      const projectId = await ctx.db.insert("projects", { ownerId: organizationOwner.userId as Id<"users">, organizationId, name: "Member export", createdAt: 1 });
      await ctx.db.insert("contentPieces", { projectId, title: "Member content", status: "draft", createdBy: organizationOwner.userId as Id<"users">, createdAt: 1, updatedAt: 1 });
      return { projectId };
    });
    const job = await member.as.mutation(api.modules.privacy.exportJobs.createProject, { projectId: projectId as Id<"projects"> });
    await drainExport(t);
    const status = await member.as.query(api.modules.privacy.exportJobs.status, { jobId: job.jobId });
    const chunks = await Promise.all(Array.from({ length: status.chunks }, (_, sequence) => member.as.query(api.modules.privacy.exportJobs.chunk, { jobId: job.jobId, sequence })));
    expect(status.status).toBe("succeeded");
    expect(chunks.some((chunk) => chunk?.json && JSON.parse(chunk.json).row?.title === "Member content")).toBe(true);
  });

  it("fails an explicit project export when another active organization member exists", async () => {
    const t = newBackend();
    const owner = await seedUser(t);
    const inactiveOne = await seedUser(t, { email: "inactive-one@example.com" });
    const inactiveTwo = await seedUser(t, { email: "inactive-two@example.com" });
    const member = await seedUser(t, { email: "shared-explicit-export@example.com" });
    const projectId = await t.run(async (ctx) => {
      const organizationId = await ctx.db.insert("organizations", { name: "Shared export", kind: "business", ownerId: owner.userId as Id<"users">, createdAt: 1, updatedAt: 1 });
      await ctx.db.insert("memberships", { organizationId, userId: owner.userId as Id<"users">, role: "owner", status: "active", createdAt: 1, updatedAt: 1 });
      await ctx.db.insert("memberships", { organizationId, userId: inactiveOne.userId as Id<"users">, role: "member", status: "inactive", createdAt: 1, updatedAt: 1 });
      await ctx.db.insert("memberships", { organizationId, userId: inactiveTwo.userId as Id<"users">, role: "member", status: "inactive", createdAt: 1, updatedAt: 1 });
      await ctx.db.insert("memberships", { organizationId, userId: member.userId as Id<"users">, role: "member", status: "active", createdAt: 1, updatedAt: 1 });
      const projectId = await ctx.db.insert("projects", { ownerId: owner.userId as Id<"users">, organizationId, name: "Shared project export", createdAt: 1 });
      await ctx.db.insert("contentPieces", { projectId, title: "Shared record", status: "draft", createdBy: owner.userId as Id<"users">, createdAt: 1, updatedAt: 1 });
      return projectId;
    });
    const job = await owner.as.mutation(api.modules.privacy.exportJobs.createProject, { projectId: projectId as Id<"projects"> });
    await drainExport(t);
    await expect(owner.as.query(api.modules.privacy.exportJobs.status, { jobId: job.jobId })).resolves.toMatchObject({
      status: "failed",
      reason: "Project export is unavailable while another active organization member shares this project. Use an account export for personal data; shared project data is omitted.",
    });
    const chunk = await owner.as.query(api.modules.privacy.exportJobs.chunk, { jobId: job.jobId, sequence: 0 });
    expect(chunk?.json).toBeUndefined();

    const accountJob = await owner.as.mutation(api.modules.privacy.exportJobs.create, {});
    await drainExport(t);
    const accountStatus = await owner.as.query(api.modules.privacy.exportJobs.status, { jobId: accountJob.jobId });
    const accountChunks = await Promise.all(Array.from({ length: accountStatus.chunks }, (_, sequence) => owner.as.query(api.modules.privacy.exportJobs.chunk, { jobId: accountJob.jobId, sequence })));
    expect(accountChunks.some((entry) => entry?.json && JSON.parse(entry.json).project?._id === projectId)).toBe(false);
    expect(accountChunks.some((entry) => entry?.json && JSON.parse(entry.json).omittedSharedProject === true)).toBe(true);
  });

  it("stops an account export when a new active organization member joins mid-project", async () => {
    const t = newBackend();
    const owner = await seedUser(t);
    const member = await seedUser(t, { email: "joins-during-export@example.com" });
    const projectId = await t.run(async (ctx) => {
      const organizationId = await ctx.db.insert("organizations", { name: "Membership changes during export", kind: "business", ownerId: owner.userId as Id<"users">, createdAt: 1, updatedAt: 1 });
      await ctx.db.insert("memberships", { organizationId, userId: owner.userId as Id<"users">, role: "owner", status: "active", createdAt: 1, updatedAt: 1 });
      const projectId = await ctx.db.insert("projects", { ownerId: owner.userId as Id<"users">, organizationId, name: "Private until shared", createdAt: 1 });
      await ctx.db.insert("contentPieces", { projectId, title: "Never leak after membership change", status: "draft", createdBy: owner.userId as Id<"users">, createdAt: 1, updatedAt: 1 });
      return projectId;
    });
    const job = await owner.as.mutation(api.modules.privacy.exportJobs.create, {});
    await t.mutation(internal.modules.privacy.exportJobs.processBatch, { now: 20 });
    await t.run(async (ctx) => {
      const project = await ctx.db.get(projectId);
      if (!project?.organizationId) throw new Error("expected organization project");
      await ctx.db.insert("memberships", { organizationId: project.organizationId, userId: member.userId as Id<"users">, role: "member", status: "active", createdAt: 2, updatedAt: 2 });
    });
    await expect(owner.as.query(api.modules.privacy.exportJobs.chunk, { jobId: job.jobId, sequence: 1 })).resolves.toBeNull();
    await drainExport(t);
    const status = await owner.as.query(api.modules.privacy.exportJobs.status, { jobId: job.jobId });
    const chunks = await Promise.all(Array.from({ length: status.chunks }, (_, sequence) => owner.as.query(api.modules.privacy.exportJobs.chunk, { jobId: job.jobId, sequence })));
    expect(chunks.some((chunk) => chunk?.json && JSON.stringify(JSON.parse(chunk.json)).includes("Never leak after membership change"))).toBe(false);
  });

  it("stops a project export after ownership transfer and withholds prior chunks", async () => {
    const t = newBackend();
    const owner = await seedUser(t);
    const successor = await seedUser(t, { email: "project-export-successor@example.com" });
    const projectId = await seedProject(t, owner.userId);
    await t.run((ctx) => ctx.db.insert("contentPieces", { projectId: projectId as Id<"projects">, title: "Old owner export row", status: "draft", createdBy: owner.userId as Id<"users">, createdAt: 1, updatedAt: 1 }));
    const job = await owner.as.mutation(api.modules.privacy.exportJobs.createProject, { projectId: projectId as Id<"projects"> });
    await t.mutation(internal.modules.privacy.exportJobs.processBatch, { now: 20 });
    const oldChunk = await owner.as.query(api.modules.privacy.exportJobs.chunk, { jobId: job.jobId, sequence: 1 });
    expect(oldChunk).toBeTruthy();
    await t.run((ctx) => ctx.db.patch(projectId as Id<"projects">, { ownerId: successor.userId as Id<"users"> }));
    await drainExport(t);
    await expect(owner.as.query(api.modules.privacy.exportJobs.status, { jobId: job.jobId })).resolves.toMatchObject({ status: "failed", reason: "Project access changed before export." });
    await expect(owner.as.query(api.modules.privacy.exportJobs.chunk, { jobId: job.jobId, sequence: 1 })).resolves.toBeNull();
  });

  it("rechecks active organization membership after a project export is queued", async () => {
    const t = newBackend();
    const organizationOwner = await seedUser(t);
    const member = await seedUser(t, { email: "revoked-export@example.com" });
    const { projectId, membershipId } = await t.run(async (ctx) => {
      const organizationId = await ctx.db.insert("organizations", { name: "Membership revoked after queue", kind: "business", ownerId: organizationOwner.userId as Id<"users">, createdAt: 1, updatedAt: 1 });
      const membershipId = await ctx.db.insert("memberships", { organizationId, userId: member.userId as Id<"users">, role: "member", status: "active", createdAt: 1, updatedAt: 1 });
      const projectId = await ctx.db.insert("projects", { ownerId: organizationOwner.userId as Id<"users">, organizationId, name: "Revoked member export", createdAt: 1 });
      return { projectId, membershipId };
    });
    const job = await member.as.mutation(api.modules.privacy.exportJobs.createProject, { projectId: projectId as Id<"projects"> });
    await t.run((ctx) => ctx.db.patch(membershipId, { status: "suspended" }));
    await drainExport(t);
    await expect(member.as.query(api.modules.privacy.exportJobs.status, { jobId: job.jobId })).resolves.toMatchObject({ status: "failed", reason: "Project access changed before export." });
  });

  it("gives an older running export a turn while a newer export remains queued", async () => {
    const t = newBackend();
    const owner = await seedUser(t);
    const queuedProjectId = await seedProject(t, owner.userId, "Queued project export");
    const { runningId, queuedId } = await t.run(async (ctx) => {
      const runningId = await ctx.db.insert("privacyJobs", { kind: "account_export", userId: owner.userId as Id<"users">, status: "running", idempotencyKey: "old-running-export", requestedAt: 1, cursor: JSON.stringify({ mode: "account", projectCursor: null, tableIndex: 0, rowCursor: null, parentId: null, parentCursor: null, parentDone: false, sequence: 0 }), completedCount: 0, lastServedAt: 1, createdAt: 1, updatedAt: 1 });
      const queuedId = await ctx.db.insert("privacyJobs", { kind: "project_export", userId: owner.userId as Id<"users">, status: "queued", idempotencyKey: "new-queued-export", requestedAt: 2, cursor: JSON.stringify({ mode: "project", projectId: queuedProjectId, projectCursor: null, tableIndex: 0, rowCursor: null, parentId: null, parentCursor: null, parentDone: false, sequence: 0 }), completedCount: 0, lastServedAt: 2, createdAt: 2, updatedAt: 2 });
      return { runningId, queuedId };
    });
    await t.mutation(internal.modules.privacy.exportJobs.processBatch, { now: 20 });
    const after = await t.run(async (ctx) => ({ running: await ctx.db.get(runningId), queued: await ctx.db.get(queuedId) }));
    expect(after.running?.completedCount).toBe(1);
    expect(after.queued?.status).toBe("queued");
  });

  it("exports authorized content in bounded chunks and excludes credentials and storage bytes", async () => {
    const t = newBackend();
    const user = await seedUser(t);
    const projectId = await seedProject(t, user.userId);
    await t.run(async (ctx) => {
      await ctx.db.insert("contentPieces", { projectId: projectId as Id<"projects">, title: "Export me", topic: "proof", status: "draft", createdBy: user.userId as Id<"users">, createdAt: 10, updatedAt: 10 });
      await ctx.db.insert("socialCredentials", { projectId: projectId as Id<"projects">, platform: "test-provider", accessToken: "never-export-this", connectedBy: user.userId as Id<"users">, createdAt: 10, updatedAt: 10 });
    });
    const job = await user.as.mutation(api.modules.privacy.exportJobs.create, {});
    const profileChunk = await user.as.query(api.modules.privacy.exportJobs.chunk, { jobId: job.jobId, sequence: 0 });
    expect(JSON.parse(profileChunk!.json)).toMatchObject({ storageBytesIncluded: false });
    await drainExport(t);
    const status = await user.as.query(api.modules.privacy.exportJobs.status, { jobId: job.jobId });
    expect(status.status).toBe("succeeded");
    expect(status.chunks).toBeGreaterThanOrEqual(2);
    const chunks = await Promise.all(Array.from({ length: status.chunks }, (_, sequence) => user.as.query(api.modules.privacy.exportJobs.chunk, { jobId: job.jobId, sequence })));
    const projectRow = chunks.find((chunk) => chunk?.json && JSON.parse(chunk.json).row?.title === "Export me");
    expect(JSON.parse(profileChunk!.json)).toMatchObject({ storageBytesIncluded: false });
    expect(JSON.parse(projectRow!.json)).toMatchObject({ table: "contentPieces", row: { title: "Export me" } });
    expect(JSON.parse(projectRow!.json).excludedTables).toEqual(expect.arrayContaining(["socialCredentials", "adsCredentials", "oauthStates"]));
    expect(JSON.stringify([profileChunk, projectRow])).not.toContain("never-export-this");
    const storedChunks = await t.run((ctx) => ctx.db.query("privacyExportChunks").withIndex("by_job_sequence", (q) => q.eq("jobId", job.jobId)).collect());
    expect(storedChunks.every((chunk) => chunk.bytes <= EXPORT_CHUNK_MAX_BYTES && chunk.bytes === new TextEncoder().encode(chunk.json).byteLength)).toBe(true);
  });

  it("marks a row larger than the chunk limit failed instead of retrying forever", async () => {
    const t = newBackend();
    const user = await seedUser(t);
    const projectId = await seedProject(t, user.userId);
    await t.run((ctx) => ctx.db.insert("contentPieces", {
      projectId: projectId as Id<"projects">, title: "Oversize", body: "x".repeat(EXPORT_CHUNK_MAX_BYTES + 100),
      status: "draft", createdBy: user.userId as Id<"users">, createdAt: 10, updatedAt: 10,
    }));
    const job = await user.as.mutation(api.modules.privacy.exportJobs.createProject, { projectId: projectId as Id<"projects"> });
    await drainExport(t);
    await expect(user.as.query(api.modules.privacy.exportJobs.status, { jobId: job.jobId })).resolves.toMatchObject({ status: "failed", reason: expect.stringContaining("exceeds the") });
  });

  it("does not export shared project records to a personal archive", async () => {
    const t = newBackend();
    const owner = await seedUser(t);
    const member = await seedUser(t, { email: "member@example.com" });
    const organizationId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("organizations", { name: "Shared", kind: "business", ownerId: owner.userId as Id<"users">, createdAt: 1, updatedAt: 1 });
      await ctx.db.insert("memberships", { organizationId: id, userId: owner.userId as Id<"users">, role: "owner", status: "active", createdAt: 1, updatedAt: 1 });
      await ctx.db.insert("memberships", { organizationId: id, userId: member.userId as Id<"users">, role: "member", status: "active", createdAt: 1, updatedAt: 1 });
      return id;
    });
    await t.run((ctx) => ctx.db.insert("projects", { ownerId: owner.userId as Id<"users">, organizationId, name: "Shared project", createdAt: 1 }));
    const job = await owner.as.mutation(api.modules.privacy.exportJobs.create, {});
    await drainExport(t);
    const chunk = await owner.as.query(api.modules.privacy.exportJobs.chunk, { jobId: job.jobId, sequence: 1 });
    expect(JSON.parse(chunk!.json)).toMatchObject({ omittedSharedProject: true });
    await expect(member.as.query(api.modules.privacy.exportJobs.chunk, { jobId: job.jobId, sequence: 1 })).rejects.toThrow();
  });
});
