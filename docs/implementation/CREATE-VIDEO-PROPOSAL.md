# Create → Video: script-to-video editor (proposal)

**Status:** proposal, not started. Needs the owner decisions in §9 before any
ticket is cut. **Researched:** 24 September 2026. Prices below are list prices
found that day; re-check before committing money (AGENTS.md §7).

## 1. What we are building

A **simple, scene-based video editor inside Create** that turns a saved
`video_script` content piece into a short marketing video (15–90 s, 9:16 / 1:1 /
16:9). The LLM does the *editorial* work (split the script into scenes, pick a
visual intent per scene, write on-screen text, suggest stock queries); a
deterministic renderer does the *pixels*. Generative AI video clips are an
optional, metered per-scene upgrade, not the default.

Not in scope: a multi-track NLE, keyframes, free-form timelines, avatars, voice
cloning. "Simple" means: a list of scene cards, a live preview, one voice, one
music bed, captions, a style preset, export.

### Why this shape (and not "LLM generates the video")

| Approach | 60 s video cost (list, Sep 2026) | Brand-consistent | Truthful | Editable |
|---|---|---|---|---|
| Whole video from a text-to-video model | Veo 3.1 Fast 1080p $0.12/s → **$7.20**; Standard $0.40/s → **$24** | No (drifts shot to shot) | Risky: invents product footage | Regenerate only |
| **Template composition + TTS + stock/uploads** (recommended default) | TTS ~900 chars ≈ **$0.05–0.09** + render compute (cents) | Yes (brand kit drives it) | Yes: the owner's own footage and products | Every scene, every word |
| Hybrid: template + 2–4 AI clips for b-roll | + 24 s × $0.05–0.12 ≈ **$1.20–2.90** | Mostly | Flagged as synthetic | Per scene |

Small businesses need many cheap, on-brand, correct videos more than one
cinematic one. The composition approach also fits MOSAI's truth promise: a
product shot is the real product, not a model's guess at it.

## 2. What already exists in the repo

- `video_script` is a Create content type (`src/pages/app/Create.tsx:54`); the
  generator emits H2 sections (Hook / Main points / CTA), spoken lines as
  paragraphs and `[b-roll/cut]` notes (`src/convex/ai.ts`, `TYPE_GUIDE`).
  This is the input. It is lossy HTML, so the storyboard step (§4) re-reads it
  server-side rather than trusting a client-parsed version.
- `lib/modelGateway.ts` + `aiRuns`: text-only today (vly / OpenRouter). Media
  calls must go through the same gateway contract (AGENTS.md rule 11).
- `lib/dataRegistry.ts`: new tables register here (rule 12).
- Promote's TikTok adapter already needs a public video URL
  (`src/convex/social/adapters.ts`); this feature is its natural supplier.
- Convex file storage for assets; no video tooling in `package.json`.

## 3. User flow

1. In Create → Content, a `video_script` piece gets a **Make video** action.
2. **Storyboard** (AI, ~10 s): the script is split into 4–12 scenes. Each card
   shows narration, on-screen text, visual source and estimated duration.
3. **Edit** (the editor): reorder, split/merge scenes, edit narration (script
   stays the source of truth; edits write back to the piece on request), swap a
   visual (upload · brand graphic · stock · AI image · AI clip), pick aspect
   ratio, style preset, voice, music, caption style. Live preview updates.
4. **Voice**: generate voiceover; scene durations snap to real audio length;
   captions are timed from the TTS alignment.
5. **Render**: server render to MP4 (+ `.vtt` captions). Job status is honest:
   `queued → running → succeeded | failed` with the provider receipt.
6. **Use**: download, or send to Promote as a canonical ref `{type:"video", id}`.
   Publishing stays Promote's job and its receipts.

UI states required by AGENTS.md §6: loading, empty (no script yet → link to
write one), error, partial (some scenes lack visuals), success, locked (plan
lacks the capability or provider `needs_setup`).

## 4. The LLM steps

| Agent id | Input (server-loaded only) | Output (structured, validated) |
|---|---|---|
| `create.video_storyboard` | piece body/`contentDocs`, persona, brand kit, target length, aspect ratio | `Scene[]` (below) |
| `create.video_scene_rewrite` | one scene + neighbours | one `Scene` |
| `create.video_clip_prompt` | one scene's visual intent, brand kit | a text-to-video prompt (shown to user before spend) |

Validators (`validateOutput`), so a bad model answer fails loudly instead of
producing a broken video:

- concatenated narration must match the script within a similarity threshold
  (the model segments; it does not silently rewrite);
- pacing ≤ ~2.7 spoken words/second per scene, total within ±15% of target;
- on-screen text ≤ 8 words; scene count 3–15; enums only for `visual.kind`;
- `stockQuery` is plain words (it is sent to a third-party search API).

Script text and research are **data, not instructions** (rule 4): scene output
can never select a tool, a provider, or trigger spend. AI-clip generation always
needs an explicit user click and, after T2.12, an approval record.

## 5. Composition model (the source of truth)

A provider-neutral JSON document, versioned, stored on the `videos` row. Both
the browser preview and the server render read the same document, so what the
user previews is what renders.

```ts
type VideoComposition = {
  version: 1;
  aspect: "9:16" | "1:1" | "16:9";
  fps: 30;
  style: { presetId: string; brandKitRef?: CanonicalRef };
  voice?: { provider: "elevenlabs"; voiceId: string; assetId?: Id<"videoAssets"> };
  music?: { assetId: Id<"videoAssets">; gainDb: number; duckUnderVoice: boolean };
  captions: { enabled: boolean; style: "bold_word" | "line" | "off" };
  scenes: Scene[];
};

type Scene = {
  id: string;
  narration: string;
  onScreenText?: string;
  durationMs: number;            // from TTS audio when present, else estimate
  visual:
    | { kind: "upload"; assetId: Id<"videoAssets"> }
    | { kind: "brand_graphic"; layout: "title" | "list" | "quote" | "cta" }
    | { kind: "stock"; assetId: Id<"videoAssets"> }
    | { kind: "ai_image"; assetId: Id<"videoAssets"> }   // Ken Burns motion
    | { kind: "ai_clip"; assetId: Id<"videoAssets"> };
  transitionIn: "cut" | "fade" | "slide";
  wordTimings?: { word: string; startMs: number; endMs: number }[];
};
```

## 6. Technology choices (researched)

### Renderer: recommend Remotion, behind an adapter

| Option | Fit | Cost | Risk |
|---|---|---|---|
| **Remotion** (React compositions; `@remotion/player` for in-browser preview; Remotion Lambda for server render) | Same React/TS stack; one composition for preview and render | Free for orgs of up to 3 people; larger orgs need a Company License, reported at ~$100/month minimum for automated renders (≈ $0.01/render) plus AWS Lambda compute | Needs an AWS account; license terms must be confirmed on remotion.pro (their site was not reachable from this environment) |
| Shotstack / Creatomate (hosted JSON render APIs) | No infra; we map our composition to their JSON | From ~$41–54/month (Creatomate) or $49/month for 200 min at 720p (Shotstack), overage extra | Preview must be rebuilt separately → preview/render drift |
| Browser export (WebCodecs via Mediabunny, MPL-2.0) | Zero server cost | Free | Device-dependent speed and codec support; not reliable for a job with a receipt |

Convex cannot run Chromium/FFmpeg and actions have hard time limits, so the
render **must** be an external job: a Convex action starts it with an
idempotency key, the provider calls back (webhook) or a scheduled poll checks
it, and only then is the MP4 copied into storage and the row set to
`succeeded` (rules 5, 6, 13). Keep a `RenderProvider` interface so Shotstack can
replace Remotion without touching the editor.

### Voice: ElevenLabs text-to-speech with timestamps

`POST /v1/text-to-speech/{voice_id}/with-timestamps` returns audio plus
per-character start/end times, which gives word-accurate captions and exact
scene durations with no separate alignment step. List price (Sep 2026):
$0.10 per 1k characters (multilingual) or $0.05 (Flash/Turbo), billed on
characters sent. A 60 s script is ~900 characters.

### Visuals

- **Uploads** first (owner's product photos/clips; best for truth).
- **Brand graphics**: rendered text/logo/colour layouts; free.
- **Stock**: Pexels API (free incl. commercial use; 200 req/h, 20k/month by
  default, raised free with visible attribution). Store attribution per asset
  and show it in the export notes.
- **AI clips (optional, metered)**: Google Veo 3.1 via the Gemini API —
  Lite $0.05/s (720p), Fast $0.10/s (720p) / $0.12/s (1080p), Standard $0.40/s.
  Kling (~$0.08–0.17/s) is the fallback adapter.
  **Do not use OpenAI Sora**: the Videos API and all `sora-2*` models are
  removed from OpenAI's API on **24 September 2026** with no replacement.
- **Avatars** (e.g. HeyGen API, ~$1–4 per minute): deferred. Likeness and
  deepfake rules (§7) make it a separate, consent-gated feature.

## 7. Truth, safety and legal

- **Honest states.** `rendered` only when the provider reports success *and*
  the file is in our storage with a checksum. Never mark `published` here.
- **Synthetic-media disclosure.** Every asset records `aiGenerated`, model and
  provider; a video carries `containsSyntheticMedia`. EU AI Act Article 50
  transparency obligations apply from **2 August 2026** (machine-readable
  marking by providers; deployers must disclose deepfakes). Veo output carries
  Google's SynthID watermark; we should also pass the flag to Promote so the
  platform's own "AI-generated" label is set at publish time. Exact wording of
  any on-video disclosure is a legal decision (§9).
- **No voice cloning or real-person likeness in v1.** Stock voices only.
- **Uploaded media is untrusted**: check MIME/size server-side; never render
  user-supplied HTML inside a composition.
- **User URLs** (e.g. "use this video link") go through `safeFetch` (rule 8).
- **Money and budgets.** Every TTS/clip/render call writes an `aiRuns`-style
  record with cost in integer micro-USD; per-plan monthly budget enforced
  before the call, not after.

## 8. Data model (additive; register every table in `dataRegistry.ts`)

| Table | Key fields | Notes |
|---|---|---|
| `videos` | `projectId`, `pieceId?`, `title`, `composition`, `compositionHash`, `status: draft\|ready\|archived`, `containsSyntheticMedia`, `createdBy`, timestamps | index `by_project`, `by_piece` |
| `videoAssets` | `projectId`, `videoId?`, `kind: upload\|stock\|ai_image\|ai_clip\|voiceover\|music`, `storageId`, `mimeType`, `durationMs?`, `source {provider, externalId?, license?, attribution?, aiGenerated, model?, runId?}` | provenance is required, not optional |
| `videoRenders` | `projectId`, `videoId`, `compositionHash`, `status: queued\|running\|succeeded\|failed\|canceled`, `idempotencyKey`, `provider`, `providerRenderId`, `outputStorageId?`, `captionsStorageId?`, `costMicrousd?`, `error?` | job table per rule 13; one render per (video, hash) |

All three cascade with the project (`cascadeDeleteProject` via the registry)
and are included in export. Capability: `create` module, new verbs gated in
`lib/capabilities.ts` (e.g. `create.render`, `create.generate_media`).

## 9. Owner decisions needed (AGENTS.md §7)

| # | Question | Options | Recommendation |
|---|---|---|---|
| 1 | Render infrastructure | Remotion + AWS Lambda · Shotstack/Creatomate hosted | Remotion; confirm license tier for team size and open an AWS account. Hosted API if no AWS. |
| 2 | Voice provider + key | ElevenLabs · OpenAI TTS · Google TTS | ElevenLabs (timestamps endpoint removes an alignment step) |
| 3 | Who pays for AI clips | Included credits per plan · pass-through top-up · off by default | Off by default; small monthly allowance on paid plans; hard budget |
| 4 | AI disclosure wording and placement | end card · corner label · metadata only | Metadata always + platform label; legal to decide on-video text |
| 5 | Stock attribution | Visible credit in description · none (keep default limits) | Visible credit; unlocks free unlimited Pexels quota |

Until these are answered the safe path is: build the storyboard + editor +
preview (no spend, no external accounts) and keep render/TTS/clips in
`needs_setup`.

## 10. Proposed tickets (cut when started, per `docs/tickets/README.md`)

| Ticket | Scope | Depends on | Acceptance (examples) |
|---|---|---|---|
| **V0** spike | Render one 30 s composition via Remotion Lambda and via Shotstack; measure time, cost, preview parity | owner #1 | Written numbers; ADR |
| **V1** storyboard + editor | Tables, `create.video_storyboard` agent with validators, scene-card editor, `@remotion/player` preview, uploads + brand graphics + stock | T2.9 gateway | Narration-fidelity validator rejects a rewritten script; cross-tenant tests for every new function |
| **V2** voice + captions | TTS through the gateway, alignment → `wordTimings`, VTT export | owner #2 | Caption timings within 100 ms of audio; budget refusal tested |
| **V3** render job | `RenderProvider`, job states, webhook/poll, storage copy, download, Promote hand-off by ref | V0 decision | Browser redirect or client call can never set `succeeded`; retry is idempotent |
| **V4** AI clips | Veo adapter (Kling fallback), approval before spend, provenance + disclosure flag | T2.12, owner #3/#4 | No clip generated without an approval record; synthetic flag reaches Promote |

Deferred: avatars, voice clone, multilingual dubbing, music generation,
multi-track timeline.

## Sources

- Remotion licensing and Lambda: https://www.remotion.dev/docs/license/pricing,
  https://www.remotion.dev/docs/lambda, https://www.therundown.ai/tools/remotion
- Veo 3.1 pricing: https://ai.google.dev/gemini-api/docs/pricing
- Video model price comparison: https://www.buildmvpfast.com/api-costs/ai-video,
  https://modelslab.com/blog/api/veo-3-1-vs-kling-3-sora-2-ai-video-api-cost-2026
- Sora API removal: https://help.openai.com/en/articles/20001152-what-to-know-about-the-sora-discontinuation
- ElevenLabs timestamps: https://elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps;
  pricing: https://elevenlabs.io/pricing/api
- Shotstack vs Creatomate: https://creatomate.com/compare/shotstack-alternative,
  https://www.wireflow.ai/blog/creatomate-vs-shotstack
- Mediabunny: https://mediabunny.dev/
- Pexels API: https://www.pexels.com/api/documentation/
- HeyGen API pricing: https://www.g2.com/articles/heygen-api-pricing
- EU AI Act Article 50: https://artificialintelligenceact.eu/transparency-rules-article-50/,
  https://digital-strategy.ec.europa.eu/en/policies/guidelines-ai-transparency-obligations
