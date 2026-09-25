# MOSAI Camera Coach & Authentic Media: implementation plan

Scope: MD-0 through MD-3 of `INTEGRATION-PLAN.md` Wave 4, expanded into
buildable tickets. Deferred: live in-browser CV coach, video, Creative
AI/Canva/Adobe. Cloudinary vs self-hosted stays an owner decision (D4).

## 1. Critical review vs current code

**What exists today**

- `src/convex/media.ts` (62 lines) is Sell-only: `setPrimary` and `setAlt`
  write raw `url`/`alt` onto `productMedia`. No storage handling, no
  ownership beyond `moduleMutation("sell")` + `access.ownedRow`. This is
  correctly scoped and should not become the media domain (integration plan
  agrees, `INTEGRATION-PLAN.md:183`).
- `projectFiles` (`src/convex/schema.ts:1089-1112`) already has most of what
  the blueprint's `mediaAssets` wants: `storageId`, `mimeType`, `sizeBytes`,
  `source` (`upload|owner_site|stock`), `attribution` (Pexels object, typed
  to one provider literal), `excerpt` for AI grounding. It is missing
  `kind`, `role`, `width`/`height`, `checksum`, `authenticity`,
  `derivedFromFileId`, `processingStatus`: all additive, per the integration
  plan.
- `src/convex/stock.ts` (`"use node"`, 230 lines) is a solid template for
  provider work: idempotent import (`findStockFile` before re-download),
  `safeFetchBytes` with `allowedContentTypes`/`allowedHosts`, per-user quota,
  24h shared search cache in `stockStore.ts`, provider timeout via
  `AbortSignal.timeout`, `redirect: "error"`. New media actions should copy
  this shape rather than invent a new one.
- `src/convex/lib/pexels.ts` (166 lines) is pure request-building/parsing -
  no side effects, easy to unit test. Good model for a `presets.ts`/
  `qualityChecks.ts` pure-function module.
- Owner-site import (`importOwnerPhoto`, `stock.ts:214-229`) re-validates the
  URL against `project.websiteScan.images` server-side rather than trusting
  the client: this is the pattern MD tickets must reuse for any
  "pick from your library" flow (AGENTS rule 3).
- `PostsCard.tsx` already renders `post.mediaUrl` + `post.attribution` with a
  "Photo by …" credit line and a download button. It has no swap/replace
  control yet: that's exactly MD-0's picker gap.
- No `sharp`, `cloudinary`, or any image-processing dependency in
  `package.json` today. No existing Convex action does pixel-level image
  work; everything under `"use node"` (`stock.ts`, `research.ts`, `ai.ts`,
  `buildChat.ts`, `scraping.ts`) does fetch/text/LLM work only.

**What Convex can and cannot do for image processing**

- Convex has two runtimes: the default V8 isolate (queries/mutations, no
  Node APIs, no native modules) and Node actions (`"use node"`, real
  Node.js, can `npm install` node_modules). Node actions run in a managed,
  ephemeral, non-persistent-disk environment; they are not a general
  container. `sharp` ships prebuilt native (libvips) binaries per
  platform/arch and downloads/postinstalls them; this has repeatedly broken
  in serverless bundlers (esbuild/webpack) and non-Debian/non-glibc deploy
  targets unless the exact runtime triple is pinned. Convex does not publish
  a guarantee that its Node action runtime matches a prebuilt `sharp` binary,
  and the codebase has zero precedent for bundling a native dependency into
  a Convex action.
- Practical read: **do not build MD-2's post-capture quality feedback in
  pure Convex + sharp as a default assumption.** Two safe paths:
  (a) do the *check* (not transform) in pure JS/TS with no native deps -
  blur/exposure heuristics can run on downsampled pixel data decoded via a
  pure-JS/WASM decoder (e.g. `@jsquash/*` or `jpeg-js`), which is
  Node-action-safe and testable; or
  (b) treat real enhancement/derivative-rendering as provider work behind an
  interface, calling Cloudinary (or another HTTP-based transform API) from a
  Node action the same way `stock.ts` calls Pexels: no native deps, and it
  is an outbound HTTP call MOSAI already knows how to guard (`safeFetch`
  patterns) and receipt.
  This plan's tickets follow that split: MD-2a ships a deterministic,
  dependency-light *quality checker* (blur/exposure/resolution score) that
  works with zero provider; MD-2b, gated on the owner's D4 decision, adds a
  real enhancement/derivative *provider* behind a swappable interface with a
  no-op implementation as the default.
- What is overbuilt for a small-business MVP in the blueprint: the full
  `src/convex/media/{assets,uploads,variants,processing,quality,lineage,
  usage,policy}.ts` split (8 files) before there is a second consumer of any
  of them; per-channel derivative rendering for 6+ aspect ratios before a
  single "does the picture look OK" check ships; live in-browser CV coaching
  (camera permissions, frame-rate CV, device fragmentation risk) before a
  post-capture check is even live; a `MediaIntegrity`/`mediaOperations` audit
  trail with per-operation typed unions before there is any operation other
  than "uploaded" and "cropped". All deferred here in favor of the smallest
  vertical slice: pick → check → (optional) fix → use, on one table.

## 2. Tickets

Numbering continues the integration plan's MD-0..MD-3, split for size.
Order below is the required build order; each ticket is one PR.

### MD-0: Picture picker (kit posts + Create), no schema change
- **Goal**: one component, one entry point, to browse/search/pick a picture
  from `projectFiles` (owner uploads, `owner_site`, `stock`) and swap it into
  a kit post or a Create editor block. Read-only against existing data.
- **Files**: new `src/components/app/media/MediaPicker.tsx` (dialog: tabs
  "Your files" / "From your website" / "Stock photos", reusing
  `stock.searchPhotos`/`importStockPhoto`/`importOwnerPhoto` and a query
  listing `projectFiles` by `source`); wire into `PostsCard.tsx` (replace the
  static `<img>` with picker trigger + existing attribution rendering) and
  the Create editor's image block. No new Convex functions if a `by_project`
  list query already exists on `projectFiles` (check `ProjectFiles.tsx`'s
  query first: `src/components/app/ProjectFiles.tsx:12`); otherwise add one
  read-only query, ownership-checked (`requireProject`/`access.ownedRow`).
- **Schema**: none.
- **Tests**: component test for picker selection updating the kit post
  mutation that sets `mediaUrl`/`attribution` (find or add that mutation);
  a11y test (keyboard reachable dialog, labeled tabs, focus trap/return).
- **Acceptance**: from a kit post or Create block, a user can open the
  picker, search stock, pick an owner/site photo, and see the swap reflected
  without a page reload; attribution renders for stock picks; empty/loading/
  error states shown per module standard (AGENTS §6).
- **Dependencies**: none (uses existing `stock.ts`).
- **Size**: M.

### MD-1: `projectFiles` media fields + child tables (schema only)
- **Goal**: extend `projectFiles` additively so a row can describe an image's
  kind/role/dimensions/authenticity/lineage, and add child tables for
  variants and usage, per `INTEGRATION-PLAN.md:174-179`.
- **Files**: `src/convex/schema.ts` (extend `projectFiles`; add
  `mediaVariants`, `mediaUsage` tables); `src/convex/lib/dataRegistry.ts`
  (register both new tables: project scope, `cascade-with-project`,
  `by_project` deletion, per the `project()` helper at
  `src/convex/lib/dataRegistry.ts:41-45`); `src/convex/dal.ts` if
  `cascadeDeleteProjectStep` needs the two new tables added (check whether
  it walks the registry or a hard-coded list: AGENTS rule 12 forbids a
  hard-coded table list).
- **Schema** (additive on `projectFiles`):
  ```ts
  kind: v.optional(v.union(v.literal("image"), v.literal("video"), v.literal("document"))),
  role: v.optional(v.union(
    v.literal("product"), v.literal("food"), v.literal("venue"),
    v.literal("people"), v.literal("brand"), v.literal("social"),
    v.literal("campaign"), v.literal("general"),
  )),
  width: v.optional(v.number()),
  height: v.optional(v.number()),
  checksum: v.optional(v.string()),
  authenticity: v.optional(v.union(
    v.literal("original"), v.literal("authentic_transform"), v.literal("generative_edit"),
  )),
  derivedFromFileId: v.optional(v.id("projectFiles")),
  processingStatus: v.optional(v.union(
    v.literal("uploading"), v.literal("processing"), v.literal("ready"), v.literal("failed"),
  )),
  // source union gains "camera" alongside upload|owner_site|stock
  ```
  New tables `mediaVariants` (`{ projectFileId, preset, storageId, width,
  height, createdAt }`, index `by_file`) and `mediaUsage` (`{ projectFileId,
  module, referenceId, referenceType, createdAt }`, index `by_file` and
  `by_project`-via-join or a denormalized `projectId`). `productMedia` gains
  `projectFileId: v.optional(v.id("projectFiles"))`.
- **Tests**: schema/type check only (`bun convex dev --once && bun tsc -b`);
  `audit:functions`/data-registry audit green; a migration note confirming
  existing rows are unaffected (all new fields optional).
- **Acceptance**: `bun run check:codegen` clean; no runtime behavior change;
  registry audit passes for the two new tables.
- **Dependencies**: none.
- **Size**: S.

### MD-2a: Post-capture quality check (deterministic, no provider)
- **Goal**: after upload, score the image for blur/exposure/resolution using
  pure JS/WASM decoding (no native deps), write the result onto
  `projectFiles.processingStatus` plus a `qualityScore`/`qualityFlags` field,
  and surface it in the upload UI ("This photo looks a little dark: want
  tips, or use it anyway?").
- **Files**: `src/convex/mediaLibrary/quality.ts` (new folder, per
  `INTEGRATION-PLAN.md:183-184`: do not add `src/convex/media/`); a pure
  scoring module `src/lib/media/qualityChecks.ts` (unit-testable, takes
  decoded pixel data, returns `{ blurScore, exposureScore, flags[] }`); wire
  into the existing upload path (find current upload mutation/action -
  likely referenced from `ProjectFiles.tsx`) to run the check as a follow-up
  action, not inline in the mutation (AGENTS rule 13: no CPU-heavy work in a
  query/mutation: use an action queued after `ctx.storage.store`).
- **Schema** (additive on `projectFiles`): `qualityScore: v.optional(v.number())`,
  `qualityFlags: v.optional(v.array(v.union(v.literal("blurry"),
  v.literal("too_dark"), v.literal("too_bright"), v.literal("low_resolution"))))`.
- **Tests**: unit tests for `qualityChecks.ts` against fixture images (sharp
  test image, dark test image, low-res test image: store as small fixtures,
  not generated at test time); integration test that upload triggers the
  action and status transitions `processing -> ready`.
- **Acceptance**: uploading a deliberately dark/blurry test image shows a
  flag in the UI within the job's normal latency; a normal photo shows no
  flag; failure of the check never blocks the upload (`processingStatus:
  "failed"` still leaves the file usable, per rule 5: no fake success, but
  also no fake failure of the underlying upload).
- **Dependencies**: MD-1 (schema fields).
- **Size**: M.

### MD-2b: Enhancement/derivative provider interface (owner-gated)
- **Goal**: define one `MediaProvider` interface (`enhance(original) ->
  variant`, `crop(original, preset) -> variant`) with a deterministic no-op
  implementation (returns the original unchanged, `authenticity:
  "authentic_transform"` only if an actual transform ran) and, only if the
  owner has decided D4, a Cloudinary-backed implementation behind an env
  flag. Do not build this until the owner picks Cloudinary vs self-hosted.
- **Files**: `src/convex/mediaLibrary/processing.ts` (interface + no-op
  provider), `src/convex/mediaLibrary/providers/cloudinary.ts` (only after
  D4, separate PR).
- **Schema**: none beyond MD-1's `mediaVariants`.
- **Tests**: contract test against the interface (same test suite runs
  against no-op and, later, Cloudinary provider); receipt stored on every
  variant row (provider name + external id) per AGENTS rule 6.
- **Acceptance**: with no provider configured, the app shows `needs_setup`
  for "auto-enhance" rather than fabricating a result; crop presets (MD-2c)
  still work with the no-op provider since cropping to a stored preset needs
  no native image library, only stored crop coordinates + `<img>`
  `object-position`/CSS, deferring pixel re-encoding entirely.
- **Dependencies**: MD-1; owner decision D4.
- **Size**: M (S if scoped to no-op + crop-coordinates only, which is
  recommended for v1).

### MD-2c: Crop presets as versioned data
- **Goal**: a static, versioned table of channel presets (website hero
  16:9, website card 4:3, social 1:1, social 4:5, story 9:16, ad 1:1/1.91:1)
  as plain TS data, not a schema table: presets change with product
  decisions, not per project.
- **Files**: `src/lib/media/presets.ts` (`export const MEDIA_PRESETS =
  [...] as const`, each with `id`, `label`, `ratio`, `module` tag); consumed
  by the picker (MD-0 follow-up) to offer "use for" hints and by MD-2b's
  crop step to store `{ x, y, width, height }` crop rectangles on
  `mediaVariants` rather than re-encoded pixels, so v1 needs zero image
  library: the browser renders the crop via CSS `object-fit`/`object-
  position` from stored coordinates, and only MD-2b's real provider (if
  built) burns the crop into pixels.
- **Schema**: none (presets are code, not data); `mediaVariants.preset`
  (added in MD-1) stores the preset id as a string.
- **Tests**: snapshot test that preset ids are stable (renaming one breaks
  stored `mediaVariants.preset` values); unit test for the crop-rectangle
  math (aspect-ratio-constrained crop given a source width/height).
- **Acceptance**: picker (MD-0) can show "recommended crop" per module
  without any provider call.
- **Dependencies**: MD-1.
- **Size**: S.

### MD-3: Camera capture (plain `getUserMedia`, no live CV)
- **Goal**: let a user take a photo directly in-browser (mobile-first) as an
  alternative to file upload, storing the result exactly like an upload
  (`source: "camera"`). No live framing guidance, no CV overlay: just a
  capture UI with a static "what to shoot" checklist read from a simple shot
  list (hard-coded per role for v1, not the full shot-planner agent).
- **Files**: `src/components/app/media/CameraCapture.tsx` (video element +
  `getUserMedia`, capture-to-canvas-to-blob, permission-denied state, a
  device-not-available state); reuse the existing upload action/mutation
  path unchanged (capture produces the same `Blob` an `<input type=file>`
  would, so it flows through MD-1's `source: "camera"` and MD-2a's quality
  check with no new backend surface).
- **Schema**: none beyond MD-1's `source` literal gaining `"camera"`
  (already planned in MD-1).
- **Tests**: component test for permission-denied and no-camera fallbacks
  (mock `navigator.mediaDevices.getUserMedia` rejecting); a11y test (capture
  button reachable, live region announces "photo captured").
- **Acceptance**: on a device with a camera, user captures a photo and it
  appears in the project's media library with the same states as an upload
  (uploading/processing/ready/failed); on a device without camera access,
  the entry point is hidden or shows a clear fallback to file upload, never
  a silent failure.
- **Dependencies**: MD-1, MD-2a.
- **Size**: M.

## 3. UX: single picture-picker entry points and wording

**One picker, four call sites.** `MediaPicker` (MD-0) is the only place a
user chooses a picture; every module opens the same dialog instead of a
bespoke uploader:
- **Kit posts** (`PostsCard.tsx`): a small "Change picture" button under the
  post image, opening the picker pre-scoped to the post's role (social).
- **Create editor** (image block): the existing "insert image" affordance
  opens the picker instead of a bare upload input; picker defaults to the
  block's aspect hint from `MEDIA_PRESETS` (MD-2c).
- **Build** (website hero/card sections): "Change photo" on a section opens
  the picker filtered to `role: "venue"|"brand"|"general"` with the
  section's preset (16:9 hero, 4:3 card) shown as a crop guide.
- **Sell** (`productMedia`): `media.ts`'s `setPrimary` stays the underlying
  mutation, but the UI that calls it opens `MediaPicker` scoped to
  `role: "product"` instead of a raw URL field, and on selection writes both
  `url` and the new optional `projectFileId` (MD-1) so product photos join
  the same library.

**Wording** (matches blueprint §3, "no moralistic tone"):
- Tabs: "Your photos", "From your website", "Stock photos": not "uploads"
  vs "AI" vs "external".
- Camera entry point: "Take a photo" (not "Camera Coach", not "scan").
- Quality nudge (MD-2a): "This photo looks a little dark. Use it anyway, or
  try another?": always offers "use it anyway", never blocks.
- Crop/enhance labels stay as the blueprint specifies: "Authentic
  enhancement" for anything in MD-2a/MD-2b's no-op+crop scope, reserving
  "Creative edit" for the explicitly deferred generative path so the wording
  is already correct when that ships later.
- Attribution stays exactly as `PostsCard.tsx` renders it today ("Photo by
  {photographer}", linked): do not change working, guideline-compliant
  copy.

## 4. Owner decisions needed before certain tickets

1. **D4: Cloudinary vs self-hosted processing** (blocks MD-2b only; MD-2a/
   MD-2c/MD-0/MD-1/MD-3 need no decision). Recommendation: start MD-2b with
   the no-op provider plus stored-crop-coordinates only; defer any real
   pixel transform (auto-enhance, burned-in crop, format conversion beyond
   what the browser already does) until there's a paying reason, since it is
   the only ticket in this set that adds recurring cost or a new vendor.
2. **Privacy disclosure for camera capture** (MD-3): browser camera access
   needs a clear, plain-language permission prompt context before triggering
   `getUserMedia` (why MOSAI wants the camera, that photos stay in the
   project, no background capture). Needs product/legal sign-off on exact
   wording; flag as a blocking question for MD-3, not a guess.
3. **Storage cost/retention for variants** (MD-1/MD-2b): if `mediaVariants`
   ever stores re-encoded pixels (post-D4, only if Cloudinary or similar is
   chosen), confirm whether variants are cached indefinitely or regenerated
   on demand: affects Convex storage cost and the `cascadeDeleteProject`
   cleanup path. Not blocking for MD-1 to MD-3 since v1 stores crop
   coordinates, not pixels.
