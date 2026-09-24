import { moduleMutation, moduleQuery } from "./guards";
import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { cascadeDeleteBuildStep } from "./dal";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { contextVersion } from "./lib/contextPack";
import { READINESS_RULE_VERSION, contentFingerprint } from "../shared/contracts/status";

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

type AppRequirementsReviewStatus = "draft" | "fresh" | "stale";

async function appRequirementsReviewStatus(
  ctx: QueryCtx,
  build: Doc<"builds">,
): Promise<AppRequirementsReviewStatus> {
  const requirements = build.appRequirements;
  if (build.kind !== "app" || !requirements || requirements.state !== "reviewed") return "draft";
  for (const ref of requirements.sourceRefs) {
    if (ref.kind === "persona") {
      const source = await ctx.db.get(ref.id);
      if (!source || source.projectId !== build.projectId || contextVersion(JSON.stringify(source)) !== ref.sourceVersion)
        return "stale";
    } else if (ref.kind === "journeyMap") {
      const source = await ctx.db.get(ref.id);
      if (!source || source.projectId !== build.projectId || contextVersion(JSON.stringify(source)) !== ref.sourceVersion)
        return "stale";
    } else {
      const source = await ctx.db.get(ref.id);
      if (!source || source.projectId !== build.projectId || contextVersion(JSON.stringify(source)) !== ref.sourceVersion)
        return "stale";
    }
  }
  return "fresh";
}

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
    if (args.kind === "app" && (
      args.pages !== undefined || args.positioning !== undefined ||
      args.goals !== undefined || args.personaIds !== undefined ||
      args.journeyMapIds !== undefined || args.differentiators !== undefined
    )) throw new Error("App builds cannot contain website plan fields");
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
    if (row.kind === "app" && (
      patch.pages !== undefined || patch.positioning !== undefined ||
      patch.goals !== undefined || patch.personaIds !== undefined ||
      patch.journeyMapIds !== undefined || patch.differentiators !== undefined ||
      patch.blueprint !== undefined || patch.status === "generated"
    )) throw new Error("App builds cannot receive website plans or generated status");
    const clean = Object.fromEntries(
      Object.entries(patch).filter(([, v]) => v !== undefined),
    );
    if (Object.keys(clean).length)
      await ctx.db.patch(id, { ...clean, updatedAt: Date.now() });
  },
});

const appRequirementsInput = v.object({
  audience: v.union(v.literal("customer_facing"), v.literal("internal_team"), v.literal("both")),
  goal: v.string(),
  targetUsers: v.string(),
  coreWorkflows: v.array(v.string()),
  constraints: v.array(v.string()),
  sourceRefs: v.array(
    v.union(
      v.object({ kind: v.literal("persona"), id: v.id("personas") }),
      v.object({ kind: v.literal("journeyMap"), id: v.id("journeyMaps") }),
      v.object({ kind: v.literal("contentPiece"), id: v.id("contentPieces") }),
    ),
  ),
});

/** Resolve source labels on the server and keep every reference inside the build project. */
export const saveAppRequirements = moduleMutation("build", {
  args: { buildId: v.id("builds"), requirements: appRequirementsInput },
  handler: async (ctx, { buildId, requirements }, access) => {
    const build = await access.ownedRow(await ctx.db.get(buildId));
    if (!build || build.kind !== "app") throw new Error("App build not found");
    const boundedText = (value: string, name: string, limit: number) => {
      if (value.length > limit) throw new Error(`${name} is too long`);
    };
    boundedText(requirements.goal, "Goal", 2000);
    boundedText(requirements.targetUsers, "Target users", 1000);
    if (requirements.coreWorkflows.length > 20 || requirements.constraints.length > 20)
      throw new Error("Requirements allow at most 20 workflows and 20 constraints");
    for (const item of requirements.coreWorkflows) boundedText(item, "Workflow", 500);
    for (const item of requirements.constraints) boundedText(item, "Constraint", 500);
    if (requirements.sourceRefs.length > 50) throw new Error("Choose at most 50 context records");
    const uniqueRefs = new Set(requirements.sourceRefs.map((ref) => `${ref.kind}:${ref.id}`));
    if (uniqueRefs.size !== requirements.sourceRefs.length) throw new Error("Duplicate context records are not allowed");
    const sourceRefs: Array<
      | { kind: "persona"; id: Id<"personas">; label: string; sourceVersion: string }
      | { kind: "journeyMap"; id: Id<"journeyMaps">; label: string; sourceVersion: string }
      | { kind: "contentPiece"; id: Id<"contentPieces">; label: string; sourceVersion: string }
    > = [];
    for (const ref of requirements.sourceRefs) {
      if (ref.kind === "persona") {
        const record = await ctx.db.get(ref.id);
        if (!record || record.projectId !== build.projectId) throw new Error("Source must belong to this app project's context");
        sourceRefs.push({ ...ref, label: record.name, sourceVersion: contextVersion(JSON.stringify(record)) });
      } else if (ref.kind === "journeyMap") {
        const record = await ctx.db.get(ref.id);
        if (!record || record.projectId !== build.projectId) throw new Error("Source must belong to this app project's context");
        sourceRefs.push({ ...ref, label: record.name, sourceVersion: contextVersion(JSON.stringify(record)) });
      } else {
        const record = await ctx.db.get(ref.id);
        if (!record || record.projectId !== build.projectId) throw new Error("Source must belong to this app project's context");
        sourceRefs.push({ ...ref, label: record.title, sourceVersion: contextVersion(JSON.stringify(record)) });
      }
    }
    const now = Date.now();
    await ctx.db.patch(buildId, {
      appRequirements: {
        version: 1,
        state: "draft",
        ...requirements,
        sourceRefs,
        editedAt: now,
      },
      updatedAt: now,
    });
  },
});

/** Explicit review is recorded against the authenticated actor and current requirements. */
export const reviewAppRequirements = moduleMutation("build", {
  args: { buildId: v.id("builds") },
  handler: async (ctx, { buildId }, access) => {
    const build = await access.ownedRow(await ctx.db.get(buildId));
    if (!build || build.kind !== "app") throw new Error("App build not found");
    if (!build.appRequirements) throw new Error("Save requirements before review");
    const requirements = build.appRequirements;
    if (!requirements.goal.trim() || !requirements.targetUsers.trim() ||
      requirements.coreWorkflows.length === 0 ||
      requirements.coreWorkflows.some((workflow) => !workflow.trim()))
      throw new Error("Add a goal, target users, and at least one core workflow before review");
    for (const ref of requirements.sourceRefs) {
      if (ref.kind === "persona") {
        const source = await ctx.db.get(ref.id);
        if (!source || source.projectId !== build.projectId || contextVersion(JSON.stringify(source)) !== ref.sourceVersion)
          throw new Error("A selected source changed; save requirements again before review");
      } else if (ref.kind === "journeyMap") {
        const source = await ctx.db.get(ref.id);
        if (!source || source.projectId !== build.projectId || contextVersion(JSON.stringify(source)) !== ref.sourceVersion)
          throw new Error("A selected source changed; save requirements again before review");
      } else {
        const source = await ctx.db.get(ref.id);
        if (!source || source.projectId !== build.projectId || contextVersion(JSON.stringify(source)) !== ref.sourceVersion)
          throw new Error("A selected source changed; save requirements again before review");
      }
    }
    const { userId } = await access.requireProject(build.projectId);
    const now = Date.now();
    await ctx.db.patch(buildId, {
      appRequirements: { ...build.appRequirements, state: "reviewed", reviewedAt: now, reviewedBy: userId },
      updatedAt: now,
    });
  },
});

/** Reactive truth for the UI: a saved review remains current only while every source snapshot matches. */
export const getAppRequirementsStatus = moduleQuery("build", {
  args: { buildId: v.id("builds") },
  handler: async (ctx, { buildId }, access) => {
    const build = await access.ownedRow(await ctx.db.get(buildId));
    if (!build || build.kind !== "app" || !build.appRequirements) return null;
    const requirements = build.appRequirements;
    const status = await appRequirementsReviewStatus(ctx, build);
    if (status !== "fresh") return { status };
    return {
      status: "fresh" as const,
      reviewedAt: requirements.reviewedAt,
      reviewedBy: requirements.reviewedBy,
    };
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
      // BP-03: the audit pins the *content* of the promoted revisions. A
      // page counts as verified while its current draft content equals an
      // audited revision's content; an in-place edit of the draft changes
      // the fingerprint and invalidates the claim (key-order-insensitive
      // comparison via contentFingerprint, shared with the audit writer).
      if (latest && draft && latest.ruleVersion === READINESS_RULE_VERSION) {
        for (const rid of latest.revisionIds) {
          const audited = await ctx.db.get(rid);
          if (
            audited &&
            contentFingerprint(audited.document) ===
              contentFingerprint(draft.document)
          ) {
            verified = true;
            break;
          }
        }
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

/** Rows removed per transaction; larger builds continue in scheduled steps. */
const BUILD_CASCADE_BATCH = 100;

/**
 * Deletes a build and every row that hangs off it (chat messages, versions,
 * page plans, release audits and any other table `buildChildTables()` derives
 * from the data registry). Shared project data (the site, CMS pages, their
 * revisions) is NOT removed: it belongs to the project, not to one build.
 *
 * A build with a deployment on record is refused: deleting it would remove a
 * deployment receipt, which changes what is served. That needs an explicit
 * unpublish flow first (owner decision, AGENTS.md §7).
 */
export const remove = moduleMutation("build", {
  args: { id: v.id("builds") },
  handler: async (ctx, { id }, access): Promise<{ done: boolean }> => {
    const row = await access.ownedRow(await ctx.db.get(id));
    if (!row) throw new Error("Not found");

    const deployments = await ctx.db
      .query("buildDeployments")
      .withIndex("by_build", (q) => q.eq("buildId", id))
      .take(50);
    if (deployments.some((d) => d.state !== "failed" && d.state !== "canceled")) {
      throw new Error(
        "This build has a deployment on record. Take it offline before deleting the build.",
      );
    }

    const step = await cascadeDeleteBuildStep(ctx, id, BUILD_CASCADE_BATCH);
    await ctx.db.delete(id);
    if (!step.done) {
      await ctx.scheduler.runAfter(0, internal.builds.removeChildrenStep, { buildId: id });
    }
    return { done: step.done };
  },
});

/** Continues a build deletion that had more child rows than one batch. Runs
 *  only for a build row that is already gone, so it can never be used to
 *  strip the children of a live build. */
export const removeChildrenStep = internalMutation({
  args: { buildId: v.id("builds") },
  handler: async (ctx, { buildId }): Promise<{ done: boolean }> => {
    if (await ctx.db.get(buildId)) return { done: true };
    const step = await cascadeDeleteBuildStep(ctx, buildId, BUILD_CASCADE_BATCH);
    if (!step.done) {
      await ctx.scheduler.runAfter(0, internal.builds.removeChildrenStep, { buildId });
    }
    return { done: step.done };
  },
});
