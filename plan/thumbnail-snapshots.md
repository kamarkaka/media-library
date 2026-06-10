# Video Thumbnail Snapshots

## Problem

There is no way to preview the contents of a video without scrubbing through it. We want to generate a series of evenly-spaced snapshot images per video (via FFmpeg) so users can:
- Quickly skim a video's contents from a carousel on the player page.
- Bulk-generate snapshots for the whole library from Settings, with progress shown like the scan/scrape jobs.

## Requirements (from request)

1. **Player page**: a button to generate/re-generate thumbnails, and a carousel of those images.
2. **Settings page**: a button that starts a backend job generating thumbnails for *all* videos, with progress shown like scraping; the per-video thumbnail count is configurable (default `10`).
3. An environment variable controls where thumbnail images are stored.
4. Each thumbnail file is named `<code>-<seq_id>.jpeg`.

## Design decisions

- **FFmpeg, not ffprobe**: snapshots are extracted with `ffmpeg` (already a system dependency, already used by `hls-transcoder.ts`). Reuse `config.ffmpegPath`.
- **Reusable service module** `src/services/thumbnail-generator.ts`, mirroring how `cover-downloader.ts` is shared by both the `cover-download-worker` and the videos API. Both the single-video endpoint and the batch worker call into it.
- **Filesystem is the source of truth** — no new DB table. Thumbnails live on disk under a per-video subdirectory; the list endpoint reads that directory. This keeps with the project's pattern of deriving cache state from disk (HLS cache works the same way) and avoids a schema migration.
- **Even spacing**: for a video of duration `D` seconds and count `N`, snapshot `i` (1-based) is taken at `t_i = D * i / (N + 1)`. This avoids the black first frame and the credits/end frame.
- **Videos without a `code` are skipped.** Thumbnails are only generated for videos that have a non-empty `code` (it keys both the directory and filenames). The single-video endpoint returns a clear error; the batch worker skips and counts them.
- **Storage layout**: `THUMBNAIL_CACHE_DIR/<code>/<code>-<seq>.jpeg`.
  - The per-`<code>` subdirectory groups a video's snapshots together, while the filename follows the required `<code>-<seq_id>.jpeg` pattern.
  - `<code>` (used for both the directory and filename) is sanitized with the same `replace(/[/\\:*?"<>|]/g, '_')` rule used in `cover-downloader.ts`.
  - `<seq>` is 1-based and zero-padded to 3 digits (`001`, `002`, …) so directory listings sort correctly. (The numeric `seq_id` still satisfies the `<code>-<seq_id>.jpeg` pattern.)
- **Thumbnail size**: scale to 480px wide preserving aspect (`-vf scale=480:-2`), `-q:v 3` JPEG quality — small files, fast to load in a carousel. (Not exposed as a setting; hardcoded constant, easy to change later.)
- **Click-to-seek**: because each thumbnail maps to a known timestamp, clicking one in the carousel seeks the player to that time. The list endpoint returns `{ seq, t, url }` so the client knows each timestamp.

## Configuration

**`src/config.ts`** — add one field, following the existing `coverCacheDir` / `hlsCacheDir` pattern:

```ts
thumbnailCacheDir: process.env.THUMBNAIL_CACHE_DIR || path.join(__dirname, '../data/thumbnails'),
```

Add `thumbnailCacheDir: string;` to the `AppConfig` interface.

Per-video count is a runtime setting (changeable without restart), stored in the `settings` table under key `thumbnail_count` (default `10`) — same mechanism as `seek_step` / `default_scraper`.

## Architecture

```
Player page                              Server
  │  POST /api/videos/:id/thumbnails     │  generateThumbnails(video, count) → ffmpeg ×N
  │  ──────────────────────────────────► │  writes <code>-NNN.jpeg under THUMBNAIL_CACHE_DIR/<code>/
  │  ◄──────────────────────────────────│  returns [{seq, t, url}]
  │  GET  /api/videos/:id/thumbnails     │  lists files on disk → [{seq, t, url}]
  │  GET  /api/videos/:id/thumbnails/:f  │  serves one .jpeg

Settings page                            Server
  │  POST /api/library/thumbnails        │  startThumbnail() spawns thumbnail-worker
  │  GET  /api/library/thumbnails/status │  polled by scan-toast.js (reuses ScanProgress)
```

## Plan

### Phase 1: Config + shared generator service

**`src/config.ts`** — add `thumbnailCacheDir` (env `THUMBNAIL_CACHE_DIR`, default `data/thumbnails`).

**New file `src/services/thumbnail-generator.ts`** — pure, reusable, no DB writes:

- `THUMBNAIL_WIDTH = 480`, `JPEG_QUALITY = 3` constants.
- `thumbnailBaseName(video): string` → sanitized `video.code`.
- `getThumbnailDir(video): string` → `path.join(config.thumbnailCacheDir, thumbnailBaseName(video))`.
- `thumbnailFilename(base, seq): string` → `${base}-${String(seq).padStart(3, '0')}.jpeg`.
- `listThumbnails(video): { seq, t, url }[]` — reads the dir, parses `-NNN.jpeg` suffix for `seq`, sorts by seq. `t` is recomputed from `video.length` and the total found (`D * seq / (count+1)`); `url` is `/api/videos/<id>/thumbnails/<filename>`. Returns `[]` if the dir doesn't exist.
- `async generateThumbnails(video, count: number): Promise<{seq,t,url}[]>`:
  1. Require `code`: if `video.code` is null/empty, throw `Error('Video has no code')` — no thumbnails are generated.
  2. Resolve duration: prefer `video.length` (seconds, already populated by scan). If null/0, run a quick `ffprobe` (via `execFile`) to get it; if still unknown, throw `Error('Unknown video duration')`.
  3. Delete the existing per-video dir (regenerate semantics), then `mkdirSync(..., { recursive: true })`.
  4. For `seq` in `1..count`: `t = D * seq / (count + 1)`; spawn `ffmpeg -ss <t> -i <full_path> -frames:v 1 -q:v 3 -vf scale=480:-2 -y <dir>/<base>-NNN.jpeg`. `-ss` before `-i` = fast input seek; one frame per call gives an exact count and reliable spacing.
  5. Await each (sequential to bound CPU per video); collect results; return `listThumbnails(video)`.
- `removeThumbnails(video)` → `fs.rmSync(getThumbnailDir(video), { recursive: true, force: true })` (used for regenerate and, optionally, stale cleanup).

*Note on `code` changes:* the directory keys off the current `code`. If a video's `code` is later edited, old snapshots remain under the previous `<code>` dir as orphans; the simplest handling is to just re-generate (which writes the new dir). Optional follow-up: remove the old dir when `code` changes in the videos `PUT` handler, alongside the existing cover-rename logic.

*Why per-frame spawn instead of one `fps=` filter pass:* guarantees exactly `count` images and exact timestamps for click-to-seek, and fast `-ss` seeks keep it quick. `count` defaults to 10, so ≤10 short ffmpeg calls per video.

### Phase 2: Per-video API endpoints + player UI

**`src/routes/api/videos.ts`** — add three routes (mirroring the existing `/:id/cover` and HLS handlers):

- `POST /:id/thumbnails` — load video; read `thumbnail_count` from settings (default 10); `await generateThumbnails(video, count)`; return `{ thumbnails: [...] }`. On `Video has no code` or `Unknown video duration` return a 400 with a clear message.
- `GET /:id/thumbnails` — return `{ thumbnails: listThumbnails(video) }`.
- `GET /:id/thumbnails/:filename` — load video; validate `filename` against `/^.+-\d{3}\.jpeg$/`, resolve within `getThumbnailDir(video)` (reject path traversal), `res.type('image/jpeg')` and stream the file; 404 if missing.

**`src/routes/player.ts`** — pass the existing thumbnails to the view so the carousel renders server-side on load:
```ts
const thumbnails = listThumbnails(video); // [] if none yet
res.render('player', { ..., thumbnails });
```

**`views/player.ejs`** — add a **Thumbnails** block. Placement: a horizontally-scrolling carousel strip inside the "Video Details" panel, directly under the prev/next nav (above the title), consistent with existing section styling (`bg-gray-800`, `border-t border-gray-700/50`, `text-xs uppercase tracking-wide` header like the Metadata/Scrape Comparison sections).
- Header row: label "Thumbnails" + a `#generate-thumbnails-btn` (`bg-blue-600 hover:bg-blue-700 text-xs px-3 py-1 rounded`, same style as the Edit button) reading "Generate" (or "Re-generate" when some exist) + a `#thumbnails-status` span. When the video has no `code`, render the button disabled with a hint ("Add a code to generate thumbnails") instead.
- Carousel: a `#thumbnail-carousel` flex row, `overflow-x-auto`, horizontal `scroll-snap`, each item a fixed-height (`h-24`) `<img>` with `data-t="<seconds>"`, `rounded`, `cursor-pointer`, lazy-loaded. Server-renders the `thumbnails` passed from the route; empty state shows a muted "No thumbnails yet" message.

**`public/js/player.js`** — add a small module:
- `#generate-thumbnails-btn` click → disable + "Generating…" → `POST /api/videos/<id>/thumbnails` → rebuild the carousel from the returned list → re-enable, label becomes "Re-generate". Errors shown in `#thumbnails-status`.
- Delegate click on `#thumbnail-carousel img` → set the player's `currentTime` to `img.dataset.t` (reuse the existing video element / hls.js instance already wired in player.js).

### Phase 3: Settings — count config + batch job

**Count setting**

- **`src/routes/settings.ts`** — load `thumbnail_count` (default 10) and pass to the view (same shape as `seekStep`).
- **`views/settings.ejs`** — in the existing "Player Settings" section (next to Seek step), add a "Thumbnails per video" `<select>` (e.g. 5 / 10 / 15 / 20 / 30) bound to `#thumbnail-count-select`, with a `#thumbnail-count-status` span.
- **`src/routes/api/library.ts`** — `PUT /api/library/settings/thumbnail-count` validating the value against the allowed set, `setSetting('thumbnail_count', ...)` (mirrors `settings/seek-step`).
- **`public/js/settings.js`** — change handler that PUTs the new value and shows "Saved" (copy the seek-step handler).

**Batch worker** (mirrors `cover-download-worker` + scanner wiring exactly)

- **New file `src/services/thumbnail-worker.ts`**: knex init like `cover-download-worker.ts`; read `thumbnail_count` from `settings`; select videos with a non-empty `code` and non-null `length` (videos without a `code` or duration are excluded from the run); `progress({ total })`; loop, `progress({ currentFile: code, step: 'Generating' })`, `await generateThumbnails(video, count)`, increment `processed`/`updated`; on per-video failure log and continue; finish with `progress({ status: 'done', ... })`. Reuses the `ScanProgress` shape (`updated` = videos that got thumbnails).
- **`src/services/scanner.ts`** — add a `thumbnailProgress` singleton + `getThumbnailProgress()`, `resetThumbnailProgress()`, `startThumbnail()` (guard on `status === 'scanning'`), calling `spawnWorker('thumbnail-worker', {}, thumbnailProgress)`.
- **`src/routes/api/library.ts`** — `POST /thumbnails` (start, guarded) and `GET /thumbnails/status` (returns progress, resets on done/error), copied from the `cover-download` pair.

**Settings UI for the batch job**

- **`views/settings.ejs`** — in the Metadata section (next to "Download Cover Images"), add a `#thumbnail-btn` ("Generate Thumbnails", e.g. `bg-pink-600`) + `#thumbnail-status` + a one-line description.
- **`public/js/settings.js`** — reuse the generic `window.startJob` path by registering `'thumbnail'` in its `busyTexts`/`defaultTexts` maps and pointing it at `/api/library/thumbnails`; add `window.setThumbnailButtonBusy`.
- **`public/js/scan-toast.js`** — register `'thumbnail'` in the `busyFns` and `labels` maps and add `checkActiveJob('thumbnail')` so the progress toast and resume-on-reload work like the other jobs.

### Phase 4 (optional): stale cleanup

- In `scan-worker.ts`, when a video record is removed during a scan, also call `removeThumbnails(video.id)` (and the HLS cache cleanup already exists as a model). Low priority; can be a follow-up.

## Files to create / modify

### New files
- `src/services/thumbnail-generator.ts` — FFmpeg snapshot extraction, naming, listing (shared)
- `src/services/thumbnail-worker.ts` — batch worker over all videos

### Modified files
- `src/config.ts` — `thumbnailCacheDir` (env `THUMBNAIL_CACHE_DIR`)
- `src/services/scanner.ts` — `thumbnailProgress` singleton + `startThumbnail` / get / reset
- `src/routes/api/videos.ts` — `POST/GET /:id/thumbnails`, `GET /:id/thumbnails/:filename`
- `src/routes/api/library.ts` — `POST /thumbnails`, `GET /thumbnails/status`, `PUT /settings/thumbnail-count`
- `src/routes/player.ts` — pass `thumbnails` to the view
- `src/routes/settings.ts` — pass `thumbnailCount` to the view
- `views/player.ejs` — Thumbnails carousel + Generate button
- `views/settings.ejs` — "Generate Thumbnails" button + "Thumbnails per video" select
- `public/js/player.js` — generate handler + click-to-seek
- `public/js/settings.js` — batch job button + count save handler
- `public/js/scan-toast.js` — register the `thumbnail` job for progress/resume

## Naming & env summary

- Env var: `THUMBNAIL_CACHE_DIR` (default `data/thumbnails`)
- File path: `THUMBNAIL_CACHE_DIR/<code>/<code>-<seq>.jpeg` (e.g. `.../ABC-123/ABC-123-001.jpeg`); `<seq>` is 1-based, zero-padded to 3 digits. Videos without a `code` are skipped entirely.

## Not in scope

- Storyboard/sprite sheets or WebVTT thumbnail tracks for seek-bar hover previews.
- Animated preview (GIF/webp) thumbnails.
- A DB table tracking thumbnails (filesystem is the source of truth).
- Configurable thumbnail dimensions/quality via the UI (hardcoded constants).

## Verification

1. `npm run dev`.
2. Set `THUMBNAIL_CACHE_DIR` (or use the default) and confirm the dir is created on first generation.
3. On a player page, click **Generate** → carousel fills with N images; files appear at `THUMBNAIL_CACHE_DIR/<code>/<code>-001.jpeg …`.
4. Verify the count matches the Settings "Thumbnails per video" value; change it to e.g. 5 and re-generate → 5 images, old ones removed.
5. Click a thumbnail → player seeks to the corresponding timestamp.
6. Re-load the player page → carousel renders server-side from disk (no regeneration).
7. A video with unknown duration → Generate shows a clear error, no crash.
8. A video with no `code` → the Generate button is disabled (player), and the batch job skips it (excluded from `total`); the API returns a 400 if called directly.
9. In Settings, click **Generate Thumbnails** → progress toast shows `Thumbnail: x / total`, like scrape; reload mid-run → toast resumes.
10. Verify a second click while running is rejected ("already in progress").
11. Confirm filenames follow `<code>-<seq_id>.jpeg`.
