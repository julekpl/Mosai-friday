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
    // (BP-03 removes these inputs from the public API entirely, so the
    // validator rejects them; the property under test is that the call is
    // refused AND nothing is written, not the validator's wording.)
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
    ).rejects.toThrow();

    await expect(
      tenant.as.mutation(api.builds.update, {
        id: buildId,
        // @ts-expect-error — WCAG booleans are no longer client-writable
        wcagReady: true,
      }),
    ).rejects.toThrow();

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
    const build = await t.run((ctx) => ctx.db.get(buildId));
    expect(build?.status).toBe("generated");
    expect(build?.releaseState).toBe("prepared");
    expect(build?.lastReleaseAt).toBeTypeOf("number");
    // BP-03 correction: "draft" is a local lifecycle state written at site
    // creation — publish must leave the row untouched, never upgrade it to
    // an external status like "live" (which pre-BP-03 code did).
    expect(siteRow?.status).toBe("draft");
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
    // Local "draft" stays exactly as created — no external claim appears.
    expect(siteRow?.status).toBe("draft");
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

    // First preparation succeeds (this is the release that must survive).
    const first = await tenant.as.mutation(api.buildWorkspace.publishSite, {
      buildId,
    });
    expect(first.prepared).toBe(1);
    const before = await t.run((ctx) => ctx.db.get(pageId));

    // …then the content becomes invalid under it.
    await t.run(async (ctx) => {
      return ctx.db.patch(before!.latestDraftRevisionId!, {
        document: {
          schemaVersion: 1,
          blocks: [
            // hero without its required heading — invalid content
            { id: "blk_bad", type: "hero", version: 1, props: {} },
          ],
        },
      });
    });

    // The next preparation must fail loudly…
    await expect(
      tenant.as.mutation(api.buildWorkspace.publishSite, { buildId }),
    ).rejects.toThrow();

    // …and the previous confirmed release is untouched: the promoted
    // revision row from the first preparation still exists, still
    // referenced by the page's published pointer (the public-serving gate
    // itself is covered by the "External delivery" suite below).
    const pageAfter = await t.run((ctx) => ctx.db.get(pageId));
    expect(pageAfter?.publishedRevisionId).toBe(
      before!.publishedRevisionId,
    );
    const servedRevision = await t.run((ctx) =>
      ctx.db.get(before!.publishedRevisionId!),
    );
    expect(servedRevision?.state).toBe("published");
    expect(servedRevision?.document).toEqual(DOC);

    // No second release was recorded.
    const releases = await t.run((ctx) =>
      ctx.db.query("buildReleaseAudits").collect(),
    );
    expect(releases).toHaveLength(1);
    // The failed preparation left the site row untouched (still local
    // "draft" from creation — never an external status).
    const siteRow = await t.run((ctx) => ctx.db.get(before!.siteId));
    expect(siteRow?.status).toBe("draft");
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
    // BP-03 correction: the field is documented as *revision* ids — assert
    // the audited draft revision, not the page id.
    const freshPage = await t.run((ctx) => ctx.db.get(pageId));
    expect(ready?.delivery.verifiedRevisionIds).toContain(
      freshPage!.latestDraftRevisionId,
    );
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
    expect(stale?.delivery.verifiedRevisionIds).not.toContain(
      before!.latestDraftRevisionId,
    );
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

/* ── Review follow-up (chat 3, same day) — red-first regressions ───────────
 *
 * The GitHub review of BP-03 on main found two correctness gaps. Both tests
 * below were written and shown failing BEFORE the fixes:
 *
 *  1. `publishSite` skipped invalid/empty pages while still promoting the
 *     valid ones — a partial release, which the blueprint forbids:
 *     "Continue serving the last confirmed public release when a new publish
 *     fails" (BP-03 Changes) implies a failed preparation must not ship a
 *     half-revised site. There is NO partial-release clause in the
 *     blueprint; preparation is therefore all-or-nothing.
 *  2. `cms.getPublishedByPath` (unauthenticated public query) and
 *     `storefront.getPublishedPage` served approved content as soon as a
 *     preparation promoted it — before any BP-13 deployment exists. External
 *     delivery must be gated on a server-verified deployment receipt;
 *     prepared content is preview-only until then.
 */

describe("Preparation is all-or-nothing (review follow-up 1)", () => {
  /** Create a second page and return the page row via a direct read. */
  async function addPage(
    t: TestBackend,
    tenant: Tenant,
    projectId: string,
    slug: string,
  ) {
    const site = await t.run(async (ctx) =>
      ctx.db
        .query("sites")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .first(),
    );
    await tenant.as.mutation(api.cms.createPage, {
      siteId: site!._id,
      title: slug,
      slug,
      // `seedSite` already created the homepage at "/" — this helper adds
      // a distinct child page under it.
      parentId: (
        await t.run(async (ctx) =>
          ctx.db
            .query("cmsPages")
            .withIndex("by_site_path", (q) =>
              q.eq("siteId", site!._id).eq("fullPath", "/"),
            )
            .first(),
        )
      )!._id,
    });
    return await t.run(async (ctx) =>
      ctx.db
        .query("cmsPages")
        .withIndex("by_site_path", (q) =>
          q.eq("siteId", site!._id).eq("fullPath", `/${slug}`),
        )
        .first(),
    );
  }

  it("a valid+invalid page mix fails the whole preparation and preserves the prior release", async () => {
    const t = newBackend();
    const tenant = await seedUser(t, { plan: "starter" });
    const projectId = await tenant.as.mutation(api.projects.create, {
      name: "p",
    });
    const { buildId } = await seedSite(t, tenant, projectId);

    // First preparation succeeds while every page is valid — this is the
    // prior release that must survive the later failed attempt.
    const first = await tenant.as.mutation(api.buildWorkspace.publishSite, {
      buildId,
    });
    expect(first.prepared).toBe(1);

    // A second page whose draft is invalid (hero without its required
    // heading) — the mix that exposed the partial-release defect.
    const brokenPage = await addPage(t, tenant, projectId, "broken");
    await t.run((ctx) =>
      ctx.db.patch(brokenPage!.latestDraftRevisionId!, {
        document: {
          schemaVersion: 1,
          blocks: [{ id: "blk_bad", type: "hero", version: 1, props: {} }],
        },
      }),
    );

    // The mixed preparation must fail LOUDLY — not skip-and-promote.
    await expect(
      tenant.as.mutation(api.buildWorkspace.publishSite, { buildId }),
    ).rejects.toThrow(/invalid|failed checks/i);

    // Nothing from the failed attempt was promoted: no second audit exists.
    const releases = await t.run((ctx) =>
      ctx.db.query("buildReleaseAudits").collect(),
    );
    expect(releases).toHaveLength(1);
    const brokenAfter = await t.run((ctx) => ctx.db.get(brokenPage!._id));
    // The broken page never gained a published pointer or status.
    expect(brokenAfter?.publishedRevisionId).toBeUndefined();
    expect(brokenAfter?.status).toBe("draft");
  });

  it("an empty-draft page in the mix also fails the whole preparation", async () => {
    const t = newBackend();
    const tenant = await seedUser(t, { plan: "starter" });
    const projectId = await tenant.as.mutation(api.projects.create, {
      name: "p",
    });
    const { buildId } = await seedSite(t, tenant, projectId);

    // A page created but never drafted — its draft document is empty.
    await addPage(t, tenant, projectId, "empty");

    await expect(
      tenant.as.mutation(api.buildWorkspace.publishSite, { buildId }),
    ).rejects.toThrow(/empty|failed checks/i);

    // The valid page was NOT promoted either — all-or-nothing.
    const audits = await t.run((ctx) =>
      ctx.db.query("buildReleaseAudits").collect(),
    );
    expect(audits).toHaveLength(0);
  });
});

describe("External delivery is gated on a verified deployment receipt (review follow-up 2)", () => {
  it("cms.getPublishedByPath serves nothing after preparation alone and the prior release after a failed one", async () => {
    const t = newBackend();
    const tenant = await seedUser(t, { plan: "starter" });
    const projectId = await tenant.as.mutation(api.projects.create, {
      name: "p",
    });
    const { buildId, siteId, pageId } = await seedSite(t, tenant, projectId);

    // Before any preparation: nothing is served.
    expect(
      await tenant.as.query(api.cms.getPublishedByPath, {
        siteId,
        fullPath: "/",
      }),
    ).toBeNull();

    // After a successful preparation there IS an approved revision — but no
    // verified deployment. The public path must still serve nothing.
    await tenant.as.mutation(api.buildWorkspace.publishSite, { buildId });
    expect(
      await tenant.as.query(api.cms.getPublishedByPath, {
        siteId,
        fullPath: "/",
      }),
    ).toBeNull();

    // Owner preview is preserved: the readiness view still describes the
    // prepared content (the workspace renders drafts directly, so preview
    // does not depend on the public path).
    const ready = await tenant.as.query(api.builds.getReadiness, {
      id: buildId,
    });
    expect(ready?.delivery.label).toBe("release_prepared");
    expect(ready?.pages[0]?.fullPath).toBe("/");

    // Simulate BP-13's verified deployment receipt (server-written row, the
    // exact shape BP-13's verifier will produce). Only now is it served.
    const now = Date.now();
    const deploymentId = await t.run((ctx) =>
      ctx.db.insert("buildDeployments", {
        projectId,
        buildId,
        siteId,
        state: "succeeded",
        createdAt: now,
        updatedAt: now,
      }),
    );
    const audit = (await t.run((ctx) =>
      ctx.db.query("buildReleaseAudits").collect(),
    ))[0];
    await t.run((ctx) =>
      ctx.db.patch(audit._id, { phase: "verified", deploymentId }),
    );
    const served = await tenant.as.query(api.cms.getPublishedByPath, {
      siteId,
      fullPath: "/",
    });
    expect(served?.revision.document).toEqual(DOC);

    // The prepared page row is the one served.
    const page = await t.run((ctx) => ctx.db.get(pageId));
    expect(served?.page._id).toBe(page?._id);
  });

  it("storefront.getPublishedPage serves nothing before a verified deployment and content after", async () => {
    const t = newBackend();
    const tenant = await seedUser(t, { plan: "starter" });
    const projectId = await tenant.as.mutation(api.projects.create, {
      name: "p",
    });
    const { buildId, siteId } = await seedSite(t, tenant, projectId);

    await tenant.as.mutation(api.buildWorkspace.publishSite, { buildId });

    // Prepared but not deployed: not found externally.
    expect(
      await tenant.as.query(api.storefront.getPublishedPage, {
        projectId,
        path: "/",
      }),
    ).toMatchObject({ kind: "not_found" });

    // Verify the deployment (server-written receipt, as BP-13 will).
    const now = Date.now();
    const deploymentId = await t.run((ctx) =>
      ctx.db.insert("buildDeployments", {
        projectId,
        buildId,
        siteId,
        state: "succeeded",
        createdAt: now,
        updatedAt: now,
      }),
    );
    const audit = (await t.run((ctx) =>
      ctx.db.query("buildReleaseAudits").collect(),
    ))[0];
    await t.run((ctx) =>
      ctx.db.patch(audit._id, { phase: "verified", deploymentId }),
    );

    const result = await tenant.as.query(api.storefront.getPublishedPage, {
      projectId,
      path: "/",
    });
    expect(result.kind).toBe("page");
    if (result.kind === "page") {
      expect(result.document).toEqual(DOC);
    }
  });

  /** Simulate BP-13's server-written verification of the newest audit. */
  async function verifyNewestAudit(
    t: TestBackend,
    projectId: string,
    buildId: string,
    siteId: string,
  ) {
    const now = Date.now();
    const deploymentId = await t.run((ctx) =>
      ctx.db.insert("buildDeployments", {
        projectId,
        buildId,
        siteId,
        state: "succeeded",
        createdAt: now,
        updatedAt: now,
      }),
    );
    await t.run(async (ctx) => {
      const audits = await ctx.db
        .query("buildReleaseAudits")
        .withIndex("by_build", (q) => q.eq("buildId", buildId))
        .collect();
      audits.sort((a, b) => b.createdAt - a.createdAt);
      ctx.db.patch(audits[0]._id, { phase: "verified", deploymentId });
    });
  }

  it("keeps serving A's pinned revision across B prepare/fail and serves B once verified", async () => {
    const t = newBackend();
    const tenant = await seedUser(t, { plan: "starter" });
    const projectId = await tenant.as.mutation(api.projects.create, {
      name: "p",
    });
    const { buildId, siteId, pageId } = await seedSite(t, tenant, projectId);

    // Release A: prepare + verify. The homepage serves DOC.
    await tenant.as.mutation(api.buildWorkspace.publishSite, { buildId });
    await verifyNewestAudit(t, projectId, buildId, siteId);
    const aAudit = (
      await t.run(async (ctx) =>
        ctx.db
          .query("buildReleaseAudits")
          .withIndex("by_build", (q) => q.eq("buildId", buildId))
          .collect(),
      )
    ).sort((a, b) => b.createdAt - a.createdAt)[0];
    const aRevisionId = aAudit.revisionIds[0];
    const aServed = await tenant.as.query(api.cms.getPublishedByPath, {
      siteId,
      fullPath: "/",
    });
    expect(aServed?.revision.document).toEqual(DOC);

    // Release B: a new draft with different content is prepared.
    const before = await t.run((ctx) => ctx.db.get(pageId));
    await t.run((ctx) =>
      ctx.db.patch(before!.latestDraftRevisionId!, {
        document: {
          schemaVersion: 1,
          blocks: [
            {
              id: "blk_b_hero",
              type: "hero",
              version: 1,
              props: { heading: "Release B headline" },
            },
          ],
        },
      }),
    );
    await tenant.as.mutation(api.buildWorkspace.publishSite, { buildId });

    // B's preparation moved the page pointer to B's revision — the public
    // path must STILL serve A's pinned revision (last confirmed release),
    // not nothing and not B.
    const stillA = await tenant.as.query(api.cms.getPublishedByPath, {
      siteId,
      fullPath: "/",
    });
    expect(stillA?.revision.document).toEqual(DOC);
    expect(stillA?.revision._id).toBe(aRevisionId);
    const stillASf = await tenant.as.query(api.storefront.getPublishedPage, {
      projectId,
      path: "/",
    });
    expect(stillASf.kind).toBe("page");
    if (stillASf.kind === "page") {
      expect(stillASf.document).toEqual(DOC);
    }

    // B's deployment then FAILS (superseding audit is non-verified): A
    // keeps serving on both paths.
    const now = Date.now();
    await t.run(async (ctx) => {
      const audits = await ctx.db
        .query("buildReleaseAudits")
        .withIndex("by_build", (q) => q.eq("buildId", buildId))
        .collect();
      audits.sort((a, b) => b.createdAt - a.createdAt);
      const failedDeployment = await ctx.db.insert("buildDeployments", {
        projectId,
        buildId,
        siteId,
        state: "failed",
        createdAt: now,
        updatedAt: now,
      });
      ctx.db.patch(audits[0]._id, {
        phase: "failed",
        deploymentId: failedDeployment,
      });
    });
    const afterFail = await tenant.as.query(api.cms.getPublishedByPath, {
      siteId,
      fullPath: "/",
    });
    expect(afterFail?.revision.document).toEqual(DOC);
    expect(afterFail?.revision._id).toBe(aRevisionId);
    const afterFailSf = await tenant.as.query(api.storefront.getPublishedPage, {
      projectId,
      path: "/",
    });
    expect(afterFailSf.kind).toBe("page");
    if (afterFailSf.kind === "page") {
      expect(afterFailSf.document).toEqual(DOC);
    }

    // B is then verified: both paths switch to B.
    await verifyNewestAudit(t, projectId, buildId, siteId);
    const nowB = await tenant.as.query(api.cms.getPublishedByPath, {
      siteId,
      fullPath: "/",
    });
    expect(nowB?.revision.document).toEqual({
      schemaVersion: 1,
      blocks: [
        {
          id: "blk_b_hero",
          type: "hero",
          version: 1,
          props: { heading: "Release B headline" },
        },
      ],
    });
    const nowBSf = await tenant.as.query(api.storefront.getPublishedPage, {
      projectId,
      path: "/",
    });
    expect(nowBSf.kind).toBe("page");
    if (nowBSf.kind === "page") {
      expect(nowBSf.document).toEqual({
        schemaVersion: 1,
        blocks: [
          {
            id: "blk_b_hero",
            type: "hero",
            version: 1,
            props: { heading: "Release B headline" },
          },
        ],
      });
    }
  });

  it("pages and redirects added by B stay hidden until B is verified", async () => {
    const t = newBackend();
    const tenant = await seedUser(t, { plan: "starter" });
    const projectId = await tenant.as.mutation(api.projects.create, {
      name: "p",
    });
    const { buildId, siteId } = await seedSite(t, tenant, projectId);

    // A: prepare + verify (only the homepage exists).
    await tenant.as.mutation(api.buildWorkspace.publishSite, { buildId });
    await verifyNewestAudit(t, projectId, buildId, siteId);

    // B: add a NEW page and a redirect, then prepare.
    const site = await t.run(async (ctx) =>
      ctx.db
        .query("sites")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .first(),
    );
    await tenant.as.mutation(api.cms.createPage, {
      siteId: site!._id,
      title: "New in B",
      slug: "new-in-b",
      parentId: (
        await t.run(async (ctx) =>
          ctx.db
            .query("cmsPages")
            .withIndex("by_site_path", (q) =>
              q.eq("siteId", site!._id).eq("fullPath", "/"),
            )
            .first(),
        )
      )!._id,
    });
    const newPage = await t.run(async (ctx) =>
      ctx.db
        .query("cmsPages")
        .withIndex("by_site_path", (q) =>
          q.eq("siteId", site!._id).eq("fullPath", "/new-in-b"),
        )
        .first(),
    );
    // Give the new page a valid draft so B's all-or-nothing preparation
    // accepts it.
    await t.run((ctx) =>
      ctx.db.patch(newPage!.latestDraftRevisionId!, {
        document: {
          schemaVersion: 1,
          blocks: [
            {
              id: "blk_new_hero",
              type: "hero",
              version: 1,
              props: { heading: "New in B" },
            },
          ],
        },
      }),
    );
    await tenant.as.mutation(api.buildWorkspace.publishSite, { buildId });

    // Before verification the new page is not served...
    expect(
      await tenant.as.query(api.cms.getPublishedByPath, {
        siteId,
        fullPath: "/new-in-b",
      }),
    ).toBeNull();
    expect(
      await tenant.as.query(api.storefront.getPublishedPage, {
        projectId,
        path: "/new-in-b",
      }),
    ).toMatchObject({ kind: "not_found" });

    // ...and B's new redirect is not honored.
    const now = Date.now();
    await t.run((ctx) =>
      ctx.db.insert("cmsRedirects", {
        siteId: site!._id,
        projectId,
        fromPath: "/old-path",
        to: "/new-in-b",
        statusCode: 301,
        createdAt: now,
      }),
    );
    expect(
      await tenant.as.query(api.storefront.getPublishedPage, {
        projectId,
        path: "/old-path",
      }),
    ).toMatchObject({ kind: "not_found" });

    // After verification both the new page and the redirect open up.
    await verifyNewestAudit(t, projectId, buildId, siteId);
    const page = await t.run((ctx) => ctx.db.get(newPage!._id));
    expect(
      (
        await tenant.as.query(api.cms.getPublishedByPath, {
          siteId,
          fullPath: "/new-in-b",
        })
      )?.page._id,
    ).toBe(page?._id);
    expect(
      await tenant.as.query(api.storefront.getPublishedPage, {
        projectId,
        path: "/old-path",
      }),
    ).toMatchObject({ kind: "redirect", to: "/new-in-b" });
  });
});
