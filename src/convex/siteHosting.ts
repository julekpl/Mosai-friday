import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  type ActionCtx,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { moduleAction, moduleQuery, requireProject } from "./guards";
import {
  hasCompleteRouteSnapshot,
  releaseRouteMap,
  resolveReleaseRoute,
  selectConfirmedRelease,
  type ReleaseRoute,
} from "./lib/deliveryGate";
import {
  parsePublicSiteSegment,
  PUBLIC_SITE_HTTP_PREFIX,
  PUBLIC_SITE_PATH_PREFIX,
  publicSiteBase,
  publicSiteLocation,
  publicSiteSegment,
  SELF_HOST_PROVIDER,
  slugCandidate,
  slugifyProjectName,
} from "./lib/publicSites";
import { normalizeSitePath } from "./lib/sitePaths";
import { collectionProducts } from "./cms";
import {
  PUBLIC_SITE_CSP,
  renderNotFoundPage,
  renderSitePage,
} from "./lib/siteHtml";

/* ── MOSAI self-hosted websites (owner decision, 24 Sep 2026) ─────────────
 *
 * For the MVP a customer WEBSITE is served by MOSAI itself at
 * `<MOSAI_PUBLIC_SITE_BASE>/s/<slug>-website/<page path>` as server-rendered
 * static HTML with no JavaScript. Apps are not served publicly yet.
 *
 * Truth chain (AGENTS.md rule 5, BP-03/BP-13):
 *  - `deployWebsite` (Build, `build.publish`) takes the release prepared by
 *    `buildWorkspace.publishSite`, writes a `buildDeployments` row `running`
 *    (provider `mosai-self-host`), VERIFIES the release by rendering every
 *    route through the same resolver + renderer the public route uses, and
 *    only then marks the deployment `succeeded` and the audit `verified`.
 *    Those writes live in internal mutations; no client-callable function
 *    in this file writes a success state.
 *  - The public route resolves pages ONLY through `selectConfirmedRelease`
 *    (the newest verified release with a succeeded deployment), so draft
 *    edits and later unverified releases are never served, and a failed
 *    deployment keeps the previous confirmed release serving.
 *  - Idempotency key = release audit id: redeploying a verified release is a
 *    no-op that returns the same path.
 */

/** A `running` deployment older than this is treated as abandoned. */
const STALE_DEPLOYMENT_MS = 5 * 60_000;
/** Upper bound on routes one deployment verifies (keeps the job bounded). */
const MAX_RELEASE_ROUTES = 500;
/** Upper bound on slug suffix attempts (`-2` … `-N`). */
const MAX_SLUG_ATTEMPTS = 200;

const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy": PUBLIC_SITE_CSP,
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Cache-Control": "public, max-age=60",
};

function configuredBase(): string {
  // Never logged or echoed: only its validated https form is used.
  return publicSiteBase(process.env.MOSAI_PUBLIC_SITE_BASE);
}

/** Path part of the configured base (`https://x.tld/sites` → `/sites`). */
function basePathPrefix(base: string): string {
  if (!base) return "";
  try {
    return new URL(base).pathname.replace(/\/+$/g, "");
  } catch {
    return "";
  }
}

// ── Shared reads ────────────────────────────────────────────────────────────

async function websiteBuild(
  ctx: Pick<QueryCtx, "db">,
  projectId: Id<"projects">,
): Promise<Doc<"builds"> | null> {
  return await ctx.db
    .query("builds")
    .withIndex("by_project_kind", (q) =>
      q.eq("projectId", projectId).eq("kind", "website"),
    )
    .first();
}

async function projectSite(
  ctx: Pick<QueryCtx, "db">,
  projectId: Id<"projects">,
): Promise<Doc<"sites"> | null> {
  return await ctx.db
    .query("sites")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .first();
}

async function publicSiteFor(
  ctx: Pick<QueryCtx, "db">,
  projectId: Id<"projects">,
): Promise<Doc<"publicSites"> | null> {
  return await ctx.db
    .query("publicSites")
    .withIndex("by_project_kind", (q) =>
      q.eq("projectId", projectId).eq("kind", "website"),
    )
    .first();
}

function siteDisplayName(site: Doc<"sites">): string {
  return site.seoDefaults?.siteName?.trim() || site.name;
}

function sortedRoutes(
  routes: Map<string, ReleaseRoute>,
): [string, ReleaseRoute][] {
  return [...routes.entries()].sort(([a], [b]) =>
    a === "/" ? -1 : b === "/" ? 1 : a.localeCompare(b),
  );
}

function hrefFor(basePath: string, fullPath: string): string {
  return fullPath === "/" ? `${basePath}/` : `${basePath}${fullPath}`;
}

/** Public product facts a productGrid block renders (renderer contract). */
type PublicProduct = {
  title: string;
  priceCents: number | null;
  currency: string;
  availability: string | null;
  imageUrl: string | null;
  externalUrl: string | null;
};

/**
 * productGrid blocks carry only a `collectionId`; product facts are live
 * Sell data, never copied into page content. Resolve them server-side from a
 * collection of the SAME project (a foreign or unknown id resolves to no
 * products) and inject them as `props.resolvedProducts`. Draft and archived
 * products are never shown publicly. Other blocks pass through unchanged.
 */
async function withResolvedProducts(
  ctx: Pick<QueryCtx, "db">,
  projectId: Id<"projects">,
  block: { type: string; props: unknown },
): Promise<unknown> {
  if (block.type !== "productGrid") return block.props;
  const props =
    block.props && typeof block.props === "object"
      ? (block.props as Record<string, unknown>)
      : {};
  const rawId = props.collectionId;
  let resolvedProducts: PublicProduct[] = [];
  const collectionId =
    typeof rawId === "string" ? ctx.db.normalizeId("collections", rawId) : null;
  const collection = collectionId ? await ctx.db.get(collectionId) : null;
  if (collection && collection.projectId === projectId) {
    const limit = typeof props.limit === "number" ? props.limit : undefined;
    resolvedProducts = (
      await collectionProducts(ctx, collection, { limit, publicOnly: true })
    ).map((p) => ({
      title: p.title,
      priceCents: p.priceCents,
      currency: p.currency,
      availability: p.availability,
      imageUrl: p.imageUrl,
      externalUrl: p.externalUrl,
    }));
  }
  return { ...props, resolvedProducts };
}

/**
 * THE render path for one route of one release. Used by the public HTTP
 * route (with the confirmed release) and by the deployment verifier (with
 * the candidate release), so a verified deployment proves exactly what the
 * public route will serve.
 */
async function renderReleasePath(
  ctx: Pick<QueryCtx, "db">,
  args: {
    routes: Map<string, ReleaseRoute>;
    site: Doc<"sites">;
    slug: string;
    path: string;
  },
): Promise<string | null> {
  const resolved = await resolveReleaseRoute(ctx, args.routes, args.path);
  if (!resolved) return null;
  const base = configuredBase();
  const segment = publicSiteSegment(args.slug, "website");
  const basePath = `${basePathPrefix(base)}${PUBLIC_SITE_PATH_PREFIX}/${segment}`;
  const nav = sortedRoutes(args.routes)
    .filter(([, route]) => !!route.title)
    .map(([fullPath, route]) => ({
      title: route.title ?? fullPath,
      href: hrefFor(basePath, fullPath),
    }));
  const blocks = [];
  for (const block of resolved.revision.document.blocks) {
    blocks.push({
      id: block.id,
      type: block.type,
      version: block.version,
      props: await withResolvedProducts(ctx, args.site.projectId, block),
    });
  }
  return renderSitePage({
    siteName: siteDisplayName(args.site),
    basePath,
    page: {
      title: resolved.route.title,
      fullPath: args.path,
      seo: resolved.route.seo,
      blocks,
    },
    nav,
    canonicalUrl: base
      ? `${base}${PUBLIC_SITE_PATH_PREFIX}/${segment}${args.path === "/" ? "/" : args.path}`
      : undefined,
  });
}

/** The rendered HTML is acceptable to serve: a real document, no script. */
function acceptableHtml(html: string | null): html is string {
  if (!html || html.trim().length === 0) return false;
  if (/<script/i.test(html)) return false;
  return /<html[\s>]/i.test(html);
}

// ── Public read path (HTTP) ────────────────────────────────────────────────

type PublicPageResult =
  | { kind: "page"; html: string }
  | { kind: "redirect"; location: string; status: 301 | 302 }
  | { kind: "not_found"; html: string };

/**
 * Resolve one public request. Internal: reached only through the HTTP route
 * below. Every page comes from the CONFIRMED release (receipt-gated); drafts,
 * prepared-but-unverified releases, suspended sites and apps resolve to 404.
 */
export const resolvePublicPage = internalQuery({
  args: { segment: v.string(), path: v.string() },
  handler: async (ctx, { segment, path }): Promise<PublicPageResult> => {
    const notFound = (): PublicPageResult => ({
      kind: "not_found",
      html: renderNotFoundPage(),
    });
    const parsed = parsePublicSiteSegment(segment);
    // Apps are not served publicly yet (owner decision, 24 Sep 2026).
    if (!parsed || parsed.kind !== "website") return notFound();
    const row = (
      await ctx.db
        .query("publicSites")
        .withIndex("by_slug", (q) => q.eq("slug", parsed.slug))
        .collect()
    ).find((r) => r.kind === "website");
    if (!row) return notFound();
    const site = await projectSite(ctx, row.projectId);
    if (!site || site.status === "suspended") return notFound();
    const gate = await selectConfirmedRelease(ctx, row.projectId);
    if (!gate.allowed) return notFound();

    const normalized = normalizeSitePath(path);
    const html = await renderReleasePath(ctx, {
      routes: gate.routesByPath,
      site,
      slug: row.slug,
      path: normalized,
    });
    const basePath = `${basePathPrefix(configuredBase())}${PUBLIC_SITE_PATH_PREFIX}/${publicSiteSegment(row.slug, "website")}`;
    if (acceptableHtml(html)) return { kind: "page", html };

    // Redirects come from the confirmed release's snapshot only.
    const redirect =
      gate.redirectsByPath.get(path) ?? gate.redirectsByPath.get(normalized);
    if (redirect) {
      const target = normalizeSitePath(redirect.to);
      if (target !== normalized) {
        return {
          kind: "redirect",
          location: hrefFor(basePath, target),
          status: redirect.statusCode,
        };
      }
    }
    return {
      kind: "not_found",
      html: renderNotFoundPage({ siteName: siteDisplayName(site), basePath }),
    };
  },
});

const resolvePublicPageRef = makeFunctionReference<
  "query",
  { segment: string; path: string },
  PublicPageResult
>("siteHosting:resolvePublicPage");

function htmlResponse(html: string, status: number): Response {
  return new Response(html, {
    status,
    headers: {
      ...SECURITY_HEADERS,
      "Content-Type": "text/html; charset=utf-8",
    },
  });
}

/**
 * HTTP handler body for `GET /public-site/<slug>-website/<page path>`.
 * Wrapped by `httpAction` in `http.ts`. Public, read-only and receipt-gated:
 * it serves nothing but the confirmed release, never writes, and never
 * executes or emits scripts.
 */
export async function handlePublicSiteRequest(
  ctx: Pick<ActionCtx, "runQuery">,
  request: Request,
): Promise<Response> {
  let segment = "";
  let rest = "/";
  try {
    const pathname = new URL(request.url).pathname;
    const idx = pathname.indexOf(PUBLIC_SITE_HTTP_PREFIX);
    const tail =
      idx >= 0 ? pathname.slice(idx + PUBLIC_SITE_HTTP_PREFIX.length) : "";
    const [first, ...others] = tail.split("/");
    segment = decodeURIComponent(first ?? "").toLowerCase();
    rest = `/${others.map((s) => decodeURIComponent(s)).join("/")}`;
  } catch {
    return htmlResponse(renderNotFoundPage(), 404);
  }
  try {
    const result = await ctx.runQuery(resolvePublicPageRef, {
      segment,
      path: rest,
    });
    if (result.kind === "page") return htmlResponse(result.html, 200);
    if (result.kind === "redirect") {
      return new Response(null, {
        status: result.status,
        headers: { ...SECURITY_HEADERS, Location: result.location },
      });
    }
    return htmlResponse(result.html, 404);
  } catch {
    return htmlResponse(
      '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Temporarily unavailable</title></head><body><main><h1>Temporarily unavailable</h1><p>Please try again in a moment.</p></main></body></html>',
      503,
    );
  }
}

// ── Slug allocation ────────────────────────────────────────────────────────

/**
 * The project's public website slug, allocated once from the project name
 * and stable afterwards (a rename does not move the URL). Unique across all
 * projects via `-2`, `-3`, … suffixes; the read of the `by_slug` index range
 * inside this transaction makes a concurrent duplicate a write conflict,
 * which Convex retries. Exported for tests; callers are internal mutations.
 */
export async function allocatePublicSlug(
  ctx: MutationCtx,
  project: Doc<"projects">,
  kind: "website" | "app" = "website",
): Promise<string> {
  const projectId = project._id;
  const existing = await ctx.db
    .query("publicSites")
    .withIndex("by_project_kind", (q) =>
      q.eq("projectId", projectId).eq("kind", kind),
    )
    .first();
  if (existing) return existing.slug;
  const base = slugifyProjectName(project.name);
  for (let n = 1; n <= MAX_SLUG_ATTEMPTS; n++) {
    const candidate = slugCandidate(base, n);
    const holders = await ctx.db
      .query("publicSites")
      .withIndex("by_slug", (q) => q.eq("slug", candidate))
      .collect();
    // A project's website and app may share its own slug (the kind suffix
    // keeps their URLs apart); any other project holding it blocks it.
    if (holders.every((h) => h.projectId === projectId && h.kind !== kind)) {
      await ctx.db.insert("publicSites", {
        projectId,
        kind,
        slug: candidate,
        createdAt: Date.now(),
      });
      return candidate;
    }
  }
  throw new Error(
    "Could not allocate a public address for this project. Rename the project and try again.",
  );
}

// ── Deployment (internal writers only) ─────────────────────────────────────

type StartResult =
  | { status: "already_live"; slug: string }
  | {
      status: "started";
      slug: string;
      deploymentId: Id<"buildDeployments">;
      auditId: Id<"buildReleaseAudits">;
    };

/** Step 1 of a deployment: validate, allocate the slug, record `running`. */
export const startDeployment = internalMutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }): Promise<StartResult> => {
    // Defence in depth: the caller's identity propagates from the action, so
    // the writer re-authenticates and re-authorizes the project itself.
    const { project } = await requireProject(ctx, projectId);
    const build = await websiteBuild(ctx, projectId);
    if (!build)
      throw new Error(
        "This project has no website yet. Generate the website first.",
      );
    const site = await projectSite(ctx, projectId);
    if (!site)
      throw new Error(
        "This project has no website yet. Generate the website first.",
      );
    if (site.status === "suspended")
      throw new Error("This website is suspended and cannot be deployed.");
    const auditId = build.lastReleaseAuditId;
    const audit = auditId ? await ctx.db.get(auditId) : null;
    if (!audit || audit.buildId !== build._id || audit.siteId !== site._id) {
      throw new Error(
        "No prepared release. Publish the website in the Build workspace first, then deploy.",
      );
    }
    if (!hasCompleteRouteSnapshot(audit) || audit.revisionIds.length === 0) {
      throw new Error(
        "This release is incomplete. Publish the website again, then deploy.",
      );
    }
    if ((audit.routes ?? []).length > MAX_RELEASE_ROUTES) {
      throw new Error(
        `A website can have at most ${MAX_RELEASE_ROUTES} pages.`,
      );
    }

    const slug = await allocatePublicSlug(ctx, project, "website");
    const now = Date.now();
    const prior = await ctx.db
      .query("buildDeployments")
      .withIndex("by_release_audit", (q) => q.eq("releaseAuditId", audit._id))
      .collect();
    // Idempotency key = release audit id: a verified release is not redeployed.
    if (
      audit.phase === "verified" &&
      prior.some((d) => d.state === "succeeded")
    ) {
      return { status: "already_live", slug };
    }
    for (const d of prior) {
      if (d.state !== "running" && d.state !== "queued") continue;
      if (now - d.updatedAt < STALE_DEPLOYMENT_MS) {
        throw new Error("A deployment of this release is already running.");
      }
      await ctx.db.patch(d._id, {
        state: "failed",
        error: "The deployment did not finish and was abandoned.",
        finishedAt: now,
        updatedAt: now,
      });
    }

    const deploymentId = await ctx.db.insert("buildDeployments", {
      projectId,
      buildId: build._id,
      siteId: site._id,
      releaseAuditId: audit._id,
      state: "running",
      provider: SELF_HOST_PROVIDER,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(audit._id, { phase: "deploying" });
    return { status: "started", slug, deploymentId, auditId: audit._id };
  },
});

type VerifyResult = { ok: true; routes: number } | { ok: false; error: string };

/**
 * Step 2: render every route of the candidate release through the public
 * render path and check each is a non-empty, script-free HTML document.
 */
export const verifyDeployment = internalQuery({
  args: { deploymentId: v.id("buildDeployments") },
  handler: async (ctx, { deploymentId }): Promise<VerifyResult> => {
    const deployment = await ctx.db.get(deploymentId);
    const audit = deployment?.releaseAuditId
      ? await ctx.db.get(deployment.releaseAuditId)
      : null;
    if (!deployment || !audit)
      return { ok: false, error: "The release no longer exists." };
    const site = await ctx.db.get(deployment.siteId);
    const publicSite = await publicSiteFor(ctx, deployment.projectId);
    if (!site || !publicSite)
      return { ok: false, error: "The website no longer exists." };
    const routes = releaseRouteMap(audit);
    if (routes.size === 0)
      return { ok: false, error: "The release has no pages." };
    if (!routes.has("/"))
      return { ok: false, error: "The release has no home page (/)." };
    const failed: string[] = [];
    for (const [path] of sortedRoutes(routes)) {
      const html = await renderReleasePath(ctx, {
        routes,
        site,
        slug: publicSite.slug,
        path,
      });
      if (!acceptableHtml(html)) failed.push(path);
    }
    if (failed.length > 0) {
      return {
        ok: false,
        error: `These pages did not render: ${failed.slice(0, 10).join(", ")}${failed.length > 10 ? "…" : ""}.`,
      };
    }
    return { ok: true, routes: routes.size };
  },
});

/**
 * Step 3: record the outcome. The ONLY writer of `succeeded` / `verified` /
 * site `live` for self-hosted websites — an internal mutation, reached only
 * from `deployWebsite` after verification. Idempotent: a deployment that is
 * no longer `running` is left untouched.
 */
export const finishDeployment = internalMutation({
  args: {
    deploymentId: v.id("buildDeployments"),
    ok: v.boolean(),
    error: v.optional(v.string()),
  },
  handler: async (ctx, { deploymentId, ok, error }) => {
    const deployment = await ctx.db.get(deploymentId);
    if (!deployment || deployment.state !== "running") {
      return { state: deployment?.state ?? null };
    }
    const now = Date.now();
    const audit = deployment.releaseAuditId
      ? await ctx.db.get(deployment.releaseAuditId)
      : null;
    const publicSite = await publicSiteFor(ctx, deployment.projectId);
    let failure = ok ? null : (error ?? "Verification failed.");
    if (!failure && (!audit || !publicSite))
      failure = "The release no longer exists.";
    if (!failure && audit) {
      // Race guard: a newer preparation during this deployment supersedes the
      // candidate's revisions; confirming it then would serve nothing.
      for (const revisionId of audit.revisionIds) {
        const revision = await ctx.db.get(revisionId);
        if (
          !revision ||
          (revision.state !== "release_prepared" &&
            revision.state !== "published")
        ) {
          failure =
            "A newer release was prepared while deploying. Deploy again.";
          break;
        }
      }
    }

    if (failure || !audit || !publicSite) {
      await ctx.db.patch(deploymentId, {
        state: "failed",
        error: failure ?? "Deployment failed.",
        finishedAt: now,
        updatedAt: now,
      });
      if (audit && audit.phase === "deploying") {
        await ctx.db.patch(audit._id, { phase: "failed" });
      }
      await ctx.db.patch(deployment.buildId, {
        releaseState: "failed",
        updatedAt: now,
      });
      return { state: "failed" as const };
    }

    await ctx.db.patch(deploymentId, {
      state: "succeeded",
      providerResourceId: `${publicSiteSegment(publicSite.slug, "website")}@${audit._id}`,
      error: undefined,
      finishedAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(audit._id, { phase: "verified", deploymentId });
    await ctx.db.patch(deployment.buildId, {
      releaseState: "verified",
      updatedAt: now,
    });
    await ctx.db.patch(deployment.siteId, { status: "live", updatedAt: now });
    return { state: "succeeded" as const };
  },
});

const startDeploymentRef = makeFunctionReference<
  "mutation",
  { projectId: Id<"projects"> },
  StartResult
>("siteHosting:startDeployment");
const verifyDeploymentRef = makeFunctionReference<
  "query",
  { deploymentId: Id<"buildDeployments"> },
  VerifyResult
>("siteHosting:verifyDeployment");
const finishDeploymentRef = makeFunctionReference<
  "mutation",
  { deploymentId: Id<"buildDeployments">; ok: boolean; error?: string },
  { state: string | null }
>("siteHosting:finishDeployment");

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Deploy the project's prepared website release to MOSAI hosting. Bounded:
 * one start mutation, one verification query over at most
 * `MAX_RELEASE_ROUTES` routes, one finish mutation. Returns the public path
 * (`/s/<slug>-website`, prefixed with `MOSAI_PUBLIC_SITE_BASE` when set) or
 * throws a readable error; on failure the previous confirmed release keeps
 * serving.
 */
export const deployWebsite = moduleAction("build", {
  capability: "build.publish",
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }, access): Promise<{ path: string }> => {
    await access.requireProject(projectId);
    const start = await ctx.runMutation(startDeploymentRef, { projectId });
    const path = publicSiteLocation(start.slug, configuredBase(), "website");
    if (start.status === "already_live") return { path };

    let verdict: VerifyResult;
    try {
      verdict = await ctx.runQuery(verifyDeploymentRef, {
        deploymentId: start.deploymentId,
      });
    } catch {
      verdict = { ok: false, error: "Verification could not run." };
    }
    const outcome = await ctx.runMutation(finishDeploymentRef, {
      deploymentId: start.deploymentId,
      ok: verdict.ok,
      error: verdict.ok ? undefined : verdict.error,
    });
    if (!verdict.ok || outcome.state !== "succeeded") {
      const reason = verdict.ok
        ? "A newer release was prepared while deploying. Deploy again."
        : verdict.error;
      throw new Error(
        `Deployment failed: ${reason} Any previously live version keeps serving.`,
      );
    }
    return { path };
  },
});

export type SiteHostingState = "not_deployed" | "deploying" | "live" | "failed";

/**
 * The website's MOSAI hosting state, derived only from server-written rows.
 * `live` only when the delivery gate finds a confirmed release (verified
 * audit + succeeded deployment) AND the site has its public address.
 */
export const status = moduleQuery("build", {
  args: { projectId: v.id("projects") },
  handler: async (
    ctx,
    { projectId },
    access,
  ): Promise<{
    slug: string | null;
    path: string | null;
    state: SiteHostingState;
    lastDeployedAt: number | null;
    error: string | null;
  }> => {
    await access.requireProject(projectId);
    const publicSite = await publicSiteFor(ctx, projectId);
    const slug = publicSite?.slug ?? null;
    const path = slug
      ? publicSiteLocation(slug, configuredBase(), "website")
      : null;

    const build = await websiteBuild(ctx, projectId);
    const deployments = build
      ? await ctx.db
          .query("buildDeployments")
          .withIndex("by_build", (q) => q.eq("buildId", build._id))
          .collect()
      : [];
    const selfHosted = deployments
      .filter((d) => d.provider === SELF_HOST_PROVIDER)
      .sort(
        (a, b) =>
          b.createdAt - a.createdAt || b._creationTime - a._creationTime,
      );
    const newest = selfHosted[0] ?? null;

    const gate = await selectConfirmedRelease(ctx, projectId);
    const confirmed =
      gate.allowed && gate.audit.deploymentId
        ? await ctx.db.get(gate.audit.deploymentId)
        : null;
    const live = gate.allowed && !!slug && confirmed?.state === "succeeded";
    const now = Date.now();
    const deploying =
      !!newest &&
      (newest.state === "running" || newest.state === "queued") &&
      now - newest.updatedAt < STALE_DEPLOYMENT_MS;
    const newestFailed =
      !!newest &&
      (newest.state === "failed" ||
        ((newest.state === "running" || newest.state === "queued") &&
          !deploying));

    const state: SiteHostingState = deploying
      ? "deploying"
      : live
        ? "live"
        : newestFailed
          ? "failed"
          : "not_deployed";
    return {
      slug,
      path,
      state,
      lastDeployedAt: live
        ? (confirmed?.finishedAt ?? confirmed?.updatedAt ?? null)
        : null,
      error: newestFailed
        ? (newest?.error ?? "The last deployment did not finish.")
        : null,
    };
  },
});
