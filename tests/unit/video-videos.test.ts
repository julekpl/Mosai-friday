import { describe, expect, it } from "vitest";
import { makeFunctionReference } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { emptyComposition, type Composition } from "@/shared/video/composition";
import { newBackend, seedUser, type TestBackend } from "./helpers";

/**
 * E3.11 V1 — `modules/video/videos`: authorization, optimistic concurrency,
 * validation and deletion.
 *
 * The functions are referenced by name because the typed `api` bindings are
 * regenerated against a Convex deployment (T1.2), which this change could not
 * reach; the runtime behaviour is identical.
 */

const fn = {
  list: makeFunctionReference<"query">("modules/video/videos:list"),
  get: makeFunctionReference<"query">("modules/video/videos:get"),
  create: makeFunctionReference<"mutation">("modules/video/videos:create"),
  save: makeFunctionReference<"mutation">("modules/video/videos:save"),
  rename: makeFunctionReference<"mutation">("modules/video/videos:rename"),
  setArchived: makeFunctionReference<"mutation">("modules/video/videos:setArchived"),
  remove: makeFunctionReference<"mutation">("modules/video/videos:remove"),
};

type ProjectId = Id<"projects">;
type VideoId = Id<"videos">;

async function setup(t: TestBackend) {
  const alice = await seedUser(t, { email: "alice@example.com" });
  const projectId = (await alice.as.mutation(api.projects.create, { name: "Bakery" })) as ProjectId;
  return { alice, projectId };
}

function withScene(c: Composition, visual: Composition["scenes"][number]["visual"] = { kind: "brand_graphic", layout: "title" }): Composition {
  return {
    ...c,
    scenes: [{ id: "s1", onScreenText: "Fresh bread daily", visual, durationMs: 5_000, transitionIn: "cut" }],
  };
}

async function insertAsset(t: TestBackend, projectId: ProjectId, videoId: VideoId, userId: string) {
  return await t.run(async (ctx) => {
    const storageId = await ctx.storage.store(new Blob(["png"]));
    const assetId = await ctx.db.insert("videoAssets", {
      projectId,
      videoId,
      kind: "upload",
      storageId,
      mimeType: "image/png",
      sizeBytes: 3,
      source: { provider: "user", aiGenerated: false },
      createdBy: userId as Id<"users">,
      createdAt: Date.now(),
    });
    return { assetId, storageId };
  });
}

describe("videos — create", () => {
  it("creates a blank 5 s draft", async () => {
    const t = newBackend();
    const { alice, projectId } = await setup(t);
    const videoId = (await alice.as.mutation(fn.create, { projectId, aspect: "9:16", targetMs: 5_000 })) as VideoId;
    const result = (await alice.as.query(fn.get, { videoId })) as { video: { title: string; revision: number; status: string; composition: Composition } };
    expect(result.video.title).toBe("Untitled video");
    expect(result.video.revision).toBe(1);
    expect(result.video.status).toBe("draft");
    expect(result.video.composition).toEqual(emptyComposition("9:16", 5_000));
  });

  it("creates a video from a video script and takes its title", async () => {
    const t = newBackend();
    const { alice, projectId } = await setup(t);
    const pieceId = await alice.as.mutation(api.content.create, {
      projectId,
      title: "Morning bake",
      contentType: "video_script",
    });
    const videoId = (await alice.as.mutation(fn.create, { projectId, pieceId, aspect: "1:1", targetMs: 15_000 })) as VideoId;
    const result = (await alice.as.query(fn.get, { videoId })) as { video: { title: string; pieceId: string } };
    expect(result.video.title).toBe("Morning bake");
    expect(result.video.pieceId).toBe(pieceId);
  });

  it("refuses a piece that is not a video script", async () => {
    const t = newBackend();
    const { alice, projectId } = await setup(t);
    const pieceId = await alice.as.mutation(api.content.create, { projectId, title: "Blog", contentType: "blog" });
    await expect(
      alice.as.mutation(fn.create, { projectId, pieceId, aspect: "9:16", targetMs: 5_000 }),
    ).rejects.toThrow(/video script/);
  });

  it("refuses a length under 5 s or over 120 s", async () => {
    const t = newBackend();
    const { alice, projectId } = await setup(t);
    await expect(alice.as.mutation(fn.create, { projectId, aspect: "9:16", targetMs: 4_000 })).rejects.toThrow(/between 5 and 120/);
    await expect(alice.as.mutation(fn.create, { projectId, aspect: "9:16", targetMs: 121_000 })).rejects.toThrow(/between 5 and 120/);
  });

  it("does not accept another tenant's piece in the caller's project", async () => {
    const t = newBackend();
    const { alice, projectId: aliceProject } = await setup(t);
    const alicePiece = await alice.as.mutation(api.content.create, {
      projectId: aliceProject,
      title: "Secret",
      contentType: "video_script",
    });
    const bob = await seedUser(t, { email: "bob@example.com" });
    const bobProject = (await bob.as.mutation(api.projects.create, { name: "Bob" })) as ProjectId;
    await expect(
      bob.as.mutation(fn.create, { projectId: bobProject, pieceId: alicePiece, aspect: "9:16", targetMs: 5_000 }),
    ).rejects.toThrow(/Not found/);
  });
});

describe("videos — cross-tenant isolation", () => {
  it("a foreign organization cannot read, list, edit or delete a video", async () => {
    const t = newBackend();
    const { alice, projectId } = await setup(t);
    const videoId = (await alice.as.mutation(fn.create, { projectId, aspect: "9:16", targetMs: 5_000 })) as VideoId;
    const bob = await seedUser(t, { email: "bob@example.com" });
    await bob.as.mutation(api.projects.create, { name: "Bob" });

    expect(await bob.as.query(fn.get, { videoId })).toBeNull();
    expect(await bob.as.query(fn.list, { projectId })).toEqual([]);
    await expect(
      bob.as.mutation(fn.save, { videoId, composition: withScene(emptyComposition("9:16", 5_000)), baseRevision: 1 }),
    ).rejects.toThrow();
    await expect(bob.as.mutation(fn.rename, { videoId, title: "Mine" })).rejects.toThrow();
    await expect(bob.as.mutation(fn.remove, { videoId })).rejects.toThrow();

    const still = (await alice.as.query(fn.get, { videoId })) as { video: { title: string; revision: number } };
    expect(still.video.title).toBe("Untitled video");
    expect(still.video.revision).toBe(1);
  });

  it("a signed-out caller gets nothing", async () => {
    const t = newBackend();
    const { alice, projectId } = await setup(t);
    const videoId = (await alice.as.mutation(fn.create, { projectId, aspect: "9:16", targetMs: 5_000 })) as VideoId;
    expect(await t.query(fn.get, { videoId })).toBeNull();
    await expect(t.mutation(fn.create, { projectId, aspect: "9:16", targetMs: 5_000 })).rejects.toThrow();
  });
});

describe("videos — save", () => {
  it("bumps the revision and refuses a stale base revision", async () => {
    const t = newBackend();
    const { alice, projectId } = await setup(t);
    const videoId = (await alice.as.mutation(fn.create, { projectId, aspect: "9:16", targetMs: 5_000 })) as VideoId;
    const next = withScene(emptyComposition("9:16", 5_000));

    const first = (await alice.as.mutation(fn.save, { videoId, composition: next, baseRevision: 1 })) as { revision: number };
    expect(first.revision).toBe(2);

    await expect(
      alice.as.mutation(fn.save, { videoId, composition: { ...next, targetMs: 15_000 }, baseRevision: 1 }),
    ).rejects.toThrow(/Conflict/);
  });

  it("is a no-op when nothing changed", async () => {
    const t = newBackend();
    const { alice, projectId } = await setup(t);
    const videoId = (await alice.as.mutation(fn.create, { projectId, aspect: "9:16", targetMs: 5_000 })) as VideoId;
    const result = (await alice.as.mutation(fn.save, {
      videoId,
      composition: emptyComposition("9:16", 5_000),
      baseRevision: 1,
    })) as { revision: number };
    expect(result.revision).toBe(1);
  });

  it("rejects invalid content", async () => {
    const t = newBackend();
    const { alice, projectId } = await setup(t);
    const videoId = (await alice.as.mutation(fn.create, { projectId, aspect: "9:16", targetMs: 5_000 })) as VideoId;
    const tooWordy = withScene(emptyComposition("9:16", 5_000));
    tooWordy.scenes[0]!.onScreenText = "one two three four five six seven eight nine";
    await expect(alice.as.mutation(fn.save, { videoId, composition: tooWordy, baseRevision: 1 })).rejects.toThrow(/at most 8 words/);
  });

  it("rejects a malformed composition at the argument validator", async () => {
    const t = newBackend();
    const { alice, projectId } = await setup(t);
    const videoId = (await alice.as.mutation(fn.create, { projectId, aspect: "9:16", targetMs: 5_000 })) as VideoId;
    await expect(
      alice.as.mutation(fn.save, {
        videoId,
        composition: { ...emptyComposition("9:16", 5_000), fps: 60 },
        baseRevision: 1,
      }),
    ).rejects.toThrow();
  });

  it("accepts media of this video only", async () => {
    const t = newBackend();
    const { alice, projectId } = await setup(t);
    const videoA = (await alice.as.mutation(fn.create, { projectId, aspect: "9:16", targetMs: 5_000 })) as VideoId;
    const videoB = (await alice.as.mutation(fn.create, { projectId, aspect: "9:16", targetMs: 5_000 })) as VideoId;
    const { assetId: assetOfB } = await insertAsset(t, projectId, videoB, alice.userId);
    const { assetId: assetOfA } = await insertAsset(t, projectId, videoA, alice.userId);

    const media = (assetId: string) =>
      withScene(emptyComposition("9:16", 5_000), { kind: "upload", assetId, fit: "cover", motion: "zoom_in" });

    await expect(
      alice.as.mutation(fn.save, { videoId: videoA, composition: media(assetOfB), baseRevision: 1 }),
    ).rejects.toThrow(/missing/);
    const ok = (await alice.as.mutation(fn.save, { videoId: videoA, composition: media(assetOfA), baseRevision: 1 })) as { revision: number };
    expect(ok.revision).toBe(2);
  });

  it("refuses edits to an archived video", async () => {
    const t = newBackend();
    const { alice, projectId } = await setup(t);
    const videoId = (await alice.as.mutation(fn.create, { projectId, aspect: "9:16", targetMs: 5_000 })) as VideoId;
    await alice.as.mutation(fn.setArchived, { videoId, archived: true });
    await expect(
      alice.as.mutation(fn.save, { videoId, composition: withScene(emptyComposition("9:16", 5_000)), baseRevision: 1 }),
    ).rejects.toThrow(/Restore/);
  });
});

describe("videos — list, rename, remove", () => {
  it("lists the project's videos, newest first", async () => {
    const t = newBackend();
    const { alice, projectId } = await setup(t);
    const first = await alice.as.mutation(fn.create, { projectId, title: "First", aspect: "9:16", targetMs: 5_000 });
    const second = await alice.as.mutation(fn.create, { projectId, title: "Second", aspect: "16:9", targetMs: 30_000 });
    await alice.as.mutation(fn.rename, { videoId: first, title: "  First,   renamed " });
    const rows = (await alice.as.query(fn.list, { projectId })) as Array<{ _id: string; title: string }>;
    expect(rows.map((r) => r._id)).toEqual([first, second]);
    expect(rows[0]!.title).toBe("First, renamed");
  });

  it("remove deletes the video, its assets and their stored files", async () => {
    const t = newBackend();
    const { alice, projectId } = await setup(t);
    const videoId = (await alice.as.mutation(fn.create, { projectId, aspect: "9:16", targetMs: 5_000 })) as VideoId;
    const { storageId } = await insertAsset(t, projectId, videoId, alice.userId);

    await alice.as.mutation(fn.remove, { videoId });

    const videos = await t.run((ctx) => ctx.db.query("videos").collect());
    const assets = await t.run((ctx) => ctx.db.query("videoAssets").collect());
    const blob = await t.run((ctx) => ctx.storage.get(storageId));
    expect(videos).toEqual([]);
    expect(assets).toEqual([]);
    expect(blob).toBeNull();
  });
});
