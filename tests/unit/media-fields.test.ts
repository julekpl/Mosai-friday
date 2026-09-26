import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { mediaKindFor } from "@/convex/lib/media";
import { newBackend, seedProject, seedUser, type TestBackend } from "./helpers";

/**
 * MD-1: additive media fields on `projectFiles` and `productMedia`.
 * No network: `fetch` is stubbed and DNS answers public.
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
  vi.unstubAllGlobals();
  if (originalKey === undefined) delete process.env[KEY_ENV];
  else process.env[KEY_ENV] = originalKey;
});

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
const ATTRIBUTION = {
  provider: "pexels" as const,
  externalId: "123",
  photographer: "Ana Baker",
  photographerUrl: "https://www.pexels.com/@ana",
  pageUrl: "https://www.pexels.com/photo/bakery-123/",
};

async function seed(t: TestBackend, images: Array<{ url: string }> = []) {
  const user = await seedUser(t);
  const projectId = (await seedProject(t, user.userId)) as Id<"projects">;
  await t.run((ctx) => ctx.db.patch(projectId, { websiteScan: { status: "scraped", scannedAt: Date.now(), images } }));
  return { user, userId: user.userId as Id<"users">, projectId };
}

describe("MD-1: projectFiles media fields round-trip", () => {
  const cases: Array<{ source: Doc<"projectFiles">["source"]; attribution?: typeof ATTRIBUTION }> = [
    { source: undefined },
    { source: "upload" },
    { source: "owner_site" },
    { source: "stock", attribution: ATTRIBUTION },
  ];
  it.each(cases)("source $source keeps its value, attribution and the new fields", async ({ source, attribution }) => {
    const t = newBackend();
    const { userId, projectId } = await seed(t);
    const row = await t.run(async (ctx) => {
      const storageId = await ctx.storage.store(new Blob([PNG], { type: "image/png" }));
      const id = await ctx.db.insert("projectFiles", {
        projectId,
        name: "a.png",
        mimeType: "image/png",
        storageId,
        uploadedBy: userId,
        ...(source ? { source } : {}),
        ...(attribution ? { attribution } : {}),
        kind: "image",
        role: "product",
        width: 1200,
        height: 800,
        processingStatus: "ready",
        qualityFlags: ["dark"],
        authenticity: source === "stock" ? "licensed_stock" : "owner_supplied",
        createdAt: 1,
      });
      return await ctx.db.get(id);
    });
    expect(row?.source).toBe(source);
    expect(row).toMatchObject({ kind: "image", role: "product", width: 1200, height: 800, processingStatus: "ready", qualityFlags: ["dark"] });
    expect(row?.attribution).toEqual(attribution);
    expect(row).not.toHaveProperty("qualityScore");
  });

  it("older rows without any media field still read", async () => {
    const t = newBackend();
    const { userId, projectId } = await seed(t);
    const row = await t.run(async (ctx) => {
      const storageId = await ctx.storage.store(new Blob([PNG]));
      const id = await ctx.db.insert("projectFiles", { projectId, name: "old", storageId, uploadedBy: userId, createdAt: 1 });
      return await ctx.db.get(id);
    });
    expect(row?.kind).toBeUndefined();
  });

  it("productMedia accepts an optional projectFileId", async () => {
    const t = newBackend();
    const { userId, projectId } = await seed(t);
    const media = await t.run(async (ctx) => {
      const storageId = await ctx.storage.store(new Blob([PNG]));
      const fileId = await ctx.db.insert("projectFiles", { projectId, name: "p", storageId, uploadedBy: userId, createdAt: 1 });
      const productId = await ctx.db.insert("products", { projectId, title: "Loaf", createdAt: 1 } as never);
      const id = await ctx.db.insert("productMedia", { projectId, productId, url: "https://x.example/a.png", projectFileId: fileId, createdAt: 1 });
      return { row: await ctx.db.get(id), fileId };
    });
    expect(media.row?.projectFileId).toBe(media.fileId);
  });

  it("files.attach derives kind and authenticity on the server", async () => {
    const t = newBackend();
    const { user, projectId } = await seed(t);
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob([PNG])));
    const id = await user.as.mutation(api.files.attach, { projectId, storageId, name: "me.jpg", mimeType: "image/jpeg" });
    const row = await t.run((ctx) => ctx.db.get(id));
    expect(row).toMatchObject({ kind: "image", authenticity: "owner_supplied" });
    expect(row?.source).toBeUndefined();
  });

  it("mediaKindFor maps MIME types", () => {
    expect(mediaKindFor("image/heic")).toBe("image");
    expect(mediaKindFor("video/mp4")).toBe("video");
    expect(mediaKindFor("application/pdf")).toBe("document");
    expect(mediaKindFor("application/zip")).toBe("other");
    expect(mediaKindFor(undefined)).toBeUndefined();
  });
});

describe("MD-1: existing writers keep their contract", () => {
  it("importOwnerPhoto still refuses a URL not in the server scan, and marks owner_site", async () => {
    const t = newBackend();
    const owner = "https://bakery.example/img/bread.png";
    const { userId, projectId } = await seed(t, [{ url: owner }]);
    vi.stubGlobal("fetch", async () => new Response(PNG, { status: 200, headers: { "content-type": "image/png" } }));
    await expect(
      t.action(internal.stock.importOwnerPhoto, { projectId, userId, url: "https://elsewhere.example/b.png" }),
    ).rejects.toThrow(/not on your scanned website/);
    const ok = await t.action(internal.stock.importOwnerPhoto, { projectId, userId, url: owner });
    expect(ok.status).toBe("ok");
    const files = await t.run((ctx) => ctx.db.query("projectFiles").collect());
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ source: "owner_site", kind: "image", authenticity: "owner_supplied" });
    expect(files[0].attribution).toBeUndefined();
  });

  it("stock import still writes source stock with attribution", async () => {
    process.env[KEY_ENV] = "pexels-test-value";
    const t = newBackend();
    const { userId, projectId } = await seed(t);
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.hostname === "api.pexels.com") {
        return Response.json({
          id: 123,
          width: 4000,
          height: 3000,
          alt: "Bread",
          url: ATTRIBUTION.pageUrl,
          photographer: ATTRIBUTION.photographer,
          photographer_url: ATTRIBUTION.photographerUrl,
          src: {
            large: "https://images.pexels.com/photos/123/a.jpeg",
            medium: "https://images.pexels.com/photos/123/m.jpeg",
            original: "https://images.pexels.com/photos/123/o.jpeg",
          },
        });
      }
      return new Response(PNG, { status: 200, headers: { "content-type": "image/jpeg" } });
    });
    const res = await t.action(internal.stock.importStockPhoto, { projectId, userId, externalId: "123" });
    expect(res.status).toBe("ok");
    const files = await t.run((ctx) => ctx.db.query("projectFiles").collect());
    expect(files[0]).toMatchObject({ source: "stock", attribution: ATTRIBUTION, kind: "image", authenticity: "licensed_stock" });
  });

  it("project deletion removes files carrying the new fields", async () => {
    const t = newBackend();
    const user = await seedUser(t, { plan: "scale" });
    const userId = user.userId as Id<"users">;
    const projectId = await user.as.mutation(api.projects.create, { name: "Bakery" });
    await t.run(async (ctx) => {
      const storageId = await ctx.storage.store(new Blob([PNG]));
      await ctx.db.insert("projectFiles", {
        projectId,
        name: "a",
        storageId,
        uploadedBy: userId,
        kind: "image",
        qualityFlags: ["blurry"],
        authenticity: "owner_supplied",
        createdAt: 1,
      });
    });
    const deletion = await user.as.mutation(api.projects.remove, { id: projectId });
    for (let step = 0; step < 200; step += 1) {
      const result = await t.mutation(internal.modules.privacy.deletionJobs.processProjectDeletion, { jobId: deletion.jobId });
      if ((result as { completed?: boolean }).completed) break;
    }
    const left = await t.run((ctx) => ctx.db.query("projectFiles").collect());
    expect(left).toHaveLength(0);
  });
});
