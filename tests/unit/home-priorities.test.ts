import { describe, expect, it } from "vitest";
import { api } from "@/convex/_generated/api";
import {
  rankHomePriorities,
  type HomePrioritiesInput,
} from "@/shared/homePriorities";
import {
  FOR_YOU_NOW_EMPTY,
  forYouNowAnnouncement,
  forYouNowTone,
  sinceSubline,
} from "@/components/app/next-action-model";
import { STARTER_KIT_PART_STATUSES, STARTER_KIT_STATUSES } from "@/shared/starterKit";
import { newBackend, seedUser } from "./helpers";

// HM-1: home.priorities query and its pure ranking model
// (docs/integration/2026-09-25/MVP-BLUEPRINT-PLAN.md §2 row 6, §5).

const BASE: HomePrioritiesInput = {
  projectId: "p1",
  kit: null,
  build: { included: false, website: "none" },
  promote: { included: false },
  profile: { complete: true },
  contactable: true,
  posts: { drafted: 0, missingPictures: 0 },
  since: null,
};

describe("rankHomePriorities (pure)", () => {
  it("an empty project (no kit, nothing saved) asks to check \"Your answers\"", () => {
    const items = rankHomePriorities({
      ...BASE,
      profile: { complete: false },
      contactable: false,
    });
    expect(items.map((i) => i.kind)).toEqual(["needs_you", "next", "next"]);
    expect(items[0]).toMatchObject({
      id: "needs-you-profile",
      title: "Check your answers",
      state: "needs_input",
    });
    // #27's "Your answers" section lives on Edit project's first tab.
    expect(items[0].action).toEqual({
      kind: "link",
      label: "Open your answers",
      to: "/app/p1?edit=understanding",
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
      projectId: "p1",
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

describe("rankHomePriorities actions never link Home to itself", () => {
  const kits: HomePrioritiesInput["kit"][] = [null];
  for (const status of STARTER_KIT_STATUSES) {
    for (const part of STARTER_KIT_PART_STATUSES) {
      kits.push({
        status,
        parts: { plan: { status: part }, site: { status: "succeeded" }, posts: { status: part } },
      });
    }
  }

  it("no item links to /app or /app/ across every kit, website and profile state", () => {
    for (const kit of kits) {
      for (const website of ["none", "draft", "live"] as const) {
        for (const complete of [true, false]) {
          for (const contactable of [true, false]) {
            const items = rankHomePriorities({
              ...BASE,
              kit,
              build: { included: true, website },
              promote: { included: true },
              profile: { complete },
              contactable,
              posts: { drafted: 2, missingPictures: complete ? 0 : 1 },
            });
            for (const item of items) {
              const action: { to?: unknown } = item.action;
              if (typeof action.to === "string") {
                expect(["/app", "/app/"]).not.toContain(action.to);
              }
            }
          }
        }
      }
    }
  });

  it("kit items use in-page intents; a failed part retries by name", () => {
    const working = rankHomePriorities({
      ...BASE,
      kit: {
        status: "running",
        parts: { plan: { status: "running" }, site: { status: "queued" }, posts: { status: "queued" } },
      },
    });
    expect(working[0].action).toMatchObject({ kind: "intent", intent: "show_kit_progress" });

    const failed = rankHomePriorities({
      ...BASE,
      kit: {
        status: "partially_succeeded",
        parts: { plan: { status: "succeeded" }, site: { status: "failed" }, posts: { status: "succeeded" } },
      },
    });
    expect(failed[0].action).toMatchObject({ kind: "intent", intent: "retry_kit_part", part: "site" });

    const waiting = rankHomePriorities({
      ...BASE,
      kit: {
        status: "waiting_for_user",
        parts: { plan: { status: "succeeded" }, site: { status: "queued" }, posts: { status: "queued" } },
      },
    });
    expect(waiting[0].action).toMatchObject({ kind: "intent", intent: "open_kit" });

    expect(rankHomePriorities(BASE)[0].action).toMatchObject({ kind: "intent", intent: "start_kit" });
  });
});

// HM-2: goal- and channel-aware ranking, real routes, stale kits.
const FINISHED_KIT: HomePrioritiesInput["kit"] = {
  status: "succeeded",
  parts: { plan: { status: "succeeded" }, site: { status: "succeeded" }, posts: { status: "succeeded" } },
};
const READY: HomePrioritiesInput = {
  ...BASE,
  kit: FINISHED_KIT,
  build: { included: true, website: "draft" },
  promote: { included: true },
  posts: { drafted: 7, missingPictures: 0 },
};

describe("rankHomePriorities is goal and channel aware (HM-2)", () => {
  it("does not rank \"Use this week's posts\" when the owner posts nowhere", () => {
    for (const postingChannels of [[], ["none"]] as const) {
      const ids = rankHomePriorities({ ...READY, postingChannels }).map((i) => i.id);
      expect(ids).toEqual(["ready-site"]);
    }
    // Missing pictures are not nagged about either.
    const pictures = rankHomePriorities({
      ...READY,
      postingChannels: [],
      posts: { drafted: 7, missingPictures: 3 },
    });
    expect(pictures.map((i) => i.id)).not.toContain("needs-you-pictures");
  });

  it("keeps posts when channels were never answered, and names the channels when they were", () => {
    expect(rankHomePriorities(READY).map((i) => i.id)).toEqual(["ready-site", "ready-posts"]);
    const posts = rankHomePriorities({ ...READY, postingChannels: ["instagram", "facebook"] }).find(
      (i) => i.id === "ready-posts",
    );
    expect(posts?.reason).toBe("7 posts are ready to use for Instagram, Facebook.");
  });

  it("puts posts first for awareness and repeat customers, the website first otherwise", () => {
    for (const primaryGoal of ["awareness", "repeat_customers"] as const) {
      const ids = rankHomePriorities({ ...READY, primaryGoal, postingChannels: ["instagram"] }).map((i) => i.id);
      expect(ids).toEqual(["ready-posts", "ready-site"]);
    }
    for (const primaryGoal of ["bookings", "sales", "online_orders", "visits", "reviews"] as const) {
      const ids = rankHomePriorities({ ...READY, primaryGoal, postingChannels: ["instagram"] }).map((i) => i.id);
      expect(ids).toEqual(["ready-site", "ready-posts"]);
    }
  });

  it("names the owner's goal in the website's \"Why this?\" line", () => {
    const [site] = rankHomePriorities({ ...READY, primaryGoal: "bookings" });
    expect(site.reason).toBe("You want more bookings, and your website draft is ready to look over.");
  });

  it("links to real routes under the project, never a bare module path", () => {
    const items = rankHomePriorities({ ...READY, contactable: false });
    expect(items.map((i) => i.action)).toEqual([
      { kind: "link", label: "Look over your website", to: "/app/p1/build" },
      { kind: "link", label: "Review your posts", to: "/app/p1/promote" },
      { kind: "link", label: "Add contact details", to: "/app/p1?edit=details" },
    ]);
  });

  it("a stale kit is not \"building\": its first unfinished part asks to try again", () => {
    const items = rankHomePriorities({
      ...BASE,
      kit: {
        status: "running",
        stale: true,
        parts: { plan: { status: "succeeded" }, site: { status: "running" }, posts: { status: "queued" } },
      },
    });
    expect(items[0]).toMatchObject({
      id: "needs-you-site",
      kind: "needs_you",
      title: "Your website is not finished yet",
      action: { kind: "intent", intent: "retry_kit_part", part: "site" },
    });
    expect(items.map((i) => i.state)).not.toContain("working");
  });
});

describe("For you now presentation model (HM-2)", () => {
  it("draws a working item as working and other items by kind", () => {
    expect(forYouNowTone({ kind: "next", state: "working" })).toBe("working");
    expect(forYouNowTone({ kind: "needs_you", state: "needs_input" })).toBe("needs_you");
    expect(forYouNowTone({ kind: "ready", state: "ready" })).toBe("ready");
  });

  it("announces the top item, or the empty state", () => {
    expect(forYouNowAnnouncement([{ title: "Look over your website" }, { title: "x" }])).toBe(
      "For you now: Look over your website.",
    );
    expect(forYouNowAnnouncement([])).toBe(`${FOR_YOU_NOW_EMPTY}.`);
    expect(FOR_YOU_NOW_EMPTY).toBe("Nothing needs you right now");
  });

  it("turns the since-last-visit summary into one subline", () => {
    const tuesday = new Date(2026, 8, 22, 10).getTime();
    const friday = new Date(2026, 8, 25, 9).getTime();
    expect(sinceSubline({ since: tuesday, posted: 2, websiteWentLive: true }, friday)).toBe(
      "Since Tuesday: 2 posts went out; your website is live",
    );
    expect(sinceSubline({ since: friday - 60_000, newContacts: 1 }, friday)).toBe("Since earlier today: 1 new contact");
    expect(sinceSubline({ since: friday - 30 * 86_400_000, posted: 1 }, friday)).toBe(
      "Since your last visit: 1 post went out",
    );
    expect(sinceSubline({ since: tuesday }, friday)).toBeNull();
    expect(sinceSubline(null, friday)).toBeNull();
  });
});

describe("home.priorities reads the owner's answers (convex-test)", () => {
  it("drops ready posts for an owner who posts nowhere yet", async () => {
    const t = newBackend();
    const owner = await seedUser(t, { plan: "scale", email: "ch@example.com" });
    const projectId = await owner.as.mutation(api.projects.create, { name: "Bakery" });
    const now = Date.now();
    await t.run(async (ctx) => {
      for (let i = 0; i < 2; i += 1) {
        await ctx.db.insert("posts", {
          projectId,
          channel: "instagram",
          body: `Post ${i}`,
          status: "draft",
          mediaUrl: "https://images.example/p.jpg",
          createdAt: now,
        });
      }
    });
    const before = await owner.as.query(api.home.priorities, { projectId });
    expect(before.map((i) => i.id)).toContain("ready-posts");
    expect(before.find((i) => i.id === "ready-posts")?.action).toMatchObject({ to: `/app/${projectId}/promote` });

    await t.run((ctx) => ctx.db.patch(projectId, { postingChannels: ["none"], primaryGoal: "awareness" }));
    const after = await owner.as.query(api.home.priorities, { projectId });
    expect(after.map((i) => i.id)).not.toContain("ready-posts");
  });
});
