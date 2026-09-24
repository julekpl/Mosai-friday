# Create → Video: implementation blueprint

**Status:** `not started`. Blueprint ready for ticketing; blocked on the owner
decisions in §0 only for the tickets marked ⚑.
**Decided 24 Sep 2026 (owner):** the MVP renders the final video **in the
user's browser** with `@remotion/web-renderer`. No AWS, no render server. A
server renderer (Vercel Sandbox preferred) is a later ticket (V5b). See §1.1.
**Decided 24 Sep 2026 (owner):** the MVP is **silent** (no voiceover, no
music, no audio track), must support videos **as short as 5 seconds**, and
**export time is not a success criterion**.
**Written:** 24 September 2026 against the working tree on
`claude/nice-cerf-n78iit` (post T2.4). Re-find symbols with `rg -n` if files
have moved.
**Replaces:** the earlier `CREATE-VIDEO-PROPOSAL.md` (same research, now turned
into an implementation plan).
**Rules:** `AGENTS.md` wins on security and truth; each ticket in §13 wins on
scope. Prices are list prices seen on 24 Sep 2026; re-check before any money
decision.

---

## 0. Decisions this blueprint assumes

The tickets that need nothing from the owner (V1–V3, and V5 once V4 is in) can start now. The ⚑
tickets wait for these answers. The default is what gets built if the owner
agrees; the alternative is what changes if not.

| # | Decision ⚑ | Default in this blueprint | If the owner chooses otherwise |
|---|---|---|---|
| D1 | Renderer | ✅ **Decided: browser rendering** (`@remotion/web-renderer`) for the MVP. Later server renderer for background renders and Promote hand-off: **Vercel Sandbox** (`@remotion/vercel`) | Remotion Lambda (AWS) or Shotstack behind the same `RenderProvider` interface (§9.5). Google Cloud Run is excluded (Remotion lists it as alpha, not actively developed) |
| D1a | Remotion licence tier | ✅ **Decided: free licence** (the organization is 1 person, 24 Sep 2026; free covers up to 3) | Buy a Company License before the team reaches 4 people; the licence applies to browser rendering too |
| D2 | Voice provider (after the MVP; the MVP is silent) | **ElevenLabs** `with-timestamps` | Any TTS that returns word/char timings; otherwise add a forced-alignment step |
| D3 | AI clip provider | **OpenRouter video API** (`/api/v1/videos`) using the existing `OPENROUTER_API_KEY` | Direct Gemini (Veo) adapter behind the same interface |
| D4 | Who pays for AI clips and TTS | Off by default; small monthly allowance on paid plans; hard per-organization budget | Pass-through top-up (needs T2.4 metered billing) |
| D5 | AI disclosure on the video | Metadata always + platform AI label via Promote; on-video text only if legal asks | Add an end card or corner label (a composition style flag) |
| D6 | Stock attribution | ✅ **Decided: no credit in the video or the post** (24 Sep 2026). Two things stay because Pexels' API guidelines require them: a visible "Photos and videos provided by Pexels" link in the stock picker UI whenever search results are shown, and the photographer credit stored per asset (not displayed). Consequence: the app stays on Pexels' default limits, **200 requests/hour and 20,000/month for the whole app**, shared by all users | Showing credit would let us request unlimited free quota |

---

## 1. Outcome and scope

**Outcome.** A Create user turns a saved `video_script` piece into a short,
on-brand MP4 (15–120 s; 9:16, 1:1, 16:9) with voiceover and captions, edits it in
a simple scene editor, renders it with an honest job status, and hands it to
Promote by reference.

**In scope (V1–V6):** storyboard agent, scene editor, live preview, uploads,
brand graphics, stock, voiceover, captions, music bed, server render, download,
Promote hand-off, optional AI clips with spend control.

**Out of scope (deferred, §13 V7+):** multi-track timeline or keyframes
("Advanced edit", OpenReel as reference), editing raw phone footage ("Rough
cut", OpenStoryline as reference), avatars, voice cloning, dubbing, music
generation.

**Principle.** The LLM writes and plans; a deterministic renderer draws. The
same JSON composition and the same React components drive the preview and the
export, so what the user previews is what renders.

### 1.1 MVP (what ships first)

**Loop:** saved video script → pick a length (5, 15, 30 or 60 s) → AI
storyboard → edit scenes → **export a silent MP4 in the browser** → download
(and keep a copy in the project).

The MVP video is a **text-led, silent** video: each scene is a visual (brand
graphic, upload or stock) with on-screen text taken from the script. This is
the common format for social feeds, where most video autoplays muted.

| In the MVP | Later |
|---|---|
| Length presets 5 / 15 / 30 / 60 s (custom 5–120 s); a 5 s video is 1–3 scenes | |
| Storyboard agent: condenses the script into on-screen text, with a grounding check (§7.1) and a fallback | "Rewrite scene with AI" |
| Edit text, set scene duration, reorder, add/delete scenes, pick visual, aspect (9:16, 1:1, 16:9), one style preset, live preview | Split/merge, more presets |
| Visuals: uploads, brand graphics, Pexels stock (stock audio stripped) | AI images, AI clips (V6) |
| **No audio at all** | Voiceover, word-timed captions, WebVTT, music bed (V4b) |
| Browser export (muted MP4) → download + saved as a project asset | Server render with receipt (V5b), Promote hand-off, disclosure end card |

**Tickets:** V0 (reduced), V1, V2, V3, V4 (stock only), V5 (browser export).
Roughly **10–14 working days** (estimate). Owner inputs still needed: a
`PEXELS_API_KEY` set on the Convex deployment (the owner has a key; D6 and
D1a are decided). **Not needed for the
MVP:** D2 voice, ElevenLabs key, voiceover cap, D3/D4 clip decisions, D5
beyond a metadata flag.

**Done when:**
- a user with a video script exports and downloads a **5 s** silent MP4 and a
  60 s one, in each aspect, in a supported browser (export duration is not
  measured; it only has to finish, and it may run in a background tab);
- every on-screen line passes the grounding check or was written by the user;
- no success state is shown without a real stored file;
- cross-tenant and truth tests are green and axe is clean;
- without a Pexels key, stock shows `needs_setup` and uploads plus brand
  graphics still work.

---

## 2. Architecture

```
Browser (Create → Videos tab)                       Convex (module: create)
┌───────────────────────────────┐   queries/     ┌──────────────────────────────────────┐
│ VideoStudio                   │   mutations    │ modules/video/videos.ts   CRUD, save  │
│  SceneList · SceneCard        │ ─────────────▶ │ modules/video/storyboard.ts  LLM      │
│  VisualPicker · StylePanel    │                │ modules/video/assets.ts  upload/stock │
│  LengthPicker · ExportPanel   │ ◀───────────── │ modules/video/voice.ts   TTS          │
│  PreviewPlayer (@remotion/    │   live rows    │ modules/video/clips.ts   AI clip jobs │
│   player, lazy-loaded)        │                │ modules/video/renders.ts render jobs  │
└──────────────┬────────────────┘                │ http.ts  /api/video/* webhooks        │
               │ imports                         │ lib/modelGateway.ts (+ video, speech) │
┌──────────────▼────────────────┐                └───────┬───────────┬──────────┬────────┘
│ src/shared/video/             │  same code             │           │          │
│  composition.ts (schema,      │◀──────────┐            │           │          │
│   validate, timing, captions) │           │     OpenRouter    ElevenLabs   Pexels
│ src/video/remotion/           │           │     (LLM + video)  (TTS)       (stock)
│  MosaiVideo · scenes ·        │           │
│  captions                     │           └── later (V5b): Vercel Sandbox server render
└──────────────┬────────────────┘
               │ MVP export: renderMediaOnWeb() in the user's tab (WebCodecs)
               ▼
   MP4 Blob ──▶ download to the user's device
            └─▶ upload to Convex storage as a `render` asset (assets.attachExport)
```

### 2.1 File map

| Path | New/changed | Owner in `CONVEX_FILE_OWNERS` |
|---|---|---|
| `src/shared/video/composition.ts` | new: types, Convex validator, `validateComposition`, `compositionHash` | n/a (shared, pure) |
| `src/shared/video/timing.ts` | new: pacing, duration estimate, char→word timings, scene split | n/a |
| `src/shared/video/captions.ts` | new: word groups, WebVTT builder | n/a |
| `src/convex/modules/video/videos.ts` | new | `"modules/video/videos": "create"` |
| `src/convex/modules/video/storyboard.ts` (`"use node"`) | new | `"create"` |
| `src/convex/modules/video/assets.ts` | new | `"create"` |
| `src/convex/modules/video/voice.ts` (`"use node"`) | new | `"create"` |
| `src/convex/modules/video/clips.ts` (`"use node"`) | new | `"create"` |
| `src/convex/modules/video/renders.ts` (`"use node"`) | **later (V5b)**: server renders | `"create"` |
| `src/convex/modules/video/jobs.ts` | new: internal state machine mutations | `"internal"` |
| `src/convex/modules/video/agents/storyboard.prompt.v1.ts` | new | `"internal"` |
| `src/convex/modules/video/providers/{openrouterVideo,elevenlabs,pexels,remotion}.ts` | new adapters | `"internal"` |
| `src/convex/lib/modelGateway.ts` | changed: `modelGenerateVideo`, `modelSynthesizeSpeech` | `"internal"` (existing) |
| `src/convex/schema.ts` | changed: 4 tables, `aiRuns` additive fields | n/a |
| `src/convex/lib/dataRegistry.ts` | changed: 4 entries | n/a |
| `src/convex/lib/capabilities.ts` | changed: `create` gains `spend`; file owners | n/a |
| `src/convex/http.ts` | changed: 2 routes | n/a |
| `src/convex/crons.ts` | changed: stuck-job sweep | n/a |
| `src/video/remotion/*` | new: `MosaiVideo` composition and scene components, used by the preview and by `renderMediaOnWeb` (and later by the server renderer) | n/a |
| `src/components/create/video/*` | new: editor UI | n/a |
| `src/pages/app/Create.tsx` | changed: add "Videos" tab + "Make video" action only (extract, don't grow) | n/a |

Module independence (rule 10): everything lives in `modules/video/` and
`src/shared/video/`. The only cross-module reads are the Create module's own
`contentPieces`/`contentDocs` (same module) and brand kit through its canonical
reference once E3.1 exists. Promote receives `{ type: "video", id }` and reads
through a published contract query, never the tables.

---

## 3. Data model (additive)

Add to `src/convex/schema.ts`. All four tables are project-scoped and cascade
with the project. **The MVP creates two:** `videos` and `videoAssets`.
`videoClipJobs` arrives with V6 and `videoRenders` with V5b.

```ts
const videoStatus = v.union(v.literal("draft"), v.literal("ready"), v.literal("archived"));
const jobStatus = v.union(
  v.literal("queued"), v.literal("running"), v.literal("waiting_for_user"),
  v.literal("succeeded"), v.literal("partially_succeeded"),
  v.literal("failed"), v.literal("canceled"),
);

videos: defineTable({
  projectId: v.id("projects"),
  pieceId: v.optional(v.id("contentPieces")),
  title: v.string(),
  composition: compositionValidator,          // §4, from src/shared/video
  compositionHash: v.string(),                // sha-256 of canonical JSON
  revision: v.number(),                       // optimistic concurrency
  status: videoStatus,
  storyboardStatus: v.optional(jobStatus),    // LLM step state
  containsSyntheticMedia: v.boolean(),        // derived on every save
  createdBy: v.id("users"),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_project", ["projectId"])
  .index("by_piece", ["pieceId"]),

videoAssets: defineTable({
  projectId: v.id("projects"),
  videoId: v.optional(v.id("videos")),        // unset = project library asset
  kind: v.union(
    v.literal("upload"), v.literal("stock"), v.literal("ai_image"),
    v.literal("ai_clip"), v.literal("voiceover"), v.literal("music"),
    v.literal("render"), v.literal("captions"),
  ),
  storageId: v.id("_storage"),
  mimeType: v.string(),
  sizeBytes: v.number(),
  sha256: v.string(),
  durationMs: v.optional(v.number()),
  width: v.optional(v.number()),
  height: v.optional(v.number()),
  source: v.object({
    provider: v.string(),                     // user | pexels | openrouter:<model> | elevenlabs | remotion
    externalId: v.optional(v.string()),
    license: v.optional(v.string()),
    attribution: v.optional(v.string()),
    aiGenerated: v.boolean(),
    model: v.optional(v.string()),
    aiRunId: v.optional(v.id("aiRuns")),
  }),
  wordTimings: v.optional(v.array(v.object({ word: v.string(), startMs: v.number(), endMs: v.number() }))),
  // Browser exports (kind "render"): which composition and renderer produced
  // the file. Recorded as claimed by the client, not verified (see §10).
  compositionHash: v.optional(v.string()),
  rendererVersion: v.optional(v.string()),   // e.g. "web-renderer@4.0.528+mosai-video-v1"
  createdBy: v.id("users"),
  createdAt: v.number(),
})
  .index("by_project", ["projectId"])
  .index("by_video", ["videoId"]),

videoClipJobs: defineTable({
  projectId: v.id("projects"),
  videoId: v.id("videos"),
  sceneId: v.string(),
  status: jobStatus,
  idempotencyKey: v.string(),                 // hash(videoId, sceneId, prompt, model, duration, seed)
  model: v.string(),
  prompt: v.string(),
  durationS: v.number(),
  estimateMicrousd: v.number(),
  approvedBy: v.id("users"),
  approvalId: v.optional(v.string()),         // T2.12 approval record once it exists
  providerJobId: v.optional(v.string()),
  pollCount: v.number(),
  nextPollAt: v.optional(v.number()),
  resultAssetId: v.optional(v.id("videoAssets")),
  costMicrousd: v.optional(v.number()),
  aiRunId: v.optional(v.id("aiRuns")),
  error: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_project", ["projectId"])
  .index("by_video", ["videoId"])
  .index("by_idempotency", ["idempotencyKey"])
  .index("by_status_next_poll", ["status", "nextPollAt"]),

// Later (V5b, server rendering). Not created in the MVP: browser exports are
// stored as `videoAssets` rows with kind "render" (see below).
videoRenders: defineTable({
  projectId: v.id("projects"),
  videoId: v.id("videos"),
  status: jobStatus,
  compositionHash: v.string(),
  compositionSnapshot: compositionValidator,  // frozen copy; edits never change a running render
  rendererVersion: v.string(),                // deployed Remotion site name
  idempotencyKey: v.string(),                 // hash(videoId, compositionHash, rendererVersion)
  provider: v.union(v.literal("vercel_sandbox"), v.literal("remotion_lambda")),
  providerRenderId: v.optional(v.string()),
  providerBucket: v.optional(v.string()),
  progress: v.optional(v.number()),           // 0..1, display only
  outputAssetId: v.optional(v.id("videoAssets")),
  captionsAssetId: v.optional(v.id("videoAssets")),
  receipt: v.optional(v.object({              // written only by server code on verified success
    renderId: v.string(), outKey: v.string(), sha256: v.string(),
    sizeBytes: v.number(), verifiedAt: v.number(),
  })),
  costMicrousd: v.optional(v.number()),
  error: v.optional(v.string()),
  requestedBy: v.id("users"),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_project", ["projectId"])
  .index("by_video", ["videoId"])
  .index("by_idempotency", ["idempotencyKey"])
  .index("by_status", ["status"]),
```

**`aiRuns` (additive):** widen `provider` with `v.literal("elevenlabs")`; add
optional `modality: "text" | "speech" | "video"` and optional
`units: { characters?: number; seconds?: number }`. Old rows stay valid.

**Registry (`lib/dataRegistry.ts`), using the existing `project()` helper:**

```ts
videos: project("modules/video: moduleQuery/moduleMutation(\"create\") + access.ownedRow"),
videoAssets: project("modules/video: parent video/project ownership"),
videoClipJobs: project("modules/video: parent video ownership", "excluded"),
videoRenders: project("modules/video: parent video ownership"),
// V4: shared Pexels search cache (no user data: query text, result ids, thumbnails)
stockSearchCache: global("modules/video/assets.searchStock only", "Search results expire after 24 h and are swept", true),
```

`stockSearchCache` (V4): `{ key: string /* provider:orientation:normalized query */,
results: StockHit[], fetchedAt: number, expiresAt: number }`, index `by_key`
and `by_expires`; the daily cron deletes expired rows.

Deletion must also delete each row's `_storage` blobs. Extend the project
cascade with a storage hook for `videoAssets.storageId` (the registry audit
fails today if a table is missing, not if blobs leak, so V1 adds a test for it).

**Migration:** none. New tables only; `aiRuns` change is a union widening plus
optional fields. Rollback note: drop the four tables after a project export;
`aiRuns` rows with `provider: "elevenlabs"` would need the union kept.

---

## 4. Composition model (`src/shared/video/composition.ts`)

One versioned document is the source of truth for preview and render. Pure
TypeScript, no Convex or React imports, so the Remotion site, the browser and
Convex all import it.

```ts
export const COMPOSITION_VERSION = 1;
export const LIMITS = { minScenes: 1, maxScenes: 20,
  minTotalMs: 5_000, maxTotalMs: 120_000,
  minSceneMs: 1_500, maxSceneMs: 20_000, maxOnScreenWords: 8 } as const;
export const LENGTH_PRESETS_MS = [5_000, 15_000, 30_000, 60_000] as const;
// Readability for silent video: ~0.4 s per on-screen word + 1 s to notice,
// so an 8-word line needs ~4.2 s and a 3-word line ~2.2 s.
export const readMsFor = (words: number) => 1_000 + words * 400;

export type Aspect = "9:16" | "1:1" | "16:9";
export const DIMENSIONS: Record<Aspect, { width: number; height: number }> = {
  "9:16": { width: 1080, height: 1920 },
  "1:1": { width: 1080, height: 1080 },
  "16:9": { width: 1920, height: 1080 },
};

export type Visual =
  | { kind: "brand_graphic"; layout: "title" | "list" | "quote" | "cta" }
  | { kind: "upload" | "stock" | "ai_image" | "ai_clip"; assetId: string;
      fit: "cover" | "contain"; motion: "none" | "ken_burns_in" | "ken_burns_out" };

export type Scene = {
  id: string;                      // stable uuid, never reused
  narration?: string;              // spoken text (only once voice exists, V4b)
  onScreenText: string;            // MVP: the scene's message; "" allowed for a pure visual
  visual: Visual | null;           // null = incomplete (partial state)
  durationMs: number;              // MVP: user-set or from LENGTH preset; later from voiceover
  transitionIn: "cut" | "fade" | "slide";
};

export type Composition = {
  version: 1;
  aspect: Aspect;
  fps: 30;
  style: { presetId: "clean" | "bold" | "minimal"; primaryColor: string;
           fontFamily: string; logoAssetId?: string };
  voice?: { voiceId: string; assetId?: string };      // assetId = full voiceover track
  music?: { assetId: string; gainDb: number; duckUnderVoice: boolean };
  targetMs: number;                                   // chosen length (5–120 s)
  captions: { style: "bold_word" | "line" | "off" };  // MVP: always "off" (no voice)
  disclosure: { endCard: boolean };                   // D5
  scenes: Scene[];
};
```

Exports: `compositionValidator` (Convex `v.object` mirror; a unit test asserts
the TS type and validator accept the same fixtures), `validateComposition(c):
Issue[]` (limits, unique ids, colour is a token-safe hex from the brand kit,
every referenced asset id present, total between `minTotalMs` and
`maxTotalMs`), `isRenderable(c)` (no `null` visuals; each scene at least
`readMsFor(words)` long, so no line flashes by unreadably),
`fitToTarget(c)` (scales scene durations proportionally to `targetMs`,
respecting the per-scene minimum; used when the user changes the length), `totalDurationMs(c)`, `compositionHash(c)` (sha-256 of
key-sorted JSON).

`primaryColor` is data from the user's brand kit, rendered inside the video
only; the app UI still uses tokens only (rule 15).

---

## 5. Backend functions

All public functions use the existing builders. Node files (`"use node"`)
cannot use `moduleAction`, so they call `requireActionCapability` first, the
same way `ai.ts` does today.

### 5.1 `modules/video/videos.ts`

| Function | Builder / capability | Behaviour |
|---|---|---|
| `list({ projectId })` | `moduleQuery("create")` → `create.view` | `access.ownedProject`; rows by `by_project`, newest first |
| `get({ videoId })` | `create.view` | `access.ownedRow`; returns video + its assets + latest render + clip jobs |
| `createFromPiece({ pieceId, aspect })` | `moduleMutation("create")` → `create.edit` | piece must be owned and `contentType === "video_script"`; inserts draft with `scenes: []`, `storyboardStatus: "queued"`; schedules `storyboard.generate` |
| `save({ videoId, composition, baseRevision })` | `create.edit` | rejects when `baseRevision !== revision` (conflict → client reloads); runs `validateComposition`; recomputes hash, `containsSyntheticMedia`; **never touches status fields owned by jobs** |
| `archive / remove({ videoId })` | `create.edit` | remove cascades assets + blobs + jobs; refuses while a render is `running` (cancel first) |
| `forPromote({ videoId })` | `promote.view` (contract query) | returns `{ title, renderReceipt, url, containsSyntheticMedia, captionsUrl }` only for a `succeeded` render |

### 5.2 `modules/video/storyboard.ts` (`"use node"`)

| Function | Capability | Behaviour |
|---|---|---|
| `generate({ videoId })` | `create.edit` | loads piece body server-side (`contentDocs` snapshot else `body`), persona, brand kit; never accepts script text from the client (rule 3); `consumeAiQuotaForAction`; calls gateway with agent `create.video_storyboard`; validates (§7); writes scenes with estimated durations; sets `storyboardStatus` |
| `rewriteScene({ videoId, sceneId, instruction })` | `create.edit` | agent `create.video_scene_rewrite`; returns a proposed scene; client applies it via `save` (user stays in control) |

### 5.3 `modules/video/assets.ts`

| Function | Capability | Behaviour |
|---|---|---|
| `generateUploadUrl({ projectId })` | `create.edit` | ownership checked (unlike the legacy `files.generateUploadUrl`) |
| `attachUpload({ videoId, storageId, name })` | `create.edit` | reads `_storage` system row: MIME allow-list `video/mp4, video/quicktime, video/webm, image/jpeg, image/png, image/webp, audio/mpeg, audio/wav`; max 200 MB video, 20 MB image; deletes the blob and throws on violation; stores `sha256` from the system row |
| `searchStock({ videoId, query, orientation })` | `create.edit` | Pexels video/photo search by fixed host with the server key; returns ids, thumbnails, credit; `needs_setup` if no key. **Shared quota protection** (D6 keeps the default 200/h, 20k/month for the whole app): cache results per normalized query + orientation for 24 h in a small `stockSearchCache` table (global scope, ephemeral, registered); a per-user limit of 30 searches/hour; when Pexels returns 429 or the hourly budget is used up, stock shows `rate_limited` with the reset time and uploads/brand graphics keep working |
| `importStock({ videoId, provider: "pexels", externalId })` | `create.edit` | re-fetches the item **by id** server-side (never trusts a client URL), downloads the chosen rendition via `safeFetch`, stores blob + attribution |

### 5.4 `modules/video/voice.ts` (`"use node"`), later (V4b, not in the silent MVP)

`generateVoiceover({ videoId, voiceId })`, capability `create.edit` (and the
TTS budget check, §11):

1. Join scene narrations with `\n\n`; remember each scene's character range.
2. Gateway `modelSynthesizeSpeech` → ElevenLabs
   `POST /v1/text-to-speech/{voice_id}/with-timestamps` (one call keeps prosody
   consistent across scenes); `aiRuns` row with `units.characters` and cost.
3. Store the MP3 as a `voiceover` asset; convert character alignment to
   `wordTimings` (`shared/video/timing.ts`).
4. Set each scene's `durationMs` = its speech span + 250 ms padding, clamped to
   `LIMITS`; save with a new revision.

`listVoices()` returns a curated static list (no cloned voices, §10).

### 5.5 `modules/video/clips.ts` (`"use node"`) ⚑ D3, D4

| Function | Capability | Behaviour |
|---|---|---|
| `quoteClip({ videoId, sceneId, model, durationS })` | `create.edit` | price from the model allow-list (§6.1) → `estimateMicrousd`; budget remaining |
| `requestClip({ videoId, sceneId, prompt, model, durationS, quoteToken })` | **`create.spend`** (owner role) | validates the quote token (HMAC of the quote, 10 min TTL) so the user saw the price; budget check; inserts `videoClipJobs` (`queued`) keyed by `idempotencyKey`, returning the existing row on repeat; schedules `submit` |
| internal `submit({ jobId })` | n/a | gateway `modelGenerateVideo.submit` → OpenRouter `POST /api/v1/videos` `{ model, prompt, duration, aspect_ratio, resolution, callback_url }`; stores `providerJobId`; `running`; schedules `poll` at +30 s |
| internal `poll({ jobId })` | n/a | `GET /api/v1/videos/{id}`: `pending/in_progress` → reschedule with backoff (30 s → 2 min, max 40 polls); `completed` → `GET /api/v1/videos/{id}/content?index=0` with auth, store blob, create `ai_clip` asset (`aiGenerated: true`), record `usage.cost` → `costMicrousd`, `succeeded`; `failed/cancelled/expired` → `failed` with reason |
| `cancelClip({ jobId })` | `create.edit` | only while `queued`; a running provider job is left to finish (cost may still accrue; UI says so) |

The OpenRouter `callback_url` points at `/api/video/clip-callback/<jobId>`. We do
not rely on the callback body: it only schedules an immediate `poll`, and the
state comes from the authenticated status read.

### 5.6 Export (MVP: browser rendering)

There is no server render job in the MVP. The browser renders; the server only
stores the result.

| Function | Capability | Behaviour |
|---|---|---|
| `assets.exportUploadUrl({ videoId })` | `create.edit` | ownership checked; returns a Convex upload URL |
| `assets.attachExport({ videoId, storageId, compositionHash, rendererVersion })` | `create.edit` | reads the `_storage` system row: MIME must be `video/mp4`, size ≤ 300 MB; stores a `videoAssets` row, kind `render`, `source.provider: "browser_export"`, `aiGenerated` copied from the video; (from V4b) builds the WebVTT from `wordTimings` server-side and stores it as a `captions` asset; sets video `status: "ready"`. Replaces the previous export of the same video (old blob deleted) |

The export itself runs in `src/components/create/video/useBrowserExport.ts`
(§9.2). The downloaded file never depends on the upload: if the upload fails,
the user still has the MP4 and the UI says "Saved on this device; not saved to
the project" with a retry.

### 5.6b `modules/video/renders.ts` (`"use node"`), later (V5b)

Server rendering on Vercel Sandbox for renders that must finish after the tab
closes, and for the Promote hand-off with a receipt. Same job pattern as below;
the provider calls become `renderMediaOnVercel({ detached: true })` +
`getRenderProgress()` polling (no signed webhook needed), output read from Vercel
Blob. The table below is written for that ticket.

| Function | Capability | Behaviour |
|---|---|---|
| `requestRender({ videoId })` | `create.edit` | `isRenderable` or throw with the issues; idempotent on `(videoId, compositionHash, rendererVersion)`; snapshot composition; `queued`; schedules `submit` |
| internal `submit({ renderId })` | n/a | builds `inputProps` = snapshot + short-lived asset URLs (`ctx.storage.getUrl`); starts a detached render through the `RenderProvider` (§9.5); stores `providerRenderId`; `running`; schedules `poll` at +30 s |
| internal `poll({ renderId })` | n/a | `getRenderProgress`; updates `progress`; on done → `finalize`; on fatal error → `failed`; reschedules with backoff |
| internal `finalize({ renderId })` | n/a | downloads the output from the provider's storage, computes sha-256, stores blob as `render` asset, builds WebVTT from `wordTimings` as `captions` asset, writes `receipt`, sets `succeeded`, sets video `status: "ready"`. **Only path that writes `succeeded`.** |
| `cancelRender({ renderId })` | `create.edit` | marks `canceled`; late webhook for a canceled render is ignored |

### 5.7 State machine (`modules/video/jobs.ts`)

One pure `canTransition(from, to)` used by every internal mutation. Allowed:
`queued→running|canceled|failed`, `running→succeeded|failed|canceled|waiting_for_user`,
`waiting_for_user→running|canceled`. Terminal states never change. Every
transition writes `updatedAt`; a duplicate webhook or poll is a no-op.

### 5.8 HTTP routes (`src/convex/http.ts`)

| Route | Verification | Effect |
|---|---|---|
| `POST /api/video/render-webhook` (only if V5b uses Lambda; Vercel Sandbox is polled) | `validateWebhookSignature` with `REMOTION_WEBHOOK_SECRET` over the parsed body and `X-Remotion-Signature`; reject `X-Remotion-Mode: demo` in production | looks up the render by `renderId` in the payload; `success` → schedule `finalize`; `error/timeout` → `failed` with the provider message |
| `POST /api/video/clip-callback/:jobId` | none trusted (body ignored); rate-limited by job | schedules `poll({ jobId })` now |

### 5.9 Cron (`src/convex/crons.ts`)

Every 5 min (from V5b/V6): `running` renders older than 20 min → `poll`; clip jobs whose
`nextPollAt` is past → `poll`; `queued` older than 10 min → re-`submit`
(idempotent). Daily: delete `videoAssets` with no `videoId` reference older
than 30 days that are not library uploads.

---

## 6. Gateway changes (`src/convex/lib/modelGateway.ts`)

AI calls keep going through one gateway (rule 11). Add two functions beside
`modelComplete`, sharing `startAiRun` / `finishAiRun`:

```ts
modelSynthesizeSpeech(req: {
  ctx, userId, projectId, agentId: "create.video_voiceover", promptVersion,
  voiceId: string, text: string, modelId: "eleven_multilingual_v2" | "eleven_flash_v2_5",
}): Promise<{ audio: Uint8Array; alignment: CharAlignment; usage: ProviderUsage }>

modelGenerateVideo: {
  submit(req: { ctx, userId, projectId, agentId: "create.video_clip", promptVersion,
    model: AllowedVideoModel, prompt: string, durationS: number,
    aspect: Aspect, resolution: "720p" | "1080p", callbackUrl: string,
    idempotencyKey: string }): Promise<{ providerJobId: string; runId: Id<"aiRuns"> }>;
  status(providerJobId: string): Promise<"pending" | "in_progress" | "completed" | "failed" | "cancelled" | "expired">;
  download(providerJobId: string): Promise<{ bytes: Uint8Array; costMicrousd: number | null }>;
}
```

### 6.1 Model allow-list

Feature code may only name models in `VIDEO_MODELS` (a typed constant). Each
entry records `id`, `label`, `maxUsdPerSecond` (a ceiling used for the quote
and the budget check), supported durations and aspects. V6 fills it from
`GET /api/v1/videos/models` (`pricing_skus`, `supported_durations`,
`supported_aspect_ratios`) at ticket time, with owner sign-off on the list.
The actual cost recorded is the provider's `usage.cost`; the ceiling only
guards the budget. A model whose live price exceeds its ceiling is refused.

---

## 7. LLM agents

Prompts live in `modules/video/agents/<agent>.prompt.v1.ts` (the T2.11
convention); `promptVersion` is written to every `aiRuns` row.

### 7.1 `create.video_storyboard`

- **Input (server-built):** script text stripped to plain text with section
  headings and `[b-roll]` notes kept as hints; persona summary; brand voice;
  target length chosen by the user (5–120 s); aspect. Script, research and
  notes are wrapped as untrusted data (rule 4).
- **Scene budget:** the server computes the allowed scene count from the target
  before calling the model: 5 s → 1–3 scenes, 15 s → 2–5, 30 s → 3–8,
  60 s → 5–12. For short targets the model **condenses**: it picks the hook and
  the call to action and drops the rest.
- **Output (MVP, silent):** JSON only: `{ scenes: [{ onScreenText, visualIntent,
  suggestedVisual: "brand_graphic"|"upload"|"stock"|"ai_image"|"ai_clip",
  layout?, stockQuery?, transitionIn }] }`.
- **Validators (`validateOutput`):**
  1. **Grounding** (replaces the fidelity check while the MVP is silent,
     because a 5 s video cannot carry the whole script): every on-screen line's
     content words (stop words removed, stemmed) must appear in the script at
     ≥ 70 % overlap, and numbers, prices, percentages and proper nouns must
     appear in the script verbatim. The model may shorten; it may not add
     claims. When voice arrives (V4b), the narration fidelity check (≥ 0.9
     similarity to the script's spoken lines) is added back for narration.
  2. Pacing: scene count within the budget; each scene ≥ `readMsFor(words)`;
     durations sum to the target (then `fitToTarget`).
  3. `onScreenText` ≤ 8 words; 1–20 scenes; enums only.
  4. `stockQuery`: ≤ 6 plain words, no URLs, no punctuation beyond spaces.
  5. `suggestedVisual: "ai_clip"` is only a suggestion; it never triggers spend.
- **On failure:** one retry with the validator message appended; then
  `storyboardStatus: "failed"` and the UI offers a deterministic fallback:
  the script's first heading or sentence (hook) and its CTA section as two
  brand-graphic scenes, trimmed to 8 words each and fitted to the target. The
  user can then edit freely; user-written text skips the grounding check.

### 7.2 `create.video_scene_rewrite` and `create.video_clip_prompt`

Same pattern, single scene. The clip prompt is shown and editable before the
price quote; the user's final text is what is sent.

### 7.3 Evaluation (T2.11 once present, a fixture test until then)

Ten fixture scripts (short/long, list-heavy, CTA-heavy, non-English): fidelity
≥ 0.9, pacing in range, zero invalid enums. Recorded model responses so CI does
not call a provider.

---

## 8. Frontend

### 8.1 Placement

`Create.tsx` is 1,177 lines: add only a fourth tab (`gaps · topics · content ·
videos`) and a **Make video** button on `video_script` pieces. Everything else
lives in `src/components/create/video/`:

| Component | Job |
|---|---|
| `VideosTab.tsx` | list of videos (status via `StatusBadge`; MVP exports labelled "Exported on this device"; `ReceiptBadge` only for V5b server renders), empty state linking to "write a video script" |
| `VideoStudio.tsx` | three-pane layout: scenes · preview · settings; stacks on mobile |
| `SceneList.tsx` / `SceneCard.tsx` | narration + on-screen text fields, visual thumbnail, duration, move up/down buttons (keyboard), split/merge, delete, "Rewrite with AI" |
| `VisualPicker.tsx` | tabs: Upload · Brand · Stock · AI clip (AI clip shows `locked` without `create.spend`, `needs_setup` without provider) |
| `PreviewPlayer.tsx` | `@remotion/player` with the shared composition, `React.lazy` so the Create bundle does not grow for users who never open video |
| `StylePanel.tsx`, `LengthPicker.tsx` | aspect, preset; length presets 5 / 15 / 30 / 60 s + custom (calls `fitToTarget`), per-scene duration with the readability minimum shown |
| `VoicePanel.tsx`, `MusicPanel.tsx` (V4b) | voice select + "Generate voiceover"; captions style; music upload + gain |
| `ExportPanel.tsx` | MVP: Export button (or `unavailable` with supported browsers), progress + Cancel, `aria-live="polite"` status, download MP4 + VTT, save-to-project status. V5b adds server render and "Send to Promote" |
| `ClipSpendDialog.tsx` | prompt, model, duration, **price quote**, remaining budget, explicit confirm |
| `useVideoDraft.ts` | local reducer over the composition, debounced `save` with `baseRevision`, conflict banner "Updated elsewhere: reload" |

### 8.2 UI states (AGENTS.md §6)

| State | When | Shown |
|---|---|---|
| loading | queries pending, storyboard `running` | skeleton scene cards, "Planning scenes…" |
| empty | no videos / piece has no script | `ModuleEmpty` with next action |
| error | storyboard/render `failed` | error text from job + retry |
| partial | any scene `visual === null` or shorter than its readability minimum (later: no voice) | scene cards flagged; export disabled with the list of issues |
| success | MVP: export stored via `attachExport`; V5b: server render `succeeded` with receipt | MVP: "Exported on this device" + download; V5b: `ReceiptBadge`, send to Promote |
| locked | plan lacks `create`, role lacks `spend` | `locked` badge on AI clip + reason |
| needs_setup | provider key missing on the deployment | `needs_setup` on voice/stock/render/clips, never simulated media |

### 8.3 Accessibility (rule 16)

Reorder by buttons and keyboard (no drag-only); every field labelled; preview
shows all on-screen text as real text in the editor (the silent video's
message is readable without watching it; captions come with V4b) and honours `prefers-reduced-motion` (Ken Burns off);
job status announced via live region; focus returns to the scene after dialogs;
contrast of caption presets checked (WCAG 2.2 AA) in a unit test over preset
colours.

---

## 9. Rendering (Remotion)

### 9.1 Composition code (`src/video/remotion/`)

- `MosaiVideo.tsx`: `<Series>` of scenes with transitions; one `<Audio>` for
  the voiceover; captions overlay; optional disclosure end card. Music (later)
  is a second `<Audio>` with ducking from `wordTimings`.
- `composition.ts`: `toRemotionComposition(c)` returns `{ id: "MosaiVideo",
  component, durationInFrames, fps: 30, width, height, calculateMetadata: null }`
  from the shared `Composition`, so the Player and `renderMediaOnWeb` get the
  same object.
- Scene components per visual kind: `BrandGraphicScene`, `MediaScene`.
- **Media components must be the browser-renderer-compatible ones:** `<Video>`
  and `<Audio>` from `@remotion/media`, and `<Img>`. `<OffthreadVideo>`,
  `<Html5Video>` and `<Html5Audio>` are not supported by client-side rendering.
- **CSS subset rule.** Client-side rendering draws the layout onto a canvas and
  supports only listed properties (layout, `transform`, `opacity`, colours,
  linear gradients, borders and radius, most text properties, `text-shadow`).
  Not supported, so banned in `src/video/remotion/`: `z-index` (use DOM order),
  `perspective`, `object-position`, non-gradient `background-image`, inset or
  spread shadows, SVG masks and `clip-path: url()`, CSS filters (not in
  Safari). V3 adds a lint rule or unit test that scans these files for the
  banned properties.
- Fonts loaded through `@remotion/fonts` or `@remotion/google-fonts` (only
  licences that allow embedding in video).
- All media URLs are same-origin or CORS-enabled (Convex storage URLs; V0
  confirms Convex storage sends the needed CORS headers for canvas use).

### 9.2 Browser export (MVP)

`src/components/create/video/useBrowserExport.ts`:

1. **Capability check** before showing the button: `typeof VideoEncoder !==
   "undefined"` plus a trial `VideoEncoder.isConfigSupported({ codec: "avc1…",
   width, height })`. Unsupported → the Export button is `unavailable` with
   "Use Chrome 94+, Firefox 130+ or Safari 26+".
2. **Guard:** `isRenderable(composition)` and a saved revision (export uses the
   saved composition, never unsaved local edits, so the stored
   `compositionHash` is true).
3. **Render:** `renderMediaOnWeb({ composition, inputProps, container: "mp4",
   videoCodec: "h264", muted: true, onProgress, signal, schema })`
   (`muted: true` in the MVP: no audio track is written, and stock clips'
   own audio is dropped) with the composition's Zod v4 schema (Zod v4 is already a
   dependency). `signal` comes from an `AbortController` wired to Cancel.
   Load `@remotion/web-renderer` with a dynamic `import()` so it never enters
   the main bundle.
4. **Progress:** progress bar + `aria-live="polite"` text at 10 % steps;
   `beforeunload` warning while rendering. Export time is not a requirement:
   the user can keep working in another tab (a background tab renders slower;
   that is accepted).
5. **Deliver:** `getBlob()` → object URL → download `<title>.mp4` (plus the
   `.vtt` captions once voice exists). Then upload the blob with `exportUploadUrl` and
   `attachExport` (with hash and `rendererVersion`).
6. **Failure:** show the error, keep the editor state, offer retry. Never mark
   the video ready unless `attachExport` succeeded.

Settings: `pageResponsiveness` stays at the default (keeps the editor
responsive); `videoBitrate` at the default. No performance tuning is planned,
since export time does not matter.

### 9.3 Environment (names only; values never committed, rule 1)

MVP: `PEXELS_API_KEY`, `OPENROUTER_API_KEY` (exists) on the Convex
deployment. No Remotion licence key is needed while the free licence applies
(D1a); client-side rendering sends Remotion a telemetry event per render with
or without a key. If a Company License is bought later, its key is passed as
`licenseKey`; V0 notes whether that key is a public identifier (it would be
visible in the browser bundle) before one is added.
Later: `ELEVENLABS_API_KEY` (V4b); `VIDEO_CLIP_QUOTE_SECRET` (V6); `VERCEL_TOKEN`, `VERCEL_TEAM_ID`,
`BLOB_READ_WRITE_TOKEN` or equivalent (V5b). Missing key → that capability
resolves to `needs_setup`.

### 9.4 Server rendering later (V5b): Vercel Sandbox

`@remotion/vercel` renders in an ephemeral Vercel Sandbox VM (Chrome +
FFmpeg) and writes to Vercel Blob. It needs one Vercel account and a Blob
store; no AWS. Limits from Remotion's docs: single machine per render (slower
than Lambda, a few seconds to start), 45 min timeout on Hobby and 5 h on Pro,
10 concurrent renders on Hobby and 2000 on Pro; functions run up to 800 s, so
use `renderMediaOnVercel({ detached: true })` and poll `getRenderProgress()`.
Vercel's Hobby plan is for non-commercial use, so production needs Pro; set
Vercel spend management and delete Blob outputs after they are copied into
Convex storage. Because server rendering uses a real Chrome screenshot, the
CSS subset rule of §9.1 is stricter than needed there, which keeps preview,
browser export and server render identical.

### 9.5 `RenderProvider` interface (server rendering only)

```ts
interface RenderProvider {
  id: "vercel_sandbox" | "remotion_lambda" | "shotstack";
  submit(input: { snapshot: Composition; assetUrls: Record<string, string>;
    idempotencyKey: string }): Promise<{ providerRenderId: string }>;
  progress(id: string): Promise<{ done: boolean; progress: number; error?: string; outputUrl?: string; costUsd?: number }>;
  fetchOutput(id: string): Promise<Uint8Array>;
}
```

Any provider switch is gated by a parity test: the same fixture rendered by the
browser export and the server provider, frame hashes compared at 3 timestamps
within a tolerance.

---

## 10. Security and truth checklist

| Rule | How this design meets it |
|---|---|
| 1 secrets | env names only; secret scan in CI already covers new files; no Remotion key in the MVP (§9.3); the Pexels key lives only on the Convex deployment, never in the web bundle |
| 2 auth + ownership | every public function via `moduleQuery/Mutation` or `requireActionCapability` + `ownedRow`; the generated cross-tenant suite picks new functions up automatically (verify the registry in `tests/unit/function-registry.ts`) |
| 3 no client snapshots | storyboard/voice/clip/render load everything server-side by id |
| 4 untrusted content | script, research, stock metadata wrapped as data; model output can't select tools or trigger spend |
| 5 no fake success | MVP: a browser export is labelled "Exported on this device" and is a user-supplied file, never "verified" or "published"; `ready` only after the file is actually stored (`attachExport`). Later: `succeeded` only from `finalize` (server render) or `poll` (clip) after verified provider state + stored blob + sha-256; client mutations can't write job status (test) |
| 6 idempotency + receipts | `idempotencyKey` on renders and clips, receipts stored |
| 7 money | costs in integer micro-USD; quotes are HMAC-signed; budget checked before submit |
| 8 user URLs | no user-supplied URL is fetched; stock downloads by provider id via `safeFetch` |
| 9 public content origin | exported/rendered MP4 served via Convex storage URL (separate registrable domain from the app) until T2.15 defines the public media origin |
| 10 module independence | all code in `modules/video` + `shared/video`; Promote reads `forPromote` only |
| 11 gateway | TTS and video through `modelGateway.ts` with `aiRuns` |
| 12 registry | 4 entries + blob cleanup test |
| 13 jobs | storyboard, clips, renders use the standard states |
| 15 tokens | app UI tokens only; brand colours only inside rendered video |
| 16 a11y | §8.3 |
| Synthetic media | `aiGenerated` per asset, `containsSyntheticMedia` per video, passed to Promote so the platform AI label is set; EU AI Act Art. 50 applies from 2 Aug 2026 |
| Likeness | no voice cloning, no avatars, no real-person generation prompts in v1 (clip prompt validator refuses named real people) |

---

## 11. Costs and budgets ⚑ D4

Per 60 s video, list prices on 24 Sep 2026. **The silent MVP costs only the
storyboard call (under $0.01 per video)**; everything else is free or runs on
the user's device.

| Item | Unit price | Typical use | Cost |
|---|---|---|---|
| Storyboard LLM | existing text model via OpenRouter | ~3k tokens | < $0.01 |
| Voiceover (ElevenLabs, V4b; none in the MVP) | $0.05–0.10 / 1k chars | ~900 chars | $0.05–0.09 |
| Stock (Pexels) | free | 3–6 clips | $0 |
| Export (MVP, browser) | runs on the user's device | 1 export | $0 (plus the Remotion licence if the company has 4+ people) |
| Server render (later, Vercel Sandbox) | usage-based Vercel compute + Blob storage; Vercel Pro plan | 1 render | measure in V5b |
| AI clips (optional) | Veo 3.1 Lite $0.05/s … Fast 1080p $0.12/s | 4 × 6 s | $1.20–2.90 |

Enforcement: `assertMediaBudget(organizationId, estimateMicrousd)` sums this
month's `aiRuns.costMicrousd` for the organization plus in-flight estimates and
compares with the plan allowance (a constant beside `PLAN_MODULES` until the
owner sets real numbers). Refusal returns `locked` with the reason, never a
silent failure.

`create` gains the `spend` action in `MODULE_DEFINITIONS` (role matrix already
limits `spend` to owners). Plans without an allowance see AI clips as `locked`.

---

## 12. Test plan

| Area | Test (Vitest + convex-test unless noted) |
|---|---|
| Composition | validator ↔ type parity fixtures; limits (a 5 s composition is valid, 4.9 s is not); `readMsFor` minimum; `fitToTarget` for 5/15/30/60 s; hash stability; `isRenderable` |
| Timing/captions | char alignment → words; scene split; VTT output snapshot; pacing estimator |
| Authorization | cross-tenant suite covers every new public function; member vs owner on `requestClip` |
| Capability | free plan can storyboard; `create.spend` missing → `requestClip` refused before any provider call |
| Truth | MVP: `attachExport` refuses a non-MP4 or oversized blob, and the video is not `ready` without a stored export; later: no client-callable function can set `succeeded`; forged webhook → no change; callback body ignored |
| Renderer compatibility | unit test scans `src/video/remotion/` for banned CSS properties and unsupported components (§9.1) |
| Idempotency | double `attachExport` of the same video replaces the old export (one row, old blob deleted); later double `requestRender` / `requestClip` → one row, one provider submit (mock) |
| State machine | table test over `canTransition`; terminal states immutable |
| Storyboard | fixture model outputs: an invented number/price/name rejected by grounding; scene count over budget for 5 s rejected; over-long on-screen text rejected; deterministic hook + CTA fallback fits 5 s |
| Budget | over-allowance quote refused; cost recorded from `usage.cost` |
| Deletion | project deletion removes rows **and** storage blobs |
| Browser (Playwright, Chromium) | create video from a script → edit scene → preview plays → export a **5 s** fixture in the browser → download event fires with an MP4 that has a video track and **no audio track** and a duration of 5 s (±1 frame) → export listed on the video; keyboard-only reorder; unsupported-browser message when `VideoEncoder` is stubbed out |
| A11y (axe) | Videos tab and studio pass with no allow-list |

---

## 13. Tickets (one ticket = one branch = one PR)

Sizes: S ≤ 1 day, M 2–3 days, L 4–5 days.

| Ticket | Scope | Depends on | Acceptance (each by a test or recorded check) | Size |
|---|---|---|---|---|
| **V0 Spike + ADR** | Export a 5 s and a 60 s muted fixture (brand graphics + an uploaded image + a stock clip) with `renderMediaOnWeb` in Chrome, Firefox and Safari 26; confirm it completes (speed not measured), and Convex storage CORS for canvas use. ADR "Video rendering and media providers". ElevenLabs and OpenRouter video checks move to V4b/V6. | none | ADR merged; no production code | S |
| **V1 Data + composition** | `src/shared/video/*`; `videos` + `videoAssets` tables; `aiRuns` additive fields; registry entries + blob cleanup; `videos.ts` CRUD with optimistic concurrency; `create.spend` in registry; file owners | T2.2, T2.3, T2.5 | composition tests; cross-tenant + capability tests green; `audit:functions`, `audit:capabilities`, data-registry audit green | M |
| **V2 Storyboard agent** | `storyboard.ts`, prompt v1, validators, fallback, fixtures | V1, gateway | fidelity/pacing validators reject bad fixtures; no client-supplied script accepted | M |
| **V3 Studio UI + preview** | Videos tab, studio, scene editing, uploads, brand graphics, `@remotion/player` preview, all UI states | V1, V2 | Playwright journey to preview; axe clean; keyboard reorder | L |
| **V4 Stock** | Pexels search/import (the export is muted, so clip audio is irrelevant); "Photos and videos provided by Pexels" link in the picker; photographer credit stored, not shown; search cache, per-user limit and `rate_limited` state | V3, `PEXELS_API_KEY` on the deployment | `needs_setup` without the key; import by id only; attribution stored; Pexels link visible whenever results show; cached repeat search makes no Pexels call; 429 → `rate_limited` | S–M |
| V4b ⚑ Sound (after the MVP) | ElevenLabs voiceover, word timings, captions, WebVTT, music bed + ducking, narration fidelity check, `muted: false` export | V5, D2, D4 voice cap | caption timing within 100 ms of alignment on fixtures; `needs_setup` without the key; budget refusal | M |
| **V5 Browser export (MVP)** | `useBrowserExport`, capability check, progress/cancel, download MP4 + VTT, `exportUploadUrl`/`attachExport`, "Exported on this device" label | V4, V0 | Playwright export journey; unsupported browser shows `unavailable`; `attachExport` rejects bad MIME/size; `ready` only after stored | S–M |
| V5b Server render + hand-off (later) | Vercel Sandbox `RenderProvider`, `videoRenders` table, `renders.ts`, polling, cron, finalize with receipt, `forPromote` contract, Promote accepts `{type:"video",id}` | V5, Vercel account (Pro) | truth + idempotency tests; receipt only after verified finalize; parity test vs browser export | L |
| **V6 ⚑ AI clips** | allow-list, quote token, `clips.ts`, poll loop, budget, disclosure flag to Promote; approval record once T2.12 lands | V5 (V5b for the Promote flag), D3, D4, D5 | no clip without `create.spend` + valid quote; budget refusal; `aiGenerated` reaches Promote | M |
| V7 Rough cut (deferred) | Upload phone footage → shot detection + ASR filler removal (OpenStoryline as reference, isolated worker) | ADR | n/a | L |
| V8 Advanced edit (deferred) | Multi-track editor (OpenReel as reference, MIT; check ffmpeg.wasm licensing and CDN loading) | ADR | n/a | L+ |

**MVP = V0 + V1 + V2 + V3 + V4 (stock) + V5, silent**, roughly 10–14 working
days (estimate). Order: V0 can run in parallel with V1–V3 (they need no
provider). V4 needs only the Pexels key set on the deployment; V4b (sound), V5b and V6 come
after the MVP. Each PR description follows the template in AGENTS.md §6
(Outcome · Scope · Before · After · Data migration · Security and privacy ·
Verification · Proof).

---

## 14. Risks

| Risk | Mitigation |
|---|---|
| Browser export fails on low-end devices (slowness itself is accepted) | V0 checks completion on each browser; cap length at 120 s; V5b server render as the fallback |
| A 5 s video that says nothing useful | scene budget + hook/CTA condensing; user can edit every line |
| Unsupported browser (older Safari, no WebCodecs) | capability check → `unavailable` with the supported versions; preview still works |
| User closes the tab mid-export | `beforeunload` warning; backgrounding is fine (Remotion keeps rendering via a Worker timer, slower, which is accepted) |
| Canvas-drawn output differs from the preview for unsupported CSS | CSS subset rule + scan test (§9.1) |
| Remotion licence tier | free licence now (1 person); add a Company License before the team reaches 4 |
| Pexels shared quota (200/h for the whole app, D6) | 24 h search cache, per-user limit, `rate_limited` state; revisit D6 (showing credit unlocks unlimited free quota) if users hit it |
| Provider model retired (Sora API removed 24 Sep 2026) | allow-list + OpenRouter lets us switch model ids; no model id in UI code |
| Large files | MVP uploads go straight from the browser to a Convex upload URL (no action memory involved); cap at 120 s / 1080p (~30–80 MB). V5b: stream the provider output in a node action or keep it in Blob with a receipt |
| Preview ≠ server render (V5b) | one composition, one component tree; frame-hash parity test in V5b |
| Cost surprise | ceilings per model, quote tokens, monthly budget, costs recorded from provider usage |
| Legal wording (AI disclosure, stock licence, fonts, music) | D6 decided; D5 open (metadata flag first); Pexels' own terms still apply (no reselling unmodified clips, no copying Pexels' core function) |

---

## 15. Sources (researched 24 Sep 2026)

- Remotion licence/pricing: https://www.remotion.dev/docs/license/pricing ,
  summary https://www.therundown.ai/tools/remotion
- Remotion client-side rendering: https://www.remotion.dev/docs/client-side-rendering/ ,
  https://www.remotion.dev/docs/client-side-rendering/limitations ,
  https://www.remotion.dev/docs/web-renderer/render-media-on-web
  (read from the docs source at github.com/remotion-dev/remotion, `packages/docs/docs`;
  `@remotion/web-renderer` 4.0.528 published 24 Sep 2026 on npm)
- Remotion on Vercel Sandbox: https://www.remotion.dev/docs/vercel-sandbox ,
  https://github.com/remotion-dev/template-vercel
- Remotion Cloud Run (alpha, not actively developed): https://www.remotion.dev/docs/cloudrun
- Remotion Lambda and webhooks: https://www.remotion.dev/docs/lambda ,
  https://www.remotion.dev/docs/lambda/webhooks ,
  https://www.remotion.dev/docs/lambda/validatewebhooksignature
- OpenRouter video API: https://openrouter.ai/docs/guides/overview/multimodal/video-generation ,
  https://openrouter.ai/docs/api/api-reference/video-generation/poll-video-generation-status ,
  https://github.com/OpenRouterTeam/skills/blob/main/skills/openrouter-video/SKILL.md ,
  https://openrouter.ai/collections/video-models
- Veo 3.1 pricing: https://ai.google.dev/gemini-api/docs/pricing
- Price comparison: https://www.buildmvpfast.com/api-costs/ai-video
- Sora API removal: https://help.openai.com/en/articles/20001152-what-to-know-about-the-sora-discontinuation
- ElevenLabs timestamps and pricing: https://elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps ,
  https://elevenlabs.io/pricing/api
- Shotstack vs Creatomate: https://www.wireflow.ai/blog/creatomate-vs-shotstack
- Pexels API: https://www.pexels.com/api/documentation/
- EU AI Act Article 50: https://artificialintelligenceact.eu/transparency-rules-article-50/
- References for deferred work: https://github.com/FireRedTeam/FireRed-OpenStoryline (Apache-2.0),
  https://github.com/Augani/openreel-video (MIT)
