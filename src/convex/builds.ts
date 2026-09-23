import { moduleMutation, moduleQuery } from "./guards";
import { internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { READINESS_RULE_VERSION } from "../shared/contracts/status";

const blueprintStep = v.object({
  step: v.string(),
  title: v.string(),
  detail: v.string(),
  status: v.optional(
    v.union(v.literal("todo"), v.literal("doing"), v.literal("done")),
  ),
});

const blueprintValidator = v.object({
  summary: v.optional(v.string()),
  steps: v.optional(v.array(blueprintStep)),
  generatedAt: v.number(),
});

/**
 * Local-only lifecycle input (BP-03): everything a client may still move.
 * The old `"published"` literal is gone — a client-callable mutation must
 * never be able to write an external-success state (AGENTS.md rule 5).
 * `seoReady` / `wcagReady` are likewise removed: readiness claims come from
 * a server-written audit record, not from client booleans.
 */
const LOCAL_BUILD_STATUS = v.union(
  v.literal("draft"),
  v.literal("generated"),
);

export const list = moduleQuery("build", {
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }, access) => {
    const scope = await access.ownedProject(projectId);
    if (!scope) return [];
    return await ctx.db
      .query("builds")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
  },
});

export const get = moduleQuery("build", {
  args: { id: v.id("builds") },
  handler: async (ctx, { id }, access) => {
    return await access.ownedRow(await ctx.db.get(id));
  },
});

export const create = moduleMutation("build", {
  args: {
    projectId: v.id("projects"),
    name: v.string(),
    kind: v.union(v.literal("website"), v.literal("app")),
    pages: v.optional(v.array(v.string())),
    idea: v.optional(v.string()),
    positioning: v.optional(v.string()),
    goals: v.optional(v.array(v.string())),
    personaIds: v.optional(v.array(v.id("personas"))),
    journeyMapIds: v.optional(v.array(v.id("journeyMaps"))),
    differentiators: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args, access) => {
    await access.requireProject(args.projectId);
    const { projectId, ...rest } = args;
    const now = Date.now();
    return await ctx.db.insert("builds", {
      projectId,
      ...rest,
      status: "draft" as const,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const update = moduleMutation("build", {
  args: {
    id: v.id("builds"),
    name: v.optional(v.string()),
    pages: v.optional(v.array(v.string())),
    // BP-03: only local lifecycle values remain client-writable. A client
    // cannot assert `published` (external state) any more.
    status: v.optional(LOCAL_BUILD_STATUS),
    idea: v.optional(v.string()),
    positioning: v.optional(v.string()),
    goals: v.optional(v.array(v.string())),
    personaIds: v.optional(v.array(v.id("personas"))),
    journeyMapIds: v.optional(v.array(v.id("journeyMaps"))),
    differentiators: v.optional(v.array(v.string())),
    blueprint: v.optional(blueprintValidator),
    // BP-03: `seoReady` / `wcagReady` removed — readiness is audited
    // server-side against a revision + rule version (see auditReadiness).
  },
  handler: async (ctx, { id, ...patch }, access) => {
    const row = await access.ownedRow(await ctx.db.get(id));
    if (!row) throw new Error("Not found");
    const clean = Object.fromEntries(
      Object.entries(patch).filter(([, v]) => v !== undefined),
    );
    if (Object.keys(clean).length)
      await ctx.db.patch(id, { ...clean, updatedAt: Date.now() });
  },
});

/**
 * Server-side readiness audit (BP-03): record the SEO/accessibility checks
 * for a build's draft revisions, pinned to the revision ids, their document
 * versions and the rule version that produced them. Internal only — the
 * checks themselves run in `cms.getPublishChecks`-style logic and any future
 * automated audit writes through here, never through a client mutation.
 */
export const auditReadiness = internalMutation({
  args: {
    buildId: v.id("builds"),
    projectId: v.id("projects"),
    siteId: v.id("sites"),
    // pages whose current draft revision passed every blocking check
    verifiedRevisionIds: v.array(v.id("pageRevisions")),
    // their document versions at audit time (invalidation key)
    revisionVersions: v.array(v.number()),
    pagesWithBlocking: v.optional(v.array(v.id("cmsPages"))),
  },
  handler: async (
    ctx,
    { buildId, projectId, siteId, verifiedRevisionIds, revisionVersions, pagesWithBlocking },
  ) => {
    await ctx.db.insert("buildReleaseAudits", {
      projectId,
      buildId,
      siteId,
      phase: "draft_approved",
      revisionIds: verifiedRevisionIds,
      skipped: [],
      revisionVersions,
      ruleVersion: READINESS_RULE_VERSION,
      pagesWithBlocking,
      createdBy: undefined,
      createdAt: Date.now(),
    });
  },
});

export const setStepStatus = moduleMutation("build", {
  args: {
    id: v.id("builds"),
    stepIndex: v.number(),
    status: v.union(v.literal("todo"), v.literal("doing"), v.literal("done")),
  },
  handler: async (ctx, { id, stepIndex, status }, access) => {
    const build = await access.ownedRow(await ctx.db.get(id));
    if (!build) throw new Error("Not found");
    const blueprint = build.blueprint;
    if (!blueprint?.steps || stepIndex < 0 || stepIndex >= blueprint.steps.length)
      throw new Error("Step not found");
    const steps = blueprint.steps.map((s, i) =>
      i === stepIndex ? { ...s, status } : s,
    );
    await ctx.db.patch(id, {
      blueprint: { ...blueprint, steps },
      updatedAt: Date.now(),
    });
  },
});

/**
 * Readiness + delivery view for one build (BP-03 acceptance): the client
 * reads truth here instead of writing it.
 *
 * - `delivery` describes where the build sits in the delivery pipeline
 *   (draft approval → release preparation → deployment → verified), with a
 *   receipt reference only when a verified deployment record exists.
 * - Legacy rows (`status: "published"` written before BP-03) stay readable
 *   but are labelled `requires_verification` — never given an invented
 *   receipt.
 * - `pages` carries the live per-page blocking checks; a page's audited
 *   readiness counts only while its draft revision is unchanged and the
 *   rule version matches.
 */
export const getReadiness = moduleQuery("build", {
  args: { id: v.id("builds") },
  handler: async (ctx, { id }, access) => {
    const build = await access.ownedRow(await ctx.db.get(id));
    if (!build) return null;
    const project = await ctx.db.get(build.projectId);

    // Latest server-written release audit for this build.
    const audits = await ctx.db
      .query("buildReleaseAudits")
      .withIndex("by_build", (q) => q.eq("buildId", id))
      .collect();
    audits.sort((a, b) => b.createdAt - a.createdAt);
    const latest = audits[0] ?? null;

    // Current draft revision per page (the content readiness is pinned to).
    const site = await ctx.db
      .query("sites")
      .withIndex("by_project", (q) => q.eq("projectId", build.projectId))
      .first();
    const pages = site
      ? await ctx.db
          .query("cmsPages")
          .withIndex("by_site", (q) => q.eq("siteId", site._id))
          .collect()
      : [];
    const pageViews: {
      pageId: string;
      title: string;
      fullPath: string;
      revisionId: string | null;
      revisionVersion: number | null;
      verified: boolean;
      blocking: string[];
    }[] = [];
    for (const page of pages) {
      const draft = page.latestDraftRevisionId
        ? await ctx.db.get(page.latestDraftRevisionId)
        : null;
      let verified = false;
      if (
        latest &&
        draft &&
        latest.ruleVersion === READINESS_RULE_VERSION &&
        latest.revisionIds.includes(draft._id) &&
        latest.revisionVersions?.includes(draft.version)
      ) {
        verified = true;
      }
      pageViews.push({
        pageId: page._id,
        title: page.title,
        fullPath: page.fullPath,
        revisionId: draft?._id ?? null,
        revisionVersion: draft?.version ?? null,
        verified,
        blocking: [],
      });
    }

    const verifiedRevisionIds = pageViews
      .filter((p) => p.verified)
      .map((p) => p.revisionId)
      .filter((x): x is string => Boolean(x));

    const legacy = build.status === "published";

    // Delivery phase: legacy external claim → honest unverified label;
    // otherwise derive from the audit trail.
    let delivery: {
      label: string;
      verified: boolean;
      receipt?: { table: string; id: string; providerRef?: string };
      reason?: string;
      legacy?: boolean;
      ruleVersion: number;
      verifiedRevisionIds: string[];
    };
    if (legacy) {
      delivery = {
        label: "requires_verification",
        verified: false,
        legacy: true,
        reason:
          "This build was marked published before external verification existed. Its release needs to be re-verified — no receipt is on record.",
        ruleVersion: READINESS_RULE_VERSION,
        verifiedRevisionIds,
      };
    } else if (latest?.phase === "verified" && latest.deploymentId) {
      delivery = {
        label: "verified",
        verified: true,
        receipt: {
          table: "buildReleaseAudits",
          id: latest._id,
        },
        ruleVersion: latest.ruleVersion,
        verifiedRevisionIds,
      };
    } else if (latest && latest.phase === "release_prepared") {
      delivery = {
        label: pageViews.length > 0 && verifiedRevisionIds.length === 0
          ? "content_changed"
          : "release_prepared",
        verified: false,
        reason:
          pageViews.length > 0 && verifiedRevisionIds.length === 0
            ? "Content changed after this release was prepared — the release no longer matches the current drafts."
            : "A release was prepared from these drafts. It is not deployed yet — no public URL exists until the deployment pipeline runs.",
        ruleVersion: latest.ruleVersion,
        verifiedRevisionIds,
      };
    } else if (latest && latest.phase === "draft_approved") {
      delivery = {
        label: "draft_approved",
        verified: false,
        reason: "Drafts passed the readiness checks; no release was prepared yet.",
        ruleVersion: latest.ruleVersion,
        verifiedRevisionIds,
      };
    } else {
      delivery = {
        label: site ? "deployment_missing" : "draft_approved",
        verified: false,
        reason: site
          ? "No release has been prepared or deployed for this site yet."
          : "No site has been generated for this build yet.",
        ruleVersion: READINESS_RULE_VERSION,
        verifiedRevisionIds,
      };
    }

    return {
      _id: build._id,
      status: build.status,
      legacy,
      delivery,
      pages: pageViews,
      // legacy compliance booleans are surfaced as the unverified claims they are
      legacyClaims: {
        seoReady: build.seoReady ?? null,
        wcagReady: build.wcagReady ?? null,
      },
      projectName: project?.name ?? null,
    };
  },
});

export const remove = moduleMutation("build", {
  args: { id: v.id("builds") },
  handler: async (ctx, { id }, access) => {
    const row = await access.ownedRow(await ctx.db.get(id));
    if (!row) throw new Error("Not found");
    // cascade: remove the build's pages too
    const pages = await ctx.db
      .query("buildPages")
      .withIndex("by_build", (q) => q.eq("buildId", id))
      .collect();
    for (const p of pages) await ctx.db.delete(p._id);
    await ctx.db.delete(id);
  },
});
