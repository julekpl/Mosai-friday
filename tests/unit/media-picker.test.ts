import { describe, expect, it } from "vitest";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { emptyStarterKitPart } from "@/shared/starterKit";
import { newBackend, seedProject, seedUser, type Tenant, type TestBackend } from "./helpers";

/**
 * MD-0: the kit post picture picker. The server takes only ids and resolves
 * the picture address and credit itself.
 */

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
const ATTRIBUTION = {
  provider: "pexels" as const,
  externalId: "77",
  photographer: "Ana Baker",
  photographerUrl: "https://www.pexels.com/@ana",
  pageUrl: "https://www.pexels.com/photo/bakery-77/",
};

async function seedKit(t: TestBackend, tenant: Tenant) {
  const userId = tenant.userId as Id<"users">;
  const projectId = (await seedProject(t, tenant.userId)) as Id<"projects">;
  return await t.run(async (ctx) => {
    const now = Date.now();
    const postId = await ctx.db.insert("posts", {
      projectId,
      channel: "instagram",
      body: "Fresh bread",
      status: "draft",
      origin: "copilot",
      createdAt: now,
    });
    const posts = { ...emptyStarterKitPart(now), status: "succeeded" as const, outputs: [{ type: "posts" as const, id: postId }] };
    const kitId = await ctx.db.insert("starterKits", {
      projectId,
      requestedBy: userId,
      idempotencyKey: projectId,
      status: "succeeded",
      parts: { plan: emptyStarterKitPart(now), site: emptyStarterKitPart(now), posts },
      attempts: 1,
      budgetMicrousd: 1,
      spentMicrousd: 0,
      budgetCurrency: "USD",
      createdAt: now,
      updatedAt: now,
    });
    return { projectId, postId, kitId, userId };
  });
}

async function seedFile(
  t: TestBackend,
  projectId: Id<"projects">,
  userId: Id<"users">,
  extra: { mimeType?: string; source?: "stock"; attribution?: typeof ATTRIBUTION } = {},
) {
  return await t.run(async (ctx) => {
    const storageId = await ctx.storage.store(new Blob([PNG]));
    return await ctx.db.insert("projectFiles", {
      projectId,
      name: "bread.png",
      mimeType: extra.mimeType ?? "image/png",
      storageId,
      uploadedBy: userId,
      ...(extra.source ? { source: extra.source } : {}),
      ...(extra.attribution ? { attribution: extra.attribution } : {}),
      createdAt: Date.now(),
    });
  });
}

describe("MD-0: starterKit.setPostPicture", () => {
  it("sets the post picture from the file's stored address", async () => {
    const t = newBackend();
    const owner = await seedUser(t);
    const { projectId, postId, userId } = await seedKit(t, owner);
    const fileId = await seedFile(t, projectId, userId);
    const result = await owner.as.mutation(api.starterKit.setPostPicture, { projectId, postId, projectFileId: fileId });
    const expected = await t.run(async (ctx) => ctx.storage.getUrl((await ctx.db.get(fileId))!.storageId));
    expect(result.mediaUrl).toBe(expected);
    const post = await t.run((ctx) => ctx.db.get(postId));
    expect(post?.mediaUrl).toBe(expected);
  });

  it("refuses a caller without access", async () => {
    const t = newBackend();
    const owner = await seedUser(t);
    const stranger = await seedUser(t, { email: "s@example.test" });
    const { projectId, postId, userId } = await seedKit(t, owner);
    const fileId = await seedFile(t, projectId, userId);
    await expect(
      stranger.as.mutation(api.starterKit.setPostPicture, { projectId, postId, projectFileId: fileId }),
    ).rejects.toThrow();
    await expect(t.mutation(api.starterKit.setPostPicture, { projectId, postId, projectFileId: fileId })).rejects.toThrow();
    const post = await t.run((ctx) => ctx.db.get(postId));
    expect(post?.mediaUrl).toBeUndefined();
  });

  it("rejects a file from another project, even one the caller owns", async () => {
    const t = newBackend();
    const owner = await seedUser(t);
    const { projectId, postId, userId } = await seedKit(t, owner);
    const otherProject = (await seedProject(t, owner.userId, "Other")) as Id<"projects">;
    const foreign = await seedFile(t, otherProject, userId);
    await expect(
      owner.as.mutation(api.starterKit.setPostPicture, { projectId, postId, projectFileId: foreign }),
    ).rejects.toThrow(/Not found/);
    const post = await t.run((ctx) => ctx.db.get(postId));
    expect(post?.mediaUrl).toBeUndefined();
  });

  it("rejects a file that is not a picture, and a post outside the kit", async () => {
    const t = newBackend();
    const owner = await seedUser(t);
    const { projectId, postId, userId } = await seedKit(t, owner);
    const pdf = await seedFile(t, projectId, userId, { mimeType: "application/pdf" });
    await expect(
      owner.as.mutation(api.starterKit.setPostPicture, { projectId, postId, projectFileId: pdf }),
    ).rejects.toThrow(/not a picture/);
    const loose = await t.run((ctx) =>
      ctx.db.insert("posts", { projectId, channel: "facebook", body: "x", status: "draft", createdAt: 1 }),
    );
    const image = await seedFile(t, projectId, userId);
    await expect(
      owner.as.mutation(api.starterKit.setPostPicture, { projectId, postId: loose, projectFileId: image }),
    ).rejects.toThrow(/Not found/);
  });

  it("keeps the Pexels credit for a picked stock picture", async () => {
    const t = newBackend();
    const owner = await seedUser(t);
    const { projectId, postId, userId } = await seedKit(t, owner);
    const stock = await seedFile(t, projectId, userId, { source: "stock", attribution: ATTRIBUTION });
    await owner.as.mutation(api.starterKit.setPostPicture, { projectId, postId, projectFileId: stock });
    await owner.as.mutation(api.starterKit.setPostPicture, { projectId, postId, projectFileId: stock });
    const content = await owner.as.query(api.starterKit.content, { projectId });
    expect(content?.posts[0].attribution).toEqual({
      photographer: "Ana Baker",
      photographerUrl: ATTRIBUTION.photographerUrl,
      pageUrl: ATTRIBUTION.pageUrl,
    });
    const kit = await t.run((ctx) => ctx.db.query("starterKits").first());
    expect(kit?.parts.posts.outputs.filter((o) => o.type === "projectFiles")).toHaveLength(1);
  });
});

describe("MD-0: files.pictures", () => {
  it("lists only this project's pictures with server-resolved addresses and credit", async () => {
    const t = newBackend();
    const owner = await seedUser(t);
    const stranger = await seedUser(t, { email: "s@example.test" });
    const { projectId, userId } = await seedKit(t, owner);
    await seedFile(t, projectId, userId, { source: "stock", attribution: ATTRIBUTION });
    await seedFile(t, projectId, userId, { mimeType: "application/pdf" });
    const list = await owner.as.query(api.files.pictures, { projectId });
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ source: "stock", photographer: "Ana Baker" });
    expect(list[0].url).toMatch(/^https?:/);
    expect(await stranger.as.query(api.files.pictures, { projectId })).toEqual([]);
  });
});
