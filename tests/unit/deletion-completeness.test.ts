import { describe, expect, it } from "vitest";
import { api, internal } from "@/convex/_generated/api";
import schema from "@/convex/schema";
import { DATA_REGISTRY } from "@/convex/lib/dataRegistry";
import { ACCOUNT_DELETION_GRACE_MS } from "@/convex/modules/privacy/deletionJobs";
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
    table: "contentSources",
    doc: (s) => ({
      projectId: s.projectId,
      pieceId: s.ids.contentPieces,
      kind: "note",
      title: "Source",
      text: "Source text",
      charCount: 11,
      truncated: false,
      extraction: "Pasted by you",
      included: true,
      createdBy: s.userId,
      createdAt: at,
    }),
  },
  {
    table: "videos",
    doc: (s) => ({
      projectId: s.projectId,
      title: "Video",
      composition: {
        version: 1,
        aspect: "9:16",
        fps: 30,
        targetMs: 5_000,
        style: { presetId: "clean" },
        scenes: [],
      },
      fingerprint: "fixture",
      revision: 1,
      status: "draft",
      createdBy: s.userId,
      createdAt: at,
      updatedAt: at,
    }),
  },
  {
    table: "videoAssets",
    doc: (s) => ({
      projectId: s.projectId,
      videoId: s.ids.videos,
      kind: "upload",
      storageId: s.ids.videoStorage,
      mimeType: "image/png",
      sizeBytes: 5,
      source: { provider: "user", aiGenerated: false },
      createdBy: s.userId,
      createdAt: at,
    }),
  },
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
    table: "appRuns",
    doc: (s) => ({
      buildId: s.ids.builds,
      projectId: s.projectId,
      userId: s.userId,
      prompt: "Build it",
      mode: "create",
      status: "succeeded",
      createdAt: at,
    }),
  },
  {
    table: "appSnapshots",
    doc: (s) => ({
      buildId: s.ids.builds,
      projectId: s.projectId,
      version: 1,
      label: "Starter",
      source: "starter",
      files: [{ path: "src/App.jsx", hash: "h1", bytes: 3 }],
      dependencies: [{ name: "react", version: "18.3.1" }],
      createdBy: s.userId,
      createdAt: at,
    }),
  },
  {
    table: "appSourceFiles",
    doc: (s) => ({ buildId: s.ids.builds, projectId: s.projectId, hash: "h1", content: "app", createdAt: at }),
  },
  {
    // BP-03: server-written release-preparation audit trail. No client
    // writer exists — the fixture only proves project deletion clears it.
    table: "buildReleaseAudits",
    doc: (s) => ({
      projectId: s.projectId,
      buildId: s.ids.builds,
      siteId: s.ids.sites,
      phase: "release_prepared",
      revisionIds: [],
      skipped: [],
      ruleVersion: 1,
      createdAt: at,
    }),
  },
  {
    // BP-13 placeholder table (receipt chain home). No code writes it yet;
    // the fixture only proves project deletion clears it.
    table: "buildDeployments",
    doc: (s) => ({
      projectId: s.projectId,
      buildId: s.ids.builds,
      siteId: s.ids.sites,
      state: "queued",
      createdAt: at,
      updatedAt: at,
    }),
  },
  {
    // MOSAI-hosted site address (siteHosting). Deleting the project frees
    // the slug.
    table: "publicSites",
    doc: (s) => ({
      projectId: s.projectId,
      kind: "website",
      slug: "fixture-site",
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
    table: "googleConnections",
    doc: (s) => ({
      projectId: s.projectId,
      accessToken: "token",
      status: "connected",
      connectedBy: s.userId,
      createdAt: at,
      updatedAt: at,
    }),
  },
  {
    table: "googleSyncRuns",
    doc: (s) => ({
      projectId: s.projectId,
      trigger: "manual",
      status: "succeeded",
      idempotencyKey: "k",
      createdAt: at,
      sources: [],
    }),
  },
  {
    table: "starterKits",
    doc: (s) => ({
      projectId: s.projectId,
      requestedBy: s.userId,
      idempotencyKey: String(s.projectId),
      status: "partially_succeeded",
      parts: {
        plan: { status: "succeeded", outputs: [], attempts: 1, updatedAt: at },
        site: { status: "failed", errorCode: "ai_budget", outputs: [], attempts: 1, updatedAt: at },
        posts: { status: "succeeded", outputs: [], attempts: 1, updatedAt: at },
      },
      attempts: 1,
      budgetMicrousd: 500_000,
      spentMicrousd: 120_000,
      budgetCurrency: "USD",
      createdAt: at,
      updatedAt: at,
    }),
  },
  {
    table: "projectVisits",
    doc: (s) => ({
      projectId: s.projectId,
      userId: s.userId,
      lastSeenAt: at,
      updatedAt: at,
    }),
  },
  {
    table: "googleMetricsDaily",
    doc: (s) => ({
      projectId: s.projectId,
      source: "gsc",
      resourceId: "sc-domain:example.com",
      date: "2026-01-01",
      clicks: 1,
      syncedAt: at,
    }),
  },
  {
    table: "googleTopItems",
    doc: (s) => ({
      projectId: s.projectId,
      source: "gsc",
      kind: "query",
      rank: 0,
      label: "q",
      periodStart: "2026-01-01",
      periodEnd: "2026-01-28",
      syncedAt: at,
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
  {
    table: "aiRuns",
    doc: (s) => ({
      userId: s.userId,
      projectId: s.projectId,
      agentId: "test.agent",
      promptVersion: "v1",
      provider: "vly",
      model: "gpt-4o-mini",
      autonomy: "assistive",
      maxOutputTokens: 100,
      contextSources: ["project.snapshot"],
      status: "succeeded",
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
      providerCredits: null,
      costMicrousd: null,
      costCurrency: null,
      errorCategory: null,
      startedAt: at,
      finishedAt: at,
      latencyMs: 1,
    }),
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
    expect(DATA_REGISTRY.aiRuns).toMatchObject({
      scope: "project",
      tenantField: "projectId",
      export: "excluded",
      retention: "cascade-with-project",
      deletion: { kind: "project-cascade", index: "by_project" },
      accountCleanup: [{ kind: "index", index: "by_user_created", field: "userId" }],
    });
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
      seed.ids.videoStorage = String(await c.storage.store(new Blob(["video bytes"])));
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

    const deletion = await alice.as.mutation(api.projects.remove, { id: projectId });
    expect(deletion.status).toBe("queued");
    const jobId = deletion.jobId;
    for (let step = 0; step < expectedTables.length * 12 + 20; step += 1) {
      const result = await t.mutation(internal.modules.privacy.deletionJobs.processProjectDeletion, { jobId });
      if ((result as { completed?: boolean }).completed) break;
    }

    for (const table of expectedTables) {
      const rows = await t.run((ctx) => loose(ctx).db.query(table).collect());
      expect(rows, `${table} still has rows after deletion`).toEqual([]);
    }
    const projects = await t.run((ctx) => ctx.db.query("projects").collect());
    expect(projects).toEqual([]);

    const blob = await t.run((ctx) => loose(ctx).storage.get(seed.ids.storage));
    expect(blob).toBeNull();
    const videoBlob = await t.run((ctx) => loose(ctx).storage.get(seed.ids.videoStorage));
    expect(videoBlob, "a video asset's stored file must be deleted with the project").toBeNull();
  });

  it("a project organization member cannot request deletion when they are not its owner", async () => {
    const t = newBackend();
    const owner = await seedUser(t, { plan: "scale" });
    const member = await seedUser(t, { plan: "scale" });
    const projectId = await owner.as.mutation(api.projects.create, { name: "Shared project" });
    const project = await t.run((ctx) => ctx.db.get(projectId));
    if (!project?.organizationId) throw new Error("Project organization was not created");

    await t.run(async (ctx) => {
      await ctx.db.insert("memberships", {
        organizationId: project.organizationId!,
        userId: member.userId,
        role: "member",
        status: "active",
        createdAt: at,
        updatedAt: at,
      });
    });

    await expect(member.as.mutation(api.projects.remove, { id: projectId }))
      .rejects.toThrow("Only the project owner can delete this project");
    expect(await t.run((ctx) => ctx.db.query("privacyJobs").collect())).toEqual([]);
  });

  it("account deletion clears user-only AI runs and quota buckets", async () => {
    const t = newBackend();
    const alice = await seedUser(t);
    await t.run(async (ctx) => {
      const db = loose(ctx).db;
      await db.insert("aiRuns", {
        userId: alice.userId,
        agentId: "test.user_only",
        promptVersion: "v1",
        provider: "vly",
        model: "gpt-4o-mini",
        autonomy: "assistive",
        maxOutputTokens: 100,
        contextSources: ["request.context"],
        status: "succeeded",
        promptTokens: null,
        completionTokens: null,
        totalTokens: null,
        providerCredits: null,
        costMicrousd: null,
        costCurrency: null,
        errorCategory: null,
        startedAt: at,
      });
      await db.insert("aiRateLimits", {
        userId: alice.userId,
        windowStart: at,
        count: 1,
      });
    });

    const request = await alice.as.mutation(api.billing.deleteAccount, {});
    expect(request.status).toBe("queued");
    expect(request.effectiveAt - request.requestedAt).toBe(ACCOUNT_DELETION_GRACE_MS);
    await t.run(async (ctx) => {
      expect(await loose(ctx).db.query("aiRuns").collect()).toHaveLength(1);
      expect(await loose(ctx).db.query("aiRateLimits").collect()).toHaveLength(1);
      expect(await ctx.db.get(alice.userId)).toBeTruthy();
    });

    let terminal = false;
    for (let step = 0; step < 2000; step += 1) {
      const result = await t.mutation(internal.modules.privacy.deletionJobs.finalizeUser, {
        userId: alice.userId,
        now: request.effectiveAt + 1,
      });
      if (result.status === "succeeded") { terminal = true; break; }
      if (result.status === "waiting_for_user") throw new Error(result.reason);
    }
    expect(terminal).toBe(true);

    await t.run(async (ctx) => {
      expect(await loose(ctx).db.query("aiRuns").collect()).toEqual([]);
      expect(await loose(ctx).db.query("aiRateLimits").collect()).toEqual([]);
      expect(await ctx.db.get(alice.userId)).toBeNull();
    });
  });
});
