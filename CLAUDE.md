# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A self-hosted video library web app (like a simpler Jellyfin/Plex). Single-owner, no transcoding. Users add directory paths via Settings, scan for video files, browse/search/filter, and stream with resume-playback support.

## Commands

- `npm run dev` — start dev server with hot reload (tsx watch), runs on port 3000
- `npm run build` — compile TypeScript to `dist/`
- `npm start` — run compiled output (`node dist/index.js`)
- `npm run setup-auth` — interactive CLI to set login credentials

No test framework is configured.

## Architecture

**Server-rendered app**: Express + EJS templates + vanilla JS on the client. No frontend build step — Tailwind is loaded via CDN.

**Database**: SQLite via `better-sqlite3` with Knex query builder. Schema is created imperatively in `src/db.ts` (no migrations directory). Tables: `videos`, `genres`, `video_genres`, `cast_members`, `video_cast`, `library_paths`, `playback_state`, `sessions`.

**Route structure**: Page routes (`src/routes/*.ts`) render EJS views. API routes (`src/routes/api/*.ts`) serve JSON under `/api`. All routes except auth require session authentication (`src/middleware/auth.ts`).

**Scanner** (`src/services/scanner.ts`): Walks configured library paths, finds video files by extension, inserts/updates records, uses `ffprobe` for duration, and calls the active scraper for metadata. Tracks progress in a module-level singleton (`scanProgress`) polled by the frontend via `/api/library/progress`.

**Scraper interface** (`src/scrapers/types.ts`): `Scraper.scrape(filename)` returns optional metadata (director, genres, cast, cover image, etc.). Default is `NoOpScraper`. New scrapers are registered in `src/scrapers/index.ts` and selected via `SCRAPER_TYPE` env var.

**Video relations**: Genres and cast use many-to-many join tables. The `syncRelation` helper in scanner.ts handles upsert logic for both.

## Key Patterns

- Config is centralized in `src/config.ts`, sourced from env vars / `.env`
- Video IDs are UUIDs, but scrapers can override them with a canonical ID
- Playback position is saved per-video and used for resume functionality
- The scanner prevents concurrent runs via status check on the singleton
