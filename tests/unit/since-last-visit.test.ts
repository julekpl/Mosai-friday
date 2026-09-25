import { describe, expect, it } from "vitest";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { sinceLines, summarizeSinceLastVisit } from "@/shared/sinceLastVisit";
import { newBackend, seedUser } from "./helpers";
import { buildFunctionRegistry } from "./function-registry";

const SINCE = 1_000;

describe("U7 — summarizeSinceLastVisit (pure)", () => {
  it("returns null when nothing changed", () => {
    expect(
      summarizeSinceLastVisit({
        since: SINCE,
        posts: [{ status: "published", providerRef: "p1", publishedAt: SINCE - 1 }],
        contacts: [{ createdAt: SINCE - 5 }],
        deployments: [{ state: "succeeded", finishedAt: SINCE - 1, updatedAt: SINCE - 1 }],
      }),
    ).toBeNull();
    expect(
      summarizeSinceLastVisit({ since: SINCE, posts: [], contacts: [], deployments: [] }),
    ).toBeNull();
  });

  it("does not count a published post without providerRef", () => {
    const summary = summarizeSinceLastVisit({
      since: SINCE,
      posts: [
        { status: "published", publishedAt: SINCE + 1 },
        { status: "published", providerRef: "  ", publishedAt: SINCE + 1 },
        { status: "published", providerRef: "ok", publishedAt: SINCE + 1 },
      ],
      contacts: null,
      deployments: null,
    });
    expect(summary).toEqual({ since: SINCE, posted: 1 });
  });

  it("does not count a scheduled post as posted", () => {
    expect(
      summarizeSinceLastVisit({
        since: SINCE,
        posts: [{ status: "scheduled", providerRef: "x", publishedAt: SINCE + 1 }],
        contacts: null,
        deployments: null,
      }),
    ).toBeNull();
  });

  it("omits a locked module instead of showing 0", () => {
    const summary = summarizeSinceLastVisit({
      since: SINCE,
      posts: null,
      contacts: [{ createdAt: SINCE + 1 }, { createdAt: SINCE + 2 }],
      deployments: null,
    });
    expect(summary).toEqual({ since: SINCE, newContacts: 2 });
    expect(summary && "posted" in summary).toBe(false);
    expect(summary && "websiteWentLive" in summary).toBe(false);
  });

  it("counts only a succeeded deployment after since as live", () => {
    expect(
      summarizeSinceLastVisit({
        since: SINCE,
        posts: null,
        contacts: null,
        deployments: [{ state: "running", updatedAt: SINCE + 5 }],
      }),
    ).toBeNull();
    expect(
      summarizeSinceLastVisit({
        since: SINCE,
        posts: null,
        contacts: null,
        deployments: [{ state: "succeeded", finishedAt: SINCE + 5, updatedAt: SINCE + 5 }],
      }),
    ).toEqual({ since: SINCE, websiteWentLive: true });
  });

  it("uses plain words", () => {
    expect(sinceLines({ since: 0, posted: 3, newContacts: 1, websiteWentLive: true })).toEqual([
      "3 posts went out",
      "1 new contact",
      "Your website is live",
    ]);
  });
});

describe("U7 — visits functions (convex-test)", () => {
  it("sinceLastVisit returns null on the first visit", async () => {
    const t = newBackend();
    const owner = await seedUser(t, { plan: "scale", email: "o@example.com" });
    const projectId = await owner.as.mutation(api.projects.create, { name: "P" });
    expect(await owner.as.query(api.visits.sinceLastVisit, { projectId })).toBeNull();
  });

  it("markSeen upserts only the caller's row; members are independent", async () => {
    const t = newBackend();
    const owner = await seedUser(t, { plan: "scale", email: "owner@example.com" });
    const member = await seedUser(t, { plan: "scale", email: "member@example.com" });
    const organizationId = await owner.as.mutation(api.organizations.create, {
      name: "Acme Inc",
      kind: "business",
    });
    const invite = await owner.as.mutation(api.organizations.invite, {
      organizationId,
      email: "member@example.com",
      role: "member",
    });
    await member.as.mutation(api.organizations.acceptInvitation, { token: invite.token });
    const projectId = await owner.as.mutation(api.projects.create, { name: "Acme" });
    await t.run((ctx) => ctx.db.patch(projectId, { organizationId }));

    await owner.as.mutation(api.visits.markSeen, { projectId });
    await owner.as.mutation(api.visits.markSeen, { projectId });
    const rows = () =>
      t.run((ctx) =>
        ctx.db
          .query("projectVisits")
          .withIndex("by_project", (q) => q.eq("projectId", projectId))
          .collect(),
      );
    let all = await rows();
    expect(all).toHaveLength(1);
    expect(all[0].userId).toBe(owner.userId);
    const ownerSeen = all[0].lastSeenAt;

    // Backdate the owner so a change is visible to them but not the member.
    await t.run((ctx) => ctx.db.patch(all[0]._id, { lastSeenAt: 0 }));
    await member.as.mutation(api.visits.markSeen, { projectId });
    all = await rows();
    expect(all).toHaveLength(2);
    const ownerRow = all.find((r) => r.userId === owner.userId);
    const memberRow = all.find((r) => r.userId === member.userId);
    expect(ownerRow?.lastSeenAt).toBe(0);
    expect(memberRow?.lastSeenAt).toBeGreaterThanOrEqual(ownerSeen);

    const now = Date.now();
    await t.run(async (ctx) => {
      await ctx.db.insert("contacts", { projectId, createdAt: now });
      await ctx.db.insert("posts", {
        projectId,
        channel: "facebook",
        body: "hi",
        status: "published",
        providerRef: "fb_1",
        publishedAt: now,
        createdAt: now,
      });
      await ctx.db.insert("posts", {
        projectId,
        channel: "facebook",
        body: "no receipt",
        status: "published",
        publishedAt: now,
        createdAt: now,
      });
    });
    const summary = await owner.as.query(api.visits.sinceLastVisit, { projectId });
    expect(summary).toMatchObject({ since: 0, posted: 1, newContacts: 1 });
    expect(summary?.websiteWentLive).toBeUndefined();
  });

  it("a foreign org cannot mark or read another tenant's visits", async () => {
    const t = newBackend();
    const alice = await seedUser(t, { plan: "scale", email: "a@example.com" });
    const bob = await seedUser(t, { plan: "scale", email: "b@example.com" });
    await bob.as.mutation(api.projects.create, { name: "Bob" });
    const projectId = (await alice.as.mutation(api.projects.create, {
      name: "Alice",
    })) as Id<"projects">;
    await alice.as.mutation(api.visits.markSeen, { projectId });
    await expect(bob.as.mutation(api.visits.markSeen, { projectId })).rejects.toThrow();
    expect(await bob.as.query(api.visits.sinceLastVisit, { projectId })).toBeNull();
  });

  it("the generated cross-tenant suite picks up visits.*", () => {
    const names = buildFunctionRegistry()
      .filter((e) => e.tenantScoped)
      .map((e) => e.name);
    expect(names).toEqual(
      expect.arrayContaining(["visits:sinceLastVisit", "visits:markSeen"]),
    );
  });
});
