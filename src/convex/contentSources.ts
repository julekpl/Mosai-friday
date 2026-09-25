import { v } from "convex/values";
import { internalMutation, internalQuery, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { moduleMutation, moduleQuery } from "./guards";
import { capSourceText } from "./lib/sourceText";

/* ── Source library for a content piece ───────────────────────────────────
 *
 * Every function authorizes the piece (and through it the project) before it
 * reads or writes a source row. Imports that need the network or a parser
 * (files, web pages, YouTube transcripts, research findings) live in
 * `contentSourceImport.ts` ("use node") and write through `insert` below
 * only after the same authorization.
 */

/** Upper bound per piece: keeps generation prompts and the panel usable. */
export const MAX_SOURCES_PER_PIECE = 40;

const PREVIEW_CHARS = 280;

const kindValidator = v.union(
  v.literal("file"),
  v.literal("web"),
  v.literal("youtube"),
  v.literal("research"),
  v.literal("note"),
);

/** Source metadata plus a short preview. The full text stays on the server;
 *  the AI actions load it there. */
export const list = moduleQuery("create", {
  args: { pieceId: v.id("contentPieces") },
  handler: async (ctx, { pieceId }, access) => {
    const piece = await access.ownedRow(await ctx.db.get(pieceId));
    if (!piece) return [];
    const rows = await ctx.db
      .query("contentSources")
      .withIndex("by_piece", (q) => q.eq("pieceId", pieceId))
      .collect();
    return rows.map(({ text, ...row }) => ({
      ...row,
      preview: text.slice(0, PREVIEW_CHARS),
    }));
  },
});

export const setIncluded = moduleMutation("create", {
  args: { id: v.id("contentSources"), included: v.boolean() },
  handler: async (ctx, { id, included }, access) => {
    const row = await access.ownedRow(await ctx.db.get(id));
    if (!row) throw new Error("Not found");
    await ctx.db.patch(id, { included });
  },
});

/** Include or exclude every source of a piece at once. */
export const setAllIncluded = moduleMutation("create", {
  args: { pieceId: v.id("contentPieces"), included: v.boolean() },
  handler: async (ctx, { pieceId, included }, access) => {
    const piece = await access.ownedRow(await ctx.db.get(pieceId));
    if (!piece) throw new Error("Not found");
    const rows = await ctx.db
      .query("contentSources")
      .withIndex("by_piece", (q) => q.eq("pieceId", pieceId))
      .collect();
    for (const row of rows) {
      if (row.included !== included) await ctx.db.patch(row._id, { included });
    }
  },
});

export const remove = moduleMutation("create", {
  args: { id: v.id("contentSources") },
  handler: async (ctx, { id }, access) => {
    const row = await access.ownedRow(await ctx.db.get(id));
    if (!row) throw new Error("Not found");
    await ctx.db.delete(id);
  },
});

/** Pasted text (notes, interview answers, a brief) as a source. */
export const addNote = moduleMutation("create", {
  args: {
    pieceId: v.id("contentPieces"),
    title: v.string(),
    text: v.string(),
  },
  handler: async (ctx, { pieceId, title, text }, access) => {
    const piece = await access.ownedRow(await ctx.db.get(pieceId));
    if (!piece) throw new Error("Not found");
    const userId = await access.requireUser();
    const capped = capSourceText(text);
    if (!capped.text) throw new Error("The note is empty");
    await assertRoom(ctx, pieceId);
    return await ctx.db.insert("contentSources", {
      projectId: piece.projectId,
      pieceId,
      kind: "note",
      title: title.trim().slice(0, 200) || "Pasted note",
      text: capped.text,
      charCount: capped.text.length,
      truncated: capped.truncated,
      extraction: "Pasted by you",
      included: true,
      createdBy: userId,
      createdAt: Date.now(),
    });
  },
});

/** Upload URL for a source file. Scoped to a piece the caller can edit; the
 *  import action extracts the text and deletes the blob. */
export const generateUploadUrl = moduleMutation("create", {
  args: { pieceId: v.id("contentPieces") },
  handler: async (ctx, { pieceId }, access) => {
    const piece = await access.ownedRow(await ctx.db.get(pieceId));
    if (!piece) throw new Error("Not found");
    await assertRoom(ctx, pieceId);
    return await ctx.storage.generateUploadUrl();
  },
});

async function assertRoom(ctx: MutationCtx, pieceId: Id<"contentPieces">) {
  const rows = await ctx.db
    .query("contentSources")
    .withIndex("by_piece", (q) => q.eq("pieceId", pieceId))
    .collect();
  if (rows.length >= MAX_SOURCES_PER_PIECE) {
    throw new Error(`A piece can hold ${MAX_SOURCES_PER_PIECE} sources. Remove one first.`);
  }
}

/* ── Internal: used by the import and AI actions after authorization ──── */

export const insert = internalMutation({
  args: {
    projectId: v.id("projects"),
    pieceId: v.id("contentPieces"),
    userId: v.id("users"),
    kind: kindValidator,
    title: v.string(),
    url: v.optional(v.string()),
    provider: v.optional(v.string()),
    fileName: v.optional(v.string()),
    text: v.string(),
    truncated: v.boolean(),
    extraction: v.string(),
  },
  handler: async (ctx, { userId, ...args }) => {
    const piece = await ctx.db.get(args.pieceId);
    if (!piece || piece.projectId !== args.projectId) throw new Error("Not found");
    await assertRoom(ctx, args.pieceId);
    if (args.url) {
      const existing = await ctx.db
        .query("contentSources")
        .withIndex("by_piece", (q) => q.eq("pieceId", args.pieceId))
        .collect();
      if (existing.some((row) => row.url === args.url)) throw new Error("This source is already in the library.");
    }
    const capped = capSourceText(args.text);
    if (!capped.text) throw new Error("No readable text was found in this source");
    return await ctx.db.insert("contentSources", {
      ...args,
      title: args.title.trim().slice(0, 200) || "Untitled source",
      text: capped.text,
      charCount: capped.text.length,
      truncated: args.truncated || capped.truncated,
      included: true,
      createdBy: userId,
      createdAt: Date.now(),
    });
  },
});

/** Included sources with full text, for a piece the caller already passed
 *  authorization for (see `guards.contentGenerationReferences`). */
export const includedForPiece = internalQuery({
  args: { pieceId: v.id("contentPieces") },
  handler: async (ctx, { pieceId }) => {
    const rows = await ctx.db
      .query("contentSources")
      .withIndex("by_piece", (q) => q.eq("pieceId", pieceId))
      .collect();
    return rows
      .filter((row) => row.included)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((row) => ({
        id: row._id as string,
        kind: row.kind,
        title: row.title,
        url: row.url,
        text: row.text,
      }));
  },
});

/** Size, type and age of an uploaded blob (system table). */
export const uploadedBlob = internalQuery({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, { storageId }) => {
    const blob = await ctx.db.system.get(storageId);
    if (!blob) return null;
    return { size: blob.size, contentType: blob.contentType, createdAt: blob._creationTime };
  },
});
