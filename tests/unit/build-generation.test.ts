import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  EDIT_DOCUMENT_BUDGET_CHARS,
  aiWritableBlockDefs,
  blockPropSpec,
} from "@/convex/buildChat";
import { BLOCK_REGISTRY } from "@/lib/cms/blocks";
import { newBackend, seedUser, type TestBackend, type Tenant } from "./helpers";

/**
 * Build chat generation and edit regressions (build backend review C1–C5,
 * S1, S4; UX review P0-1/P0-3). The model is a scripted stub behind the
 * OpenRouter fetch boundary: each test lists the replies, in order, that the
 * "model" gives, and inspects the requests the server sent. No network.
 */

type ModelRequest = { messages: { role: string; content: string }[] };

afterEach(() => {
  vi.unstubAllGlobals();
});

function scriptModel(replies: string[]): ModelRequest[] {
  const calls: ModelRequest[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (new URL(url).hostname !== "openrouter.ai") {
      throw new Error(`live network blocked in tests: ${url}`);
    }
    const body = JSON.parse(String(init?.body ?? "{}")) as ModelRequest;
    calls.push(body);
    const content = replies[Math.min(calls.length - 1, replies.length - 1)] ?? "{}";
    return new Response(
      JSON.stringify({
        choices: [{ message: { content } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  });
  return calls;
}

async function setup(kind: "website" | "app" = "website") {
  const t = newBackend();
  const tenant = await seedUser(t, { plan: "starter" });
  const projectId = (await tenant.as.mutation(api.projects.create, { name: "Roastery" })) as Id<"projects">;
  const buildId = (await tenant.as.mutation(api.builds.create, {
    projectId,
    name: "Website",
    kind,
  })) as Id<"builds">;
  return { t, tenant, projectId, buildId };
}

type SeedBlock = { id: string; type: string; version: number; props: Record<string, unknown> };

async function seedSite(
  t: TestBackend,
  tenant: Tenant,
  projectId: Id<"projects">,
  pages: { path: string; title: string; blocks: SeedBlock[] }[],
): Promise<Record<string, { pageId: Id<"cmsPages">; revisionId: Id<"pageRevisions"> }>> {
  const now = Date.now();
  const userId = tenant.userId as Id<"users">;
  const siteId = await t.run((ctx) =>
    ctx.db.insert("sites", {
      projectId,
      name: "Roastery",
      slug: "roastery",
      status: "draft",
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    }),
  );
  const out: Record<string, { pageId: Id<"cmsPages">; revisionId: Id<"pageRevisions"> }> = {};
  for (const page of pages) {
    const pageId = await t.run((ctx) =>
      ctx.db.insert("cmsPages", {
        siteId,
        projectId,
        title: page.title,
        slug: page.path === "/" ? "home" : page.path.slice(1),
        fullPath: page.path,
        pageType: page.path === "/" ? "homepage" : "standard",
        status: "draft",
        createdBy: userId,
        createdAt: now,
        updatedAt: now,
      }),
    );
    const revisionId = await t.run((ctx) =>
      ctx.db.insert("pageRevisions", {
        pageId,
        projectId,
        version: 1,
        state: "draft",
        document: { schemaVersion: 1, blocks: page.blocks },
        createdBy: userId,
        createdAt: now,
      }),
    );
    await t.run((ctx) => ctx.db.patch(pageId, { latestDraftRevisionId: revisionId }));
    out[page.path] = { pageId, revisionId };
  }
  return out;
}

async function draftBlocks(t: TestBackend, pageId: Id<"cmsPages">) {
  return t.run(async (ctx) => {
    const page = await ctx.db.get(pageId);
    const rev = page?.latestDraftRevisionId ? await ctx.db.get(page.latestDraftRevisionId) : null;
    return rev?.document.blocks ?? [];
  });
}

async function pagesOf(t: TestBackend, projectId: Id<"projects">) {
  return t.run((ctx) =>
    ctx.db
      .query("cmsPages")
      .collect()
      .then((rows) => rows.filter((row) => row.projectId === projectId)),
  );
}

async function draftByPath(t: TestBackend, projectId: Id<"projects">, path: string) {
  const page = (await pagesOf(t, projectId)).find((row) => row.fullPath === path);
  if (!page) return null;
  return draftBlocks(t, page._id);
}

const LONG_HTML = `<p>${"We roast small batches every Tuesday and ship the same day. ".repeat(20)}</p>`;

const hero = (heading: string) => ({ type: "hero", props: { heading, body: "Fresh coffee.", ctaLabel: "Shop beans", ctaHref: "/shop" } });
const cta = { type: "cta", props: { heading: "Visit us", buttonLabel: "Get directions", buttonHref: "/contact" } };

/* ── C1: full props + verbatim untouched blocks ─────────────────────────── */

describe("buildChat.editPage keeps content it did not change", () => {
  it("sends every block's full props and preserves an untouched 1,000+ character block byte for byte", async () => {
    const { t, tenant, projectId, buildId } = await setup();
    expect(LONG_HTML.length).toBeGreaterThan(1000);
    const seeded = await seedSite(t, tenant, projectId, [
      {
        path: "/",
        title: "Home",
        blocks: [
          { id: "blk_hero", type: "hero", version: 1, props: { heading: "Old heading" } },
          { id: "blk_story", type: "richText", version: 1, props: { html: LONG_HTML } },
        ],
      },
    ]);
    const calls = scriptModel([
      JSON.stringify({
        summary: "Sharper hero.",
        blocks: [
          { id: "blk_hero", type: "hero", props: { heading: "Roasted Tuesday, at your door Wednesday" } },
          { id: "blk_story", keep: true },
        ],
      }),
    ]);

    await tenant.as.action(api.buildChat.editPage, { buildId, message: "Make the hero punchier" });

    expect(calls).toHaveLength(1);
    const prompt = calls[0]!.messages.map((message) => message.content).join("\n");
    expect(prompt).toContain(JSON.stringify(LONG_HTML));
    // Page content is data in the user turn, not the system prompt.
    expect(calls[0]!.messages[0]!.content).not.toContain("We roast small batches");

    const blocks = await draftBlocks(t, seeded["/"]!.pageId);
    expect(blocks.map((block) => block.id)).toEqual(["blk_hero", "blk_story"]);
    expect(blocks[1]!.props.html).toBe(LONG_HTML);
    expect(blocks[0]!.props.heading).toBe("Roasted Tuesday, at your door Wednesday");
  });

  it("refuses a page over the size budget with a clear error, before any quota or model spend", async () => {
    const { t, tenant, projectId, buildId } = await setup();
    const huge = `<p>${"x".repeat(EDIT_DOCUMENT_BUDGET_CHARS)}</p>`;
    const seeded = await seedSite(t, tenant, projectId, [
      { path: "/", title: "Home", blocks: [{ id: "blk_big", type: "richText", version: 1, props: { html: huge } }] },
    ]);
    const calls = scriptModel(["{}"]);

    await expect(
      tenant.as.action(api.buildChat.editPage, { buildId, message: "Tweak it" }),
    ).rejects.toThrow(/too large to edit in chat/);
    expect(calls).toEqual([]);
    const blocks = await draftBlocks(t, seeded["/"]!.pageId);
    expect(blocks[0]!.props.html).toBe(huge);
  });
});

/* ── P0-1: the page being viewed ────────────────────────────────────────── */

describe("buildChat.editPage edits the page the user is viewing", () => {
  it("applies the edit to the page at pagePath, not the homepage", async () => {
    const { t, tenant, projectId, buildId } = await setup();
    const seeded = await seedSite(t, tenant, projectId, [
      { path: "/", title: "Home", blocks: [{ id: "blk_home", type: "hero", version: 1, props: { heading: "Home hero" } }] },
      { path: "/pricing", title: "Pricing", blocks: [{ id: "blk_price", type: "hero", version: 1, props: { heading: "Pricing hero" } }] },
    ]);
    const calls = scriptModel([
      JSON.stringify({
        summary: "Added a FAQ.",
        blocks: [
          { id: "blk_price", keep: true },
          { type: "faq", props: { heading: "Questions", items: [{ question: "Can I pause?", answer: "Any time." }] } },
        ],
      }),
    ]);

    const result = await tenant.as.action(api.buildChat.editPage, {
      buildId,
      message: "add a FAQ",
      pagePath: "/pricing",
    });

    expect(result.pageId).toBe(seeded["/pricing"]!.pageId);
    expect(calls[0]!.messages[1]!.content).toContain("(/pricing)");
    const pricing = await draftBlocks(t, seeded["/pricing"]!.pageId);
    expect(pricing.map((block) => block.type)).toEqual(["hero", "faq"]);
    const home = await draftBlocks(t, seeded["/"]!.pageId);
    expect(home).toEqual([{ id: "blk_home", type: "hero", version: 1, props: { heading: "Home hero" } }]);
  });

  it("refuses a path that is not on this build's site, before any model call", async () => {
    const { t, tenant, projectId, buildId } = await setup();
    await seedSite(t, tenant, projectId, [
      { path: "/", title: "Home", blocks: [{ id: "blk_home", type: "hero", version: 1, props: { heading: "Home hero" } }] },
    ]);
    // Another tenant's site has the path; it must not be reachable.
    const other = await seedUser(t, { plan: "starter" });
    const otherProject = (await other.as.mutation(api.projects.create, { name: "Other" })) as Id<"projects">;
    await seedSite(t, other, otherProject, [
      { path: "/secret", title: "Secret", blocks: [{ id: "blk_s", type: "hero", version: 1, props: { heading: "Theirs" } }] },
    ]);
    const calls = scriptModel(["{}"]);

    for (const pagePath of ["/secret", "/does-not-exist"]) {
      await expect(
        tenant.as.action(api.buildChat.editPage, { buildId, message: "edit", pagePath }),
      ).rejects.toThrow(/Page not found/);
    }
    expect(calls).toEqual([]);
  });
});

/* ── P0-3 / C7: stable block ids ────────────────────────────────────────── */

describe("buildChat.editPage keeps block ids stable", () => {
  it("keeps the ids of blocks that persist and mints ids only for new blocks", async () => {
    const { t, tenant, projectId, buildId } = await setup();
    const seeded = await seedSite(t, tenant, projectId, [
      {
        path: "/",
        title: "Home",
        blocks: [
          { id: "blk_hero", type: "hero", version: 1, props: { heading: "Old" } },
          { id: "blk_quote", type: "quote", version: 1, props: { text: "Best beans in town." } },
          { id: "blk_gone", type: "divider", version: 1, props: {} },
        ],
      },
    ]);
    scriptModel([
      JSON.stringify({
        summary: "Edited.",
        blocks: [
          { id: "blk_quote", type: "quote", props: { text: "Best beans in town.", attribution: "A regular" } },
          { id: "blk_hero", keep: true },
          { type: "cta", props: cta.props },
        ],
      }),
    ]);

    await tenant.as.action(api.buildChat.editPage, { buildId, message: "Move the quote up and add a CTA" });

    const blocks = await draftBlocks(t, seeded["/"]!.pageId);
    expect(blocks.slice(0, 2).map((block) => block.id)).toEqual(["blk_quote", "blk_hero"]);
    expect(blocks[0]!.props.attribution).toBe("A regular");
    expect(blocks[2]!.type).toBe("cta");
    expect(["blk_hero", "blk_quote", "blk_gone"]).not.toContain(blocks[2]!.id);
    expect(blocks.map((block) => block.id)).not.toContain("blk_gone");
  });
});

/* ── C2: prompt derived from the registry; every page validated ─────────── */

describe("site generator prompt and validation agree", () => {
  it("derives the block prop spec from the registry", () => {
    const spec = blockPropSpec();
    const writable = aiWritableBlockDefs().map((def) => def.type);
    expect(writable).not.toContain("image");
    expect(writable).not.toContain("productGrid");
    for (const def of BLOCK_REGISTRY) {
      if (!writable.includes(def.type)) {
        expect(spec).toMatch(new RegExp(`Never use these block types[^\\n]*\\b${def.type}\\b`));
        continue;
      }
      const line = spec.split("\n").find((row) => row.startsWith(`- ${def.type}:`));
      expect(line, def.type).toBeDefined();
      for (const field of def.fields) {
        if (field.kind === "assetRef" || field.kind === "collectionRef") {
          expect(line).not.toContain(field.key);
          continue;
        }
        expect(line).toContain(`${field.key}${field.required ? "*" : ""}`);
      }
    }
    expect(spec).not.toMatch(/\(omit\)/);
  });

  it("runs the repair turn when any page is invalid and writes the repaired site", async () => {
    const { t, tenant, projectId, buildId } = await setup();
    const invalid = {
      pages: [
        { name: "Home", path: "/", sections: [hero("Fresh roasts"), cta] },
        { name: "Gallery", path: "/gallery", sections: [{ type: "image", props: { alt: "Roaster" } }] },
      ],
    };
    const repaired = {
      pages: [
        { name: "Home", path: "/", sections: [hero("Fresh roasts"), cta] },
        { name: "Gallery", path: "/gallery", sections: [{ type: "richText", props: { html: "<p>Our roaster at work.</p>" } }] },
      ],
    };
    const calls = scriptModel([JSON.stringify(invalid), JSON.stringify(repaired)]);

    const result = await tenant.as.action(api.buildChat.generateSite, { buildId, message: "A coffee roaster site" });

    expect(calls).toHaveLength(2);
    expect(result.written).toEqual(["Home", "Gallery"]);
    expect(result.skipped).toEqual([]);
    expect((await draftByPath(t, projectId, "/gallery"))?.[0]?.type).toBe("richText");
  });

  it("reports pages that stay invalid after repair and never lists them as changed", async () => {
    const { t, tenant, projectId, buildId } = await setup();
    const plan = {
      pages: [
        { name: "Home", path: "/", sections: [hero("Fresh roasts"), cta] },
        { name: "Shop", path: "/shop", sections: [{ type: "productGrid", props: { columns: 3 } }] },
      ],
    };
    const calls = scriptModel([JSON.stringify(plan)]);

    const result = await tenant.as.action(api.buildChat.generateSite, { buildId, message: "A coffee roaster site" });

    expect(calls).toHaveLength(2); // original + one repair turn
    expect(result.written).toEqual(["Home"]);
    expect(result.skipped).toEqual([
      expect.objectContaining({ name: "Shop", path: "/shop" }),
    ]);
    expect(result.reply).toMatch(/Not written \(1\).*Shop \(\/shop\)/);
    const paths = (await pagesOf(t, projectId)).map((page) => page.fullPath);
    expect(paths).toEqual(["/"]); // no empty page left behind for /shop
    const messages = await t.run((ctx) => ctx.db.query("buildMessages").collect());
    const assistant = messages.filter((m) => m.buildId === buildId && m.role === "assistant").at(-1);
    expect(assistant?.changedPaths).toEqual(["/"]);
  });
});

/* ── C3: nested and trailing-slash paths ────────────────────────────────── */

describe("buildChat.generateSite path handling", () => {
  it("writes content to nested and trailing-slash paths", async () => {
    const { t, tenant, projectId, buildId } = await setup();
    scriptModel([
      JSON.stringify({
        pages: [
          { name: "Home", path: "/", sections: [hero("Fresh roasts")] },
          { name: "Web design", path: "/services/web-design", sections: [hero("Websites that sell")] },
          { name: "About", path: "/about/", sections: [hero("Our story")] },
        ],
      }),
    ]);

    const result = await tenant.as.action(api.buildChat.generateSite, { buildId, message: "Site" });

    expect(result.written).toEqual(["Home", "Web design", "About"]);
    const pages = await pagesOf(t, projectId);
    expect(pages.map((page) => page.fullPath).sort()).toEqual(["/", "/about", "/services/web-design"]);
    expect((await draftByPath(t, projectId, "/services/web-design"))?.[0]?.props.heading).toBe("Websites that sell");
    expect((await draftByPath(t, projectId, "/about"))?.[0]?.props.heading).toBe("Our story");
    const nested = pages.find((page) => page.fullPath === "/services/web-design");
    expect(nested?.slug).toBe("web-design");
  });
});

/* ── S1: sanitize on save ───────────────────────────────────────────────── */

describe("AI rich text is sanitized on save", () => {
  it("stores generated richText without script or event-handler markup", async () => {
    const { t, tenant, projectId, buildId } = await setup();
    scriptModel([
      JSON.stringify({
        pages: [
          {
            name: "Home",
            path: "/",
            sections: [
              hero("Fresh roasts"),
              { type: "richText", props: { html: '<p>Hello</p><img src="x" onerror="alert(1)"><script>alert(2)</script><a href="javascript:alert(3)">x</a>' } },
            ],
          },
        ],
      }),
    ]);

    await tenant.as.action(api.buildChat.generateSite, { buildId, message: "Site" });

    const blocks = await draftByPath(t, projectId, "/");
    const html = String(blocks?.[1]?.props.html);
    expect(html).toContain("Hello");
    expect(html).not.toMatch(/onerror|<script|javascript:/i);
  });
});

/* ── C5: checkpoint before every AI write ───────────────────────────────── */

describe("AI writes are checkpointed first", () => {
  it("snapshots manual edits made since the last AI operation before overwriting them", async () => {
    const { t, tenant, projectId, buildId } = await setup();
    scriptModel([
      JSON.stringify({ pages: [{ name: "Home", path: "/", sections: [hero("AI heading")] }] }),
    ]);
    await tenant.as.action(api.buildChat.generateSite, { buildId, message: "Site" });

    // A manual editor change after generation.
    const home = (await pagesOf(t, projectId))[0]!;
    const blockId = (await draftBlocks(t, home._id))[0]!.id;
    await t.run(async (ctx) => {
      const page = await ctx.db.get(home._id);
      await ctx.db.patch(page!.latestDraftRevisionId!, {
        document: { schemaVersion: 1, blocks: [{ id: blockId, type: "hero", version: 1, props: { heading: "My manual heading" } }] },
      });
    });

    scriptModel([
      JSON.stringify({ summary: "Changed.", blocks: [{ id: blockId, type: "hero", props: { heading: "AI rewrite" } }] }),
    ]);
    await tenant.as.action(api.buildChat.editPage, { buildId, message: "Rewrite the hero" });

    const versions = await t.run((ctx) =>
      ctx.db.query("buildVersions").withIndex("by_build", (q) => q.eq("buildId", buildId)).collect(),
    );
    versions.sort((a, b) => a.version - b.version);
    expect(versions.map((row) => row.label)).toEqual([
      "Site",
      "Before: Rewrite the hero",
      "Rewrite the hero",
    ]);
    expect(versions[1]!.pages[0]!.draft).toContain("My manual heading");
    expect(versions[2]!.pages[0]!.draft).toContain("AI rewrite");

    // No manual change since the last version: no duplicate checkpoint.
    scriptModel([
      JSON.stringify({ summary: "Again.", blocks: [{ id: blockId, type: "hero", props: { heading: "Second rewrite" } }] }),
    ]);
    await tenant.as.action(api.buildChat.editPage, { buildId, message: "Again" });
    const after = await t.run((ctx) =>
      ctx.db.query("buildVersions").withIndex("by_build", (q) => q.eq("buildId", buildId)).collect(),
    );
    expect(after).toHaveLength(4);
  });
});

/* ── S4: website builds only ────────────────────────────────────────────── */

describe("buildChat refuses app builds", () => {
  it("rejects plan, generate and edit on an app build before any model call or write", async () => {
    const { t, tenant, projectId, buildId } = await setup("app");
    await seedSite(t, tenant, projectId, [
      { path: "/", title: "Home", blocks: [{ id: "blk_home", type: "hero", version: 1, props: { heading: "Keep me" } }] },
    ]);
    const calls = scriptModel(["{}"]);

    await expect(tenant.as.action(api.buildChat.planSite, { buildId, message: "plan" })).rejects.toThrow(/Only website builds/);
    await expect(tenant.as.action(api.buildChat.generateSite, { buildId, message: "go" })).rejects.toThrow(/Only website builds/);
    await expect(tenant.as.action(api.buildChat.editPage, { buildId, message: "edit" })).rejects.toThrow(/Only website builds/);

    expect(calls).toEqual([]);
    const messages = await t.run((ctx) => ctx.db.query("buildMessages").collect());
    expect(messages.filter((m) => m.buildId === buildId)).toEqual([]);
    expect((await draftByPath(t, projectId, "/"))?.[0]?.props.heading).toBe("Keep me");
  });
});
