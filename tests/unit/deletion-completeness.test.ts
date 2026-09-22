import { describe, expect, it } from "vitest";
import { api } from "@/convex/_generated/api";
import schema from "@/convex/schema";
import { newBackend, seedUser } from "./helpers";

/**
 * R10 — deletion completeness (MOSAI pack T1.7 / task T2.5 precursor).
 *
 * The list of tables to check is **derived from `schema.ts`**, not written by
 * hand: every table that declares a `projectId` field is project-scoped, plus
 * `contentDocs`, which hangs off a content piece. A new project-scoped table
 * therefore cannot be forgotten — this test fails until a fixture is added, and
 * that is the seed of the data registry T2.5 will replace it with.
 *
 * `oauthStates` is the one documented exception: it is short-lived CSRF state
 * with no `by_project` index and expires on its own. The test asserts that
 * justification (no `by_project` index) rather than trusting the comment.
 */

type TableDef = {
  validator?: { fields?: Record<string, unknown> };
  indexes?: Array<{ indexDescriptor: string }>;
};

const tables = (
  schema as unknown as { tables: Record<string, TableDef> }
).tables;

const CASCADE_EXCEPTIONS = ["oauthStates"];

const projectScopedTables = Object.keys(tables).filter((name) =>
  Object.keys(tables[name]?.validator?.fields ?? {}).includes("projectId"),
);

const expectedTables = [
  ...projectScopedTables.filter((name) => !CASCADE_EXCEPTIONS.includes(name)),
  // Not project-scoped by field, but project-derived through its parent piece.
  "contentDocs",
].sort();

/* ── Fixtures: one minimal row per project-scoped table ──────────────────── */

type Seed = { projectId: string; userId: string; ids: Record<string, string> };
type Fixture = { table: string; doc: (s: Seed) => Record<string, unknown> };

const at = 1_700_000_000_000;

const fixtures: Fixture[] = [
  {
    table: "personas",
    doc: (s) => ({ projectId: s.projectId, name: "Persona", createdBy: s.userId, createdAt: at }),
  },
  {
    table: "contentGaps",
    doc: (s) => ({ projectId: s.projectId, title: "Gap", createdBy: s.userId, createdAt: at }),
  },
  {
    table: "contentTopics",
    doc: (s) => ({ projectId: s.projectId, title: "Topic", createdBy: s.userId, createdAt: at }),
  },
  {
    table: "contentPieces",
    doc: (s) => ({
      projectId: s.projectId,
      title: "Piece",
      status: "draft",
      createdBy: s.userId,
      createdAt: at,
      updatedAt: at,
    }),
  },
  { table: "contentDocs", doc: (s) => ({ pieceId: s.ids.contentPieces, updatedAt: at }) },
  {
    table: "journeyMaps",
    doc: (s) => ({
      projectId: s.projectId,
      name: "Journey",
      stages: [],
      source: "manual",
      createdBy: s.userId,
      createdAt: at,
      updatedAt: at,
    }),
  },
  {
    table: "personaMessages",
    doc: (s) => ({
      projectId: s.projectId,
      personaId: s.ids.personas,
      mode: "persona",
      role: "user",
      content: "hello",
      createdAt: at,
    }),
  },
  {
    table: "communications",
    doc: (s) => ({
      projectId: s.projectId,
      name: "Comms",
      message: "Message",
      status: "draft",
      createdBy: s.userId,
      createdAt: at,
    }),
  },
  { table: "connections", doc: (s) => ({ projectId: s.projectId, provider: "ga4", status: "connected" }) },
  { table: "contacts", doc: (s) => ({ projectId: s.projectId, name: "Contact", createdAt: at }) },
  {
    table: "campaigns",
    doc: (s) => ({
      projectId: s.projectId,
      name: "Campaign",
      channel: "email",
      status: "draft",
      createdAt: at,
    }),
  },
  {
    table: "posts",
    doc: (s) => ({
      projectId: s.projectId,
      channel: "x",
      body: "Post",
      status: "draft",
      createdAt: at,
    }),
  },
  {
    table: "socialCredentials",
    doc: (s) => ({
      projectId: s.projectId,
      platform: "x",
      accessToken: "token",
      connectedBy: s.userId,
      createdAt: at,
      updatedAt: at,
    }),
  },
  { table: "collections", doc: (s) => ({ projectId: s.projectId, title: "Collection", createdAt: at }) },
  {
    table: "products",
    doc: (s) => ({ projectId: s.projectId, title: "Product", createdAt: at, updatedAt: at }),
  },
  {
    table: "productVariants",
    doc: (s) => ({
      projectId: s.projectId,
      productId: s.ids.products,
      isDefault: true,
      currency: "USD",
      createdAt: at,
      updatedAt: at,
    }),
  },
  {
    table: "productMedia",
    doc: (s) => ({
      projectId: s.projectId,
      productId: s.ids.products,
      url: "https://example.com/a.png",
      createdAt: at,
    }),
  },
  { table: "commerceEvents", doc: (s) => ({ projectId: s.projectId, event: "view", createdAt: at }) },
  {
    table: "insights",
    doc: (s) => ({
      projectId: s.projectId,
      kind: "seo",
      title: "Insight",
      source: "internal",
      createdAt: at,
    }),
  },
  {
    table: "sites",
    doc: (s) => ({
      projectId: s.projectId,
      name: "Site",
      slug: "site",
      createdBy: s.userId,
      createdAt: at,
      updatedAt: at,
    }),
  },
  {
    table: "cmsPages",
    doc: (s) => ({
      siteId: s.ids.sites,
      projectId: s.projectId,
      title: "Page",
      slug: "page",
      fullPath: "/page",
      status: "draft",
      createdBy: s.userId,
      createdAt: at,
      updatedAt: at,
    }),
  },
  {
    table: "pageRevisions",
    doc: (s) => ({
      pageId: s.ids.cmsPages,
      projectId: s.projectId,
      version: 1,
      state: "draft",
      document: { schemaVersion: 1, blocks: [] },
      createdBy: s.userId,
      createdAt: at,
    }),
  },
  {
    table: "cmsAssets",
    doc: (s) => ({
      projectId: s.projectId,
      type: "image",
      filename: "a.png",
      url: "https://example.com/a.png",
      createdBy: s.userId,
      createdAt: at,
    }),
  },
  {
    table: "cmsNavigations",
    doc: (s) => ({
      siteId: s.ids.sites,
      projectId: s.projectId,
      name: "Main",
      items: [],
      createdAt: at,
      updatedAt: at,
    }),
  },
  {
    table: "cmsRedirects",
    doc: (s) => ({
      siteId: s.ids.sites,
      projectId: s.projectId,
      fromPath: "/old",
      to: "/new",
      statusCode: 301,
      createdAt: at,
    }),
  },
  {
    table: "builds",
    doc: (s) => ({
      projectId: s.projectId,
      name: "Build",
      kind: "website",
      status: "draft",
      createdAt: at,
      updatedAt: at,
    }),
  },
  {
    table: "buildPages",
    doc: (s) => ({
      buildId: s.ids.builds,
      projectId: s.projectId,
      name: "Home",
      path: "/",
      createdAt: at,
      updatedAt: at,
    }),
  },
  {
    table: "buildMessages",
    doc: (s) => ({
      buildId: s.ids.builds,
      projectId: s.projectId,
      role: "user",
      content: "hi",
      createdAt: at,
    }),
  },
  {
    table: "buildVersions",
    doc: (s) => ({
      buildId: s.ids.builds,
      projectId: s.projectId,
      version: 1,
      label: "v1",
      pages: [],
      createdAt: at,
    }),
  },
  {
    table: "projectFiles",
    doc: (s) => ({
      projectId: s.projectId,
      name: "brief.pdf",
      storageId: s.ids.storage,
      uploadedBy: s.userId,
      createdAt: at,
    }),
  },
  {
    table: "adsCredentials",
    doc: (s) => ({
      projectId: s.projectId,
      platform: "google",
      accessToken: "token",
      connectedBy: s.userId,
      createdAt: at,
      updatedAt: at,
    }),
  },
  {
    table: "adsAccounts",
    doc: (s) => ({
      projectId: s.projectId,
      platform: "google",
      accountId: "1",
      name: "Account",
      status: "selected",
    }),
  },
  {
    table: "adsCampaigns",
    doc: (s) => ({
      projectId: s.projectId,
      platform: "google",
      accountId: "1",
      campaignId: "c1",
      name: "C",
      status: "ACTIVE",
      lastSyncedAt: at,
    }),
  },
  {
    table: "adsMetrics",
    doc: (s) => ({
      projectId: s.projectId,
      platform: "google",
      campaignId: "c1",
      date: "2026-01-01",
      spendCents: 1,
      impressions: 1,
      clicks: 1,
      conversions: 0,
      updatedAt: at,
    }),
  },
  {
    table: "adsChangeRequests",
    doc: (s) => ({
      projectId: s.projectId,
      platform: "google",
      accountId: "1",
      campaignId: "c1",
      campaignName: "C",
      kind: "pause",
      origin: "user",
      status: "draft",
      requestedBy: s.userId,
      createdAt: at,
    }),
  },
  {
    table: "adsExecutions",
    doc: (s) => ({
      projectId: s.projectId,
      changeId: s.ids.adsChangeRequests,
      platform: "google",
      campaignId: "c1",
      kind: "pause",
      result: "success",
      executedBy: s.userId,
      createdAt: at,
    }),
  },
  {
    table: "adsCopilotMessages",
    doc: (s) => ({ projectId: s.projectId, role: "user", content: "hi", createdAt: at }),
  },
];

/* ── Loose handle: the cascade names tables at runtime ──────────────────── */

type LooseCtx = {
  db: {
    insert(table: string, doc: Record<string, unknown>): Promise<unknown>;
    query(table: string): { collect(): Promise<Array<Record<string, unknown>>> };
  };
  storage: {
    store(blob: Blob): Promise<unknown>;
    get(id: unknown): Promise<unknown>;
  };
};

const loose = (ctx: unknown): LooseCtx => ctx as LooseCtx;

describe("R10 — deleting a project leaves nothing behind", () => {
  it("the fixture set covers every project-scoped table the schema declares", () => {
    const fixtureTables = fixtures.map((f) => f.table).sort();
    expect(fixtureTables).toEqual(expectedTables);
    // Guards against two fixtures for the same table hiding a missing one.
    expect(new Set(fixtureTables).size).toBe(fixtureTables.length);
  });

  it("only oauthStates is exempt, and it has no by_project index", () => {
    const oauthIndexes = (tables.oauthStates?.indexes ?? []).map(
      (i) => i.indexDescriptor,
    );
    expect(oauthIndexes).not.toContain("by_project");
    // Every exempt table must be one whose removal we can justify above.
    for (const name of CASCADE_EXCEPTIONS) {
      expect(projectScopedTables).toContain(name);
    }
  });

  it("projects.remove deletes every project-scoped row and the stored bytes", async () => {
    const t = newBackend();
    const alice = await seedUser(t, { plan: "scale" });
    const projectId = await alice.as.mutation(api.projects.create, { name: "For sale" });

    const seed: Seed = { projectId, userId: alice.userId, ids: {} };
    await t.run(async (ctx) => {
      const c = loose(ctx);
      seed.ids.storage = String(await c.storage.store(new Blob(["bytes"])));
      for (const fixture of fixtures) {
        const id = await c.db.insert(fixture.table, fixture.doc(seed));
        seed.ids[fixture.table] = String(id);
      }
    });

    // Sanity: every fixture really landed.
    for (const table of expectedTables) {
      const rows = await t.run((ctx) => loose(ctx).db.query(table).collect());
      expect(rows.length, `${table} should have a seeded row`).toBeGreaterThan(0);
    }

    await alice.as.mutation(api.projects.remove, { id: projectId });

    for (const table of expectedTables) {
      const rows = await t.run((ctx) => loose(ctx).db.query(table).collect());
      expect(rows, `${table} still has rows after deletion`).toEqual([]);
    }
    const projects = await t.run((ctx) => ctx.db.query("projects").collect());
    expect(projects).toEqual([]);

    const blob = await t.run((ctx) => loose(ctx).storage.get(seed.ids.storage));
    expect(blob).toBeNull();
  });
});
