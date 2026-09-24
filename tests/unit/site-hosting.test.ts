import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeFunctionReference } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  isValidPublicSlug,
  MAX_PUBLIC_SLUG_LENGTH,
  parsePublicSiteSegment,
  publicSiteBase,
  RESERVED_PUBLIC_SLUGS,
  slugCandidate,
  slugifyProjectName,
} from "@/convex/lib/publicSites";
import { allocatePublicSlug } from "@/convex/siteHosting";
import { PUBLIC_SITE_CSP } from "@/convex/lib/siteHtml";
import { buildFunctionRegistry } from "./function-registry";
import { newBackend, seedUser, type Tenant, type TestBackend } from "./helpers";

/**
 * MOSAI self-hosted websites (owner decision, 24 Sep 2026):
 * `/s/<slug>-website/<page path>` served as static HTML from the CONFIRMED
 * release only.
 *
 * Red-first: before this change `siteHosting` (status / deployWebsite / the
 * `/public-site/` route), `publicSites` and `lib/publicSites.ts` did not
 * exist, so every test below failed (module not found / 404 from the router).
 */

type HostingStatus = {
  slug: string | null;
  path: string | null;
  state: "not_deployed" | "deploying" | "live" | "failed";
  lastDeployedAt: number | null;
  error: string | null;
};

const statusQuery = makeFunctionReference<
  "query",
  { projectId: Id<"projects"> },
  HostingStatus
>("siteHosting:status");
const deployAction = makeFunctionReference<
  "action",
  { projectId: Id<"projects"> },
  { path: string }
>("siteHosting:deployWebsite");

function doc(heading: string) {
  return {
    schemaVersion: 1,
    blocks: [{ id: "blk_hero", type: "hero", version: 1, props: { heading } }],
  };
}

type Seeded = {
  projectId: Id<"projects">;
  buildId: Id<"builds">;
  siteId: Id<"sites">;
  homeId: Id<"cmsPages">;
};

async function addPage(
  t: TestBackend,
  tenant: Tenant,
  s: { projectId: Id<"projects">; siteId: Id<"sites"> },
  page: { title: string; slug: string; fullPath: string; heading: string },
): Promise<Id<"cmsPages">> {
  const userId = tenant.userId as Id<"users">;
  return await t.run(async (ctx) => {
    const now = Date.now();
    const pageId = await ctx.db.insert("cmsPages", {
      siteId: s.siteId,
      projectId: s.projectId,
      title: page.title,
      slug: page.slug,
      fullPath: page.fullPath,
      status: "draft",
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    });
    const revId = await ctx.db.insert("pageRevisions", {
      pageId,
      projectId: s.projectId,
      version: 1,
      state: "draft",
      document: doc(page.heading),
      createdBy: userId,
      createdAt: now,
    });
    await ctx.db.patch(pageId, { latestDraftRevisionId: revId });
    return pageId;
  });
}

async function seedWebsite(
  t: TestBackend,
  tenant: Tenant,
  name = "Café Zürich",
): Promise<Seeded> {
  const projectId = (await tenant.as.mutation(api.projects.create, {
    name,
  })) as Id<"projects">;
  const buildId = (await tenant.as.mutation(api.builds.create, {
    projectId,
    name: "Website",
    kind: "website",
  })) as Id<"builds">;
  const userId = tenant.userId as Id<"users">;
  const siteId = await t.run((ctx) =>
    ctx.db.insert("sites", {
      projectId,
      name: "Café Zürich",
      slug: "website",
      status: "draft",
      createdBy: userId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
  );
  const homeId = await addPage(
    t,
    tenant,
    { projectId, siteId },
    {
      title: "Home",
      slug: "home",
      fullPath: "/",
      heading: "Welcome to version one",
    },
  );
  return { projectId, buildId, siteId, homeId };
}

async function editDraft(
  t: TestBackend,
  pageId: Id<"cmsPages">,
  heading: string,
) {
  await t.run(async (ctx) => {
    const page = await ctx.db.get(pageId);
    if (!page?.latestDraftRevisionId) throw new Error("no draft");
    const draft = await ctx.db.get(page.latestDraftRevisionId);
    if (draft?.state === "draft") {
      await ctx.db.patch(draft._id, { document: doc(heading) });
      return;
    }
    const revs = await ctx.db
      .query("pageRevisions")
      .withIndex("by_page", (q) => q.eq("pageId", pageId))
      .collect();
    const revId = await ctx.db.insert("pageRevisions", {
      pageId,
      projectId: page.projectId,
      version: revs.reduce((m, r) => Math.max(m, r.version), 0) + 1,
      state: "draft",
      document: doc(heading),
      createdBy: page.createdBy,
      createdAt: Date.now(),
    });
    await ctx.db.patch(pageId, { latestDraftRevisionId: revId });
  });
}

async function get(t: TestBackend, path: string) {
  const res = await t.fetch(path, { method: "GET" });
  return { res, body: await res.text() };
}

let savedBase: string | undefined;
beforeEach(() => {
  savedBase = process.env.MOSAI_PUBLIC_SITE_BASE;
  delete process.env.MOSAI_PUBLIC_SITE_BASE;
});
afterEach(() => {
  if (savedBase === undefined) delete process.env.MOSAI_PUBLIC_SITE_BASE;
  else process.env.MOSAI_PUBLIC_SITE_BASE = savedBase;
});

describe("public site slugs", () => {
  it("derives a lower-case ascii slug, strips diacritics, collapses dashes, caps at 40", () => {
    expect(slugifyProjectName("Café Zürich")).toBe("cafe-zurich");
    expect(slugifyProjectName("  Straße & Söhne -- GmbH!! ")).toBe(
      "strasse-sohne-gmbh",
    );
    expect(slugifyProjectName("Łódź Bakery")).toBe("lodz-bakery");
    const long = slugifyProjectName("a".repeat(30) + " " + "b".repeat(30));
    expect(long.length).toBeLessThanOrEqual(MAX_PUBLIC_SLUG_LENGTH);
    expect(long.endsWith("-")).toBe(false);
    expect(slugifyProjectName("!!!")).toBe("site");
    expect(slugifyProjectName("")).toBe("site");
  });

  it("refuses reserved words", () => {
    for (const word of RESERVED_PUBLIC_SLUGS) {
      expect(isValidPublicSlug(word)).toBe(false);
      const slug = slugifyProjectName(word);
      expect(RESERVED_PUBLIC_SLUGS.has(slug)).toBe(false);
      expect(isValidPublicSlug(slug)).toBe(true);
    }
    expect(slugifyProjectName("Admin")).toBe("admin-site");
    expect(isValidPublicSlug("-leading")).toBe(false);
    expect(isValidPublicSlug("a--b")).toBe(false);
  });

  it("suffixes stay within 40 characters", () => {
    const base = "x".repeat(40);
    expect(slugCandidate(base, 1)).toBe(base);
    expect(slugCandidate(base, 2)).toBe(`${"x".repeat(38)}-2`);
    expect(slugCandidate(base, 12).length).toBe(40);
  });

  it("parses URL segments; -app is recognised but separate", () => {
    expect(parsePublicSiteSegment("acme-website")).toEqual({
      slug: "acme",
      kind: "website",
    });
    expect(parsePublicSiteSegment("acme-app")).toEqual({
      slug: "acme",
      kind: "app",
    });
    expect(parsePublicSiteSegment("admin-website")).toBeNull();
    expect(parsePublicSiteSegment("acme")).toBeNull();
  });

  it("only honours an https public base", () => {
    expect(publicSiteBase(undefined)).toBe("");
    expect(publicSiteBase("https://sites.example.com/")).toBe(
      "https://sites.example.com",
    );
    expect(publicSiteBase("http://sites.example.com")).toBe("");
    expect(publicSiteBase("javascript:alert(1)")).toBe("");
  });

  it("allocates unique, stable slugs (-2 suffix; rename does not move it)", async () => {
    const t = newBackend();
    const a = await seedUser(t, { plan: "starter" });
    const b = await seedUser(t, { plan: "starter" });
    const pa = await seedWebsite(t, a, "Acme");
    const pb = await seedWebsite(t, b, "ACME!");
    const allocate = (projectId: Id<"projects">) =>
      t.run(async (ctx) => {
        const project = await ctx.db.get(projectId);
        if (!project) throw new Error("missing project");
        return await allocatePublicSlug(ctx, project);
      });
    expect(await allocate(pa.projectId)).toBe("acme");
    expect(await allocate(pb.projectId)).toBe("acme-2");
    await t.run((ctx) =>
      ctx.db.patch(pa.projectId, { name: "Totally new name" }),
    );
    expect(await allocate(pa.projectId)).toBe("acme");
    const rows = await t.run((ctx) => ctx.db.query("publicSites").collect());
    expect(rows).toHaveLength(2);
    // The project's app may reuse the project's own slug; another project's
    // website cannot (b's app gets its own `acme-2`, never a's `acme`).
    await t.run((ctx) => ctx.db.patch(pa.projectId, { name: "Acme" }));
    const p = await t.run((ctx) => ctx.db.get(pa.projectId));
    expect(await t.run((ctx) => allocatePublicSlug(ctx, p!, "app"))).toBe("acme");
    const q = await t.run((ctx) => ctx.db.get(pb.projectId));
    expect(await t.run((ctx) => allocatePublicSlug(ctx, q!, "app"))).toBe("acme-2");
  });
});

describe("deployWebsite + public route", () => {
  it("happy path: the site becomes live and the home page is served with the CSP header", async () => {
    const t = newBackend();
    const tenant = await seedUser(t, { plan: "starter" });
    const s = await seedWebsite(t, tenant);

    const before = await tenant.as.query(statusQuery, {
      projectId: s.projectId,
    });
    expect(before.state).toBe("not_deployed");
    expect(before.slug).toBeNull();

    // Deploy requires a prepared release first.
    await expect(
      tenant.as.action(deployAction, { projectId: s.projectId }),
    ).rejects.toThrow(/prepared release/i);
    await tenant.as.mutation(api.buildWorkspace.publishSite, {
      buildId: s.buildId,
    });
    // A prepared release alone is not served.
    expect((await get(t, "/public-site/cafe-zurich-website/")).res.status).toBe(
      404,
    );

    const { path } = await tenant.as.action(deployAction, {
      projectId: s.projectId,
    });
    expect(path).toBe("/s/cafe-zurich-website");

    const after = await tenant.as.query(statusQuery, {
      projectId: s.projectId,
    });
    expect(after).toMatchObject({
      slug: "cafe-zurich",
      path: "/s/cafe-zurich-website",
      state: "live",
      error: null,
    });
    expect(after.lastDeployedAt).toBeTypeOf("number");

    const deployments = await t.run((ctx) =>
      ctx.db.query("buildDeployments").collect(),
    );
    expect(deployments).toHaveLength(1);
    expect(deployments[0].state).toBe("succeeded");
    expect(deployments[0].provider).toBe("mosai-self-host");
    expect(deployments[0].providerResourceId).toBe(
      `cafe-zurich-website@${deployments[0].releaseAuditId}`,
    );

    for (const url of [
      "/public-site/cafe-zurich-website/",
      "/public-site/cafe-zurich-website",
    ]) {
      const { res, body } = await get(t, url);
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toMatch(/^text\/html/);
      expect(res.headers.get("Content-Security-Policy")).toBe(PUBLIC_SITE_CSP);
      expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(res.headers.get("Referrer-Policy")).toBe(
        "strict-origin-when-cross-origin",
      );
      expect(res.headers.get("Cache-Control")).toBe("public, max-age=60");
      expect(body).toContain("Welcome to version one");
      expect(body.toLowerCase()).not.toContain("<script");
    }

    // Idempotent: the same release is not redeployed.
    const again = await tenant.as.action(deployAction, {
      projectId: s.projectId,
    });
    expect(again.path).toBe(path);
    expect(
      await t.run((ctx) => ctx.db.query("buildDeployments").collect()),
    ).toHaveLength(1);
  });

  it("uses MOSAI_PUBLIC_SITE_BASE for the displayed location", async () => {
    process.env.MOSAI_PUBLIC_SITE_BASE = "https://sites.example.test";
    const t = newBackend();
    const tenant = await seedUser(t, { plan: "starter" });
    const s = await seedWebsite(t, tenant, "Base Co");
    await tenant.as.mutation(api.buildWorkspace.publishSite, {
      buildId: s.buildId,
    });
    const { path } = await tenant.as.action(deployAction, {
      projectId: s.projectId,
    });
    expect(path).toBe("https://sites.example.test/s/base-co-website");
    const { body } = await get(t, "/public-site/base-co-website/");
    expect(body).toContain("https://sites.example.test/s/base-co-website/");
  });

  it("404s pages not in the release, unknown sites and -app segments (still with the headers)", async () => {
    const t = newBackend();
    const tenant = await seedUser(t, { plan: "starter" });
    const s = await seedWebsite(t, tenant, "Acme");
    await tenant.as.mutation(api.buildWorkspace.publishSite, {
      buildId: s.buildId,
    });
    await tenant.as.action(deployAction, { projectId: s.projectId });
    // A page added after the release is not served.
    await addPage(t, tenant, s, {
      title: "About",
      slug: "about",
      fullPath: "/about",
      heading: "About us",
    });

    for (const url of [
      "/public-site/acme-website/about",
      "/public-site/acme-website/missing",
      "/public-site/nobody-website/",
      "/public-site/acme-app/",
      "/public-site/acme/",
    ]) {
      const { res, body } = await get(t, url);
      expect(res.status, url).toBe(404);
      expect(res.headers.get("Content-Security-Policy")).toBe(PUBLIC_SITE_CSP);
      expect(res.headers.get("Cache-Control")).toBe("public, max-age=60");
      expect(body.toLowerCase()).not.toContain("<script");
      expect(body).not.toContain("About us");
    }
  });

  it("honours the confirmed release's redirects within the site base path", async () => {
    const t = newBackend();
    const tenant = await seedUser(t, { plan: "starter" });
    const s = await seedWebsite(t, tenant, "Acme");
    await t.run((ctx) =>
      ctx.db.insert("cmsRedirects", {
        siteId: s.siteId,
        projectId: s.projectId,
        fromPath: "/old-home",
        to: "/",
        statusCode: 301,
        source: "manual",
        createdAt: Date.now(),
      }),
    );
    await tenant.as.mutation(api.buildWorkspace.publishSite, {
      buildId: s.buildId,
    });
    await tenant.as.action(deployAction, { projectId: s.projectId });
    const { res } = await get(t, "/public-site/acme-website/old-home");
    expect(res.status).toBe(301);
    expect(res.headers.get("Location")).toBe("/s/acme-website/");
    expect(res.headers.get("Content-Security-Policy")).toBe(PUBLIC_SITE_CSP);
  });

  it("productGrid resolves live, active products of the same project only", async () => {
    const t = newBackend();
    const tenant = await seedUser(t, { plan: "starter" });
    const other = await seedUser(t, { plan: "starter" });
    const s = await seedWebsite(t, tenant, "Acme");
    const foreign = await seedWebsite(t, other, "Other");
    const now = Date.now();
    const { ownCollection, foreignCollection } = await t.run(async (ctx) => {
      const ownCollection = await ctx.db.insert("collections", {
        projectId: s.projectId,
        title: "Mine",
        createdAt: now,
      });
      const foreignCollection = await ctx.db.insert("collections", {
        projectId: foreign.projectId,
        title: "Theirs",
        createdAt: now,
      });
      const rows = [
        {
          projectId: s.projectId,
          title: "Active Mug",
          status: "active" as const,
          col: ownCollection,
        },
        {
          projectId: s.projectId,
          title: "Draft Mug",
          status: "draft" as const,
          col: ownCollection,
        },
        {
          projectId: foreign.projectId,
          title: "Foreign Mug",
          status: "active" as const,
          col: foreignCollection,
        },
      ];
      for (const row of rows) {
        await ctx.db.insert("products", {
          projectId: row.projectId,
          title: row.title,
          status: row.status,
          collectionIds: [row.col],
          createdAt: now,
          updatedAt: now,
        });
      }
      return { ownCollection, foreignCollection };
    });
    await t.run(async (ctx) => {
      const page = await ctx.db.get(s.homeId);
      await ctx.db.patch(page!.latestDraftRevisionId!, {
        document: {
          schemaVersion: 1,
          blocks: [
            {
              id: "blk_hero",
              type: "hero",
              version: 1,
              props: { heading: "Shop" },
            },
            {
              id: "blk_own",
              type: "productGrid",
              version: 1,
              props: { collectionId: ownCollection, columns: 3 },
            },
            {
              id: "blk_foreign",
              type: "productGrid",
              version: 1,
              props: { collectionId: foreignCollection, columns: 3 },
            },
          ],
        },
      });
    });
    await tenant.as.mutation(api.buildWorkspace.publishSite, {
      buildId: s.buildId,
    });
    await tenant.as.action(deployAction, { projectId: s.projectId });
    const { res, body } = await get(t, "/public-site/acme-website/");
    expect(res.status).toBe(200);
    expect(body).toContain("Active Mug");
    expect(body).not.toContain("Draft Mug");
    expect(body).not.toContain("Foreign Mug");
  });

  it("serves a draft edit only after it is prepared AND redeployed", async () => {
    const t = newBackend();
    const tenant = await seedUser(t, { plan: "starter" });
    const s = await seedWebsite(t, tenant, "Acme");
    await tenant.as.mutation(api.buildWorkspace.publishSite, {
      buildId: s.buildId,
    });
    await tenant.as.action(deployAction, { projectId: s.projectId });

    await editDraft(t, s.homeId, "Version two draft");
    let body = (await get(t, "/public-site/acme-website/")).body;
    expect(body).toContain("Welcome to version one");
    expect(body).not.toContain("Version two draft");

    // Prepared but not deployed: still version one.
    await tenant.as.mutation(api.buildWorkspace.publishSite, {
      buildId: s.buildId,
    });
    body = (await get(t, "/public-site/acme-website/")).body;
    expect(body).not.toContain("Version two draft");

    await tenant.as.action(deployAction, { projectId: s.projectId });
    body = (await get(t, "/public-site/acme-website/")).body;
    expect(body).toContain("Version two draft");
    expect(body).not.toContain("Welcome to version one");
  });

  it("a failed deploy keeps serving the previous confirmed release", async () => {
    const t = newBackend();
    const tenant = await seedUser(t, { plan: "starter" });
    const s = await seedWebsite(t, tenant, "Acme");
    await tenant.as.mutation(api.buildWorkspace.publishSite, {
      buildId: s.buildId,
    });
    await tenant.as.action(deployAction, { projectId: s.projectId });

    await editDraft(t, s.homeId, "Broken version two");
    await tenant.as.mutation(api.buildWorkspace.publishSite, {
      buildId: s.buildId,
    });
    // Make release B unrenderable: its pinned home revision is no longer promoted.
    await t.run(async (ctx) => {
      const build = await ctx.db.get(s.buildId);
      const audit = build?.lastReleaseAuditId
        ? await ctx.db.get(build.lastReleaseAuditId)
        : null;
      if (!audit) throw new Error("no audit");
      for (const id of audit.revisionIds)
        await ctx.db.patch(id, { state: "superseded" });
    });

    await expect(
      tenant.as.action(deployAction, { projectId: s.projectId }),
    ).rejects.toThrow(/Deployment failed/);
    const status = await tenant.as.query(statusQuery, {
      projectId: s.projectId,
    });
    expect(status.state).toBe("live");
    expect(status.error).toMatch(/did not render/);

    const deployments = await t.run((ctx) =>
      ctx.db.query("buildDeployments").collect(),
    );
    expect(deployments.map((d) => d.state).sort()).toEqual([
      "failed",
      "succeeded",
    ]);

    const { res, body } = await get(t, "/public-site/acme-website/");
    expect(res.status).toBe(200);
    expect(body).toContain("Welcome to version one");
    expect(body).not.toContain("Broken version two");
  });

  it("status is failed (not live) when the first deploy fails", async () => {
    const t = newBackend();
    const tenant = await seedUser(t, { plan: "starter" });
    const s = await seedWebsite(t, tenant, "Acme");
    await tenant.as.mutation(api.buildWorkspace.publishSite, {
      buildId: s.buildId,
    });
    await t.run(async (ctx) => {
      const build = await ctx.db.get(s.buildId);
      const audit = build?.lastReleaseAuditId
        ? await ctx.db.get(build.lastReleaseAuditId)
        : null;
      for (const id of audit?.revisionIds ?? [])
        await ctx.db.patch(id, { state: "superseded" });
    });
    await expect(
      tenant.as.action(deployAction, { projectId: s.projectId }),
    ).rejects.toThrow();
    const status = await tenant.as.query(statusQuery, {
      projectId: s.projectId,
    });
    expect(status.state).toBe("failed");
    expect((await get(t, "/public-site/acme-website/")).res.status).toBe(404);
    const site = await t.run((ctx) => ctx.db.get(s.siteId));
    expect(site?.status).not.toBe("live");
  });
});

describe("authorization and truth", () => {
  it("another tenant can neither deploy nor read status", async () => {
    const t = newBackend();
    const owner = await seedUser(t, { plan: "starter" });
    const intruder = await seedUser(t, { plan: "starter" });
    const s = await seedWebsite(t, owner, "Acme");
    await owner.as.mutation(api.buildWorkspace.publishSite, {
      buildId: s.buildId,
    });

    await expect(
      intruder.as.action(deployAction, { projectId: s.projectId }),
    ).rejects.toThrow();
    await expect(
      intruder.as.query(statusQuery, { projectId: s.projectId }),
    ).rejects.toThrow();
    expect(
      await t.run((ctx) => ctx.db.query("buildDeployments").collect()),
    ).toHaveLength(0);
    expect(
      await t.run((ctx) => ctx.db.query("publicSites").collect()),
    ).toHaveLength(0);

    // Signed-out callers are refused too.
    await expect(
      t.action(deployAction, { projectId: s.projectId }),
    ).rejects.toThrow();
  });

  it("a plan without Build cannot deploy", async () => {
    const t = newBackend();
    const owner = await seedUser(t, { plan: "starter" });
    const s = await seedWebsite(t, owner, "Acme");
    await owner.as.mutation(api.buildWorkspace.publishSite, {
      buildId: s.buildId,
    });
    await t.run((ctx) =>
      ctx.db.patch(owner.userId as Id<"users">, { plan: "free" }),
    );
    await expect(
      owner.as.action(deployAction, { projectId: s.projectId }),
    ).rejects.toThrow();
    expect(
      await t.run((ctx) => ctx.db.query("buildDeployments").collect()),
    ).toHaveLength(0);
  });

  it("no client-callable function in siteHosting can write a success state", () => {
    const hosting = buildFunctionRegistry().filter(
      (e) => e.module === "siteHosting",
    );
    expect(hosting.map((e) => `${e.exported}:${e.kind}`).sort()).toEqual([
      "deployWebsite:action",
      "status:query",
    ]);
  });
});
