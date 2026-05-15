# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A self-hosted video library web app (like a simpler Jellyfin/Plex). Single-owner, no transcoding. Users add directory paths via Settings, scan for video files, browse/search/filter, and stream with resume-playback support.

## Commands

- `npm run dev` — start dev server with hot reload (tsx watch), runs on port 3000
- `npm run build` — compile TypeScript to `dist/`
- `npm start` — run compiled output (`node dist/index.js`)
- `npm run setup-auth` — interactive CLI to set login credentials

System dependency: FFmpeg (`ffprobe` + `ffmpeg`) must be on PATH — `ffprobe` for video metadata extraction during scan, `ffmpeg` for HLS transcoding during playback.

No test framework is configured.

## Architecture

**Server-rendered app**: Express + EJS templates + vanilla JS on the client. No frontend build step — Tailwind is loaded via CDN.

**Database**: SQLite via `better-sqlite3` with Knex query builder. Schema is created imperatively in `src/db.ts` (no migrations directory). New columns are added via `ALTER TABLE` checks at startup, not migrations. Tables: `videos`, `genres`, `video_genres`, `cast_members`, `video_cast`, `library_paths`, `playback_state`, `settings`, `sessions`.

**Auth**: Credentials are stored in the `settings` table (not env vars). On first run, a temporary password is generated and printed to console. `npm run setup-auth` writes a permanent hash to the DB.

**Route structure**: Page routes (`src/routes/*.ts`) render EJS views. API routes (`src/routes/api/*.ts`) serve JSON under `/api`. All routes except auth require session authentication (`src/middleware/auth.ts`).

**Two-phase pipeline — scan then scrape**: These are independent operations, each running in a Worker thread spawned by `src/services/scanner.ts`. Progress is tracked via module-level singletons polled by the frontend.
- **Scan** (`scan-worker.ts`): Walks library paths, discovers video files by extension, inserts new records, runs `ffprobe` for duration/resolution/codec info. Does not fetch external metadata.
- **Scrape** (`scrape-worker.ts`): Iterates existing video records, resolves source URLs via the resolver, then calls the scraper for metadata (title, cast, genres, cover image, etc.). The `syncRelation` helper handles many-to-many upserts for genres and cast.

**Scraper plugin system** (`src/scrapers/`): Scrapers are loaded dynamically by directory name. To add a new scraper, create `src/scrapers/<name>/` with:
- `scraper.ts` — must export `createScraper(): Scraper` (required)
- `resolver.ts` — must export `resolveSourceUrl(filename) → URL` and `closeResolver()` (optional)
- `validator.ts` — must export `getTestConfig(): ValidatorTestConfig` for automated validation (optional)

The active scraper is set via `SCRAPER_TYPE` env var (default: `javtrailers`). Base types are in `src/scrapers/base/types.ts`; loader logic is in `src/scrapers/base/index.ts`.

**Video queries** (`src/services/video-queries.ts`): Centralized query builder for filtering, sorting, pagination, and playback state lookups — shared by both page routes and API routes.

## Key Patterns

- Config is centralized in `src/config.ts`, sourced from env vars / `.env`
- Video IDs are UUIDs, but scrapers can override them with a canonical ID
- Playback position is saved per-video and used for resume functionality
- Worker threads prevent concurrent runs via status check on the progress singleton
- Docker support via `Dockerfile` and `docker-compose.yml`
