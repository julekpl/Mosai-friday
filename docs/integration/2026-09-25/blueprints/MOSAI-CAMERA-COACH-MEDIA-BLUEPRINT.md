> **MOSAI status (25 Sep 2026): authentic-first media, no vendor.**
>
> - **Adopted now:** `projectFiles` is the one media record, extended additively (MD-1), not a new `mediaAssets` table or `src/convex/media/` folder; one MediaPicker ("Your photos" first, then website and stock) wired into kit posts (MD-0); "take a photo" is the phone camera via `capture` on the upload input; originals are never replaced; outcome words only ("Ready", "Usable", "Retake recommended"), never a numeric score.
> - **After U12:** post-upload quality note (MD-2a), browser-side checks only.
> - **Deferred or cut (D4):** live in-browser camera coaching, shot planner, crop presets and `mediaCrops` (renamed from `mediaVariants`), server-side enhancement (`sharp` spike first), Cloudinary, Adobe, Canva, Creative AI edits, video.
> Binding plan: `../MVP-BLUEPRINT-PLAN.md` (sections 3, 9 and 10 win over this file). Owner decisions: `../OWNER-DECISIONS.md`. Where this blueprint and the plan disagree, follow the plan. The original blueprint text below is kept unchanged for reference.

---

# MOSAI Camera Coach, Authentic Media Enhancement & Multi-Channel Asset Blueprint

**Status:** implementation blueprint  
**Date:** 25 September 2026  
**Target:** MOSAI Media capability  
**Audience:** product owner, UX designer, frontend/mobile-web engineer, backend engineer, media pipeline engineer, Codex/AI coding agent  
**Primary principle:** improve authentic source media before offering generative alteration

---

# 0. Executive decision

MOSAI should not become another image editor.

It should solve a different problem:

> **A small-business owner has a phone and a real business. MOSAI tells them what to shoot, helps them capture it well, improves the authentic media automatically, and prepares every useful website/social/ad/product format without making them learn photography or design.**

Architecture:

```text
MOSAI context
    ↓
Shot planner
    ↓
Camera Coach
    ↓
Original immutable asset
    ↓
Technical quality analysis
    ↓
Authenticity-preserving enhancement
    ↓
Focal-point / safe-crop analysis
    ↓
Channel derivatives
    ↓
Media Library
    ↓
Build / Sell / Create / Promote
```

Generative editing is a separate explicit path:

```text
Original
  ├→ Authentic derivatives
  └→ Creative AI derivatives (opt-in, clearly labeled)
```

---

# 1. Goals

## 1.1 User goals

A café owner, restaurant owner, shop owner or small e-commerce operator should be able to:

1. Open MOSAI on a phone.
2. Be told what photographs/videos would help the current marketing objective.
3. Get live, simple guidance while framing.
4. Capture authentic source media.
5. Have MOSAI improve technical quality automatically.
6. Receive correct crops/outputs for website, social, ads and product feeds.
7. Keep the original untouched.
8. Edit/override when desired.
9. Explicitly choose generative editing only when desired.
10. Reuse assets across MOSAI modules.

## 1.2 Business value

MOSAI should remove four skill barriers:

```text
"What should I photograph?"
"How do I take it?"
"How do I improve it?"
"What sizes/formats do I need?"
```

The product should answer all four.

---

# 2. Product philosophy

## 2.1 Three media modes

### Authentic

Default.

Allowed transformations:

- EXIF orientation correction;
- exposure/brightness adjustment;
- white balance/color balance;
- contrast;
- shadows/highlights;
- restrained saturation;
- noise reduction;
- restrained sharpening;
- horizon/rotation correction;
- perspective correction where deterministic;
- resize;
- crop;
- compression;
- output format/color-space normalization;
- metadata handling according to policy.

No synthetic content.

### Smart

Still default-safe.

Uses computer vision/ML to understand media without inventing scene content:

- subject detection;
- face detection where needed;
- focal-point detection;
- blur/shake scoring;
- exposure/clipping scoring;
- horizon estimation;
- safe-area estimation;
- smart crop;
- product occupancy;
- best-frame selection;
- shot completeness;
- scene/category classification.

### Creative AI

Opt-in only.

Examples:

- remove object/person;
- replace background;
- generative expand;
- change scene;
- insert object;
- restyle;
- synthesize missing pixels.

Any derivative using generative pixels must be labeled in metadata and UI.

---

# 3. Authenticity contract

Every asset stores lineage.

```ts
type MediaIntegrity = {
  sourceAssetId?: Id<"mediaAssets">;

  authenticity:
    | "original"
    | "authentic_transform"
    | "generative_edit";

  operations: MediaOperation[];

  syntheticPixels: boolean;
};
```

Examples:

```text
rotation            syntheticPixels=false
crop                false
brightness          false
white_balance       false
sharpen             false
noise_reduction     false

generative_fill     true
object_remove_ai    true
background_replace  true
```

Do not present these modes with moralistic wording.

Present them as:

```text
Authentic enhancement
Creative edit
```

---

# 4. Immutable original

Never destructively edit the user's original.

Asset tree:

```text
Original
   │
   ├→ Enhanced Master
   │      ├→ Website Hero 16:9
   │      ├→ Website Card 4:3
   │      ├→ Social 1:1
   │      ├→ Social 4:5
   │      ├→ Story/Reel 9:16
   │      └→ Google Ads 1:1 / 1.91:1
   │
   └→ Creative Variant
          └→ explicit opt-in
```

This makes:

- undo;
- new crop;
- provider migration;
- future enhancement algorithms;
- audit;
- re-export

possible without quality loss.

---

# 5. One Media Library for MOSAI

Your current `src/convex/media.ts` is mainly a product-media URL/alt-text setter.

Do not extend that into dozens of ad hoc fields.

Create a shared media domain used by:

```text
Build
Sell
Create
Promote
Content
Social
Ads
Brand
```

Suggested:

```text
src/convex/media/
  assets.ts
  uploads.ts
  variants.ts
  processing.ts
  quality.ts
  lineage.ts
  usage.ts
  policy.ts

src/lib/media/
  contracts.ts
  presets.ts
  cropSafety.ts
```

---

# 6. Media data model

## 6.1 `mediaAssets`

```ts
{
  projectId,
  organizationId,
  ownerId,

  kind: "image" | "video",

  role:
    | "product"
    | "food"
    | "venue"
    | "people"
    | "brand"
    | "social"
    | "campaign"
    | "general",

  status:
    | "uploading"
    | "processing"
    | "ready"
    | "failed"
    | "archived",

  provider,
  providerAssetId,

  originalFilename,
  mimeType,
  bytes,
  width,
  height,
  durationMs,

  sourceAssetId,
  authenticity,
  syntheticPixels,

  version,
  checksum,

  createdAt,
  updatedAt
}
```

## 6.2 `mediaOperations`

```ts
{
  assetId,
  operation,
  version,
  parameters,
  provider,
  deterministic,
  syntheticPixels,
  createdAt
}
```

## 6.3 `mediaVariants`

```ts
{
  sourceAssetId,
  derivedAssetId,

  presetId,
  purpose,
  targetWidth,
  targetHeight,
  aspectRatio,

  focalPoint,
  safeArea,

  createdAt
}
```

## 6.4 `mediaUsage`

Track where an asset is used:

```text
website hero
product ABC
Instagram campaign X
Google ad group Y
email campaign Z
```

This enables impact analysis and safe replacement.

---

# 7. Provider abstraction

Create:

```ts
interface MediaProcessingProvider {
  analyze(asset: MediaAssetRef): Promise<MediaAnalysis>;

  enhanceAuthentic(
    asset: MediaAssetRef,
    recipe: AuthenticRecipe
  ): Promise<ProcessedAssetRef>;

  createVariant(
    asset: MediaAssetRef,
    preset: MediaPreset
  ): Promise<ProcessedAssetRef>;

  processVideo?(
    asset: MediaAssetRef,
    recipe: VideoRecipe
  ): Promise<ProcessedAssetRef>;
}
```

Possible providers:

```text
CloudinaryProvider
SharpWorkerProvider
AdobePhotoshopProvider
future provider
```

The rest of MOSAI never stores Cloudinary transformation strings as domain logic.

---

# 8. Recommended MVP implementation

## 8.1 Cloudinary as transformation/delivery provider

Cloudinary is a strong MVP fit because its current platform supports:

- uploaded original assets;
- on-the-fly/eager transformations;
- resizing/cropping;
- image optimization;
- automatic format selection;
- automatic quality;
- color/brightness/contrast operations;
- content-aware image cropping;
- content-aware video cropping. [S5][S6][S7][S8]

Use it **behind MOSAI's provider interface**.

Do not make Cloudinary URLs the canonical media model.

### Why not Canva as the core processor?

Canva is oriented toward designs/templates/assets/exports. Its REST API can create designs, use image assets, autofill compatible templates and export formats such as JPG/PNG/MP4. [S13][S14][S15]

That is valuable for an optional "Edit design in Canva" or template-composition capability.

It is not the best foundation for MOSAI's invisible source-photo normalization pipeline.

### Why not Photoshop as the core MVP?

Adobe Photoshop API v2 is production-grade and supports ActionJSON/Actions and smart cropping. [S10][S11][S12]

It is useful for:

- controlled "Pro Enhance";
- sophisticated standardized Photoshop recipes;
- PSD/template workflows;
- product crop;
- advanced professional-processing paths.

But it adds another external processing dependency and is not required for basic authentic enhancement.

Use Adobe later behind the same interface.

### Role for Sharp

Sharp/libvips is useful for deterministic server-side processing such as normalization, resize, rotate and sharpening. Sharp documents histogram-based `normalise()` as one image-operation example. [S4]

A future MOSAI-owned worker can use Sharp to reduce vendor lock-in for deterministic transformations.

---

# 9. Camera Coach

## 9.1 Browser feasibility

`navigator.mediaDevices.getUserMedia()` is widely available and allows a secure web app to request camera/microphone access. It requires HTTPS and explicit user permission. It supports camera constraints including resolution and mobile `facingMode`; the rear camera can be preferred/requested using `environment`. [S1]

`ImageCapture.getPhotoCapabilities()` can report available photo configuration ranges, although support varies by browser/device. [S2]

OpenCV.js can consume a browser video element and process frames in JavaScript. [S3]

Therefore a browser-first MVP is feasible.

Do not promise identical camera control on every iPhone/Android/browser.

Use progressive enhancement.

---

# 10. Camera Coach architecture

```text
getUserMedia
     ↓
preview stream
     ↓
low-resolution analysis frames
     ↓
Quality Engine
     │
     ├ blur/sharpness
     ├ brightness
     ├ clipping
     ├ horizon
     ├ movement
     ├ subject bounds
     ├ safe crop
     └ composition rules
     ↓
Coach Rule Engine
     ↓
ONE instruction
     ↓
capture when quality threshold is met
```

Important:

> Do not stream every frame to an LLM.

Most live checks are numeric/computer-vision tasks and should run locally or via a lightweight CV service.

---

# 11. Camera permission UX

Do not request camera permission on app load.

User presses:

```text
Take photos with MOSAI
```

Then explain:

```text
MOSAI uses your camera only while this screen is open
to help you frame the shot.

[Allow camera]
```

Browser permission remains authoritative.

`getUserMedia()` requires secure context and user permission; browsers provide their own camera-use indicators. [S1]

---

# 12. Shot Planner

This is where MOSAI's broader context becomes differentiated.

Input:

```text
business type
current campaign
products/menu
brand
channels
existing media inventory
content gaps
```

Output:

```text
shot list
```

Example café:

```text
THIS WEEK'S SHOT LIST

1  Brunch hero
   Why: Instagram + homepage
   Take: wide table shot by a window
   Need: landscape with crop room

2  Coffee close-up
   Why: social + ad
   Take: cup from 45 degrees
   Need: square + portrait safe

3  Interior atmosphere
   Why: Google/website
   Take: wide horizontal

4  Barista process
   Why: Reel
   Take: 4-6 second vertical clip
```

The user sees the outcome, not the technical requirements.

---

# 13. Live quality metrics

## 13.1 Blur

A simple MVP can estimate sharpness using edge/laplacian variance.

Output:

```text
sharpness score
```

Do not expose score.

UX:

```text
Hold steady
```

or:

```text
Sharp ✓
```

## 13.2 Exposure

Analyze luminance histogram:

- underexposed percentage;
- clipped highlights;
- dynamic range.

UX:

```text
Too dark — move closer to the window
```

Avoid:

```text
Increase EV +0.7
```

## 13.3 Horizon

Estimate dominant horizontal/vertical lines.

UX:

```text
Tilt slightly left
```

## 13.4 Motion

Compare consecutive frames or device motion where available.

UX:

```text
Hold still
```

## 13.5 Subject size

Use CV subject/object detection.

UX:

```text
Move a little closer
```

## 13.6 Crop safety

Determine whether subject bounding box works inside required destination crops.

Example:

```text
1:1  ✓
4:5  ✓
9:16 ✓
16:9 ✕
```

User sees:

```text
Step back slightly
```

When all required variants become safe:

```text
Great framing ✓
```

---

# 14. One instruction at a time

Do not show:

```text
too dark
too tilted
too far
background clutter
bad crop
wrong ratio
```

simultaneously.

Coach prioritizes:

```text
1. capture-blocking issue
2. largest quality improvement
3. composition
```

Show one instruction.

This is fundamental to simplicity.

---

# 15. Shot-specific coaching

Different subjects need different rules.

## Product

Priorities:

```text
entire product visible
sharp
minimal perspective distortion
clean background
crop safety
```

## Food

Priorities:

```text
sharp focal dish
pleasant natural light
avoid severe highlight clipping
composition/crop safety
```

## Venue

Priorities:

```text
verticals/horizon
wide enough field
light
avoid accidental obstruction
```

## People

Priorities:

```text
face exposure
eyes sharp
headroom
avoid awkward crop joints
```

Do not pretend one scoring algorithm represents all photography.

---

# 16. Authentic enhancement recipe

Start conservatively.

Example:

```ts
type AuthenticRecipe = {
  autoOrient: true;
  exposure: "mild";
  colorBalance: "mild";
  contrast: "mild";
  saturation: "conservative";
  noiseReduction: "auto";
  sharpening: "conservative";
  preserveSkinTones: true;
  perspectiveCorrection: "if_confident";
};
```

A restaurant photo should not suddenly have neon saturation because an "enhance" endpoint is aggressive.

Provide a before/after slider when useful.

---

# 17. Generative boundary

If an operation can invent scene content, it is **not** authentic enhancement.

Examples:

```text
generative expand
remove a stranger
replace sky
replace table
add steam
add garnish
change food
add product
replace background
```

Creative edit flow:

```text
[Creative edit]

This can change what was in the original photo.

[Continue]
```

Then store:

```text
authenticity=generative_edit
syntheticPixels=true
```

Google Merchant Center currently requires AI-generated image metadata to be maintained and requires the product image to accurately display the product. [S16]

Do not use generative transformations by default for product-feed truth assets.

---

# 18. Automatic crop presets

Do not hard-code channel requirements deep in processing code.

Create data-driven:

```text
mediaPresets
```

Example:

```json
{
  "google_ads_square_v1": {
    "aspectRatio": "1:1",
    "recommendedWidth": 1200,
    "recommendedHeight": 1200,
    "safeArea": 0.8
  }
}
```

Google Ads currently recommends 1200×1200 for square Search image assets and 1200×628 for 1.91:1 landscape, with important content within a central safe area. [S17]

Google App campaign guidance also supports 1:1, 1.91:1 and 4:5 image ratios. [S18]

Because platform specs change:

```text
preset version
source URL
last verified date
```

must be stored.

---

# 19. Product image presets

Product images have different truth requirements than promotional social images.

Google Merchant Center currently says the image should accurately display the product, with minimal/no staging for the main product image; Google has announced a 500×500 minimum beginning 31 January 2027 and recommends around 1500×1500 or above where possible. [S16]

Therefore:

```text
product_feed_master
```

should preserve:

- full product;
- true color;
- no promotional text;
- no invented product details;
- sufficient resolution.

Social/ad variants can have more composition flexibility.

Do not treat every media destination the same.

---

# 20. Focal point and smart crop

Store normalized focal information:

```ts
type FocalPoint = {
  x: number; // 0..1
  y: number; // 0..1
  confidence: number;
  source: "cv" | "user";
};
```

Allow user override:

```text
Set focus
```

Then all future crops respect it.

Cloudinary supports gravity/content-aware crop strategies, while Adobe AutoCrop can detect/preserve foreground objects and generate target-aspect crops. [S7][S12]

Again, hide provider mechanics.

---

# 21. Upload pipeline

```text
select/take media
      ↓
client validation
      ↓
signed upload
      ↓
immutable original
      ↓
metadata/checksum
      ↓
quality analysis
      ↓
enhanced master
      ↓
eager critical variants
      ↓
background optional variants
      ↓
ready event
```

Cloudinary supports eager transformations after upload and incoming transformations before storage, but MOSAI should preserve the original and use eager derivatives rather than mutating the only copy. [S9]

---

# 22. Image optimization

Delivery should be optimized separately from creative enhancement.

Cloudinary supports automatic format selection and image quality optimization; its docs note automatic delivery can choose modern formats such as WebP/AVIF depending on browser/account configuration. [S5][S6]

Conceptually:

```text
content truth
≠
delivery encoding
```

You can change:

```text
JPEG → AVIF/WebP
quality compression
pixel dimensions
```

without changing the scene.

---

# 23. Video Coach

MVP video flow:

```text
MOSAI: Let's make a 15-second brunch Reel.
```

Then:

```text
SHOT 1
Entrance
3 seconds
[Record]

SHOT 2
Wide table
3 seconds
[Record]

SHOT 3
Coffee pour
4 seconds
[Record]

SHOT 4
Food close-up
4 seconds
[Record]
```

Coach can enforce:

- vertical orientation;
- minimum duration;
- motion/shake;
- exposure;
- subject visibility.

Avoid attempting cinematic AI direction in MVP.

---

# 24. Video authentic processing

Allowed default pipeline:

```text
trim dead beginning/end
orientation
stabilization when reliable
exposure/color normalization
audio loudness normalization
safe crop / reframe
compression
resolution conversion
captions if speech
brand overlay if explicitly selected
```

Cloudinary currently supports video transformations and automatic gravity for subject-aware cropping. [S19]

Synthetic B-roll or generated video stays Creative AI.

---

# 25. "Shoot for MOSAI"

This should be the hero feature.

The user chooses an objective:

```text
Promote our autumn menu
```

MOSAI derives required assets:

```text
Instagram post
Story
website banner
Google ad
```

The Shot Planner works backward:

```text
What source captures can satisfy multiple outputs?
```

Then camera overlay confirms crop coverage.

Example:

```text
This shot can cover:

✓ Instagram 4:5
✓ Story 9:16
✓ Website card
✓ Google square ad

Need a little more space on the left
```

That is more useful than a camera app because MOSAI knows the downstream jobs.

---

# 26. Media recommendation lifecycle

Agent capability:

```text
media.shot_plan.v1
```

Produces:

```text
ShotPlan artifact
```

Camera produces:

```text
media.captured.v1
```

Pipeline produces:

```text
media.asset.ready.v1
```

MOSAI then knows:

```text
content task X now has usable media
website hero requirement fulfilled
campaign has 3/4 assets
```

This integrates with the Future-Proof Agent architecture rather than becoming a separate product.

---

# 27. Canva integration

Use Canva optionally for **design composition**, not core repair.

Flow:

```text
enhanced authentic photo
   ↓
MOSAI creative/template
   ↓
optional Canva design
   ↓
text/logo/offer
   ↓
export
```

Canva REST APIs support design creation, asset-based designs, template/autofill flows for eligible plans, and exports including JPEG/PNG/MP4. [S13][S14][S15]

MVP recommendation:

```text
[Edit design]
```

can initially use MOSAI's own lightweight template layer.

Canva integration becomes an optional advanced handoff later.

---

# 28. Adobe Photoshop API integration

Photoshop API v2 is now Adobe's current production line; v1 reached end-of-life in July 2026 according to Adobe's current documentation. [S10]

Potential MOSAI uses:

```text
Pro Enhance recipe
controlled ActionJSON pipeline
product crop
PSD/template operations
enterprise brand workflows
```

Photoshop Actions can run recorded adjustment sequences programmatically. [S11]

Adobe AutoCrop supports target-aspect smart crop and priority-object crop. [S12]

Keep this behind:

```text
AdobePhotoshopProvider
```

Never let product logic depend directly on Adobe ActionJSON.

---

# 29. User controls

For every asset:

```text
Original
Enhanced
```

Actions:

```text
Use enhanced
Use original
Adjust crop
Set focus
Compare
Restore
Creative edit...
```

Do not expose:

```text
gamma
histogram percentile
JPEG subsampling
unsharp mask sigma
```

unless an advanced mode is deliberately added later.

---

# 30. Automatic versus manual

Default:

```text
MOSAI recommends one enhanced result.
```

Manual controls remain available.

If user dislikes result:

```text
[Keep original]
[Less enhancement]
[Adjust]
```

Feedback becomes useful:

```text
preference: lower saturation
```

Do not globally learn a project preference from one accidental click. Require repeated behavior or explicit setting.

---

# 31. Privacy and sensitive media

Media can contain:

- people;
- children;
- addresses;
- license plates;
- documents/screens;
- private interiors.

MVP should:

- disclose processing/provider use;
- avoid automatic face identity recognition;
- not infer sensitive traits;
- support asset deletion;
- respect organization/project access controls;
- use signed/private access for non-public media;
- keep provider scopes minimal.

Do not build person recognition into Camera Coach.

Face detection for crop/exposure can be performed without identity recognition.

---

# 32. Performance

Live coach:

```text
run low-resolution frame analysis
5-10 fps is often sufficient
```

Do not process 4K frames continuously.

Capture high-resolution still only when user presses shutter.

Architecture:

```text
preview analysis locally
        ↓
capture original
        ↓
upload once
```

This saves bandwidth/cost.

---

# 33. Offline/poor network behavior

Camera Coach should still provide basic local guidance without upload where possible.

Queue capture locally until network available if platform/browser constraints permit.

At minimum:

```text
captured
upload pending
```

must not lose the user's photo.

---

# 34. Failure behavior

Examples:

### CV unavailable

```text
Camera guidance is limited on this device.
You can still take the photo.
```

### Enhancement provider fails

```text
Your original is safe.
We couldn't create the enhanced version.
[Try again]
```

### Crop impossible

```text
This photo works for square and portrait,
but not a wide website banner.

[Take another wide photo]
[Crop manually]
```

Never invent missing pixels automatically in Authentic mode.

---

# 35. Quality score

Internally:

```text
technical
composition
destination fitness
```

Do not show a humiliating:

```text
Photo score: 42/100
```

Use outcome language:

```text
Ready
Usable
Retake recommended
```

Reasons:

```text
Too dark
Subject cut off in Story format
Heavy blur
```

---

# 36. Recommended MVP milestones

## M0 Media foundation

- `mediaAssets`;
- immutable originals;
- provider abstraction;
- signed upload;
- image metadata;
- Media Library.

## M1 Authentic image pipeline

- orientation;
- conservative exposure/color/contrast;
- resize/compression;
- enhanced master;
- before/after;
- restore original.

## M2 Variant engine

- data-driven preset registry;
- 1:1, 4:5, 9:16, 16:9, 1.91:1;
- focal-point/crop;
- user crop override.

## M3 Camera Coach basic

Browser camera:

- rear camera;
- blur;
- brightness;
- horizon;
- simple subject center/safe area;
- one instruction at a time.

## M4 Shoot for MOSAI

- shot-plan capability;
- café/product/local-business templates;
- objective → required assets → capture flow.

## M5 Video capture

- shot sequence;
- duration/orientation/shake checks;
- authentic video derivatives.

## M6 Optional professional/creative providers

- Adobe Photoshop API provider;
- Canva handoff/template provider;
- explicit Creative AI provider.

Do not start M6 before M0-M4 prove user value.

---

# 37. File-level plan

```text
src/convex/media/
  assets.ts
  uploads.ts
  processing.ts
  variants.ts
  lineage.ts
  quality.ts
  usage.ts
  policy.ts

src/lib/media/
  contracts.ts
  provider.ts
  presets.ts
  authenticRecipes.ts
  cropSafety.ts

src/lib/media/providers/
  cloudinary.ts
  sharp.ts          // later/self-hosted worker
  adobe.ts          // later

src/components/media/
  MediaLibrary.tsx
  MediaAssetCard.tsx
  BeforeAfter.tsx
  CropEditor.tsx
  AuthenticityBadge.tsx

src/components/camera/
  CameraCoach.tsx
  CameraPreview.tsx
  CoachInstruction.tsx
  ShotList.tsx
  CropCoverage.tsx
```

Client-side CV:

```text
src/lib/camera/
  quality.ts
  exposure.ts
  sharpness.ts
  horizon.ts
  motion.ts
  cropSafety.ts
```

---

# 38. Testing

## Device matrix

At minimum:

```text
current iPhone Safari
current Android Chrome
desktop Safari
desktop Chrome
slow network
camera denied
single camera device
multiple cameras
```

## Image fixtures

```text
dark café
bright window
food
coffee cup
packaged product
reflective object
white product on white background
people
busy interior
portrait subject
landscape venue
blurry capture
rotated EXIF
HEIC/JPEG/PNG where supported
```

## Regression tests

Ensure authentic pipeline does not:

- alter product shape;
- remove objects;
- invent pixels;
- change logos/text;
- severely shift skin/food color;
- clip important subject;
- overwrite original.

---

# 39. User-value acceptance criteria

- [ ] User can capture a useful image without knowing photography terms.
- [ ] Coach shows one actionable instruction at a time.
- [ ] Original is always preserved.
- [ ] Default enhancement does not generate scene content.
- [ ] One source can produce multiple channel-ready crops.
- [ ] User can override focal point/crop.
- [ ] User can use original instead.
- [ ] Product truth asset remains suitable for product feeds.
- [ ] Media is reusable across MOSAI modules.
- [ ] Shot planner is informed by current marketing objective.
- [ ] Generative editing is clearly optional.

---

# 40. Architecture acceptance criteria

- [ ] Processing provider can be swapped.
- [ ] Channel presets are data/version driven.
- [ ] No Canva/Cloudinary/Adobe IDs leak into high-level MOSAI contracts.
- [ ] Every derivative has source lineage.
- [ ] Every generative derivative is marked.
- [ ] Camera Coach works without LLM calls for frame-by-frame guidance.
- [ ] Live camera analysis is bounded for CPU/battery.
- [ ] Provider failure never loses original.
- [ ] User/project permissions guard all originals and variants.

---

# 41. Sources

**Browser camera / CV**

- [S1] MDN `MediaDevices.getUserMedia()`: https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia
- [S2] MDN `ImageCapture.getPhotoCapabilities()`: https://developer.mozilla.org/en-US/docs/Web/API/ImageCapture/getPhotoCapabilities
- [S3] OpenCV.js video capture example: https://docs.opencv.org/4.13.0/js_video_display.html

**Deterministic processing**

- [S4] Sharp image operations: https://sharp.pixelplumbing.com/api-operation/

**Cloudinary**

- [S5] Image transformations: https://cloudinary.com/documentation/image_transformations
- [S6] Image optimization: https://cloudinary.com/documentation/image_optimization
- [S7] Gravity/content-aware image crops: https://cloudinary.com/documentation/gravity_transformations_tutorial
- [S8] Image effects/enhancements: https://cloudinary.com/documentation/effects_and_artistic_enhancements
- [S9] Upload transformations / eager transformations: https://cloudinary.com/documentation/upload_parameters
- [S19] Video gravity / automatic crop: https://cloudinary.com/documentation/video_gravity

**Adobe**

- [S10] Photoshop API v2 overview: https://developer.adobe.com/firefly-services/docs/photoshop/
- [S11] Photoshop Actions API: https://developer.adobe.com/firefly-services/docs/photoshop/guides/photoshop-actions/
- [S12] Adobe AutoCrop API: https://developer.adobe.com/firefly-services/docs/photoshop/guides/autocrop/

**Canva**

- [S13] Canva Create Design API: https://www.canva.dev/docs/apps/rest-apis/reference/designs/create-design/
- [S14] Canva Autofill: https://www.canva.dev/docs/apps/rest-apis/reference/autofills/
- [S15] Canva Export API: https://www.canva.dev/docs/apps/rest-apis/reference/exports/

**Channel/product image requirements**

- [S16] Google Merchant Center image link requirements: https://support.google.com/merchants/answer/6324350?hl=en
- [S17] Google Ads Search image asset specifications: https://support.google.com/google-ads/answer/9566341?hl=en
- [S18] Google Ads App campaign image aspect ratios: https://support.google.com/google-ads/answer/9234183?hl=en

**MOSAI**

- Current repository: https://github.com/julekpl/Mosai-friday

---

## Research note

Media-processing products increasingly mix deterministic image operations, computer vision and generative AI under the same "AI" label. This blueprint deliberately separates them by whether the operation can invent/change scene content.

Provider capabilities, pricing, quotas and platform image specifications should be revalidated before production launch. Channel presets are versioned data specifically so MOSAI does not require a code rewrite when Meta, Google, LinkedIn or other platforms change their creative specifications.
