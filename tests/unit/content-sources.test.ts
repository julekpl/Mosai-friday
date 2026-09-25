import { afterEach, describe, expect, it } from "vitest";
import { api, internal } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  MAX_SOURCES_PER_PIECE,
} from "@/convex/contentSources";
import {
  SOURCE_TEXT_MAX_CHARS,
  capSourceText,
  chunkSourceText,
  htmlToReadableText,
  packSources,
  parseSerpTranscript,
  parseYouTubeVideoId,
  rankChunks,
  sourceFileKind,
  subtitleFileToText,
  transcriptToText,
} from "@/convex/lib/sourceText";
import { newBackend, seedUser, type TestBackend } from "./helpers";
import {
  completionCalls,
  resetCompletionStub,
  stubCompletionContent,
} from "./stubs/vly-integrations";

afterEach(() => resetCompletionStub());

/**
 * Content source library: retrieval/packing (what reaches the model), the
 * provider parsers, and the authorization + deletion rules of the
 * `contentSources` functions.
 */

const paragraph = (topic: string, n: number) =>
  Array.from({ length: n }, (_, i) => `Sentence ${i} is about ${topic} and nothing else.`).join(" ");

describe("chunkSourceText", () => {
  it("keeps short text as one chunk and splits long text on paragraph boundaries", () => {
    expect(chunkSourceText("Short note.")).toEqual([{ index: 0, start: 0, text: "Short note." }]);
    const text = [paragraph("roofing", 30), paragraph("gutters", 30), paragraph("windows", 30)].join("\n");
    const chunks = chunkSourceText(text, 1_400);
    expect(chunks.length).toBeGreaterThan(2);
    for (const chunk of chunks) expect(chunk.text.length).toBeLessThanOrEqual(1_400);
    // every sentence survives chunking
    for (const topic of ["roofing", "gutters", "windows"]) {
      expect(chunks.some((chunk) => chunk.text.includes(`about ${topic}`))).toBe(true);
    }
  });
});

describe("rankChunks", () => {
  it("scores the chunk that matches the query highest", () => {
    const chunks = [
      { text: paragraph("gardening tools", 5) },
      { text: "Solar panel installation costs and payback period for homeowners." },
      { text: paragraph("baking bread", 5) },
    ];
    const scores = rankChunks(chunks, "solar panel payback");
    expect(scores.indexOf(Math.max(...scores))).toBe(1);
  });
});

describe("packSources", () => {
  const long = (topic: string, needle: string) =>
    [paragraph("background", 60), `Key fact: ${needle}.`, paragraph("filler", 60)].join("\n");

  it("passes every source in full when they fit the budget", () => {
    const packed = packSources(
      [
        { id: "a", title: "Notes", kind: "note", text: "Our warranty lasts ten years." },
        { id: "b", title: "Spec", kind: "file", text: "Panels are 420 W monocrystalline." },
      ],
      "warranty",
      10_000,
    );
    expect(packed.reports.map((r) => r.mode)).toEqual(["full", "full"]);
    expect(packed.block).toContain("Our warranty lasts ten years.");
    expect(packed.block).toContain("Panels are 420 W monocrystalline.");
    expect(packed.block).toContain('<source id="S1"');
    expect(packed.block).toContain('<source id="S2"');
  });

  it("keeps short sources whole and fills long ones with the most relevant excerpts", () => {
    const packed = packSources(
      [
        { id: "short", title: "Quote", kind: "note", text: "Customer: the install took one day." },
        { id: "big1", title: "Report", kind: "file", text: long("report", "heat pumps cut bills by 40 percent") },
        { id: "big2", title: "Transcript", kind: "youtube", text: long("video", "heat pumps work below minus 20") },
      ],
      "heat pumps bills",
      6_000,
    );
    const byId = Object.fromEntries(packed.reports.map((r) => [r.id, r]));
    expect(byId.short.mode).toBe("full");
    expect(byId.big1.mode).toBe("excerpts");
    expect(byId.big2.mode).toBe("excerpts");
    expect(byId.big1.includedChars).toBeLessThan(byId.big1.totalChars);
    // retrieval found the relevant passages inside the long sources
    expect(packed.block).toContain("heat pumps cut bills by 40 percent");
    expect(packed.block).toContain("heat pumps work below minus 20");
    expect(packed.block.length).toBeLessThanOrEqual(6_000);
  });

  it("skips empty sources and returns an empty block when nothing is given", () => {
    expect(packSources([], "x", 1_000)).toEqual({ block: "", reports: [] });
    expect(packSources([{ id: "e", title: "Empty", kind: "note", text: "   " }], "x", 1_000).reports).toEqual([]);
  });
});

describe("capSourceText", () => {
  it("normalizes whitespace and reports truncation", () => {
    expect(capSourceText("a  \t b\n\n\n\nc").text).toBe("a b\n\nc");
    const capped = capSourceText("x".repeat(SOURCE_TEXT_MAX_CHARS + 50));
    expect(capped.truncated).toBe(true);
    expect(capped.text.length).toBeLessThanOrEqual(SOURCE_TEXT_MAX_CHARS);
  });
});

describe("YouTube parsing", () => {
  it("extracts the video id from the common URL forms", () => {
    for (const url of [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42",
      "https://youtu.be/dQw4w9WgXcQ?si=abc",
      "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://www.youtube.com/shorts/dQw4w9WgXcQ",
      "https://www.youtube.com/embed/dQw4w9WgXcQ",
      "https://www.youtube.com/live/dQw4w9WgXcQ",
    ]) {
      expect(parseYouTubeVideoId(url)).toBe("dQw4w9WgXcQ");
    }
    expect(parseYouTubeVideoId("https://example.com/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(parseYouTubeVideoId("https://www.youtube.com/watch?v=short")).toBeNull();
    expect(parseYouTubeVideoId("not a url")).toBeNull();
  });

  it("turns SerpApi transcript segments into timestamped text with chapters", () => {
    const result = parseSerpTranscript({
      transcript: [
        { snippet: "Welcome to the channel", start_ms: 0 },
        { snippet: "[Music]", start_ms: 2_000 },
        { snippet: "Today we install a heat pump", start_ms: 4_000 },
        { snippet: "First, the outdoor unit", start_ms: 65_000 },
      ],
      chapters: [{ chapter: "Installation", start_ms: 60_000 }],
      available_transcripts: [{ language_name: "English", type: "asr", selected: true }],
    });
    expect(result.text).toContain("[0:00] Welcome to the channel Today we install a heat pump");
    expect(result.text).toContain("## Installation");
    expect(result.text).toContain("First, the outdoor unit");
    expect(result.text).not.toContain("[Music]");
    expect(result.kind).toBe("auto-generated captions");
    expect(result.language).toBe("English");
  });

  it("reports a missing transcript honestly instead of returning empty text", () => {
    expect(() => parseSerpTranscript({ error: "No transcript found for this video." })).toThrow(/no captions or transcript/);
    expect(() => parseSerpTranscript({ search_metadata: {} })).toThrow(/no captions or transcript/);
  });

  it("formats hour-long transcripts", () => {
    expect(transcriptToText([{ text: "late", startMs: 3_725_000 }])).toBe("[1:02:05] late");
  });
});

describe("file and page text", () => {
  it("classifies supported and unsupported file types", () => {
    expect(sourceFileKind("brief.pdf")).toBe("pdf");
    expect(sourceFileKind("brief.DOCX")).toBe("docx");
    expect(sourceFileKind("notes.md")).toBe("text");
    expect(sourceFileKind("captions.srt")).toBe("text");
    expect(sourceFileKind("page.html")).toBe("html");
    expect(sourceFileKind("old.doc")).toBe("unsupported_doc");
    expect(sourceFileKind("image.png", "image/png")).toBe("unsupported");
  });

  it("strips subtitle cue numbers and timings", () => {
    const srt = "1\n00:00:01,000 --> 00:00:02,000\nHello there\n\n2\n00:00:02,500 --> 00:00:04,000\n<i>General</i> Kenobi";
    expect(subtitleFileToText(srt).replace(/\n+/g, " ").trim()).toBe("Hello there General Kenobi");
  });

  it("keeps article text and drops navigation, scripts and footers", () => {
    const page = htmlToReadableText(`<html><head><title>Guide</title><script>steal()</script></head><body>
      <nav>Home About</nav><article><h1>Heat pumps</h1><p>They move heat.</p><ul><li><p>Efficient</p></li></ul></article>
      <footer>© 2026</footer></body></html>`);
    expect(page.title).toBe("Guide");
    expect(page.text).toBe("## Heat pumps\nThey move heat.\n- Efficient");
  });
});

/* ── Convex functions ──────────────────────────────────────────────────── */

async function setup(t: TestBackend) {
  const alice = await seedUser(t, { email: "alice@example.com" });
  const projectId = (await alice.as.mutation(api.projects.create, { name: "Heat pump installer" })) as Id<"projects">;
  const pieceId = (await alice.as.mutation(api.content.create, {
    projectId,
    title: "Heat pump guide",
    contentType: "blog",
  })) as Id<"contentPieces">;
  return { alice, projectId, pieceId };
}

describe("contentSources functions", () => {
  it("lets the owner add, list, exclude and remove sources; full text stays server-side", async () => {
    const t = newBackend();
    const { alice, pieceId } = await setup(t);
    const noteText = `Interview notes. ${"The customer wanted lower bills. ".repeat(40)}`;
    const id = await alice.as.mutation(api.contentSources.addNote, { pieceId, title: "Interview", text: noteText });

    const listed = await alice.as.query(api.contentSources.list, { pieceId });
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ title: "Interview", kind: "note", included: true });
    expect(listed[0]).not.toHaveProperty("text");
    expect(listed[0].preview.length).toBeLessThan(noteText.length);

    const forAi = await t.query(internal.contentSources.includedForPiece, { pieceId });
    expect(forAi[0].text).toBe(capSourceText(noteText).text);

    await alice.as.mutation(api.contentSources.setIncluded, { id, included: false });
    expect(await t.query(internal.contentSources.includedForPiece, { pieceId })).toEqual([]);

    await alice.as.mutation(api.contentSources.setAllIncluded, { pieceId, included: true });
    expect(await t.query(internal.contentSources.includedForPiece, { pieceId })).toHaveLength(1);

    await alice.as.mutation(api.contentSources.remove, { id });
    expect(await alice.as.query(api.contentSources.list, { pieceId })).toEqual([]);
  });

  it("refuses another tenant: no listing, no writes, no upload URL", async () => {
    const t = newBackend();
    const { alice, pieceId } = await setup(t);
    const id = await alice.as.mutation(api.contentSources.addNote, { pieceId, title: "Private", text: "Secret pricing notes for the owner." });
    const mallory = await seedUser(t, { email: "mallory@example.com" });

    expect(await mallory.as.query(api.contentSources.list, { pieceId })).toEqual([]);
    await expect(mallory.as.mutation(api.contentSources.addNote, { pieceId, title: "x", text: "injected text here" })).rejects.toThrow();
    await expect(mallory.as.mutation(api.contentSources.setIncluded, { id, included: false })).rejects.toThrow();
    await expect(mallory.as.mutation(api.contentSources.remove, { id })).rejects.toThrow();
    await expect(mallory.as.mutation(api.contentSources.generateUploadUrl, { pieceId })).rejects.toThrow();
    const rows = await t.query(internal.contentSources.includedForPiece, { pieceId });
    expect(rows).toHaveLength(1);
  });

  it("caps sources per piece and refuses a duplicate URL", async () => {
    const t = newBackend();
    const { alice, projectId, pieceId } = await setup(t);
    const base = { projectId, pieceId, userId: alice.userId as Id<"users">, kind: "web" as const, truncated: false, extraction: "test" };
    await t.mutation(internal.contentSources.insert, { ...base, title: "Page", url: "https://example.com/a", text: "Readable page text for the test." });
    await expect(
      t.mutation(internal.contentSources.insert, { ...base, title: "Page again", url: "https://example.com/a", text: "Readable page text for the test." }),
    ).rejects.toThrow(/already in the library/);
    for (let i = 1; i < MAX_SOURCES_PER_PIECE; i++) {
      await alice.as.mutation(api.contentSources.addNote, { pieceId, title: `n${i}`, text: `note number ${i}` });
    }
    await expect(alice.as.mutation(api.contentSources.addNote, { pieceId, title: "one too many", text: "overflow" })).rejects.toThrow(/can hold/);
  });

  it("deleting a piece removes its sources and its editor snapshot (regression: snapshots were orphaned)", async () => {
    const t = newBackend();
    const { alice, pieceId } = await setup(t);
    await alice.as.mutation(api.contentSources.addNote, { pieceId, title: "Notes", text: "Some notes for this piece." });
    await alice.as.mutation(api.contentPlanning.saveDoc, { pieceId, snapshot: new Uint8Array([1, 2, 3]).buffer, bodyHtml: "<p>x</p>" });

    await alice.as.mutation(api.content.remove, { id: pieceId });

    const leftovers = await t.run(async (ctx) => ({
      sources: (await ctx.db.query("contentSources").collect()).length,
      docs: (await ctx.db.query("contentDocs").collect()).length,
    }));
    expect(leftovers).toEqual({ sources: 0, docs: 0 });
  });
});

describe("sources reach the model", () => {
  it("drafts from included sources only and reports what the model read", async () => {
    resetCompletionStub();
    stubCompletionContent("<h1>Draft</h1><p>Bills fell 40% [S1].</p>");
    const t = newBackend();
    const alice = await seedUser(t, { email: "alice@example.com", plan: "scale" });
    const projectId = (await alice.as.mutation(api.projects.create, { name: "Heat pump installer" })) as Id<"projects">;
    const pieceId = (await alice.as.mutation(api.content.create, { projectId, title: "Heat pump guide", contentType: "blog" })) as Id<"contentPieces">;
    await alice.as.mutation(api.contentSources.addNote, { pieceId, title: "Survey", text: "INCLUDED-MARKER: bills fell 40 percent after install." });
    const excluded = await alice.as.mutation(api.contentSources.addNote, { pieceId, title: "Old", text: "EXCLUDED-MARKER: outdated pricing." });
    await alice.as.mutation(api.contentSources.setIncluded, { id: excluded, included: false });

    const result = await alice.as.action(api.ai.generateContent, {
      pieceId,
      options: { length: "short", instructions: "INSTRUCTION-MARKER open with the survey", citations: true },
    });
    const prompt = completionCalls[0]?.messages.map((message) => message.content).join("\n") ?? "";
    expect(prompt).toContain("INCLUDED-MARKER: bills fell 40 percent after install.");
    expect(prompt).toContain('<source id="S1" kind="note" title="Survey" scope="full text">');
    expect(prompt).toContain("INSTRUCTION-MARKER open with the survey");
    expect(prompt).toContain("Cite sources inline");
    expect(prompt).not.toContain("EXCLUDED-MARKER");
    expect(result.html).toContain("Bills fell 40%");
    expect(result.sources).toEqual([
      expect.objectContaining({ label: "S1", title: "Survey", mode: "full" }),
    ]);
  });

  it("edits a selection with the guidance note and relevant source passages", async () => {
    resetCompletionStub();
    stubCompletionContent("<p>Shorter text.</p>");
    const t = newBackend();
    const alice = await seedUser(t, { email: "alice@example.com", plan: "scale" });
    const projectId = (await alice.as.mutation(api.projects.create, { name: "Heat pump installer" })) as Id<"projects">;
    const pieceId = (await alice.as.mutation(api.content.create, { projectId, title: "Heat pump guide" })) as Id<"contentPieces">;
    await alice.as.mutation(api.contentSources.addNote, { pieceId, title: "Warranty", text: "SOURCE-MARKER: the warranty lasts ten years." });

    const inline = await alice.as.action(api.ai.editSelection, {
      pieceId,
      op: "shorten",
      selectionText: "Our warranty is long and covers many things for many years.",
      scope: "inline",
      instruction: "GUIDE-MARKER mention ten years",
    });
    const prompt = completionCalls[0]?.messages.map((message) => message.content).join("\n") ?? "";
    expect(prompt).toContain("GUIDE-MARKER mention ten years");
    expect(prompt).toContain("SOURCE-MARKER: the warranty lasts ten years.");
    expect(prompt).toContain("Shorten the selection");
    // inline scope never returns block tags that would split the paragraph
    expect(inline).toBe("Shorter text.");

    await expect(
      alice.as.action(api.ai.editSelection, { pieceId, op: "custom", selectionText: "x" }),
    ).rejects.toThrow(/Add a note/);
  });

  it("refuses a foreign caller before any model call", async () => {
    resetCompletionStub();
    const t = newBackend();
    const { pieceId } = await setup(t);
    const mallory = await seedUser(t, { email: "mallory@example.com", plan: "scale" });
    await expect(mallory.as.action(api.ai.editSelection, { pieceId, op: "rewrite", selectionText: "x" })).rejects.toThrow(/Not found/);
    await expect(mallory.as.action(api.ai.generateContent, { pieceId })).rejects.toThrow(/Not found/);
    expect(completionCalls).toHaveLength(0);
  });
});
