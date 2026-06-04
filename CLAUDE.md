# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A self-hosted video library web app (like a simpler Jellyfin/Plex). Single-owner. Users add directory paths via Settings, scan for video files, browse/search/filter, and stream with resume-playback support. Compatible files (H.264 + AAC/MP3 in mp4/m4v) play directly via HTTP range requests; everything else is transcoded to HLS on-demand with ffmpeg.

## Commands

- `npm run dev` — start dev server with hot reload (tsx watch), runs on port 3000
- `npm run build` — compile TypeScript to `dist/`
- `npm start` — run compiled output (`node dist/index.js`)
- `npm run setup-auth` — interactive CLI to set login credentials

System dependency: FFmpeg (`ffprobe` + `ffmpeg`) must be on PATH — `ffprobe` for video metadata extraction during scan, `ffmpeg` for HLS transcoding during playback.

No test framework is configured.

## Architecture

**Server-rendered app**: Express + EJS templates + vanilla JS on the client. No frontend build step — Tailwind is loaded via CDN.

**Database**: SQLite via `better-sqlite3` with Knex query builder. Schema is created imperatively in `src/db.ts` (no migrations directory). New columns are added via `ALTER TABLE` checks at startup (read `PRAGMA table_info`, add any missing column from a hardcoded list), not migrations. Runs in WAL mode with `foreign_keys = ON`. Tables: `videos`, `genres`, `video_genres`, `cast_members`, `video_cast`, `library_paths`, `playback_state`, `settings`, `sessions`, `validation_results`, `coverage_results`, `field_sources`, `scraper_field_config`.

**Auth**: Credentials are stored in the `settings` table (not env vars). On first run, a random session secret and a temporary password are generated; the password (bcrypt-hashed, cost 12) is persisted and printed to console. `npm run setup-auth` (interactive `src/cli.ts`) writes a permanent hash to the DB. Sessions use `express-session` with a custom `SQLiteSessionStore` (`src/session-store.ts`), 30-day httpOnly cookie. `requireAuth` (`src/middleware/auth.ts`) returns 401 JSON for `/api/*` and redirects to `/login` otherwise.

**Route structure**: Page routes (`src/routes/*.ts`) render EJS views. API routes (`src/routes/api/*.ts`) serve JSON under `/api`. All routes except auth require session authentication (`src/middleware/auth.ts`).

**Background pipeline**: All long-running work runs in Worker threads spawned by `src/services/scanner.ts`, with progress tracked via module-level singletons polled by the frontend. There are four: `scanProgress`, `scrapeProgress`, `coverageProgress`, `coverDownloadProgress`. Each `start*` no-ops if its status is already running (concurrency guard). In dev, `spawnWorker()` constructs an eval Worker that loads `tsx/cjs` first so workers run without a build step.
- **Scan** (`scan-worker.ts`): Walks library paths, discovers video files by extension, inserts new records, removes stale ones, runs `ffprobe` for duration/resolution/codec/bitrate/etc. Quick scan only touches new files; full scan re-probes all. Does not fetch external metadata.
- **Scrape** (`scrape-worker.ts`): Iterates existing video records, resolves source URLs via the resolver, then calls the scraper for metadata (title, cast, genres, cover image, etc.). Supports **per-field scraper config** (`scraper_field_config` table) — different fields can come from different scrapers; it records which scraper sourced each field in `field_sources` and **skips fields marked `manual`** so user edits are never overwritten. Downloads cover images via `downloadCover`. The `syncRelation` helper handles many-to-many upserts for genres and cast.
- **Coverage** (`coverage-worker.ts`): Resumable run (tracked by `run_id`) that reports metadata coverage; results in `coverage_results`.
- **Cover download** (`cover-download-worker.ts`): Backfills missing cover images.

**Streaming** (`src/services/hls-transcoder.ts`, `src/routes/api/videos.ts`): `player.ts` computes `canDirectPlay` (H.264 + AAC/MP3 + mp4/m4v). Compatible files stream raw via `GET /api/videos/:id/stream` (HTTP range requests). Otherwise the hls.js client requests `GET /api/videos/:id/hls` (master), `/:quality` (variant, triggers ffmpeg transcode), and `/:quality/:segment`. Qualities are 360p/720p/1080p (only those ≤ source height) plus `original` (stream-copy when already H.264+AAC/MP3, else re-encode). Segments cached under `HLS_CACHE_DIR/<videoId>/<quality>/`; active jobs deduped in a `Map`.

**Scraper plugin system** (`src/scrapers/`): Scrapers are loaded dynamically by directory name (loader `src/scrapers/base/index.ts`); failures fall back to `NoOpScraper`. To add a new scraper, create `src/scrapers/<name>/` with:
- `scraper.ts` — must export `createScraper(): Scraper` (required). Browser-based scrapers can extend the `PuppeteerScraper` base (`base/puppeteer-base.ts`) and implement `buildUrl()` + `extractMetadata(page)`.
- `config.ts` — per-scraper constants like `SEARCH_URL_PREFIX` / `SOURCE_URL_PREFIX` (convention used by existing scrapers)
- `resolver.ts` — must export `resolveSourceUrl(filename) → URL`; optional `closeResolver()` (optional)
- `validator.ts` — must export `getTestConfig(): ValidatorTestConfig` for automated validation (optional)

Existing scrapers: `javtrailers` (default), `123av`, `javxx`, `missav`, `javfilms` (note: `javfilms` has no validator). The active scraper is set via `SCRAPER_TYPE` env var. Base types are in `src/scrapers/base/types.ts`.

**Validator cron** (`src/services/validator-scheduler.ts`): On boot (unless `VALIDATOR_ENABLED=false`), schedules `runAllValidations()` on `VALIDATOR_CRON` (default daily 08:00). Each run resolves + scrapes a known test file per scraper, compares against the validator's `expected`, and stores rows in `validation_results` (pruned to the latest 30 per scraper).

**Video queries** (`src/services/video-queries.ts`): Centralized query builder for filtering, sorting, pagination, and playback state lookups — shared by both page routes and API routes.

## Key Patterns

- Config is centralized in `src/config.ts`, sourced from env vars / `.env`. Vars: `PORT` (3000), `DB_PATH` (`data/library.db`), `SCRAPER_TYPE` (`javtrailers`), `VALIDATOR_ENABLED` (true unless `'false'`), `VALIDATOR_CRON` (`0 8 * * *`), `HLS_CACHE_DIR` (`data/hls-cache`), `FFMPEG_PATH` (`ffmpeg`), `COVER_CACHE_DIR` (`data/covers`). Auth credentials and the session secret are not env vars — they live in the `settings` table and are loaded into config at boot.
- Video IDs are UUIDs, but scrapers can override them with a canonical ID
- Playback position is saved per-video and used for resume functionality
- Worker threads prevent concurrent runs via status check on the progress singleton
- Docker support via `Dockerfile` and `docker-compose.yml`
