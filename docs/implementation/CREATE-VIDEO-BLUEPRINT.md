# Create → Video: implementation blueprint

**Status:** `not started`. Blueprint ready for ticketing; blocked on the owner
decisions in §0 only for the tickets marked ⚑.
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

The tickets that need nothing from the owner (V1–V4) can start now. The ⚑
tickets wait for these answers. The default is what gets built if the owner
agrees; the alternative is what changes if not.

| # | Decision ⚑ | Default in this blueprint | If the owner chooses otherwise |
|---|---|---|---|
| D1 | Server renderer | **Remotion on AWS Lambda** (needs AWS account + Remotion licence tier for team size) | Shotstack or Creatomate behind the same `RenderProvider` interface (§9.4); preview stays Remotion Player |
| D2 | Voice provider | **ElevenLabs** `with-timestamps` | Any TTS that returns word/char timings; otherwise add a forced-alignment step |
| D3 | AI clip provider | **OpenRouter video API** (`/api/v1/videos`) using the existing `OPENROUTER_API_KEY` | Direct Gemini (Veo) adapter behind the same interface |
| D4 | Who pays for AI clips and TTS | Off by default; small monthly allowance on paid plans; hard per-organization budget | Pass-through top-up (needs T2.4 metered billing) |
| D5 | AI disclosure on the video | Metadata always + platform AI label via Promote; on-video text only if legal asks | Add an end card or corner label (a composition style flag) |
| D6 | Stock attribution | Visible credit in the export notes and post description | No credit: stay within Pexels default limits (200 req/h, 20k/month) |

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
generation, browser-side final export.

**Principle.** The LLM writes and plans; a deterministic renderer draws. The
same JSON composition drives the browser preview and the server render, so what
the user previews is what renders.

---

## 2. Architecture

```
Browser (Create → Videos tab)                       Convex (module: create)
┌───────────────────────────────┐   queries/     ┌──────────────────────────────────────┐
│ VideoStudio                   │   mutations    │ modules/video/videos.ts   CRUD, save  │
│  SceneList · SceneCard        │ ─────────────▶ │ modules/video/storyboard.ts  LLM      │
│  VisualPicker · StylePanel    │                │ modules/video/assets.ts  upload/stock │
│  VoicePanel · RenderPanel     │ ◀───────────── │ modules/video/voice.ts   TTS          │
│  PreviewPlayer (@remotion/    │   live rows    │ modules/video/clips.ts   AI clip jobs │
│   player, lazy-loaded)        │                │ modules/video/renders.ts render jobs  │
└──────────────┬────────────────┘                │ http.ts  /api/video/* webhooks        │
               │ imports                         │ lib/modelGateway.ts (+ video, speech) │
┌──────────────▼────────────────┐                └───────┬───────────┬──────────┬────────┘
│ src/shared/video/             │  same code             │           │          │
│  composition.ts (schema,      │◀──────────┐            │           │          │
│   validate, timing, captions) │           │     OpenRouter    ElevenLabs   Pexels
│ src/video/remotion/           │           │     (LLM + video)  (TTS)       (stock)
│  Root.tsx · scenes · captions │ ──deploy──┴──▶ Remotion Lambda (AWS) ── webhook ──▶ http.ts
└───────────────────────────────┘                  renders MP4 to S3; Convex copies to storage
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
| `src/convex/modules/video/renders.ts` (`"use node"`) | new | `"create"` |
| `src/convex/modules/video/jobs.ts` | new: internal state machine mutations | `"internal"` |
| `src/convex/modules/video/agents/storyboard.prompt.v1.ts` | new | `"internal"` |
| `src/convex/modules/video/providers/{openrouterVideo,elevenlabs,pexels,remotion}.ts` | new adapters | `"internal"` |
| `src/convex/lib/modelGateway.ts` | changed: `modelGenerateVideo`, `modelSynthesizeSpeech` | `"internal"` (existing) |
| `src/convex/schema.ts` | changed: 4 tables, `aiRuns` additive fields | n/a |
| `src/convex/lib/dataRegistry.ts` | changed: 4 entries | n/a |
| `src/convex/lib/capabilities.ts` | changed: `create` gains `spend`; file owners | n/a |
| `src/convex/http.ts` | changed: 2 routes | n/a |
| `src/convex/crons.ts` | changed: stuck-job sweep | n/a |
| `src/video/remotion/*` | new: Remotion root, scene components (also deployed as the Lambda site) | n/a |
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
with the project.

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

videoRenders: defineTable({
  projectId: v.id("projects"),
  videoId: v.id("videos"),
  status: jobStatus,
  compositionHash: v.string(),
  compositionSnapshot: compositionValidator,  // frozen copy; edits never change a running render
  rendererVersion: v.string(),                // deployed Remotion site name
  idempotencyKey: v.string(),                 // hash(videoId, compositionHash, rendererVersion)
  provider: v.literal("remotion_lambda"),
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
```

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
export const LIMITS = { minScenes: 1, maxScenes: 20, maxTotalMs: 120_000,
  minSceneMs: 1_000, maxSceneMs: 20_000, maxOnScreenWords: 8 } as const;

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
  narration: string;               // spoken text
  onScreenText?: string;
  visual: Visual | null;           // null = incomplete (partial state)
  durationMs: number;              // from voiceover when present, else estimate
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
  captions: { style: "bold_word" | "line" | "off" };
  disclosure: { endCard: boolean };                   // D5
  scenes: Scene[];
};
```

Exports: `compositionValidator` (Convex `v.object` mirror; a unit test asserts
the TS type and validator accept the same fixtures), `validateComposition(c):
Issue[]` (limits, unique ids, colour is a token-safe hex from the brand kit,
every referenced asset id present), `isRenderable(c)` (no `null` visuals, voice
present or captions off), `totalDurationMs(c)`, `compositionHash(c)` (sha-256 of
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
| `searchStock({ videoId, query, orientation })` | `create.edit` | Pexels search by fixed host with the server key; returns ids, thumbnails, credit; `needs_setup` if no key |
| `importStock({ videoId, provider: "pexels", externalId })` | `create.edit` | re-fetches the item **by id** server-side (never trusts a client URL), downloads the chosen rendition via `safeFetch`, stores blob + attribution |

### 5.4 `modules/video/voice.ts` (`"use node"`)

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

### 5.6 `modules/video/renders.ts` (`"use node"`) ⚑ D1

| Function | Capability | Behaviour |
|---|---|---|
| `requestRender({ videoId })` | `create.edit` | `isRenderable` or throw with the issues; idempotent on `(videoId, compositionHash, rendererVersion)`; snapshot composition; `queued`; schedules `submit` |
| internal `submit({ renderId })` | n/a | builds `inputProps` = snapshot + short-lived asset URLs (`ctx.storage.getUrl`); `renderMediaOnLambda` via `@remotion/lambda-client` with `codec: "h264"`, `webhook: { url, secret }`; stores `providerRenderId`, `providerBucket`; `running`; schedules a backup `poll` at +60 s |
| internal `poll({ renderId })` | n/a | `getRenderProgress`; updates `progress`; on done → `finalize`; on fatal error → `failed` |
| internal `finalize({ renderId })` | n/a | downloads output from S3, computes sha-256, stores blob as `render` asset, builds WebVTT from `wordTimings` as `captions` asset, writes `receipt`, sets `succeeded`, sets video `status: "ready"`. **Only path that writes `succeeded`.** |
| `cancelRender({ renderId })` | `create.edit` | marks `canceled`; late webhook for a canceled render is ignored |

### 5.7 State machine (`modules/video/jobs.ts`)

One pure `canTransition(from, to)` used by every internal mutation. Allowed:
`queued→running|canceled|failed`, `running→succeeded|failed|canceled|waiting_for_user`,
`waiting_for_user→running|canceled`. Terminal states never change. Every
transition writes `updatedAt`; a duplicate webhook or poll is a no-op.

### 5.8 HTTP routes (`src/convex/http.ts`)

| Route | Verification | Effect |
|---|---|---|
| `POST /api/video/render-webhook` | `validateWebhookSignature` with `REMOTION_WEBHOOK_SECRET` over the parsed body and `X-Remotion-Signature`; reject `X-Remotion-Mode: demo` in production | looks up the render by `renderId` in the payload; `success` → schedule `finalize`; `error/timeout` → `failed` with the provider message |
| `POST /api/video/clip-callback/:jobId` | none trusted (body ignored); rate-limited by job | schedules `poll({ jobId })` now |

### 5.9 Cron (`src/convex/crons.ts`)

Every 5 min: `running` renders older than 20 min → `poll`; clip jobs whose
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
  target length (from piece brief or 60 s default); aspect. Script, research and
  notes are wrapped as untrusted data (rule 4).
- **Output:** JSON only: `{ scenes: [{ narration, onScreenText?, visualIntent,
  suggestedVisual: "brand_graphic"|"upload"|"stock"|"ai_image"|"ai_clip",
  layout?, stockQuery?, transitionIn }] }`.
- **Validators (`validateOutput`):**
  1. Narration fidelity: normalized concatenated narration vs. normalized
     script spoken lines, token-level similarity ≥ 0.9 (the model segments; it
     does not rewrite).
  2. Pacing: estimated ≤ 2.7 words/s per scene; total within ±15 % of target.
  3. `onScreenText` ≤ 8 words; 1–20 scenes; enums only.
  4. `stockQuery`: ≤ 6 plain words, no URLs, no punctuation beyond spaces.
  5. `suggestedVisual: "ai_clip"` is only a suggestion; it never triggers spend.
- **On failure:** one retry with the validator message appended; then
  `storyboardStatus: "failed"` and the UI offers "Split evenly" (a deterministic
  fallback: one scene per paragraph).

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
| `VideosTab.tsx` | list of videos (status via `StatusBadge`; render via `ReceiptBadge`), empty state linking to "write a video script" |
| `VideoStudio.tsx` | three-pane layout: scenes · preview · settings; stacks on mobile |
| `SceneList.tsx` / `SceneCard.tsx` | narration + on-screen text fields, visual thumbnail, duration, move up/down buttons (keyboard), split/merge, delete, "Rewrite with AI" |
| `VisualPicker.tsx` | tabs: Upload · Brand · Stock · AI clip (AI clip shows `locked` without `create.spend`, `needs_setup` without provider) |
| `PreviewPlayer.tsx` | `@remotion/player` with the shared composition, `React.lazy` so the Create bundle does not grow for users who never open video |
| `StylePanel.tsx`, `VoicePanel.tsx`, `MusicPanel.tsx` | aspect, preset, captions style; voice select + "Generate voiceover"; music upload + gain |
| `RenderPanel.tsx` | render button, `aria-live="polite"` job status, progress, download, "Send to Promote" |
| `ClipSpendDialog.tsx` | prompt, model, duration, **price quote**, remaining budget, explicit confirm |
| `useVideoDraft.ts` | local reducer over the composition, debounced `save` with `baseRevision`, conflict banner "Updated elsewhere: reload" |

### 8.2 UI states (AGENTS.md §6)

| State | When | Shown |
|---|---|---|
| loading | queries pending, storyboard `running` | skeleton scene cards, "Planning scenes…" |
| empty | no videos / piece has no script | `ModuleEmpty` with next action |
| error | storyboard/render `failed` | error text from job + retry |
| partial | any scene `visual === null` or no voice | scene cards flagged; render disabled with the list of issues |
| success | render `succeeded` with receipt | `ReceiptBadge`, download, send to Promote |
| locked | plan lacks `create`, role lacks `spend` | `locked` badge on AI clip + reason |
| needs_setup | provider key missing on the deployment | `needs_setup` on voice/stock/render/clips, never simulated media |

### 8.3 Accessibility (rule 16)

Reorder by buttons and keyboard (no drag-only); every field labelled; preview
has captions on by default and honours `prefers-reduced-motion` (Ken Burns off);
job status announced via live region; focus returns to the scene after dialogs;
contrast of caption presets checked (WCAG 2.2 AA) in a unit test over preset
colours.

---

## 9. Rendering (Remotion) ⚑ D1

### 9.1 Composition code (`src/video/remotion/`)

- `index.ts` → `registerRoot(Root)`.
- `Root.tsx` → `<Composition id="MosaiVideo" component={MosaiVideo}
  calculateMetadata={({ props }) => ({ durationInFrames: frames(props),
  width, height, fps: 30 })} />`.
- `MosaiVideo.tsx` → `<Series>` of scenes with transitions; one `<Audio>` for
  the voiceover; `<Audio>` for music with volume ducking computed from
  `wordTimings`; `<Captions>` overlay; optional disclosure end card.
- Scene components per visual kind: `BrandGraphicScene`, `MediaScene`
  (`<OffthreadVideo>` / `<Img>` with Ken Burns), all reading the shared types.
- Fonts bundled with the site (only licences that allow embedding in video).

### 9.2 Deploy

`bunx remotion lambda functions deploy` once per region;
`bunx remotion lambda sites create src/video/remotion/index.ts --site-name=mosai-video-v<N>`
per renderer change. `rendererVersion` on each render row records the site, so
an old render can be reproduced. Output: h264 MP4, CRF 23, AAC audio.

### 9.3 Environment (names only; values never committed, rule 1)

`REMOTION_AWS_ACCESS_KEY_ID`, `REMOTION_AWS_SECRET_ACCESS_KEY`,
`REMOTION_AWS_REGION`, `REMOTION_FUNCTION_NAME`, `REMOTION_SERVE_URL`,
`REMOTION_WEBHOOK_SECRET`, `ELEVENLABS_API_KEY`, `PEXELS_API_KEY`,
`OPENROUTER_API_KEY` (exists), `VIDEO_CLIP_QUOTE_SECRET`. Missing key → that
capability resolves to `needs_setup`.

### 9.4 `RenderProvider` interface

```ts
interface RenderProvider {
  id: "remotion_lambda" | "shotstack";
  submit(input: { snapshot: Composition; assetUrls: Record<string, string>;
    webhookUrl: string; idempotencyKey: string }): Promise<{ providerRenderId: string; bucket?: string }>;
  progress(id: string): Promise<{ done: boolean; progress: number; error?: string; outputUrl?: string; costUsd?: number }>;
  fetchOutput(id: string): Promise<Uint8Array>;
}
```

A Shotstack implementation maps the composition to its JSON; the preview stays
Remotion Player, so a parity test (same fixture, frame hashes at 3 timestamps)
gates any provider switch.

---

## 10. Security and truth checklist

| Rule | How this design meets it |
|---|---|
| 1 secrets | env names only; secret scan in CI already covers new files |
| 2 auth + ownership | every public function via `moduleQuery/Mutation` or `requireActionCapability` + `ownedRow`; the generated cross-tenant suite picks new functions up automatically (verify the registry in `tests/unit/function-registry.ts`) |
| 3 no client snapshots | storyboard/voice/clip/render load everything server-side by id |
| 4 untrusted content | script, research, stock metadata wrapped as data; model output can't select tools or trigger spend |
| 5 no fake success | `succeeded` only from `finalize` (render) or `poll` (clip) after verified provider state + stored blob + sha-256; client mutations can't write job status (test) |
| 6 idempotency + receipts | `idempotencyKey` on renders and clips, receipts stored |
| 7 money | costs in integer micro-USD; quotes are HMAC-signed; budget checked before submit |
| 8 user URLs | no user-supplied URL is fetched; stock downloads by provider id via `safeFetch` |
| 9 public content origin | rendered MP4 served via Convex storage URL (separate registrable domain from the app) until T2.15 defines the public media origin |
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

Per 60 s video, list prices on 24 Sep 2026:

| Item | Unit price | Typical use | Cost |
|---|---|---|---|
| Storyboard LLM | existing text model via OpenRouter | ~3k tokens | < $0.01 |
| Voiceover (ElevenLabs) | $0.05–0.10 / 1k chars | ~900 chars | $0.05–0.09 |
| Stock (Pexels) | free | 3–6 clips | $0 |
| Render (Lambda + licence) | cents of compute; Remotion automation licence reported at ~$0.01/render with a $100/month minimum for companies of 4+ | 1 render | ~$0.01–0.05 |
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
| Composition | validator ↔ type parity fixtures; limits; hash stability; `isRenderable` |
| Timing/captions | char alignment → words; scene split; VTT output snapshot; pacing estimator |
| Authorization | cross-tenant suite covers every new public function; member vs owner on `requestClip` |
| Capability | free plan can storyboard; `create.spend` missing → `requestClip` refused before any provider call |
| Truth | no client-callable function can set `succeeded`; forged render webhook (bad signature) → no change; demo-mode webhook refused; callback body ignored |
| Idempotency | double `requestRender` / `requestClip` → one row, one provider submit (mock) |
| State machine | table test over `canTransition`; terminal states immutable |
| Storyboard | fixture model outputs: rewritten script rejected; over-long on-screen text rejected; deterministic fallback |
| Budget | over-allowance quote refused; cost recorded from `usage.cost` |
| Deletion | project deletion removes rows **and** storage blobs |
| Browser (Playwright) | create video from a script → edit scene → preview plays → render with mocked provider → receipt badge; keyboard-only reorder |
| A11y (axe) | Videos tab and studio pass with no allow-list |

---

## 13. Tickets (one ticket = one branch = one PR)

Sizes: S ≤ 1 day, M 2–3 days, L 4–5 days.

| Ticket | Scope | Depends on | Acceptance (each by a test or recorded check) | Size |
|---|---|---|---|---|
| **V0 ⚑ Spike + ADR** | Render one fixture composition on Remotion Lambda; one OpenRouter video job end to end; one ElevenLabs call with timestamps. Record time, cost, failure modes. ADR "Video rendering and media providers". | D1–D3 | ADR merged with measured numbers; no production code | M |
| **V1 Data + composition** | `src/shared/video/*`; four tables; `aiRuns` additive fields; registry entries + blob cleanup; `videos.ts` CRUD with optimistic concurrency; `create.spend` in registry; file owners | T2.2, T2.3, T2.5 | composition tests; cross-tenant + capability tests green; `audit:functions`, `audit:capabilities`, data-registry audit green | M |
| **V2 Storyboard agent** | `storyboard.ts`, prompt v1, validators, fallback, fixtures | V1, gateway | fidelity/pacing validators reject bad fixtures; no client-supplied script accepted | M |
| **V3 Studio UI + preview** | Videos tab, studio, scene editing, uploads, brand graphics, `@remotion/player` preview, all UI states | V1, V2 | Playwright journey to preview; axe clean; keyboard reorder | L |
| **V4 ⚑ Stock + voice + captions** | Pexels search/import, ElevenLabs voiceover, word timings, captions in preview, music bed | V3, D2, D6 | caption timing within 100 ms of alignment on fixtures; `needs_setup` without keys; attribution stored | M |
| **V5 ⚑ Render job + hand-off** | `renders.ts`, webhook route, cron, finalize with receipt, VTT, download, `forPromote` contract, Promote accepts `{type:"video",id}` as media | V4, V0, D1 | truth + idempotency tests; forged webhook refused; receipt badge only after verified finalize | L |
| **V6 ⚑ AI clips** | allow-list, quote token, `clips.ts`, poll loop, budget, disclosure flag to Promote; approval record once T2.12 lands | V5, D3, D4, D5 | no clip without `create.spend` + valid quote; budget refusal; `aiGenerated` reaches Promote | M |
| V7 Rough cut (deferred) | Upload phone footage → shot detection + ASR filler removal (OpenStoryline as reference, isolated worker) | ADR | n/a | L |
| V8 Advanced edit (deferred) | Multi-track editor (OpenReel as reference, MIT; check ffmpeg.wasm licensing and CDN loading) | ADR | n/a | L+ |

Order: V0 can run in parallel with V1–V3 (they need no provider). V4–V6 wait
for their ⚑ decisions. Each PR description follows the template in AGENTS.md §6
(Outcome · Scope · Before · After · Data migration · Security and privacy ·
Verification · Proof).

---

## 14. Risks

| Risk | Mitigation |
|---|---|
| Remotion licence or AWS not approved | `RenderProvider` + Shotstack path; V1–V3 unaffected |
| Provider model retired (Sora API removed 24 Sep 2026) | allow-list + OpenRouter lets us switch model ids; no model id in UI code |
| Large files in Convex actions (memory/time limits) | cap at 120 s / 1080p (~30–80 MB); stream downloads in node actions; if exceeded, keep output in S3 and store a signed-URL receipt instead (ADR in V0) |
| Preview ≠ render | one composition, one component tree; frame-hash parity test in V5 |
| Cost surprise | ceilings per model, quote tokens, monthly budget, costs recorded from provider usage |
| Legal wording (AI disclosure, stock licence, fonts, music) | D5/D6 owner decisions; ship metadata flag first |

---

## 15. Sources (researched 24 Sep 2026)

- Remotion licence/pricing: https://www.remotion.dev/docs/license/pricing ,
  summary https://www.therundown.ai/tools/remotion
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
