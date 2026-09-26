import { describe, expect, it } from "vitest";
import { api } from "@/convex/_generated/api";
import {
  rankHomePriorities,
  type HomePrioritiesInput,
} from "@/shared/homePriorities";
import { newBackend, seedUser } from "./helpers";

// HM-1: home.priorities query and its pure ranking model
// (docs/integration/2026-09-25/MVP-BLUEPRINT-PLAN.md §2 row 6, §5).

const BASE: HomePrioritiesInput = {
  kit: null,
  build: { included: false, website: "none" },
  promote: { included: false },
  profile: { complete: true },
  contactable: true,
  posts: { drafted: 0, missingPictures: 0 },
  since: null,
};

describe("rankHomePriorities (pure)", () => {
  it("an empty project (no kit, nothing saved) asks to finish details", () => {
    const items = rankHomePriorities({
      ...BASE,
      profile: { complete: false },
      contactable: false,
    });
    expect(items.map((i) => i.kind)).toEqual(["needs_you", "next", "next"]);
    expect(items[0]).toMatchObject({
      id: "needs-you-profile",
      title: "Finish your business details",
      state: "needs_input",
    });
    expect(items[1].id).toBe("next-start-kit");
    expect(items[2].id).toBe("next-contact");
  });

  it("no kit, but a complete profile: still never empty (Start your kit)", () => {
    const items = rankHomePriorities({
      ...BASE,
      profile: { complete: true },
      contactable: true,
    });
    expect(items).toEqual([
      expect.objectContaining({ id: "next-start-kit", kind: "next", state: "ready" }),
    ]);
  });

  it("an older project with a draft site and posts, but no kit, never mentions the kit", () => {
    const items = rankHomePriorities({
      ...BASE,
      build: { included: true, website: "draft" },
      promote: { included: true },
      posts: { drafted: 4, missingPictures: 0 },
    });
    expect(items.map((i) => i.id)).toEqual(["ready-site", "ready-posts"]);
    expect(items.map((i) => i.id)).not.toContain("next-start-kit");
  });

  it("collapses an actively drafting kit into one working item, ignoring everything else", () => {
    const items = rankHomePriorities({
      ...BASE,
      kit: {
        status: "running",
        parts: {
          plan: { status: "succeeded" },
          site: { status: "running" },
          posts: { status: "queued" },
        },
      },
      profile: { complete: false },
      contactable: false,
    });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: "next", state: "working", id: "kit-working" });
  });

  it("a queued kit also collapses (not just running)", () => {
    const items = rankHomePriorities({
      ...BASE,
      kit: {
        status: "queued",
        parts: {
          plan: { status: "queued" },
          site: { status: "queued" },
          posts: { status: "queued" },
        },
      },
    });
    expect(items).toHaveLength(1);
    expect(items[0].state).toBe("working");
  });

  it("waiting_for_user is a needs_you item, not a silent working one", () => {
    const items = rankHomePriorities({
      ...BASE,
      kit: {
        status: "waiting_for_user",
        parts: {
          plan: { status: "succeeded" },
          site: { status: "queued" },
          posts: { status: "queued" },
        },
      },
    });
    expect(items[0]).toMatchObject({
      id: "needs-you-kit",
      kind: "needs_you",
      state: "needs_input",
    });
    expect(items[0].state).not.toBe("working");
  });

  it("posts missing pictures asks for pictures, even when the posts part succeeded", () => {
    const items = rankHomePriorities({
      ...BASE,
      kit: {
        status: "succeeded",
        parts: {
          plan: { status: "succeeded" },
          site: { status: "succeeded" },
          posts: { status: "succeeded" },
        },
      },
      build: { included: true, website: "draft" },
      promote: { included: true },
      posts: { drafted: 7, missingPictures: 3 },
    });
    expect(items[0]).toMatchObject({
      kind: "needs_you",
      id: "needs-you-pictures",
      reason: "3 posts need a picture.",
    });
    // The website draft is still worth a look; posts stay off the "ready"
    // list until every picture is filled in.
    expect(items.map((i) => i.id)).toEqual(["needs-you-pictures", "ready-site"]);
  });

  it("a failed kit part takes priority over a picture gap or an incomplete profile", () => {
    const items = rankHomePriorities({
      ...BASE,
      kit: {
        status: "partially_succeeded",
        parts: {
          plan: { status: "succeeded" },
          site: { status: "failed" },
          posts: { status: "partially_succeeded" },
        },
      },
      build: { included: true, website: "none" },
      promote: { included: true },
      profile: { complete: false },
      posts: { drafted: 7, missingPictures: 2 },
    });
    expect(items[0]).toMatchObject({ id: "needs-you-site", kind: "needs_you" });
  });

  it("a finished kit with everything ready surfaces the website, then the posts", () => {
    const items = rankHomePriorities({
      ...BASE,
      kit: {
        status: "succeeded",
        parts: {
          plan: { status: "succeeded" },
          site: { status: "succeeded" },
          posts: { status: "succeeded" },
        },
      },
      build: { included: true, website: "draft" },
      promote: { included: true },
      posts: { drafted: 7, missingPictures: 0 },
    });
    expect(items.map((i) => i.id)).toEqual(["ready-site", "ready-posts"]);
    expect(items.every((i) => i.reason.length > 0)).toBe(true);
  });

  it("a kit that finished without a website asks to make one", () => {
    const items = rankHomePriorities({
      ...BASE,
      kit: {
        status: "succeeded",
        parts: {
          plan: { status: "succeeded" },
          site: { status: "succeeded" },
          posts: { status: "succeeded" },
        },
      },
      build: { included: true, website: "none" },
      promote: { included: true },
      posts: { drafted: 7, missingPictures: 0 },
    });
    expect(items.map((i) => i.id)).toEqual(["next-website", "ready-posts"]);
  });

  it("a website confirmed live drops off the ready list", () => {
    const items = rankHomePriorities({
      ...BASE,
      kit: {
        status: "succeeded",
        parts: {
          plan: { status: "succeeded" },
          site: { status: "succeeded" },
          posts: { status: "succeeded" },
        },
      },
      build: { included: true, website: "live" },
      promote: { included: true },
      posts: { drafted: 7, missingPictures: 0 },
    });
    expect(items.map((i) => i.id)).not.toContain("ready-site");
    expect(items.map((i) => i.id)).not.toContain("next-website");
  });

  it("returning after absence: recent posts are named in the reason", () => {
    const items = rankHomePriorities({
      ...BASE,
      kit: {
        status: "succeeded",
        parts: {
          plan: { status: "succeeded" },
          site: { status: "succeeded" },
          posts: { status: "succeeded" },
        },
      },
      build: { included: true, website: "live" },
      promote: { included: true },
      posts: { drafted: 5, missingPictures: 0 },
      since: { since: 1_000, posted: 2 },
    });
    const readyPosts = items.find((i) => i.id === "ready-posts");
    expect(readyPosts?.reason).toBe("2 posts went out since your last visit. 5 more are ready to use.");
  });

  it("never returns more than 3 items", () => {
    const items = rankHomePriorities({
      kit: {
        status: "partially_succeeded",
        parts: {
          plan: { status: "succeeded" },
          site: { status: "succeeded" },
          posts: { status: "partially_succeeded" },
        },
      },
      build: { included: true, website: "draft" },
      promote: { included: true },
      profile: { complete: false },
      contactable: false,
      posts: { drafted: 7, missingPictures: 2 },
      since: null,
    });
    expect(items.length).toBeLessThanOrEqual(3);
  });

  it("is stable: the same input always ranks the same way", () => {
    const input: HomePrioritiesInput = {
      ...BASE,
      kit: {
        status: "succeeded",
        parts: {
          plan: { status: "succeeded" },
          site: { status: "succeeded" },
          posts: { status: "succeeded" },
        },
      },
      build: { included: true, website: "draft" },
      promote: { included: true },
      posts: { drafted: 3, missingPictures: 0 },
    };
    expect(rankHomePriorities(input)).toEqual(rankHomePriorities(input));
    expect(rankHomePriorities(input).map((i) => i.id)).toEqual(["ready-site", "ready-posts"]);
  });

  it("never exposes a numeric score", () => {
    const items = rankHomePriorities({
      ...BASE,
      profile: { complete: false },
      contactable: false,
    });
    for (const item of items) {
      expect(item).not.toHaveProperty("score");
    }
  });
});

describe("home.priorities (convex-test)", () => {
  it("a brand new project with nothing saved is never empty (Start your kit)", async () => {
    const t = newBackend();
    const owner = await seedUser(t, { plan: "scale", email: "o@example.com" });
    const projectId = await owner.as.mutation(api.projects.create, { name: "Bakery" });
    const items = await owner.as.query(api.home.priorities, { projectId });
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.reason.length > 0)).toBe(true);
    expect(items.length).toBeLessThanOrEqual(3);
  });

  it("collapses a running starter kit into one working item", async () => {
    const t = newBackend();
    const owner = await seedUser(t, { plan: "scale", email: "o2@example.com" });
    const projectId = await owner.as.mutation(api.projects.create, { name: "Bakery" });
    const now = Date.now();
    await t.run((ctx) =>
      ctx.db.insert("starterKits", {
        projectId,
        requestedBy: owner.userId,
        idempotencyKey: String(projectId),
        status: "running",
        parts: {
          plan: { status: "succeeded", outputs: [], attempts: 1, updatedAt: now },
          site: { status: "running", outputs: [], attempts: 1, updatedAt: now },
          posts: { status: "queued", outputs: [], attempts: 0, updatedAt: now },
        },
        attempts: 1,
        budgetMicrousd: 400_000,
        spentMicrousd: 0,
        budgetCurrency: "USD",
        createdAt: now,
        updatedAt: now,
      }),
    );
    const items = await owner.as.query(api.home.priorities, { projectId });
    expect(items).toEqual([
      expect.objectContaining({ id: "kit-working", kind: "next", state: "working" }),
    ]);
  });

  it("a kit waiting_for_user is a needs_you item", async () => {
    const t = newBackend();
    const owner = await seedUser(t, { plan: "scale", email: "o3@example.com" });
    const projectId = await owner.as.mutation(api.projects.create, { name: "Bakery" });
    const now = Date.now();
    await t.run((ctx) =>
      ctx.db.insert("starterKits", {
        projectId,
        requestedBy: owner.userId,
        idempotencyKey: String(projectId),
        status: "waiting_for_user",
        parts: {
          plan: { status: "succeeded", outputs: [], attempts: 1, updatedAt: now },
          site: { status: "queued", outputs: [], attempts: 0, updatedAt: now },
          posts: { status: "queued", outputs: [], attempts: 0, updatedAt: now },
        },
        attempts: 1,
        budgetMicrousd: 400_000,
        spentMicrousd: 0,
        budgetCurrency: "USD",
        createdAt: now,
        updatedAt: now,
      }),
    );
    const items = await owner.as.query(api.home.priorities, { projectId });
    expect(items[0]).toMatchObject({ id: "needs-you-kit", kind: "needs_you", state: "needs_input" });
  });

  it("an older project with a draft site but no kit shows the site, not a kit prompt", async () => {
    const t = newBackend();
    const owner = await seedUser(t, { plan: "scale", email: "o4@example.com" });
    const projectId = await owner.as.mutation(api.projects.create, { name: "Bakery" });
    const now = Date.now();
    await t.run((ctx) =>
      ctx.db.insert("builds", {
        projectId,
        name: "Website",
        kind: "website",
        status: "draft",
        createdAt: now,
        updatedAt: now,
      }),
    );
    const items = await owner.as.query(api.home.priorities, { projectId });
    expect(items.map((i) => i.id)).toContain("ready-site");
    expect(items.map((i) => i.id)).not.toContain("next-start-kit");
  });

  it("a foreign org cannot read another tenant's priorities; the owner's own call still works", async () => {
    const t = newBackend();
    const alice = await seedUser(t, { plan: "scale", email: "a@example.com" });
    const bob = await seedUser(t, { plan: "scale", email: "b@example.com" });
    await bob.as.mutation(api.projects.create, { name: "Bob's" });
    const projectId = await alice.as.mutation(api.projects.create, { name: "Alice's" });
    expect(await bob.as.query(api.home.priorities, { projectId })).toEqual([]);
    const aliceItems = await alice.as.query(api.home.priorities, { projectId });
    expect(aliceItems.length).toBeGreaterThan(0);
  });
});
