"use node";

import { v } from "convex/values";
import { type ActionCtx } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { consumeAiQuotaForAction, moduleAction, requireActionUser } from "./guards";
import { modelComplete } from "./lib/modelGateway";
import { validateDocument, type PageDocument } from "../lib/cms/blocks";

/* ── Build workspace brain (Lovable/Caffeine-style chat builder) ──────────
 *
 * Two editor modes over one site:
 *   plan  — shapes strategy; proposes a page plan before anything renders
 *   build — edits the real site; every request snapshots a version first,
 *           then rewrites the target page's draft PageDocument
 *
 * Invariants preserved from W1: published revisions are immutable, AI never
 * publishes (§174.12), documents stay structured blocks (never raw HTML),
 * commerce facts are never copied into page content.
 * Queries/mutations live in buildInternals.ts (Convex: only actions in Node).
 */

async function complete(
  ctx: ActionCtx,
  userId: Id<"users">,
  projectId: Id<"projects">,
  agentId: string,
  system: string,
  user: string,
  opts: { temperature?: number; maxTokens?: number; validateOutput?: (text: string) => void } = {},
): Promise<string> {
  const result = await modelComplete({
    ctx,
    userId,
    projectId,
    agentId,
    promptVersion: "v1",
    autonomy: "draft",
    contextSources: ["build.context", "request.context"],
    provider: "openrouter",
    model: "gpt-4o-mini",
    messages: [
      { role: "system" as const, content: system },
      { role: "user" as const, content: user },
    ],
    temperature: opts.temperature ?? 0.7,
    maxOutputTokens: opts.maxTokens ?? 1600,
    validateOutput: opts.validateOutput,
  });
  return result.text;
}

function parseJson<T>(text: string): T {
  const cleaned = text.replace(/```json|```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1)
    throw new Error("AI returned an unreadable response");
  return JSON.parse(cleaned.slice(start, end + 1)) as T;
}

function validateGeneratedSitePlan(text: string): void {
  const value = parseJson<{
    pages?: { name?: unknown; sections?: { type?: unknown; props?: unknown }[] }[];
  }>(text);
  const usable = (value.pages ?? []).some((page) => {
    if (typeof page?.name !== "string" || !Array.isArray(page.sections)) return false;
    const blocks = page.sections
      .filter((section) => typeof section?.type === "string")
      .map((section, index) => ({
        id: `validation-${index}`,
        type: section.type as string,
        version: 1,
        props: (section.props ?? {}) as Record<string, unknown>,
      }));
    return blocks.length > 0 && validateDocument({ schemaVersion: 1, blocks }).length === 0;
  });
  if (!usable) throw new Error("invalid site plan");
}

async function requireOwnedBuild(
  ctx: ActionCtx,
  buildId: Id<"builds">,
): Promise<Doc<"builds">> {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Not signed in");
  const anonymous = await ctx.runQuery(internal.guards.isAnonymousUser, {
    userId,
  });
  if (anonymous) throw new Error("Not signed in");
  const build = (await ctx.runQuery(internal.buildInternals.getBuild, {
    id: buildId,
  })) as Doc<"builds"> | null;
  if (!build) throw new Error("Build not found");
  // T2.2: authorize against the owning organization, not the project owner —
  // a member of the owning org may edit the site, a foreign org may not.
  const project = (await ctx.runQuery(internal.guards.projectAccessForAction, {
    projectId: build.projectId,
    userId,
  })) as Doc<"projects"> | null;
  if (!project) throw new Error("Not found");
  // T2.3: the capability itself is enforced by `moduleAction("build", …)` when
  // it resolves the build record, before this handler runs. This helper stays
  // for the ownership read the handler needs (projectId, the build row).
  return build;
}

/* ── Plan mode: propose a page plan from idea + project context ─────────── */

export const planSite = moduleAction("build", {
  recordArg: "buildId",
  args: { buildId: v.id("builds"), message: v.string() },
  handler: async (ctx, { buildId, message }) => {
    const build = await requireOwnedBuild(ctx, buildId);
    const userId = await requireActionUser(ctx);
    await consumeAiQuotaForAction(ctx, userId);
    const project = (await ctx.runQuery(internal.buildInternals.getProject, {
      id: build.projectId,
    })) as Doc<"projects"> | null;
    if (!project) throw new Error("Not found");

    await ctx.runMutation(internal.buildInternals.insertMessage, {
      buildId,
      projectId: build.projectId,
      role: "user",
      content: message,
      mode: "plan",
    });

    const history = (await ctx.runQuery(
      internal.buildInternals.listMessagesInternal,
      { buildId },
    )) as { role: string; content: string }[];
    const transcript = history
      .slice(-8)
      .map((m) => `${m.role === "user" ? "User" : "MOSAI"}: ${m.content}`)
      .join("\n");

    const text = await complete(ctx, userId, build.projectId, "build.site_plan_chat",
      `You are MOSAI's build copilot in PLAN mode. You shape website strategy with the user before anything is generated. Be concrete and business-grounded; never generic.
Return ONLY valid JSON:
{
  "reply": string,
  "pages": [ { "name": string, "goal": string } ]
}
pages is empty while still clarifying; 3-7 pages once the plan is concrete.`,
      `Business: ${project.name} — ${project.description ?? "no description yet"}
Industry: ${project.industry ?? "unknown"}
Build idea: ${build.idea ?? "(none yet)"}
Conversation so far:
${transcript}

User's latest message: ${message}`,
      { temperature: 0.6, maxTokens: 1200, validateOutput: (output) => {
        const value = parseJson<{ reply?: unknown; pages?: unknown }>(output);
        if (typeof value.reply !== "string" || !Array.isArray(value.pages)) throw new Error("invalid plan chat");
      } },
    );

    const parsed = parseJson<{
      reply?: string;
      pages?: { name?: string; goal?: string }[];
    }>(text);
    const suggestions = (parsed.pages ?? [])
      .filter(
        (p): p is { name: string; goal?: string } =>
          typeof p?.name === "string" && p.name.trim() !== "",
      )
      .slice(0, 7)
      .map((p) => ({
        name: p.name.trim(),
        goal: typeof p.goal === "string" ? p.goal.trim() : undefined,
      }));

    const reply = parsed.reply?.trim() || "Here's my suggested plan.";
    await ctx.runMutation(internal.buildInternals.insertMessage, {
      buildId,
      projectId: build.projectId,
      role: "assistant",
      content: reply,
      mode: "plan",
      suggestions: suggestions.length ? suggestions : undefined,
    });
    return { reply, suggestions };
  },
});

/* ── Build mode: generate the full first site into real CMS pages ───────── */

const SITE_GEN_PROPS = `Allowed props per block type:
- hero: eyebrow, heading, body, ctaLabel, ctaHref, align
- richText: html (simple <h2>,<p>,<ul>,<li>,<strong>,<em> only)
- image: alt, caption
- quote: text, attribution
- cta: heading, body, buttonLabel, buttonHref
- featureGrid: heading, items[{title, body}]
- faq: heading, items[{question, answer}]
- stats: items[{value, label}]
- divider: {} · spacer: {height:number}
- productGrid: collectionId (omit), columns`;

export const generateSite = moduleAction("build", {
  recordArg: "buildId",
  args: { buildId: v.id("builds"), message: v.string() },
  handler: async (ctx, { buildId, message }) => {
    const build = await requireOwnedBuild(ctx, buildId);
    const userId = await requireActionUser(ctx);
    await consumeAiQuotaForAction(ctx, userId);
    const project = (await ctx.runQuery(internal.buildInternals.getProject, {
      id: build.projectId,
    })) as Doc<"projects"> | null;
    if (!project) throw new Error("Not found");

    await ctx.runMutation(internal.buildInternals.insertMessage, {
      buildId,
      projectId: build.projectId,
      role: "user",
      content: message,
      mode: "build",
    });

    // 1. plan pages + sections
    const planText = await complete(ctx, userId, build.projectId, "build.site_generation",
      `You are MOSAI's site generator. Given the business idea, return ONLY valid JSON:
{
  "pages": [
    {
      "name": string,
      "path": string,
      "goal": string,
      "sections": [
        { "type": "hero"|"richText"|"image"|"quote"|"cta"|"featureGrid"|"faq"|"stats"|"divider"|"spacer"|"productGrid", "props": object }
      ]
    }
  ]
}
3-6 pages, homepage first with path "/". 3-6 semantic sections per page, top to bottom.
${SITE_GEN_PROPS}
Rules: specific benefit-led headings, no lorem ipsum, no invented statistics, concrete CTA labels.`,
      `Business: ${project.name} — ${project.description ?? ""}
Industry: ${project.industry ?? "unknown"}
Products/services: ${(project.productsServices ?? []).join(", ") || "unknown"}
Idea: ${build.idea ?? message}
Latest instruction: ${message}`,
      { temperature: 0.7, maxTokens: 3000, validateOutput: validateGeneratedSitePlan },
    );
    const plan = parseJson<{
      pages?: {
        name?: string;
        path?: string;
        goal?: string;
        sections?: { type?: string; props?: Record<string, unknown> }[];
      }[];
    }>(planText);

    const plannedPages = (plan.pages ?? [])
      .filter(
        (p): p is NonNullable<typeof p> & { name: string } =>
          typeof p?.name === "string" && p.name.trim() !== "",
      )
      .slice(0, 6);
    if (!plannedPages.length)
      throw new Error("AI returned no pages — try rephrasing.");

    const normPath = (name: string, path?: string) => {
      const raw =
        typeof path === "string" && path.trim() !== "" ? path.trim() : name;
      const clean = raw
        .toLowerCase()
        .replace(/[^a-z0-9/]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|\/-/g, "");
      const withSlash = clean.startsWith("/") ? clean : `/${clean}`;
      return withSlash === "/-" || withSlash === "/" ? "/" : withSlash;
    };

    // 2. materialize the site + pages
    await ctx.runMutation(internal.buildInternals.ensureSiteWithPages, {
      projectId: build.projectId,
      projectName: project.name || build.name,
      pages: plannedPages.map((p) => ({
        name: p.name.trim(),
        path: normPath(p.name.trim(), p.path),
        goal: typeof p.goal === "string" ? p.goal.trim() : undefined,
      })),
    });

    // 3. write section documents into each page's draft
    const written: string[] = [];
    for (const p of plannedPages) {
      const path = normPath(p.name.trim(), p.path);
      const pageId = (await ctx.runQuery(internal.buildInternals.getPageByPath, {
        projectId: build.projectId,
        path,
      })) as Id<"cmsPages"> | null;
      if (!pageId) continue;

      const doc: PageDocument = {
        schemaVersion: 1,
        blocks: (p.sections ?? [])
          .filter(
            (s): s is { type: string; props?: Record<string, unknown> } =>
              typeof s?.type === "string",
          )
          .map((s) => ({
            id: `blk_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`,
            type: s.type,
            version: 1,
            props: (s.props ?? {}) as Record<string, unknown>,
          })),
      };
      const errors = validateDocument(doc);
      if (errors.length) continue;

      await ctx.runMutation(internal.buildInternals.saveDraftInternal, {
        pageId,
        document: doc,
      });
      written.push(p.name.trim());
    }
    if (!written.length)
      throw new Error("AI produced no valid pages — try rephrasing.");

    // 4. snapshot as the first version
    const snapshotPages = (await ctx.runQuery(
      internal.buildInternals.collectSnapshot,
      { projectId: build.projectId },
    )) as {
      pageId: Id<"cmsPages">;
      title: string;
      slug: string;
      fullPath: string;
      draft: string;
    }[];
    const version = (await ctx.runMutation(
      internal.buildInternals.applyEditWithSnapshot,
      {
        projectId: build.projectId,
        snapshotPages,
        versionLabel: message.slice(0, 80) || "Initial build",
      },
    )) as number;

    const reply = `Built ${written.length} page${written.length === 1 ? "" : "s"}: ${written.join(", ")}. The preview on the right is live — tell me what to change.`;
    await ctx.runMutation(internal.buildInternals.insertMessage, {
      buildId,
      projectId: build.projectId,
      role: "assistant",
      content: reply,
      mode: "build",
      changedPaths: plannedPages.map((p) => normPath(p.name.trim(), p.path)),
    });
    await ctx.runMutation(internal.buildInternals.patchBuild, {
      id: buildId,
      status: "generated",
    });

    return { written, version, reply };
  },
});

/* ── Build mode: iterative chat edit of one page ────────────────────────── */

export const editPage = moduleAction("build", {
  recordArg: "buildId",
  args: {
    buildId: v.id("builds"),
    message: v.string(),
    pageId: v.optional(v.id("cmsPages")),
  },
  handler: async (ctx, { buildId, message, pageId }) => {
    const build = await requireOwnedBuild(ctx, buildId);
    const userId = await requireActionUser(ctx);
    await consumeAiQuotaForAction(ctx, userId);

    await ctx.runMutation(internal.buildInternals.insertMessage, {
      buildId,
      projectId: build.projectId,
      role: "user",
      content: message,
      mode: "build",
    });

    // resolve target page: explicit, else homepage/first page
    let target: Doc<"cmsPages"> | null = null;
    if (pageId) {
      target = (await ctx.runQuery(internal.buildInternals.getPageById, {
        id: pageId,
      })) as Doc<"cmsPages"> | null;
    }
    if (!target) {
      const site = (await ctx.runQuery(
        internal.buildInternals.getSiteByProject,
        { projectId: build.projectId },
      )) as Doc<"sites"> | null;
      if (!site) throw new Error("No site yet — generate one first.");
      const pages = (await ctx.runQuery(internal.buildInternals.getPagesBySite, {
        siteId: site._id,
      })) as Doc<"cmsPages">[];
      target =
        pages.find((p) => p.fullPath === "/" && p.pageType === "homepage") ??
        pages.find((p) => p.fullPath === "/") ??
        pages[0] ??
        null;
    }
    if (!target)
      throw new Error("No page to edit — generate the site first.");

    const current = target.latestDraftRevisionId
      ? ((await ctx.runQuery(internal.buildInternals.getRevision, {
          id: target.latestDraftRevisionId,
        })) as Doc<"pageRevisions"> | null)
      : null;
    const currentDoc: PageDocument =
      current?.document ?? { schemaVersion: 1, blocks: [] };

    const blockSummary = currentDoc.blocks
      .map(
        (b, i) => `${i + 1}. ${b.type}: ${JSON.stringify(b.props).slice(0, 200)}`,
      )
      .join("\n");

    const text = await complete(ctx, userId, build.projectId, "build.page_edit",
      `You are MOSAI's build copilot in BUILD mode. The user wants changes to one page of their site. You edit a structured block document — never raw HTML.
Current page: ${target.title} (${target.fullPath})
Current blocks (type + props):
${blockSummary || "(empty page)"}

${SITE_GEN_PROPS}

Return ONLY valid JSON:
{
  "summary": string,
  "blocks": [ { "type": string, "props": object } ]
}
"blocks" is the FULL new block list for this page. Keep untouched blocks exactly as they were (same type and props). Apply the requested change to the relevant block(s).`,
      `User request: ${message}`,
      { temperature: 0.6, maxTokens: 2400, validateOutput: (output) => {
        const value = parseJson<{ summary?: unknown; blocks?: { type?: unknown; props?: unknown }[] }>(output);
        if (typeof value.summary !== "string" || !Array.isArray(value.blocks) || !value.blocks.length || value.blocks.some((block) => typeof block?.type !== "string" || typeof block.props !== "object" || block.props === null)) throw new Error("invalid page edit");
      } },
    );

    const parsed = parseJson<{
      summary?: string;
      blocks?: { type?: string; props?: Record<string, unknown> }[];
    }>(text);
    const newBlocks = (parsed.blocks ?? [])
      .filter(
        (b): b is { type: string; props?: Record<string, unknown> } =>
          typeof b?.type === "string",
      )
      .map((b) => ({
        id: `blk_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`,
        type: b.type,
        version: 1,
        props: (b.props ?? {}) as Record<string, unknown>,
      }));
    if (!newBlocks.length)
      throw new Error("AI returned no blocks — try rephrasing.");

    // write the edit first, then snapshot — a version always captures the
    // state it is labeled with (same order as generateSite)
    await ctx.runMutation(internal.buildInternals.saveDraftInternal, {
      pageId: target._id,
      document: { schemaVersion: 1, blocks: newBlocks } as PageDocument,
    });
    const snapshotPages = (await ctx.runQuery(
      internal.buildInternals.collectSnapshot,
      { projectId: build.projectId },
    )) as {
      pageId: Id<"cmsPages">;
      title: string;
      slug: string;
      fullPath: string;
      draft: string;
    }[];
    const version = (await ctx.runMutation(
      internal.buildInternals.applyEditWithSnapshot,
      {
        projectId: build.projectId,
        snapshotPages,
        versionLabel: message.slice(0, 80) || "Chat edit",
      },
    )) as number;

    const summary =
      parsed.summary?.trim() ||
      `Updated ${target.title}. Check the preview on the right.`;
    await ctx.runMutation(internal.buildInternals.insertMessage, {
      buildId,
      projectId: build.projectId,
      role: "assistant",
      content: summary,
      mode: "build",
      changedPaths: [target.fullPath],
    });
    return { version, pageId: target._id, summary };
  },
});
