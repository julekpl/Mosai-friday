# Decision record (proposed): render Create videos in the browser

**Status:** proposed, awaiting owner acceptance · **Date:** 24 Sep 2026
**Context:** `docs/implementation/CREATE-VIDEO-BLUEPRINT.md` (ticket V0).
**Owner brief:** the MVP is silent, must handle 5-second videos, export time
does not matter, no AWS.

## Decision

1. The MVP exports videos in the user's browser with `@remotion/web-renderer`
   (`renderMediaOnWeb`). No render server.
2. The export picks its codec at run time with `canRenderMediaOnWeb`, in this
   order: **MP4/H.264 → MP4/VP9 → WebM/VP9 → WebM/VP8**. The UI names the
   result when it is not H.264, because some platforms and older players
   expect H.264.
3. The export is always `muted: true` in the MVP; the file has no audio track.
4. Server rendering (Vercel Sandbox) stays a later ticket (V5b).

## Evidence (spike run 24 Sep 2026)

Setup: `remotion`, `@remotion/web-renderer` and `@remotion/media` 4.0.528,
React 19.2, bundled with esbuild, run in the pre-installed Playwright build of
Chromium 141 (headless, Linux, no GPU). Composition: two 2.5 s scenes, a text
"brand graphic" with a fade-in and an image scene with a slow zoom and a text
overlay; 150 frames at 30 fps. Output inspected in the browser with Mediabunny.

| Aspect | Codec chosen | Size | Duration read back | Tracks | Wall time |
|---|---|---|---|---|---|
| 9:16 (1080×1920) | MP4/VP9 | 363 KB | 4.967 s | 1 video, 0 audio | 4.0 s |
| 1:1 (1080×1080) | MP4/VP9 | 275 KB | 4.967 s | 1 video, 0 audio | 1.6 s |
| 16:9 (1920×1080) | MP4/VP9 | 451 KB | 4.967 s | 1 video, 0 audio | 2.5 s |

Findings:

- **A 5-second silent video works** in every aspect, and the file has no audio
  track. The read-back duration is one frame short of 5.000 s (it measures to
  the start of the last frame), so tests allow ±1 frame.
- **H.264 was not available in this Chromium build.** `canRenderMediaOnWeb`
  reported: `Video codec "h264" cannot be encoded by this browser`, and a
  forced H.264 render failed with "This specific encoder configuration
  (avc1.640028 …) is not supported". Open-source Chromium builds ship without
  an H.264 encoder; Google Chrome includes one. VP9 and AV1 in MP4, and VP8/VP9
  in WebM, all passed the check. Hence the fallback chain above.
- Export time was a few seconds for 5 s of video on this machine. It was not a
  requirement and was not tested on a laptop.

## Not verified here (owner-run checks before V5 ships)

| Check | Why not here | How |
|---|---|---|
| Google Chrome, Firefox 130+, Safari 26+ export H.264 | only open-source Chromium is installed | open the V5 export page in each browser; the export panel shows the chosen codec |
| Convex storage URLs can be drawn into the export canvas (CORS) | this session has no Convex deployment access | V3/V5 e2e test against the dev deployment with an uploaded image and a stock clip |
| Stock video clips (`<Video>` from `@remotion/media`) export correctly | Pexels is blocked by this environment's network policy | same e2e test with a real stock clip |

## Consequences

- No AWS, no render server, no render cost; the Remotion free licence covers a
  one-person organization (buy a Company License before 4 people).
- Video components must stay inside the browser renderer's supported CSS and
  components (blueprint §9.1).
- A non-H.264 file may not upload to every social platform. When V5b (server
  rendering) exists, it always produces H.264.
