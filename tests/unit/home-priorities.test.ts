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
  build: { included: false, live: false },
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
      profile: { complete: false, missingReason: "We don't know what you offer yet." },
      contactable: false,
    });
    expect(items.map((i) => i.kind)).toEqual(["needs_you", "next"]);
    expect(items[0]).toMatchObject({
      id: "needs-you-profile",
      title: "Finish your business details",
      reason: "We don't know what you offer yet.",
      state: "needs_input",
    });
    expect(items[1].id).toBe("next-contact");
  });

  it("collapses a running kit into one working item, ignoring everything else", () => {
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

  it("a queued or waiting_for_user kit also collapses (not just running)", () => {
    for (const status of ["queued", "waiting_for_user"] as const) {
      const items = rankHomePriorities({
        ...BASE,
        kit: {
          status,
          parts: {
            plan: { status: "queued" },
            site: { status: "queued" },
            posts: { status: "queued" },
          },
        },
      });
      expect(items).toHaveLength(1);
      expect(items[0].state).toBe("working");
    }
  });

  it("a finished kit with posts missing pictures asks for pictures first", () => {
    const items = rankHomePriorities({
      ...BASE,
      kit: {
        status: "partially_succeeded",
        parts: {
          plan: { status: "succeeded" },
          site: { status: "succeeded" },
          posts: { status: "partially_succeeded" },
        },
      },
      build: { included: true, live: false },
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
      build: { included: true, live: false },
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
      build: { included: true, live: false },
      promote: { included: true },
      posts: { drafted: 7, missingPictures: 0 },
    });
    expect(items.map((i) => i.id)).toEqual(["ready-site", "ready-posts"]);
    expect(items.every((i) => i.reason.length > 0)).toBe(true);
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
      build: { included: true, live: true },
      promote: { included: true },
      posts: { drafted: 7, missingPictures: 0 },
    });
    expect(items.map((i) => i.id)).not.toContain("ready-site");
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
      build: { included: true, live: true },
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
      build: { included: true, live: false },
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
      build: { included: true, live: false },
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
  it("a brand new project with nothing saved asks to finish details", async () => {
    const t = newBackend();
    const owner = await seedUser(t, { plan: "scale", email: "o@example.com" });
    const projectId = await owner.as.mutation(api.projects.create, { name: "Bakery" });
    const items = await owner.as.query(api.home.priorities, { projectId });
    expect(items.length).toBeGreaterThan(0);
    expect(items[0].kind).toBe("needs_you");
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

  it("a foreign org cannot read another tenant's priorities", async () => {
    const t = newBackend();
    const alice = await seedUser(t, { plan: "scale", email: "a@example.com" });
    const bob = await seedUser(t, { plan: "scale", email: "b@example.com" });
    await bob.as.mutation(api.projects.create, { name: "Bob's" });
    const projectId = await alice.as.mutation(api.projects.create, { name: "Alice's" });
    expect(await bob.as.query(api.home.priorities, { projectId })).toEqual([]);
  });
});
