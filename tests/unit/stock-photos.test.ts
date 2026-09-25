import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as cheerio from "cheerio";
import { internal } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { safeFetchBytes } from "@/convex/lib/safeFetch";
import { extractPageImages, extractWebsitePage, mergeScanImages } from "@/convex/lib/websiteScan";
import { normalizeStockQuery, rateLimitFrom } from "@/convex/lib/pexels";
import { newBackend, seedProject, seedUser, type TestBackend } from "./helpers";

/**
 * U5 — posts with pictures (backend). Pexels search/import and owner-photo
 * import. No network and no real DNS: `fetch` is stubbed per test and the
 * resolver answers public for every name except `*.rebind.test`, which
 * resolves to a private address.
 */

vi.mock("node:dns/promises", () => {
  const lookup = async (host: string) =>
    host.endsWith(".rebind.test")
      ? [{ address: "10.0.0.7", family: 4 }]
      : [{ address: "93.184.216.34", family: 4 }];
  return { lookup, default: { lookup } };
});

const KEY_ENV = ["PEXELS", "API", "KEY"].join("_");
const originalKey = process.env[KEY_ENV];

beforeEach(() => {
  delete process.env[KEY_ENV];
});
afterEach(() => {
  vi.unstubAllGlobals();
  if (originalKey === undefined) delete process.env[KEY_ENV];
  else process.env[KEY_ENV] = originalKey;
});

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);

function photoJson(id: number, large = `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg?h=650`) {
  return {
    id,
    width: 4000,
    height: 3000,
    url: `https://www.pexels.com/photo/bakery-${id}/`,
    photographer: "Ana Baker",
    photographer_url: "https://www.pexels.com/@ana",
    alt: "Fresh bread on a counter",
    src: {
      original: `https://images.pexels.com/photos/${id}/original.jpeg`,
      large,
      medium: `https://images.pexels.com/photos/${id}/medium.jpeg`,
    },
  };
}

type FetchLog = string[];

function stubFetch(handler: (url: URL, init?: RequestInit) => Response | Promise<Response>): FetchLog {
  const log: FetchLog = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    log.push(url.toString());
    return await handler(url, init);
  });
  return log;
}

const image = (bytes: Uint8Array = PNG, type = "image/png") =>
  new Response(bytes, { status: 200, headers: { "content-type": type } });

async function seedWithScan(t: TestBackend, images: Array<{ url: string }>) {
  const { userId } = await seedUser(t);
  const projectId = await seedProject(t, userId);
  await t.run((ctx) =>
    ctx.db.patch(projectId as Id<"projects">, {
      websiteScan: { status: "scraped", scannedAt: Date.now(), images },
    }),
  );
  return { userId: userId as Id<"users">, projectId: projectId as Id<"projects"> };
}

describe("U5 — stock search", () => {
  it("without a key returns needs_setup, and owner photos still import", async () => {
    const t = newBackend();
    const owner = "https://bakery.example/img/bread.png";
    const { userId, projectId } = await seedWithScan(t, [{ url: owner }]);
    const log = stubFetch((url) => (url.hostname === "bakery.example" ? image() : new Response("", { status: 500 })));

    const search = await t.action(internal.stock.searchPhotos, { userId, query: "bread", orientation: "square" });
    expect(search).toEqual({ status: "needs_setup" });
    const stock = await t.action(internal.stock.importStockPhoto, { projectId, userId, externalId: "123" });
    expect(stock).toEqual({ status: "needs_setup" });
    expect(log.some((u) => u.includes("pexels"))).toBe(false);

    const imported = await t.action(internal.stock.importOwnerPhoto, { projectId, userId, url: owner });
    expect(imported.status).toBe("ok");
    const files = await t.run((ctx) => ctx.db.query("projectFiles").collect());
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ source: "owner_site", mimeType: "image/png", sizeBytes: PNG.byteLength, name: "bread.png" });
    expect(files[0].attribution).toBeUndefined();
  });

  it("a cached repeat search makes no provider call", async () => {
    process.env[KEY_ENV] = "pexels-test-value";
    const t = newBackend();
    const { userId } = await seedUser(t);
    const log = stubFetch((url) => {
      expect(url.origin).toBe("https://api.pexels.com");
      return Response.json({ photos: [photoJson(1), photoJson(2)] });
    });
    const uid = userId as Id<"users">;

    const first = await t.action(internal.stock.searchPhotos, { userId: uid, query: "  Fresh   BREAD ", orientation: "landscape" });
    expect(first).toMatchObject({ status: "ok", cached: false });
    const second = await t.action(internal.stock.searchPhotos, { userId: uid, query: "fresh bread", orientation: "landscape" });
    expect(second).toMatchObject({ status: "ok", cached: true });
    expect(log).toHaveLength(1);
    expect(log[0]).toContain("query=fresh+bread");
    if (second.status !== "ok") throw new Error("expected ok");
    expect(second.results[0]).toMatchObject({
      provider: "pexels",
      externalId: "1",
      thumbUrl: "https://images.pexels.com/photos/1/medium.jpeg",
      photographer: "Ana Baker",
      photographerUrl: "https://www.pexels.com/@ana",
      pageUrl: "https://www.pexels.com/photo/bakery-1/",
    });
    const rows = await t.run((ctx) => ctx.db.query("stockSearchCache").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0].key).toBe("pexels:landscape:fresh bread");
    expect(rows[0].expiresAt - rows[0].fetchedAt).toBe(24 * 60 * 60_000);
    // The key is never cached or returned.
    expect(JSON.stringify(rows) + JSON.stringify(second)).not.toContain("pexels-test-value");
  });

  it("a 429 answer is rate_limited with the provider's reset time", async () => {
    process.env[KEY_ENV] = "pexels-test-value";
    const t = newBackend();
    const { userId } = await seedUser(t);
    stubFetch(() => new Response("", { status: 429, headers: { "X-Ratelimit-Reset": "1790000000", "X-Ratelimit-Remaining": "0" } }));
    const res = await t.action(internal.stock.searchPhotos, { userId: userId as Id<"users">, query: "coffee", orientation: "portrait" });
    expect(res).toEqual({ status: "rate_limited", resetAt: 1_790_000_000_000 });
    expect(await t.run((ctx) => ctx.db.query("stockSearchCache").collect())).toHaveLength(0);
  });

  it("maps an exhausted budget to rate_limited", () => {
    const headers = new Headers({ "X-Ratelimit-Remaining": "0", "X-Ratelimit-Reset": "1790000100" });
    expect(rateLimitFrom(403, headers, 0)).toEqual({ status: "rate_limited", resetAt: 1_790_000_100_000 });
    expect(rateLimitFrom(200, new Headers({ "X-Ratelimit-Remaining": "5" }), 0)).toBeNull();
    expect(normalizeStockQuery(`  A  ${"b".repeat(200)}`)).toHaveLength(100);
  });

  it("the per-user limit returns rate_limited with the window end", async () => {
    process.env[KEY_ENV] = "pexels-test-value";
    const t = newBackend();
    const { userId } = await seedUser(t);
    const log = stubFetch(() => Response.json({ photos: [] }));
    const uid = userId as Id<"users">;
    for (let i = 0; i < 5; i++) {
      const ok = await t.action(internal.stock.searchPhotos, { userId: uid, query: `q${i}`, orientation: "square" });
      expect(ok.status).toBe("ok");
    }
    const before = Date.now();
    const limited = await t.action(internal.stock.searchPhotos, { userId: uid, query: "q-last", orientation: "square" });
    expect(limited.status).toBe("rate_limited");
    if (limited.status !== "rate_limited") throw new Error("expected rate_limited");
    expect(limited.resetAt).toBeGreaterThan(before);
    expect(limited.resetAt % (10 * 60_000)).toBe(0);
    expect(log).toHaveLength(5);
  });
});

describe("U5 — imports", () => {
  it("importStockPhoto re-fetches by id and stores attribution", async () => {
    process.env[KEY_ENV] = "pexels-test-value";
    const t = newBackend();
    const { userId, projectId } = await seedWithScan(t, []);
    const log = stubFetch((url, init) => {
      if (url.hostname === "api.pexels.com") {
        expect(new Headers(init?.headers).get("authorization")).toBe("pexels-test-value");
        return Response.json(photoJson(123));
      }
      if (url.hostname === "images.pexels.com") return image(PNG, "image/jpeg");
      throw new Error(`unexpected ${url}`);
    });
    const res = await t.action(internal.stock.importStockPhoto, { projectId, userId, externalId: "123" });
    expect(res.status).toBe("ok");
    expect(log[0]).toBe("https://api.pexels.com/v1/photos/123");
    const files = await t.run((ctx) => ctx.db.query("projectFiles").collect());
    expect(files[0]).toMatchObject({
      source: "stock",
      attribution: {
        provider: "pexels",
        externalId: "123",
        photographer: "Ana Baker",
        photographerUrl: "https://www.pexels.com/@ana",
        pageUrl: "https://www.pexels.com/photo/bakery-123/",
      },
    });
    // A retried import returns the same file without another download.
    const again = await t.action(internal.stock.importStockPhoto, { projectId, userId, externalId: "123" });
    expect(again).toMatchObject({ status: "ok", fileId: files[0]._id });
    expect(log).toHaveLength(2);
  });

  it("importStockPhoto accepts only an id and refuses a non-Pexels image host", async () => {
    process.env[KEY_ENV] = "pexels-test-value";
    const t = newBackend();
    const { userId, projectId } = await seedWithScan(t, []);
    const log = stubFetch((url) => {
      if (url.hostname === "api.pexels.com") return Response.json(photoJson(55, "https://evil.example/steal.jpg"));
      return image();
    });
    await expect(
      t.action(internal.stock.importStockPhoto, { projectId, userId, externalId: "https://evil.example/x.jpg" }),
    ).rejects.toThrow(/Invalid stock photo id/);
    await expect(
      t.action(internal.stock.importStockPhoto, { projectId, userId, externalId: "55/../../v1/search" }),
    ).rejects.toThrow(/Invalid stock photo id/);
    const res = await t.action(internal.stock.importStockPhoto, { projectId, userId, externalId: "55" });
    expect(res).toEqual({ status: "unavailable" });
    expect(log.some((u) => u.includes("evil.example"))).toBe(false);
    expect(await t.run((ctx) => ctx.db.query("projectFiles").collect())).toHaveLength(0);
  });

  it("importOwnerPhoto refuses an address that is not in the scan list", async () => {
    const t = newBackend();
    const { userId, projectId } = await seedWithScan(t, [{ url: "https://bakery.example/a.jpg" }]);
    const log = stubFetch(() => image());
    await expect(
      t.action(internal.stock.importOwnerPhoto, { projectId, userId, url: "https://elsewhere.example/b.jpg" }),
    ).rejects.toThrow(/not on your scanned website/);
    expect(log).toHaveLength(0);
  });

  it("imports refuse a caller without project access", async () => {
    const t = newBackend();
    const { projectId } = await seedWithScan(t, [{ url: "https://bakery.example/a.jpg" }]);
    const { userId: stranger } = await seedUser(t);
    stubFetch(() => image());
    await expect(
      t.action(internal.stock.importOwnerPhoto, { projectId, userId: stranger as Id<"users">, url: "https://bakery.example/a.jpg" }),
    ).rejects.toThrow(/Not found/);
  });
});

describe("U5 — safeFetchBytes", () => {
  it("refuses http and private addresses", async () => {
    const log = stubFetch(() => image());
    await expect(safeFetchBytes("http://93.184.216.34/a.png")).rejects.toThrow(/Only https/);
    await expect(safeFetchBytes("https://10.0.0.1/a.png")).rejects.toThrow(/Blocked/);
    await expect(safeFetchBytes("https://169.254.169.254/a.png")).rejects.toThrow(/Blocked/);
    await expect(safeFetchBytes("https://cdn.rebind.test/a.png")).rejects.toThrow(/Blocked address/);
    expect(log).toHaveLength(0);
  });

  it("re-validates redirects, including to a private address and off the host list", async () => {
    const log = stubFetch((url) =>
      url.hostname === "cdn.example"
        ? new Response("", { status: 302, headers: { location: "https://cdn.rebind.test/a.png" } })
        : image(),
    );
    await expect(safeFetchBytes("https://cdn.example/a.png")).rejects.toThrow(/Blocked address/);
    expect(log).toEqual(["https://cdn.example/a.png"]);

    stubFetch(() => new Response("", { status: 302, headers: { location: "https://other.example/a.png" } }));
    await expect(
      safeFetchBytes("https://images.pexels.com/a.png", { allowedHosts: ["images.pexels.com"] }),
    ).rejects.toThrow(/Host not allowed/);
    await expect(
      safeFetchBytes("https://evil.example/a.png", { allowedHosts: ["images.pexels.com"] }),
    ).rejects.toThrow(/Host not allowed/);
  });

  it("refuses svg, non-image and missing content types", async () => {
    stubFetch(() => image(PNG, "image/svg+xml"));
    await expect(
      safeFetchBytes("https://cdn.example/a.svg", { allowedContentTypes: ["image/svg+xml", "image/png"] }),
    ).rejects.toThrow(/Refusing content type/);
    stubFetch(() => new Response("<html>", { headers: { "content-type": "text/html" } }));
    await expect(safeFetchBytes("https://cdn.example/a.png")).rejects.toThrow(/Refusing content type/);
    stubFetch(() => new Response(PNG));
    await expect(safeFetchBytes("https://cdn.example/a.png")).rejects.toThrow(/Refusing content type/);
  });

  it("refuses an oversize body, declared or streamed", async () => {
    const big = new Uint8Array(2_048);
    stubFetch(() => image(big, "image/png"));
    await expect(safeFetchBytes("https://cdn.example/a.png", { maxBytes: 1_024 })).rejects.toThrow(/too large/);
    stubFetch(() => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          for (let i = 0; i < 4; i++) controller.enqueue(new Uint8Array(512));
          controller.close();
        },
      });
      return new Response(stream, { headers: { "content-type": "image/png" } });
    });
    await expect(safeFetchBytes("https://cdn.example/a.png", { maxBytes: 1_024 })).rejects.toThrow(/too large/);
  });

  it("returns the bytes of an allowed image", async () => {
    stubFetch(() => image(PNG, "image/webp; charset=binary"));
    const res = await safeFetchBytes("https://cdn.example/a.webp");
    expect(res).toMatchObject({ ok: true, status: 200, contentType: "image/webp", url: "https://cdn.example/a.webp" });
    expect(new Uint8Array(res.bytes)).toEqual(PNG);
  });
});

describe("U5 — scan image extraction", () => {
  const page = "https://bakery.example/about";
  const html = `<html><head>
    <meta property="og:image" content="/og.jpg"><meta property="og:image:alt" content="Our shop">
  </head><body>
    <img src="https://bakery.example/og.jpg" alt="duplicate">
    <img src="data:image/png;base64,AAAA" alt="inline">
    <img src="http://bakery.example/plain.jpg">
    <img src="/logo.svg" alt="logo">
    <img src="/pixel.gif" width="1" height="1">
    <img src="/small.jpg" srcset="/small.jpg 320w, /large.jpg 1280w, /mid.jpg 640w" alt="  Sourdough
      loaf ">
    <img src="https://cdn.example/team.webp" alt="Team">
  </body></html>`;

  it("keeps og:image first, then img best candidates, and skips unsafe or tiny ones", () => {
    const images = extractWebsitePage(html, page).images;
    expect(images).toEqual([
      { url: "https://bakery.example/og.jpg", alt: "Our shop", pageUrl: page },
      { url: "https://bakery.example/large.jpg", alt: "Sourdough loaf", pageUrl: page },
      { url: "https://cdn.example/team.webp", alt: "Team", pageUrl: page },
    ]);
  });

  it("caps at 12 unique images across pages", () => {
    const many = Array.from({ length: 20 }, (_, i) => `<img src="/p${i}.jpg">`).join("");
    expect(extractPageImages(cheerio.load(many), page)).toHaveLength(12);
    const a = [{ url: "https://x.example/1.jpg" }, { url: "https://x.example/2.jpg" }];
    const b = Array.from({ length: 15 }, (_, i) => ({ url: `https://x.example/${i}.jpg` }));
    const merged = mergeScanImages([a, b]);
    expect(merged).toHaveLength(12);
    expect(new Set(merged.map((m) => m.url)).size).toBe(12);
  });
});

describe("U5 — cache sweep", () => {
  it("deletes only expired rows", async () => {
    const t = newBackend();
    const now = Date.now();
    await t.run(async (ctx) => {
      await ctx.db.insert("stockSearchCache", { key: "pexels:square:old", results: [], fetchedAt: now - 2e8, expiresAt: now - 1_000 });
      await ctx.db.insert("stockSearchCache", { key: "pexels:square:new", results: [], fetchedAt: now, expiresAt: now + 60_000 });
    });
    const res = await t.mutation(internal.stockStore.sweepStockCache, {});
    expect(res).toEqual({ deleted: 1 });
    const keys = (await t.run((ctx) => ctx.db.query("stockSearchCache").collect())).map((r) => r.key);
    expect(keys).toEqual(["pexels:square:new"]);
  });
});
