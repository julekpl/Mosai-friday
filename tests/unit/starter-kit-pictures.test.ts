import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { parseImageQuery, parseStarterKitPosts, postsPictureSummary } from "@/shared/starterKitJob";
import { buildFunctionRegistry } from "./function-registry";
import { newBackend, seedUser, type TestBackend, type Tenant } from "./helpers";

/**
 * U5b — pictures in the starter kit's posts, and `starterKit.content`.
 * No network, no real DNS: `fetch` routes by host (OpenRouter model stub,
 * Pexels API, Pexels images, the owner's site) and the resolver answers
 * public for every name.
 */

vi.mock("node:dns/promises", () => {
  const lookup = async () => [{ address: "93.184.216.34", family: 4 }];
  return { lookup, default: { lookup } };
});

const KEY_ENV = ["PEXELS", "API", "KEY"].join("_");
const originalKey = process.env[KEY_ENV];

beforeEach(() => {
  delete process.env[KEY_ENV];
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  if (originalKey === undefined) delete process.env[KEY_ENV];
  else process.env[KEY_ENV] = originalKey;
});

const OWNER_HOST = "roastery.example";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
/** Distinct bytes per address: convex-test derives storage URLs from content. */
const image = (url: URL) =>
  new Response(new Uint8Array([...PNG, ...new TextEncoder().encode(url.pathname)]), {
    status: 200,
    headers: { "content-type": "image/png" },
  });

const PLAN = JSON.stringify({
  customers: [{ text: "Neighbours who want good coffee", basis: "assumption" }],
  thisWeek: [
    { action: "Post opening hours", why: "People ask", basis: "assumption" },
    { action: "Ask three regulars for a review", why: "Trust", basis: "assumption" },
    { action: "Put a sign outside", why: "Walk-ins", basis: "assumption" },
  ],
});
const SITE = JSON.stringify({
  pages: [
    {
      name: "Home",
      path: "/",
      sections: [{ type: "hero", props: { heading: "Fresh roasts", body: "Coffee." } }],
    },
  ],
});
const POSTS = JSON.stringify({
  posts: Array.from({ length: 7 }, (_, index) => ({
    channel: ["facebook", "instagram", "linkedin", "x"][index % 4],
    body: `Post number ${index + 1} from the roastery.`,
    imageQuery: `coffee beans roast ${index + 1}`,
  })),
});

function photoJson(id: number) {
  return {
    id,
    width: 1000,
    height: 1000,
    url: `https://www.pexels.com/photo/coffee-${id}/`,
    photographer: "Ana Baker",
    photographer_url: "https://www.pexels.com/@ana",
    alt: "Coffee",
    src: {
      original: `https://images.pexels.com/photos/${id}/original.jpeg`,
      large: `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg`,
      medium: `https://images.pexels.com/photos/${id}/medium.jpeg`,
    },
  };
}

type Net = { log: URL[]; pexels: "ok" | "429" };

function modelReply(system: string): string {
  if (system.includes("one-week marketing plan")) return PLAN;
  if (system.includes("site generator")) return SITE;
  if (system.includes("social media posts")) return POSTS;
  throw new Error("unexpected model call");
}

/** Route every fetch by host; returns the log. */
function stubNet(net: Net, ownerHtml = "<html><body><h1>Roastery</h1></body></html>") {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    net.log.push(url);
    if (url.hostname === "openrouter.ai") {
      const body = JSON.parse(String(init?.body ?? "{}")) as { messages: { content: string }[] };
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: modelReply(body.messages[0]?.content ?? "") } }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url.hostname === "api.pexels.com") {
      if (net.pexels === "429") return new Response("", { status: 429, headers: { "X-Ratelimit-Remaining": "0" } });
      const photo = url.pathname.match(/\/photos\/(\d+)$/);
      if (photo) return Response.json(photoJson(Number(photo[1])));
      const base = 100 + net.log.filter((entry) => entry.pathname.endsWith("/search")).length * 10;
      return Response.json({ photos: [photoJson(base), photoJson(base + 1)] });
    }
    if (url.hostname === "images.pexels.com") return image(url);
    if (url.hostname === OWNER_HOST) {
      if (url.pathname.startsWith("/img/")) return image(url);
      if (url.pathname === "/robots.txt" || url.pathname === "/sitemap.xml") return new Response("", { status: 404 });
      return new Response(ownerHtml, { status: 200, headers: { "content-type": "text/html" } });
    }
    throw new Error(`live network blocked: ${url.toString()}`);
  });
}

async function setup(images?: Array<{ url: string }>) {
  const t = newBackend();
  const tenant = await seedUser(t, { plan: "starter", email: "owner@example.com" });
  const projectId = (await tenant.as.mutation(api.projects.create, { name: "Roastery" })) as Id<"projects">;
  await t.run((ctx) =>
    ctx.db.patch(projectId, {
      websiteUrl: `https://${OWNER_HOST}/`,
      websiteScan: { status: "scraped", scannedAt: Date.now(), ...(images ? { images } : {}) },
    }),
  );
  return { t, tenant, projectId };
}

async function runKit(t: TestBackend, tenant: Tenant, projectId: Id<"projects">) {
  vi.useFakeTimers();
  const kitId = await tenant.as.mutation(api.starterKit.start, { projectId });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  vi.useRealTimers();
  const kit = await t.run((ctx) => ctx.db.get(kitId));
  if (!kit) throw new Error("kit missing");
  return kit;
}

async function postsOf(t: TestBackend, projectId: Id<"projects">): Promise<Doc<"posts">[]> {
  return await t.run((ctx) =>
    ctx.db.query("posts").withIndex("by_project", (q) => q.eq("projectId", projectId)).collect(),
  );
}

async function filesOf(t: TestBackend, projectId: Id<"projects">): Promise<Doc<"projectFiles">[]> {
  return await t.run((ctx) =>
    ctx.db.query("projectFiles").withIndex("by_project", (q) => q.eq("projectId", projectId)).collect(),
  );
}

const ownerImages = [1, 2].map((n) => ({ url: `https://${OWNER_HOST}/img/photo-${n}.png` }));

describe("U5b — pure rules", () => {
  it("validates imageQuery and names the picture gap", () => {
    expect(parseImageQuery("Fresh bread, on counter!")).toBe("fresh bread on counter");
    expect(parseImageQuery("bread")).toBeUndefined();
    expect(parseImageQuery("a b c d e f")).toBeUndefined();
    expect(parseImageQuery(42)).toBeUndefined();
    expect(parseStarterKitPosts(POSTS)[0].imageQuery).toBe("coffee beans roast 1");
    expect(postsPictureSummary(7, 7).status).toBe("succeeded");
    expect(postsPictureSummary(7, 5)).toEqual({
      status: "partially_succeeded",
      message: "5 of 7 posts have pictures; add your own for the rest.",
    });
  });
});

describe("U5b — starter kit posts with pictures", () => {
  it("uses the owner's photos first, then stock, and succeeds with all 7", async () => {
    process.env[KEY_ENV] = "test-key";
    const net: Net = { log: [], pexels: "ok" };
    stubNet(net);
    const { t, tenant, projectId } = await setup(ownerImages);
    const kit = await runKit(t, tenant, projectId);

    expect(kit.parts.posts.status).toBe("succeeded");
    expect(kit.parts.posts.message).toBe("7 posts written, all with pictures.");
    const posts = await postsOf(t, projectId);
    expect(posts).toHaveLength(7);
    expect(posts.every((post) => post.status === "draft" && post.mediaUrl && !post.scheduledAt)).toBe(true);
    expect(new Set(posts.map((post) => post.mediaUrl)).size).toBe(7);

    const files = await filesOf(t, projectId);
    const bySource = (source: string) => files.filter((file) => file.source === source).length;
    expect(bySource("owner_site")).toBe(2);
    expect(bySource("stock")).toBe(5);
    // The first two posts carry the owner's photos.
    const ownerUrls = new Set<string>();
    for (const file of files.filter((row) => row.source === "owner_site")) {
      const url = await t.run((ctx) => ctx.storage.getUrl(file.storageId));
      if (url) ownerUrls.add(url);
    }
    const ordered = [...posts].sort((a, b) => a._creationTime - b._creationTime);
    expect(ownerUrls.has(ordered[0].mediaUrl ?? "")).toBe(true);
    expect(ownerUrls.has(ordered[1].mediaUrl ?? "")).toBe(true);
    // Outputs reference the files; 5 searches, no rescan (images known).
    expect(kit.parts.posts.outputs.filter((output) => output.type === "projectFiles")).toHaveLength(7);
    expect(net.log.filter((url) => url.pathname.endsWith("/search"))).toHaveLength(5);
    expect(net.log.filter((url) => url.pathname === "/robots.txt")).toHaveLength(0);
  });

  it("without a Pexels key uses owner photos only and names the gap", async () => {
    const net: Net = { log: [], pexels: "ok" };
    stubNet(net);
    const { t, tenant, projectId } = await setup(ownerImages);
    const kit = await runKit(t, tenant, projectId);

    expect(kit.parts.posts.status).toBe("partially_succeeded");
    expect(kit.parts.posts.message).toBe("2 of 7 posts have pictures; add your own for the rest.");
    expect((await postsOf(t, projectId)).filter((post) => post.mediaUrl)).toHaveLength(2);
    expect(net.log.some((url) => url.hostname === "api.pexels.com")).toBe(false);
  });

  it("a 429 gives fewer pictures and the part is partially_succeeded, not failed", async () => {
    process.env[KEY_ENV] = "test-key";
    const net: Net = { log: [], pexels: "429" };
    stubNet(net);
    const { t, tenant, projectId } = await setup(ownerImages);
    const kit = await runKit(t, tenant, projectId);

    expect(kit.parts.posts.status).toBe("partially_succeeded");
    expect(kit.parts.posts.message).toBe("2 of 7 posts have pictures; add your own for the rest.");
    // Pexels is not called again after the first rate_limited answer.
    expect(net.log.filter((url) => url.hostname === "api.pexels.com")).toHaveLength(1);
  });

  it("a missing images list triggers exactly one server rescan", async () => {
    const net: Net = { log: [], pexels: "ok" };
    stubNet(net, `<html><body><h1>Roastery</h1><img src="/img/scanned.png" alt="Our shop"></body></html>`);
    const { t, tenant, projectId } = await setup(undefined);
    const kit = await runKit(t, tenant, projectId);

    expect(net.log.filter((url) => url.hostname === OWNER_HOST && url.pathname === "/robots.txt")).toHaveLength(1);
    const project = await t.run((ctx) => ctx.db.get(projectId));
    expect(project?.websiteScan?.images?.map((row) => row.url)).toEqual([`https://${OWNER_HOST}/img/scanned.png`]);
    expect(kit.parts.posts.message).toBe("1 of 7 posts have pictures; add your own for the rest.");
  });
});

describe("U5b — starterKit.content", () => {
  it("returns plan, posts with mediaUrl and attribution, and website", async () => {
    process.env[KEY_ENV] = "test-key";
    stubNet({ log: [], pexels: "ok" });
    const { t, tenant, projectId } = await setup(ownerImages);
    await runKit(t, tenant, projectId);

    const content = await tenant.as.query(api.starterKit.content, { projectId });
    if (!content) throw new Error("no content");
    expect(content.plan?.thisWeek).toHaveLength(3);
    expect(content.posts).toHaveLength(7);
    expect(content.posts.every((post) => post.mediaUrl && post.status === "draft")).toBe(true);
    // Owner photos carry no attribution; stock photos do.
    expect(content.posts.filter((post) => post.attribution)).toHaveLength(5);
    expect(content.posts[0].attribution).toBeUndefined();
    expect(content.posts[2].attribution).toEqual({
      photographer: "Ana Baker",
      photographerUrl: "https://www.pexels.com/@ana",
      pageUrl: expect.stringMatching(/^https:\/\/www\.pexels\.com\/photo\//) as unknown as string,
    });
    expect(content.website?.buildId).toBeTruthy();
  });

  it("omits non-https attribution links and never returns another project's rows", async () => {
    stubNet({ log: [], pexels: "ok" });
    const { t, tenant, projectId } = await setup([]);
    const kit = await runKit(t, tenant, projectId);
    const otherProject = (await tenant.as.mutation(api.projects.create, { name: "Other" })) as Id<"projects">;

    const { foreignPost, foreignPiece, fileId, url } = await t.run(async (ctx) => {
      const storageId = await ctx.storage.store(new Blob([PNG], { type: "image/png" }));
      const url = (await ctx.storage.getUrl(storageId)) ?? "";
      const fileId = await ctx.db.insert("projectFiles", {
        projectId,
        storageId,
        name: "pexels-9",
        mimeType: "image/png",
        sizeBytes: PNG.byteLength,
        source: "stock",
        uploadedBy: tenant.userId as Id<"users">,
        createdAt: Date.now(),
        attribution: {
          provider: "pexels",
          externalId: "9",
          photographer: "Sam",
          photographerUrl: "javascript:alert(1)",
          pageUrl: "http://www.pexels.com/photo/9/",
        },
      });
      const foreignPost = await ctx.db.insert("posts", {
        projectId: otherProject,
        channel: "x",
        body: "secret other project post",
        status: "draft",
        createdAt: Date.now(),
      });
      const foreignPiece = await ctx.db.insert("contentPieces", {
        projectId: otherProject,
        title: "Other plan",
        body: PLAN,
        contentType: "marketing_plan",
        status: "draft",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      return { foreignPost, foreignPiece, fileId, url };
    });
    const firstPost = kit.parts.posts.outputs.find((output) => output.type === "posts");
    await t.run(async (ctx) => {
      if (firstPost) await ctx.db.patch(firstPost.id as Id<"posts">, { mediaUrl: url });
      await ctx.db.patch(kit._id, {
        parts: {
          ...kit.parts,
          plan: { ...kit.parts.plan, outputs: [{ type: "contentPieces", id: foreignPiece }] },
          posts: {
            ...kit.parts.posts,
            outputs: [
              ...kit.parts.posts.outputs,
              { type: "posts", id: foreignPost },
              { type: "projectFiles", id: fileId },
            ],
          },
        },
      });
    });

    const content = await tenant.as.query(api.starterKit.content, { projectId });
    if (!content) throw new Error("no content");
    expect(content.plan).toBeNull();
    expect(content.posts).toHaveLength(7);
    expect(content.posts.some((post) => post._id === foreignPost)).toBe(false);
    expect(content.posts.find((post) => post.mediaUrl === url)?.attribution).toEqual({ photographer: "Sam" });
  });

  it("is null without a kit, and is in the generated cross-tenant suite", async () => {
    const { tenant, projectId } = await setup([]);
    expect(await tenant.as.query(api.starterKit.content, { projectId })).toBeNull();
    const entry = buildFunctionRegistry().find(
      (candidate) => candidate.module === "starterKit" && candidate.exported === "content",
    );
    expect(entry?.tenantScoped).toBe(true);
  });
});
