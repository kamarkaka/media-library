# Seek-bar Scrubbing with Thumbnail Preview

## Problem

Dragging the player's seek handle currently calls `seekTo()` on **every** pointer move, which sets `video.currentTime` immediately (`public/js/player.js:214-239`). Consequences:

- Playback is interrupted/janky the whole time you drag — the picture jumps around as you slide.
- For HLS files this is the worst case: every move triggers a seek → the player re-buffers / kicks off transcoding at each intermediate position (a "seek storm").
- There is no visual indication of *what* is at the position you're scrubbing to until you let go and the video repaints.

## Goal (from request)

1. While the user drags/slides the progress bar, **the video keeps playing normally, uninterrupted**, until release.
2. While sliding, **show a small snapshot image of the video content at the scrubbed position** (a preview popup that follows the cursor/finger).
3. **On release, seek to that moment** and continue playback from there.

## Current behavior (reference)

- **Markup** — `views/player.ejs:48-53`: `#seek-bar` › `#seek-buffer`, `#seek-progress`, `#seek-handle`.
- **Drag** — `public/js/player.js:211-240`: a `seeking` flag; `seekTo(e)` computes `pct` from `clientX` vs the bar rect and **sets `video.currentTime` on every move**; drag starts on the **handle only** (mousedown/touchstart), tracked via document-level `mousemove`/`touchmove`/`mouseup`/`touchend`.
- **Progress UI** — `player.js:194-202`: a `timeupdate` listener drives `#seek-progress` width, `#seek-handle` left, and `#time-display` from `video.currentTime`.
- **Duration** — `player.js:188-192`: `getDuration()` returns `video.duration` or the hls.js level duration (`hlsDuration`).
- **Thumbnails** — generated per code at `t_i = D · i/(count+1)` per file (`src/services/thumbnail-generator.ts`, `generateThumbnailsForEntry`); the player receives them as a **flat `{ url }` list** via `container.dataset.thumbnails` (`player.js` `thumbnails` var), used only by the carousel/lightbox. There is currently **no timestamp or per-file grouping** on the client, so a scrub position can't yet be mapped to a frame.
- **Active file** — `currentFileId` is tracked in `player.js` (set in `loadSource`); the seek bar represents the **current file's** timeline (`getDuration()` = current file).

## Design

Two parts: (A) the scrubbing interaction, and (B) the live-extracted preview popup. (No thumbnail-data plumbing is needed — the preview is generated on the fly, independent of the pre-generated snapshot cache.)

### A. Non-interrupting scrub + deferred seek (the core change)

Replace the "seek on every move" model with a "scrub visually, seek on release" model.

- **State:** `scrubbing` (bool), `scrubPct` (0–1). Keep the existing `seeking`/`seekTo` removed or repurposed.
- **Start:** begin a scrub on pointer-down anywhere on **`#seek-bar`** (not just the handle), for both mouse and touch — this matches "drag the progress bar" and makes the whole bar grabbable. Set `scrubbing = true`, compute the initial `scrubPct`, render it immediately.
- **Move:** compute `scrubPct` from `clientX` vs the `#seek-bar` rect (extract a small `pctFromClientX(x)` helper from today's `seekTo`). Then update **only the UI**:
  - `#seek-progress` width and `#seek-handle` left → `scrubPct`.
  - `#time-display` → `formatTime(scrubPct · D)` / total (so the time readout previews the target).
  - Update the preview popup (part B).
  - **Do NOT touch `video.currentTime`.** The `<video>` keeps playing exactly where it was → uninterrupted playback.
- **Guard the live updater:** in the `timeupdate` handler (`player.js:194-202`), early-return `if (scrubbing) return;` so the still-advancing playhead doesn't fight the handle the user is dragging.
- **Release:** on pointer-up/touch-end → `video.currentTime = scrubPct · D`; hide the preview; `scrubbing = false`; let `timeupdate` resume driving the UI. **Preserve prior play state** — since playback was never paused, a playing video simply jumps and keeps playing from the new spot ("start playback from that moment"). (Decision point: if the video was *paused* before scrubbing, the cleanest behavior is to seek and stay paused on that frame; the literal request could also mean "always play on release" — easy to flip. Default = preserve state.)
- **Controls visibility:** suppress the auto-hide timer while `scrubbing` so the bar/preview stay visible during the drag; re-arm it on release (today `mouseup` calls `showControls()` — keep that).
- **Touch specifics:** the scrub `touchmove` must be **non-passive** and call `preventDefault()` while scrubbing so the page doesn't scroll under the finger (today the handle's `touchstart` is `{ passive: true }`). The container-level swipe-to-seek (`player.js:155-175`) already ignores `#player-controls`, so starting a scrub on the bar won't also trigger a swipe.

**Why this is a big win:** for HLS the intermediate seeks vanish entirely — we seek exactly once, on release — so no mid-drag re-buffer/transcode.

### B. Scrub preview popup — frames generated on the fly

The preview image is extracted **live** from the video at the scrubbed timestamp (not from the pre-generated snapshot cache). This gives an exact-position preview for *any* file (including no-`code` entries and files the browser can't play natively), at the cost of a small, bounded ffmpeg call per distinct position.

- **New DOM** (in `views/player.ejs`, inside the player container near the seek bar): a hidden `#seek-preview` containing `#seek-preview-img` (the frame) and `#seek-preview-time` (a timecode label). Floating card above the bar; `position: absolute`, `left` = clamped cursor X so it never overflows the player edges; `z-10`; shown only while scrubbing.
- **Frame source — a new on-the-fly endpoint:**
  - `GET /api/videos/:id/frame?file=<fileId>&t=<seconds>` → returns one JPEG of the selected file at ~time `t`.
  - The server resolves the file with the **existing** `resolveFile(video, req.query.file)` helper already used by `/stream` and `/hls` (`src/routes/api/videos.ts`), so it targets the same file the seek bar represents.
  - Extraction: `ffmpeg -ss <t> -i <fullPath> -frames:v 1 -vf scale=<PREVIEW_WIDTH>:-2 -q:v 5 -f mjpeg pipe:1`, piped straight to the response. `-ss` **before** `-i` = fast input/keyframe seek (snaps to the nearest keyframe — sub-second on typical files); frame-accurate decoding is intentionally avoided as too slow for a hover. Reuses `config.ffmpegPath` and the same single-frame approach as `thumbnail-generator.ts` (but piped to a Buffer/response instead of a file).
- **Client — set `img.src`, throttled** (no `fetch`/`AbortController` needed):
  - While scrubbing, update `#seek-preview-time` continuously (cheap), and **throttle** (~150 ms, trailing) updates of `#seek-preview-img.src = '/api/videos/<id>/frame?file=<currentFileId>&t=<roundedT>'`.
  - `t = scrubPct · getDuration()` (live current-file duration), rounded to `FRAME_STEP` (5 s) so the URL is stable.
  - Assigning a new `img.src` auto-cancels the previous image load, and stable rounded-`t` URLs hit the browser cache on re-scrub → back-and-forth is instant. `img.onerror` → hide the image (show timecode only).
- **No special-casing** — works the same whether the entry has a `code`/thumbnails or not.

#### Performance & concurrency (server-side bounding)

Live extraction must not spawn an ffmpeg storm during fast sliding:

- **Round `t`** to `FRAME_STEP` (5 s) on the client → far fewer distinct frames; this is also the preview's granularity.
- **In-memory LRU cache** keyed by `${fileKey}:${roundedT}` → JPEG `Buffer` (cap ~200 frames). Cache hit = instant, no ffmpeg. (On-disk under a cache dir is an alternative; in-memory is simpler and fine for a single-owner app.)
- **Single-flight / coalesce** — a `Map` of in-flight extraction promises keyed the same way, so concurrent identical requests share one ffmpeg run.
- **Kill on client abort** — `req.on('close', …)` kills the ffmpeg child if the client superseded/navigated away before it finished (rapid sliding), preventing orphaned processes. Optionally cap total concurrent extracts (e.g. ≤2).
- **`Cache-Control: public, max-age=…`** on the response so the browser caches the stable frame URLs.

> **Trade-off vs the pre-generated snapshots:** the first time you land on a new second there's a brief delay while ffmpeg extracts (typically <0.5 s; longer for very high-bitrate/HEVC sources); cached/revisited spots are instant. In return you get exact-ish positions at `FRAME_STEP` granularity for *every* file with no pre-generation step. The pre-generated thumbnail carousel/lightbox is **unchanged and unaffected** — this feature is fully independent of it, so no per-file thumbnail data plumbing is needed.

**Tunable constants** (in the frame service, like `THUMBNAIL_WIDTH`): `PREVIEW_WIDTH` (≈240), `FRAME_STEP` (5 s), JPEG quality, LRU cap. Could be promoted to settings/env later; constants are fine for v1.

## Files to change

- `public/js/player.js` — rewrite the seek-drag block (`~211-240`) to the scrubbing model; guard `timeupdate` (`~195`); add the preview popup that sets `#seek-preview-img.src` to the frame endpoint (throttled, rounded `t`); start scrub on `#seek-bar`; non-passive touch handling.
- `views/player.ejs` — add the `#seek-preview` element. (No change to the thumbnail data flow.)
- `src/routes/api/videos.ts` — add `GET /:id/frame` (reuse `resolveFile`); pipe ffmpeg MJPEG to the response; LRU cache + single-flight + kill-on-`close` + `Cache-Control`.
- `src/services/` — a small frame extractor (e.g. add `extractFrameToBuffer(fullPath, t)` to `thumbnail-generator.ts`, or a new `frame-extractor.ts` that owns the extraction + LRU cache + single-flight), reusing `config.ffmpegPath`.

No DB/schema change, no new env var, no new dependency. `src/routes/player.ts`, `src/services/thumbnail-generator.ts` listing, and the thumbnail carousel are **untouched** by this feature.

## Not in scope (v1)

- **Frame-accurate** preview — we use a fast keyframe seek (`-ss` before `-i`), so the preview snaps to the nearest keyframe; granularity is also bounded by `FRAME_STEP` (5 s). Exact-frame decoding is too slow for a live hover.
- A pre-baked storyboard sprite sheet / WebVTT thumbnail track (the alternative to on-the-fly; explicitly not chosen here).
- Hover-preview when not dragging (optional desktop nicety; the endpoint supports it for free if added later).
- Persisting the extracted frames to disk / a long-lived cache (the in-memory LRU is per-process; fine for a single-owner app).

## Verification

1. **Single-file, direct-play (H.264):** start playing, drag the bar across — audio/video keep playing uninterrupted; the handle follows the finger; the preview frame + timecode update as you slide; on release it jumps to that spot and keeps playing.
2. **HLS file:** same as above, and confirm the *stream* transcode does **not** churn during the drag (only one seek after release) — the key regression this fixes. The preview frames are produced by the separate `/frame` endpoint (independent of the HLS pipeline).
3. **Multi-file entry:** switch to file B via the file selector, then scrub — the preview frames come from **file B** (via `?file=`) and release seeks within file B.
4. **No-code entry:** scrubbing and live preview both work (no dependency on pre-generated thumbnails).
5. **Touch / mobile:** dragging the bar scrubs without scrolling the page; release seeks.
6. **Paused state:** pause, then scrub — preview updates; on release it seeks and (per the chosen default) stays paused on that frame.
7. **Fast sliding doesn't melt the CPU:** rapid back-and-forth reuses cached frames (instant) and supersedes/kills in-flight ffmpeg via `req.on('close')`; no unbounded process pile-up.
8. **HEVC / non-browser-playable source:** preview frames still appear (ffmpeg decodes the source regardless of how it streams to the browser).
