import { afterEach, describe, expect, it, vi } from "vitest";
import { makeFunctionReference } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  migratePublishedToReleasePrepared,
  migrateReleasePreparedBatch,
} from "@/convex/cmsReleaseMigration";
import {
  isReleasePrepared,
  pageStatusForDisplay,
  revisionStateForDisplay,
} from "@/components/cms/releaseLabels";
import { newBackend, seedUser, type TestBackend } from "./helpers";

/**
 * Owner decision (24 Sep 2026): the page-level `published` state is renamed,
 * additively, to the honest `release_prepared`.
 *
 * Covered here:
 *  - `cmsReleaseMigration.migratePublishedToReleasePrepared` converts every
 *    legacy `published` row on `pageRevisions.state` and `cmsPages.status`,
 *    in batches, leaves other states alone and is idempotent (a re-run
 *    converts nothing);
 *  - readers accept both names during the transition (auto-301 on a slug
 *    move, UI labels);
 *  - client promotion never writes `published` (publish-truth.test.ts has
 *    the serving guarantees).
 *
 * Red-first: before the change the schema had no `release_prepared` literal,
 * the migration module did not exist and `cms.publishPage` wrote
 * `published`, so every test below failed.
 */

const DOC = {
  schemaVersion: 1,
  blocks: [{ id: "blk_hero", type: "hero", version: 1, props: { heading: "Hi" } }],
};

const migrate = makeFunctionReference<"mutation">(
  "cmsReleaseMigration:migratePublishedToReleasePrepared",
);

type Seeded = {
  projectId: Id<"projects">;
  siteId: Id<"sites">;
  pageIds: Id<"cmsPages">[];
};

/** Seed `pages` pages, each with a draft, a superseded and a legacy
 *  `published` revision; every other page carries legacy `published`. */
async function seedLegacy(t: TestBackend, pages: number): Promise<Seeded> {
  const tenant = await seedUser(t, { plan: "starter" });
  const projectId = (await tenant.as.mutation(api.projects.create, {
    name: "p",
  })) as Id<"projects">;
  const userId = tenant.userId as Id<"users">;
  return await t.run(async (ctx) => {
    const now = Date.now();
    const siteId = await ctx.db.insert("sites", {
      projectId,
      name: "Site",
      slug: "site",
      status: "draft",
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    });
    const pageIds: Id<"cmsPages">[] = [];
    for (let i = 0; i < pages; i++) {
      const pageId = await ctx.db.insert("cmsPages", {
        siteId,
        projectId,
        title: `Page ${i}`,
        slug: `page-${i}`,
        fullPath: `/page-${i}`,
        status: i % 2 === 0 ? "published" : "draft",
        createdBy: userId,
        createdAt: now,
        updatedAt: now,
      });
      pageIds.push(pageId);
      const states = ["superseded", "published", "draft"] as const;
      for (const [v, state] of states.entries()) {
        const revId = await ctx.db.insert("pageRevisions", {
          pageId,
          projectId,
          version: v + 1,
          state,
          document: DOC,
          createdBy: userId,
          createdAt: now,
        });
        if (state === "published") {
          await ctx.db.patch(pageId, { publishedRevisionId: revId });
        }
        if (state === "draft") {
          await ctx.db.patch(pageId, { latestDraftRevisionId: revId });
        }
      }
    }
    return { projectId, siteId, pageIds };
  });
}

async function snapshot(t: TestBackend) {
  return await t.run(async (ctx) => ({
    revisions: await ctx.db.query("pageRevisions").collect(),
    pages: await ctx.db.query("cmsPages").collect(),
  }));
}

afterEach(() => {
  vi.useRealTimers();
});

describe("migratePublishedToReleasePrepared", () => {
  it("converts every legacy row in batches and touches nothing else", async () => {
    const t = newBackend();
    await seedLegacy(t, 5);
    const before = await snapshot(t);

    // Step batch by batch (autoContinue off) with a small batch size so the
    // cursor has to carry over several calls on both tables.
    let args: { table?: "pageRevisions" | "cmsPages"; cursor?: string | null } = {};
    let batches = 0;
    let converted = 0;
    for (;;) {
      const result = (await t.mutation(migrate, {
        ...args,
        batchSize: 4,
        autoContinue: false,
      })) as {
        converted: number;
        next: { table: "pageRevisions" | "cmsPages"; cursor: string | null } | null;
      };
      batches += 1;
      converted += result.converted;
      if (!result.next) break;
      args = result.next;
      expect(batches).toBeLessThan(50);
    }
    expect(batches).toBeGreaterThan(2);
    // 5 legacy revisions + 3 legacy pages (indices 0, 2, 4)
    expect(converted).toBe(8);

    const after = await snapshot(t);
    expect(after.revisions.some((r) => r.state === "published")).toBe(false);
    expect(after.pages.some((p) => p.status === "published")).toBe(false);
    for (const r of before.revisions) {
      const now = after.revisions.find((x) => x._id === r._id)!;
      expect(now.state).toBe(r.state === "published" ? "release_prepared" : r.state);
      // Only the state literal changes — content, versions and pointers stay.
      expect(now.document).toEqual(r.document);
      expect(now.version).toBe(r.version);
    }
    for (const p of before.pages) {
      const now = after.pages.find((x) => x._id === p._id)!;
      expect(now.status).toBe(p.status === "published" ? "release_prepared" : p.status);
      expect(now.publishedRevisionId).toBe(p.publishedRevisionId);
      expect(now.latestDraftRevisionId).toBe(p.latestDraftRevisionId);
    }
  });

  it("is idempotent: a second full run converts nothing and changes nothing", async () => {
    vi.useFakeTimers();
    const t = newBackend();
    await seedLegacy(t, 3);

    // Default mode: one call schedules the remaining batches itself.
    await t.mutation(migrate, { batchSize: 2 });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const once = await snapshot(t);
    expect(once.revisions.some((r) => r.state === "published")).toBe(false);
    expect(once.pages.some((p) => p.status === "published")).toBe(false);
    expect(once.revisions.filter((r) => r.state === "release_prepared")).toHaveLength(3);

    // Re-run from the start: every batch reports zero conversions.
    let next: { table: "pageRevisions" | "cmsPages"; cursor: string | null } | null = {
      table: "pageRevisions",
      cursor: null,
    };
    while (next) {
      const r = await t.run((ctx) =>
        migrateReleasePreparedBatch(ctx, { ...next!, batchSize: 2 }),
      );
      expect(r.converted).toBe(0);
      next = r.next;
    }
    const twice = await snapshot(t);
    expect(twice).toEqual(once);
  });

  it("is a no-op on an empty deployment", async () => {
    const t = newBackend();
    const result = (await t.mutation(migrate, { autoContinue: false })) as {
      converted: number;
      next: unknown;
    };
    expect(result.converted).toBe(0);
    expect(result.next).toEqual({ table: "cmsPages", cursor: null });
  });

  it("is registered as an internal mutation (no client can call it)", () => {
    // convex-test does not enforce visibility, so assert the registration.
    const fn = migratePublishedToReleasePrepared as unknown as {
      isInternal?: boolean;
      isPublic?: boolean;
      isMutation?: boolean;
    };
    expect(fn.isInternal).toBe(true);
    expect(fn.isPublic).toBeUndefined();
    expect(fn.isMutation).toBe(true);
  });
});

describe("readers accept both names during the transition", () => {
  it("a slug move on a legacy `published` or a `release_prepared` page creates the auto-301", async () => {
    const t = newBackend();
    const { pageIds } = await seedLegacy(t, 1);
    // Drive the slug move as the seeded page's owner.
    const owner = await t.run(async (ctx) => {
      const page = await ctx.db.get(pageIds[0]);
      const project = await ctx.db.get(page!.projectId);
      return project!.ownerId;
    });
    const as = t.withIdentity({ subject: owner });

    // legacy literal
    await as.mutation(api.cms.updatePage, { id: pageIds[0], slug: "moved" });
    // new literal
    await t.run((ctx) => ctx.db.patch(pageIds[0], { status: "release_prepared" }));
    await as.mutation(api.cms.updatePage, { id: pageIds[0], slug: "moved-again" });

    const redirects = await t.run((ctx) => ctx.db.query("cmsRedirects").collect());
    expect(redirects.map((r) => [r.fromPath, r.to]).sort()).toEqual([
      ["/moved", "/moved-again"],
      ["/page-0", "/moved"],
    ]);
  });

  it("UI labels treat both names as a prepared release", () => {
    expect(isReleasePrepared("release_prepared")).toBe(true);
    expect(isReleasePrepared("published")).toBe(true);
    expect(isReleasePrepared("draft")).toBe(false);
    expect(pageStatusForDisplay("release_prepared")).toBe("prepared_for_release");
    expect(pageStatusForDisplay("published")).toBe("prepared_for_release");
    expect(revisionStateForDisplay("release_prepared")).toBe("latest_release");
    expect(revisionStateForDisplay("published")).toBe("latest_release");
    expect(revisionStateForDisplay("superseded")).toBe("superseded");
  });
});
