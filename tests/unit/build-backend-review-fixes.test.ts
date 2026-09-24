import { afterEach, describe, expect, it } from "vitest";
import { api } from "@/convex/_generated/api";
import {
  completionCalls,
  resetCompletionStub,
  stubCompletionContent,
} from "./stubs/vly-integrations";
import { newBackend, seedUser, type TestBackend, type Tenant } from "./helpers";

/**
 * Build backend review (docs/reviews/build-backend-review.md) — S3, S1, C6.
 *
 * Red-first record (24 Sep 2026): every test below failed against the
 * unfixed tree:
 *  - S3: `buildPlan.generateBuildPlan` / `generatePageDraft` were plain
 *    actions, so a `free` tenant (no Build module) reached the provider and
 *    consumed AI quota;
 *  - S1: `cms.publishPage`, `cms.restoreRevision` and
 *    `buildWorkspace.restoreVersion` / `publishSite` stored rich text as
 *    given (only `cms.saveDraft` sanitized);
 *  - C6: `publishSite` repeated the draft's version number and left the
 *    prior promoted revision in state `published`.
 */

afterEach(() => resetCompletionStub());

const DIRTY_HTML = '<p>Hi</p><img src="x" onerror="alert(1)"><script>alert(2)</script>';

const dirtyDoc = () => ({
  schemaVersion: 1,
  blocks: [
    { id: "blk_rt", type: "richText", version: 1, props: { html: DIRTY_HTML } },
  ],
});

function expectClean(html: unknown) {
  expect(typeof html).toBe("string");
  expect(html).not.toMatch(/onerror/i);
  expect(html).not.toMatch(/<script/i);
  expect(html).toContain("Hi");
}

async function countRows(t: TestBackend, table: string): Promise<number> {
  return await t.run(async (ctx) => {
    const db = ctx.db as unknown as {
      query(name: string): { collect(): Promise<unknown[]> };
    };
    return (await db.query(table).collect()).length;
  });
}

/** A website build + site + homepage whose draft holds `document`. */
async function seedSite(
  t: TestBackend,
  tenant: Tenant,
  projectId: string,
  document: ReturnType<typeof dirtyDoc> | { schemaVersion: number; blocks: unknown[] },
) {
  const userId = tenant.userId;
  const now = Date.now();
  const buildId = await tenant.as.mutation(api.builds.create, {
    projectId,
    name: "Website",
    kind: "website",
  });
  const siteId = await t.run((ctx) =>
    ctx.db.insert("sites", {
      projectId,
      name: "Website",
      slug: "website",
      status: "draft",
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    }),
  );
  const pageId = await t.run((ctx) =>
    ctx.db.insert("cmsPages", {
      siteId,
      projectId,
      title: "Home",
      slug: "home",
      fullPath: "/",
      status: "draft",
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    }),
  );
  const revId = await t.run((ctx) =>
    ctx.db.insert("pageRevisions", {
      pageId,
      projectId,
      version: 1,
      state: "draft",
      document,
      createdBy: userId,
      createdAt: now,
    } as never),
  );
  await t.run((ctx) => ctx.db.patch(pageId, { latestDraftRevisionId: revId }));
  return { buildId, siteId, pageId, revId };
}

async function revisionsOf(t: TestBackend, pageId: string) {
  return await t.run((ctx) =>
    ctx.db
      .query("pageRevisions")
      .withIndex("by_page", (q) => q.eq("pageId", pageId as never))
      .collect(),
  );
}

describe("S3 — Build AI actions require the Build capability", () => {
  async function seedLockedTenant() {
    const t = newBackend();
    const tenant = await seedUser(t, { plan: "free" });
    const projectId = await tenant.as.mutation(api.projects.create, { name: "p" });
    // Rows written directly: the tenant cannot create builds on `free`.
    const buildId = await t.run((ctx) =>
      ctx.db.insert("builds", {
        projectId: projectId as never,
        name: "Locked",
        kind: "website",
        status: "draft",
        idea: "A site",
        createdAt: Date.now(),
      }),
    );
    const pageId = await t.run((ctx) =>
      ctx.db.insert("buildPages", {
        projectId: projectId as never,
        buildId,
        name: "Home",
        path: "/",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );
    return { t, tenant, projectId, buildId, pageId };
  }

  it("generateBuildPlan refuses a tenant without Build before any AI spend", async () => {
    resetCompletionStub();
    stubCompletionContent(
      JSON.stringify({ positioning: "x", pages: [{ name: "Home", path: "/" }] }),
    );
    const { t, tenant, projectId, buildId } = await seedLockedTenant();
    await expect(
      tenant.as.action(api.buildPlan.generateBuildPlan, { projectId, buildId }),
    ).rejects.toThrow(/does not include "build"/);
    expect(completionCalls).toHaveLength(0);
    expect(await countRows(t, "aiRateLimits")).toBe(0);
  });

  it("generatePageDraft refuses a tenant without Build before any AI spend", async () => {
    resetCompletionStub();
    stubCompletionContent("<h1>Draft</h1>");
    const { t, tenant, projectId, pageId } = await seedLockedTenant();
    await expect(
      tenant.as.action(api.buildPlan.generatePageDraft, { projectId, pageId }),
    ).rejects.toThrow(/does not include "build"/);
    expect(completionCalls).toHaveLength(0);
    expect(await countRows(t, "aiRateLimits")).toBe(0);
  });

  it("still serves a tenant with Build and consumes one unit of AI quota", async () => {
    resetCompletionStub();
    stubCompletionContent(
      JSON.stringify({
        positioning: "For the primary buyer",
        pages: [{ name: "Home", path: "/", goal: "Explain" }],
      }),
    );
    const t = newBackend();
    const tenant = await seedUser(t, { plan: "starter" });
    const projectId = await tenant.as.mutation(api.projects.create, { name: "p" });
    const buildId = await tenant.as.mutation(api.builds.create, {
      projectId,
      name: "Site",
      kind: "website",
    });
    const plan = await tenant.as.action(api.buildPlan.generateBuildPlan, {
      projectId,
      buildId,
    });
    expect(plan.positioning).toBe("For the primary buyer");
    expect(completionCalls).toHaveLength(1);
    expect(await countRows(t, "aiRateLimits")).toBe(1);
  });
});

describe("S1 — rich text is sanitized on every CMS write path", () => {
  it("cms.publishPage stores a sanitized published revision", async () => {
    const t = newBackend();
    const tenant = await seedUser(t, { plan: "starter" });
    const projectId = await tenant.as.mutation(api.projects.create, { name: "p" });
    const { pageId } = await seedSite(t, tenant, projectId, dirtyDoc());
    const publishedId = await tenant.as.mutation(api.cms.publishPage, {
      pageId: pageId as never,
    });
    const row = await t.run((ctx) => ctx.db.get(publishedId));
    expectClean(row?.document.blocks[0].props.html);
  });

  it("cms.restoreRevision stores a sanitized draft", async () => {
    const t = newBackend();
    const tenant = await seedUser(t, { plan: "starter" });
    const projectId = await tenant.as.mutation(api.projects.create, { name: "p" });
    const { revId } = await seedSite(t, tenant, projectId, dirtyDoc());
    const newId = await tenant.as.mutation(api.cms.restoreRevision, {
      revisionId: revId as never,
    });
    const row = await t.run((ctx) => ctx.db.get(newId));
    expectClean(row?.document.blocks[0].props.html);
  });

  it("buildWorkspace.publishSite stores sanitized promoted revisions", async () => {
    const t = newBackend();
    const tenant = await seedUser(t, { plan: "starter" });
    const projectId = await tenant.as.mutation(api.projects.create, { name: "p" });
    const { buildId, pageId } = await seedSite(t, tenant, projectId, dirtyDoc());
    await tenant.as.mutation(api.buildWorkspace.publishSite, { buildId });
    const page = await t.run((ctx) => ctx.db.get(pageId as never));
    const row = await t.run((ctx) =>
      ctx.db.get((page as { publishedRevisionId: never }).publishedRevisionId),
    );
    expectClean((row as { document: ReturnType<typeof dirtyDoc> }).document.blocks[0].props.html);
  });

  it("buildWorkspace.restoreVersion stores a sanitized draft", async () => {
    const t = newBackend();
    const tenant = await seedUser(t, { plan: "starter" });
    const projectId = await tenant.as.mutation(api.projects.create, { name: "p" });
    const { buildId, pageId, revId } = await seedSite(t, tenant, projectId, {
      schemaVersion: 1,
      blocks: [],
    });
    const versionId = await t.run((ctx) =>
      ctx.db.insert("buildVersions", {
        buildId,
        projectId,
        version: 1,
        label: "snapshot",
        pages: [
          {
            pageId: pageId as never,
            title: "Home",
            slug: "home",
            fullPath: "/",
            draft: JSON.stringify(dirtyDoc()),
          },
        ],
        createdAt: Date.now(),
      }),
    );
    await tenant.as.mutation(api.buildWorkspace.restoreVersion, { versionId });
    const row = await t.run((ctx) => ctx.db.get(revId as never));
    expectClean((row as { document: ReturnType<typeof dirtyDoc> }).document.blocks[0].props.html);
  });
});

describe("C6 — publishSite numbers revisions max+1 and supersedes the prior one", () => {
  const cleanDoc = {
    schemaVersion: 1,
    blocks: [{ id: "blk_hero", type: "hero", version: 1, props: { heading: "Hello" } }],
  };

  it("never repeats a version number and leaves exactly one promoted revision", async () => {
    const t = newBackend();
    const tenant = await seedUser(t, { plan: "starter" });
    const projectId = await tenant.as.mutation(api.projects.create, { name: "p" });
    const { buildId, pageId } = await seedSite(t, tenant, projectId, cleanDoc);

    await tenant.as.mutation(api.buildWorkspace.publishSite, { buildId });
    const firstPage = await t.run((ctx) => ctx.db.get(pageId as never));
    const firstId = (firstPage as { publishedRevisionId: string }).publishedRevisionId;
    await tenant.as.mutation(api.buildWorkspace.publishSite, { buildId });

    const revs = await revisionsOf(t, pageId);
    const versions = revs.map((r) => r.version);
    expect(new Set(versions).size).toBe(versions.length);
    // draft v1, first promotion v2, second promotion v3
    expect([...versions].sort((a, b) => a - b)).toEqual([1, 2, 3]);

    const published = revs.filter((r) => r.state === "release_prepared");
    expect(published).toHaveLength(1);
    expect(published[0].version).toBe(3);
    expect(revs.find((r) => r._id === firstId)?.state).toBe("superseded");

    // the audit records the real, unique versions
    const audits = await t.run((ctx) =>
      ctx.db
        .query("buildReleaseAudits")
        .withIndex("by_build", (q) => q.eq("buildId", buildId))
        .collect(),
    );
    expect(audits.map((a) => a.revisionVersions?.[0]).sort()).toEqual([2, 3]);
  });

  it("interleaved cms.publishPage and publishSite keep versions unique", async () => {
    const t = newBackend();
    const tenant = await seedUser(t, { plan: "starter" });
    const projectId = await tenant.as.mutation(api.projects.create, { name: "p" });
    const { buildId, pageId } = await seedSite(t, tenant, projectId, cleanDoc);

    await tenant.as.mutation(api.cms.publishPage, { pageId: pageId as never });
    await tenant.as.mutation(api.buildWorkspace.publishSite, { buildId });

    const revs = await revisionsOf(t, pageId);
    const versions = revs.map((r) => r.version);
    expect(new Set(versions).size).toBe(versions.length);
    expect(revs.filter((r) => r.state === "release_prepared")).toHaveLength(1);
  });
});
