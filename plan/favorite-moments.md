# Favorite Moments

## Problem / Goal

Let the single owner bookmark specific moments in videos — a saved list where each entry points to **one video at one timestamp** — and jump straight back to that moment by clicking the entry.

## Requirements (from request)

1. A list the user can **add to** and **remove from**.
2. Each entry = a **video + a timestamp** (points to a specific video at a specific time).
3. **Clicking an entry starts playback of that video at that timestamp.**
4. The **same video may appear multiple times** with different timestamps.

Deliberately lean — see *Not in scope* for what's intentionally left out.

## Design overview

- One new table `favorite_moments`, plus one small persisted JPEG snapshot per moment.
- A tiny API: **add** + **remove** + **serve snapshot** (the list page server-renders, like `library_paths`).
- A dedicated **`/moments`** page that renders the list; each card links to `/player/<videoId>?t=<seconds>[&file=<fileId>]`.
- An **"Add moment"** button on the player that captures the current file + current time.
- The player learns to **start at `?t=`** (deep-link seek), reusing the existing resume mechanism.
- **On add, a snapshot at that exact timestamp is generated once and saved to disk** (skipped if it already exists); each list card uses that saved image as its thumbnail — served from disk, no per-view ffmpeg. Reuses the existing single-frame ffmpeg extraction.

## Data model

New table in `src/db.ts` `initDatabase()` (same `if (!hasTable) createTable` pattern as the others, placed after `video_files`):

```ts
if (!(await db.schema.hasTable('favorite_moments'))) {
  await db.schema.createTable('favorite_moments', (t) => {
    t.text('id').primary();                                                   // uuid
    t.text('video_id').notNullable().references('id').inTable('videos').onDelete('CASCADE');
    t.text('file_id').nullable().references('id').inTable('video_files').onDelete('CASCADE');
    t.float('timestamp').notNullable();                                       // seconds within the file
    t.timestamp('created_at').defaultTo(db.fn.now());
  });
}
```

Plus an index in the trailing index block: `CREATE INDEX IF NOT EXISTS idx_favorite_moments_video ON favorite_moments(video_id)`.

**Why `file_id`** (and why it's not over-engineering): the app already supports multiple files per entry (`video_files`), and a timestamp only means something *within a file* (the seek bar is per-file). Storing `file_id` keeps a moment unambiguous on multi-file entries; it's nullable and falls back to the entry's default file when absent (covers the common single-file case and any moment added without a file). `ON DELETE CASCADE` on both FKs means a moment disappears automatically when its video or its file is removed (no dangling bookmarks).

No `videos` column changes, so the two-place `newCols` rule doesn't apply.

## Snapshot generation & storage

- **Where:** `MOMENT_CACHE_DIR/<momentId>.jpeg` — keyed by the moment's id (one file per entry). New config field `momentCacheDir` in `src/config.ts` (env `MOMENT_CACHE_DIR`, default `/data/moments`, mirroring the absolute `THUMBNAIL_CACHE_DIR`).
- **When:** generated synchronously on `POST` (a single frame is fast — ~tens of ms). Skipped if the file already exists ("if not already done so" — idempotent); the snapshot serve route also lazily regenerates if the file is ever missing.
- **How:** at the moment's **exact** timestamp (not the 5 s scrub grid — this is a deliberate capture): `ffmpeg -ss <timestamp> -i <fullPath> -frames:v 1 -q:v 3 -vf scale=480:-2 -y <path>`, resolving `<fullPath>` from `file_id` (or the entry's default file). This is the same single-frame extraction the thumbnail/seek-preview code already uses — reuse it via a shared helper (export `extractFrame(fullPath, t, outPath)` from `src/services/thumbnail-generator.ts`) rather than adding a third copy.
- **Keying by moment id** keeps cleanup trivial (delete one file on remove). Two moments at the same instant store two ~10 KB copies — negligible for a one-user app and avoids refcounting a shared file.

## API — `src/routes/api/moments.ts` (mounted at `/api/moments` in `src/routes/api/index.ts`)

Mirrors the lean `paths`/`playback` routers; behind `requireAuth` like everything else.

- `POST /api/moments` — body `{ videoId, fileId?, timestamp }`. Validates `videoId` exists and `timestamp` is a number ≥ 0; inserts a row with a generated uuid; then **generates the moment snapshot** (best-effort — a snapshot failure still returns the saved moment). Returns the created moment. (No dedup — duplicates/same-video-multiple-times are allowed by requirement #4.)
- `DELETE /api/moments/:id` — removes the row **and deletes its snapshot file**; returns `{ success: true }`.
- `GET /api/moments/:id/snapshot` — serves the saved JPEG (`image/jpeg`, long `Cache-Control`); lazily regenerates it if the file is missing; 404 → the card falls back to the cover image.

The list itself is **server-rendered** by the page route below (same approach as the Settings paths list), so no `GET` list endpoint is needed.

## Page route + nav — `/moments`

- **`src/routes/moments.ts`** (page router, mounted at `/moments` in `src/index.ts` alongside `playerRouter`/`settingsRouter`): query moments joined to `videos` for display fields, newest first:
  ```sql
  favorite_moments
    JOIN videos ON videos.id = favorite_moments.video_id
    ORDER BY favorite_moments.created_at DESC
  ```
  Select `favorite_moments.{id,video_id,file_id,timestamp}`, `videos.{name,filename,cover_image,code}`. Render `views/moments.ejs`.
- **`views/moments.ejs`** — a grid of cards (reuse the library grid styling). Each card:
  - links to `/player/<video_id>?t=<timestamp>&file=<file_id>` (omit `&file=` when null),
  - shows the moment's saved snapshot: `<img src="/api/moments/<id>/snapshot" loading="lazy" onerror="…cover-image fallback…">`,
  - shows the video title (`name || filename`) and the formatted timestamp (`h:mm:ss`),
  - a small **Remove** button → `DELETE /api/moments/:id` then drop the card from the DOM (same pattern as `deletePath` in `public/js/settings.js`).
  - Empty state when there are none.
- **`views/partials/nav-links.ejs`** — add a `Moments` link next to Genres/Cast.
- Small client script `public/js/moments.js` for the Remove handler (or fold into an existing shared script).

## Player integration

Two small additions to the existing player.

**1. Add the current moment** (`views/player.ejs` + `public/js/player.js`):
- A **"★ Save moment"** button in the details panel. On click: `POST /api/moments` with `{ videoId, fileId: currentFileId, timestamp: video.currentTime }` (both already tracked in `player.js`); show a brief "Saved" confirmation. No page reload needed.

**2. Deep-link seek (start at `?t=`)** — this is the only change to existing playback logic:
- `src/routes/player.ts`: read `req.query.t` (seconds) and `req.query.file`; pass `startAt` (number) and `startFile` (id) into the view.
- `views/player.ejs`: emit `data-start-at` and `data-start-file` on `#video-container`.
- `public/js/player.js`:
  - When choosing the initial file, prefer `startFile` (the file the moment was taken on) over the default file.
  - Reuse the existing `canplay → seekToResume` path: if `startAt > 0`, seek to `startAt` instead of the saved resume position (set `resumePosition = startAt` before the existing once-only `canplay` handler, or branch in `seekToResume`). The video then begins at the bookmarked moment.
- This leaves normal resume behavior unchanged when no `?t=` is present.

## How it fits existing infrastructure (reuse, not new machinery)

- **Single-frame extraction** → the same `ffmpeg -ss … -frames:v 1 -vf scale` the thumbnail/seek-preview code already runs (export `extractFrame` from `thumbnail-generator.ts`) — reused to write each moment's persisted snapshot, no new image pipeline.
- **Deep-link seek** → the existing resume (`seekToResume` on `canplay`) + per-file selection (`currentFileId`, `loadSource`).
- **Server-rendered list + DELETE** → the `library_paths` add/remove pattern.
- **Merge safety** → `favorite_moments` is re-parented in `mergeGroup` (`src/services/merge-helpers.ts`): when same-code entries merge, move the losers' moments to the survivor — `trx('favorite_moments').whereIn('video_id', loserIds).update({ video_id: survivorId })` (their `file_id` stays valid since files are re-parented, not renumbered). One line alongside the existing genre/cast/field_sources/playback re-parenting.

## Edge cases

- **Multi-file entry:** moment stores the file it was taken on; the player opens that file (`?file=`) and seeks. Null `file_id` → default file.
- **Video or file deleted** (scan stale-removal): the moment is removed via `ON DELETE CASCADE` — no dangling entries.
- **Merge:** handled in `mergeGroup` (above).
- **Same video, multiple moments:** allowed; each is its own row. No uniqueness constraint.
- **Auth:** all routes sit behind the existing `requireAuth`.
- **Invalid timestamp / missing video:** `POST` validates and 400s.

## Files to create / modify

**New**
- `src/routes/api/moments.ts` — POST (add) + DELETE (remove) + GET `/:id/snapshot`
- `src/routes/moments.ts` — `/moments` page route
- `views/moments.ejs` — the list page
- `public/js/moments.js` — remove handler (or fold into an existing script)

**Modify**
- `src/db.ts` — `favorite_moments` table + index
- `src/config.ts` — `momentCacheDir` (env `MOMENT_CACHE_DIR`, default `/data/moments`)
- `src/services/thumbnail-generator.ts` — export `extractFrame(fullPath, t, outPath)` for reuse
- `src/routes/api/index.ts` — mount `momentsRouter` at `/moments`
- `src/index.ts` — mount the `/moments` page router
- `src/services/merge-helpers.ts` — re-parent `favorite_moments` in `mergeGroup`
- `src/routes/player.ts` — read `?t=`/`?file=`, pass `startAt`/`startFile`
- `views/player.ejs` — "Save moment" button + `data-start-at`/`data-start-file`
- `public/js/player.js` — save-moment handler + start-at seek + initial-file-from-startFile
- `views/partials/nav-links.ejs` — `Moments` nav link

One new env var (`MOMENT_CACHE_DIR`); no schema-migration framework needed (uses the existing boot-time `createTable` pattern).

## Not in scope (intentionally lean)

- Labels/notes/titles on a moment (just video + timestamp).
- Editing a moment, reordering, or manual sorting (fixed newest-first).
- Seek-bar markers, keyboard shortcut to bookmark, mini-previews on hover.
- Per-video moments panel on the player (add from the player; view/remove/click from `/moments`).
- Search/filter/pagination of the list (a flat newest-first list; revisit only if it grows large).
- Cross-moment snapshot dedup / refcounting (each moment keeps its own ~10 KB copy).
- Export/import.

## Verification

1. Play a video, click **Save moment** at ~1:23 → a `MOMENT_CACHE_DIR/<id>.jpeg` is written and a card appears on `/moments` showing that snapshot, the title, and "1:23".
2. Click the moment → the player opens that video and begins at 1:23 (correct file for multi-file entries).
3. Save a second moment in the **same** video at a different time → both appear independently.
4. **Remove** a moment → it disappears from the list and is gone after reload.
5. Delete the underlying video (or its file via a scan) → its moments are gone (cascade).
6. Merge two same-code entries → moments from both survive under the merged entry and still play correctly.
7. Normal playback resume (no `?t=`) is unaffected.
8. Delete the snapshot file on disk and reload `/moments` → it lazily regenerates and the thumbnail still shows. A moment whose frame can't be extracted still saves (card falls back to the cover image).
