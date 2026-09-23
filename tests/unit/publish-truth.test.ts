import { describe, expect, it } from "vitest";
import { api } from "@/convex/_generated/api";
import { newBackend, seedUser, type TestBackend, type Tenant } from "./helpers";

/**
 * BP-03 — stop false publishing and readiness claims (blueprint §5 BP-03).
 *
 * Acceptance being demonstrated:
 *  1. a direct client call cannot manufacture `live` / `published` /
 *     `paid` / `sent` states or set SEO/WCAG compliance booleans;
 *  2. a failed release/preparation leaves the previous confirmed public
 *     release serving (and never marks a site live without a deployment);
 *  3. content edits invalidate prior readiness;
 *  4. unverified legacy records are labelled `requires verification` and
 *     never gain invented receipts;
 *  5. a successful external badge can only classify as verified when a
 *     stored receipt/verification record exists.
 *
 * Network policy: nothing here touches the network — every path under test
 * is database-only (no provider is contacted, nothing is published, spent or
 * sent). The "deployment" this suite exercises is deliberately absent: until
 * the BP-13 deployment adapter exists, `publishSite` may only *prepare* a
 * release and must keep the site out of externally published state.
 *
 * Red-first record (23 Sep 2026): every test in describe blocks
 * "A client cannot manufacture external success", "Failed preparation
 * preserves the previous confirmed release" and "Legacy truth" failed
 * against the unfixed tree (api.builds.update accepted `status:"published"`
 * + `seoReady/wcagReady`; publishSite wrote `sites.status="live"`;
 * builds.getReadiness / buildWorkspace.getSiteDelivery /
 * campaigns server-tracked refusal did not exist; ReceiptBadge was missing).
 */

const DOC = {
  schemaVersion: 1,
  blocks: [
    {
      id: "blk_test_hero",
      type: "hero",
      version: 1,
      props: { heading: "Hello world" },
    },
  ],
} as const;

/** A build + site + one page with a valid draft, on a paying tenant. */
async function seedSite(
  t: TestBackend,
  tenant: Tenant,
  projectId: string,
): Promise<{ buildId: string; siteId: string; pageId: string }> {
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
      document: DOC,
      createdBy: userId,
      createdAt: now,
    }),
  );
  await t.run((ctx) =>
    ctx.db.patch(pageId, { latestDraftRevisionId: revId }),
  );
  return { buildId, siteId, pageId };
}

describe("A client cannot manufacture external success", () => {
  it("builds.update refuses a client-asserted published status and compliance booleans", async () => {
    const t = newBackend();
    const tenant = await seedUser(t, { plan: "starter" });
    const projectId = await tenant.as.mutation(api.projects.create, {
      name: "p",
    });
    const buildId = await tenant.as.mutation(api.builds.create, {
      projectId,
      name: "Website",
      kind: "website",
    });

    // Legitimate local edits keep working (the fix must not over-block).
    await tenant.as.mutation(api.builds.update, {
      id: buildId,
      name: "Renamed",
      positioning: "Sharper",
    });

    // The client must not be able to claim publication or certification…
    await expect(
      tenant.as.mutation(api.builds.update, {
        id: buildId,
        // @ts-expect-error — BP-03 removes these inputs from the public API
        status: "published",
      }),
    ).rejects.toThrow();

    await expect(
      tenant.as.mutation(api.builds.update, {
        id: buildId,
        // @ts-expect-error — SEO/WCAG booleans are no longer client-writable
        seoReady: true,
      }),
    ).rejects.toThrow(/compliance|readiness|external state/i);

    await expect(
      tenant.as.mutation(api.builds.update, {
        id: buildId,
        // @ts-expect-error — WCAG booleans are no longer client-writable
        wcagReady: true,
      }),
    ).rejects.toThrow(/compliance|readiness|external state/i);

    // …and nothing was written.
    const row = await t.run((ctx) => ctx.db.get(buildId));
    expect(row?.status).toBe("draft");
    expect(row?.seoReady).toBeUndefined();
    expect(row?.wcagReady).toBeUndefined();
  });

  it("publishSite prepares a release without marking the site live or the build published", async () => {
    const t = newBackend();
    const tenant = await seedUser(t, { plan: "starter" });
    const projectId = await tenant.as.mutation(api.projects.create, {
      name: "p",
    });
    const { buildId } = await seedSite(t, tenant, projectId);

    await tenant.as.mutation(api.buildWorkspace.publishSite, { buildId });

    // No external state may exist without a deployment (BP-13 does not exist).
    const siteRow = await t.run(async (ctx) => {
      const site = await ctx.db
        .query("sites")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .first();
      return site;
    });
    expect(siteRow?.status).toBeUndefined();
    const build = await t.run((ctx) => ctx.db.get(buildId));
    expect(build?.status).toBe("generated");
    expect(build?.releaseState).toBe("prepared");
    expect(build?.lastReleaseAt).toBeTypeOf("number");
  });

  it("cms.publishPage approves a page draft without marking the site live", async () => {
    const t = newBackend();
    const tenant = await seedUser(t, { plan: "starter" });
    const projectId = await tenant.as.mutation(api.projects.create, {
      name: "p",
    });
    const { pageId } = await seedSite(t, tenant, projectId);

    await tenant.as.mutation(api.cms.publishPage, { pageId });

    const siteRow = await t.run(async (ctx) => {
      const site = await ctx.db
        .query("sites")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .first();
      return site;
    });
    expect(siteRow?.status).toBeUndefined();
  });
});

describe("Failed preparation preserves the previous confirmed release", () => {
  it("a failing release preparation never touches the already-served release", async () => {
    const t = newBackend();
    const tenant = await seedUser(t, { plan: "starter" });
    const projectId = await tenant.as.mutation(api.projects.create, {
      name: "p",
    });
    const { buildId, pageId } = await seedSite(t, tenant, projectId);

    // First preparation succeeds and the prepared release is served.
    const first = await tenant.as.mutation(api.buildWorkspace.publishSite, {
      buildId,
    });
    expect(first.published).toBe(1);

    // The page draft is edited (content change)…
    const before = await t.run((ctx) => ctx.db.get(pageId));
    const servedBefore = await tenant.as.query(api.cms.getPublishedByPath, {
      siteId: before!.siteId,
      fullPath: "/",
    });
    expect(servedBefore?.revision.document).toEqual(DOC);

    // …then the content becomes invalid under it.
    await t.run((ctx) => {
      const draft = ctx.db.get(before!.latestDraftRevisionId!);
      return draft.then((d) =>
        ctx.db.patch(before!.latestDraftRevisionId!, {
          document: {
            schemaVersion: 1,
            blocks: [
              // hero without its required heading — invalid content
              { id: "blk_bad", type: "hero", version: 1, props: {} },
            ],
          },
          ...(d ? {} : {}),
        }),
      );
    });

    // The next preparation must fail loudly…
    await expect(
      tenant.as.mutation(api.buildWorkspace.publishSite, { buildId }),
    ).rejects.toThrow();

    // …and the previous confirmed release must still be the one served.
    const servedAfter = await tenant.as.query(api.cms.getPublishedByPath, {
      siteId: before!.siteId,
      fullPath: "/",
    });
    expect(servedAfter?.revision.document).toEqual(DOC);

    // No second release was recorded.
    const releases = await t.run((ctx) =>
      ctx.db.query("buildReleaseAudits").collect(),
    );
    expect(releases).toHaveLength(1);
    // The site never left "no external deployment" state.
    const siteRow = await t.run((ctx) => ctx.db.get(before!.siteId));
    expect(siteRow?.status).toBeUndefined();
  });

  it("a foreign-organization caller cannot prepare a release", async () => {
    const t = newBackend();
    const tenant = await seedUser(t, { plan: "starter", email: "a@x.test" });
    const projectId = await tenant.as.mutation(api.projects.create, {
      name: "mine",
    });
    const { buildId } = await seedSite(t, tenant, projectId);

    const intruder = await seedUser(t, { plan: "starter", email: "b@y.test" });
    await expect(
      intruder.as.mutation(api.buildWorkspace.publishSite, { buildId }),
    ).rejects.toThrow();
  });
});

describe("Readiness is derived from a revision-pinned audit", () => {
  it("reports verified readiness from the audit record and unverified after a content edit", async () => {
    const t = newBackend();
    const tenant = await seedUser(t, { plan: "starter" });
    const projectId = await tenant.as.mutation(api.projects.create, {
      name: "p",
    });
    const { buildId, pageId } = await seedSite(t, tenant, projectId);

    await tenant.as.mutation(api.buildWorkspace.publishSite, { buildId });

    const ready = await tenant.as.query(api.builds.getReadiness, { id: buildId });
    expect(ready?.delivery.label).toBe("release_prepared");
    expect(ready?.delivery.verified).toBe(false);
    expect(ready?.delivery.receiptId).toBeUndefined();
    expect(ready?.delivery.verifiedRevisionIds).toContain(pageId);
    expect(ready?.delivery.ruleVersion).toBeGreaterThan(0);

    // The readiness view carries the page-level checks…
    expect(ready?.pages).toHaveLength(1);
    expect(ready?.pages[0]?.blocking).toEqual([]);

    // …and a content edit invalidates the revision-pinned audit.
    const before = await t.run((ctx) => ctx.db.get(pageId));
    await t.run((ctx) =>
      ctx.db.patch(before!.latestDraftRevisionId!, {
        document: {
          schemaVersion: 1,
          blocks: [
            {
              id: "blk_test_hero_2",
              type: "hero",
              version: 1,
              props: { heading: "Changed headline" },
            },
          ],
        },
      }),
    );

    const stale = await tenant.as.query(api.builds.getReadiness, { id: buildId });
    expect(stale?.delivery.verifiedRevisionIds).not.toContain(pageId);
    expect(stale?.delivery.label).toBe("content_changed");
  });
});

describe("Legacy truth", () => {
  it("unverified legacy published rows are readable but marked requires-verification without an invented receipt", async () => {
    const t = newBackend();
    const tenant = await seedUser(t, { plan: "starter" });
    const projectId = await tenant.as.mutation(api.projects.create, {
      name: "p",
    });
    const now = Date.now();
    const legacyId = await t.run((ctx) =>
      ctx.db.insert("builds", {
        projectId,
        name: "Legacy build",
        kind: "website",
        status: "published",
        createdAt: now - 86_400_000,
        updatedAt: now - 86_400_000,
      }),
    );

    const view = await tenant.as.query(api.builds.getReadiness, {
      id: legacyId,
    });
    // Readable, honestly labelled, no invented receipt.
    expect(view?.legacy).toBe(true);
    expect(view?.delivery.verified).toBe(false);
    expect(view?.delivery.receiptId).toBeUndefined();
    expect(view?.delivery.label).toMatch(/unverified|requires_verification/i);
  });
});

describe("Campaigns distinguish local tracking from provider-tracked state", () => {
  it("refuses client lifecycle writes on provider-tracked campaigns but allows local ones", async () => {
    const t = newBackend();
    const tenant = await seedUser(t, { plan: "starter" });
    const projectId = await tenant.as.mutation(api.projects.create, {
      name: "p",
    });

    const localId = await tenant.as.mutation(api.campaigns.create, {
      projectId,
      name: "Local push",
      channel: "email",
    });
    const providerId = await tenant.as.mutation(api.campaigns.create, {
      projectId,
      name: "Provider campaign",
      channel: "ads",
    });
    // Simulate an ads-provider-tracked campaign (server-written state).
    await t.run((ctx) =>
      ctx.db.patch(providerId, { trackingSource: "provider" }),
    );

    // A client must not move a provider-tracked campaign's lifecycle.
    await expect(
      tenant.as.mutation(api.campaigns.update, {
        id: providerId,
        status: "running",
      }),
    ).rejects.toThrow(/provider|internal|tracked/i);

    // Local campaigns still work end to end.
    await tenant.as.mutation(api.campaigns.update, {
      id: localId,
      status: "running",
    });
    const local = await t.run((ctx) => ctx.db.get(localId));
    expect(local?.status).toBe("running");

    // The delivery view separates the two worlds.
    const localView = await tenant.as.query(api.campaigns.getDelivery, {
      id: localId,
    });
    expect(localView?.trackingSource).toBe("local");
    expect(localView?.delivery?.verified).toBe(false);

    const providerView = await tenant.as.query(api.campaigns.getDelivery, {
      id: providerId,
    });
    expect(providerView?.trackingSource).toBe("provider");
    expect(providerView?.delivery?.verified).toBe(false);
  });
});

describe("External badges require a stored receipt", () => {
  it("ReceiptBadge classifies verified vs unverified states and never fakes green", async () => {
    const { ReceiptBadge, receiptTone, receiptDotClass, ReceiptBadge_LABELS } =
      await import("@/components/app/ReceiptBadge");

    expect(receiptTone("verified")).toBe("verified");
    expect(receiptTone("release_prepared")).toBe("prepared");
    expect(receiptTone("requires_verification")).toBe("unverified");
    expect(receiptTone("content_changed")).toBe("unverified");
    expect(receiptTone("deployment_missing")).toBe("unverified");
    expect(receiptTone("unavailable")).toBe("locked");

    // The tone contract is what the UI promise rests on: only the verified
    // tone is green, and it must not be reachable for unverified labels.
    expect(receiptDotClass.verified).toMatch(/terminal-green/);
    expect(receiptDotClass.unverified).toMatch(/terminal-amber/);
    expect(receiptDotClass.unverified).not.toMatch(/terminal-green/);
    expect(receiptDotClass.prepared).toMatch(/terminal-blue/);

    // The badge's LABELS map carries honest human text per state — an
    // unverified label must never be titled like a success. ReceiptBadge
    // itself renders exactly these strings.
    expect(ReceiptBadge_LABELS.requires_verification).toMatch(
      /verification|unverified|not verified/i,
    );
    expect(ReceiptBadge_LABELS.verified).toMatch(/verified|receipt/i);
    expect(ReceiptBadge).toBeTypeOf("function");
  });
});

describe("Site delivery view", () => {
  it("reports the honest delivery view and denies foreign tenants", async () => {
    const t = newBackend();
    const tenant = await seedUser(t, { plan: "starter" });
    const projectId = await tenant.as.mutation(api.projects.create, {
      name: "p",
    });

    // No deployment has ever existed for this site.
    const view = await tenant.as.query(api.buildWorkspace.getSiteDelivery, {
      projectId,
    });
    expect(view?.deployment).toBeNull();
    expect(view?.delivery?.verified).toBe(false);
    expect(view?.delivery?.label).toMatch(/missing|never|unverified/i);

    const intruder = await seedUser(t, { plan: "starter", email: "c@z.test" });
    await expect(
      intruder.as.query(api.buildWorkspace.getSiteDelivery, { projectId }),
    ).rejects.toThrow();
  });
});
