# Scraper Coverage Tool

## Context

Need to measure how well each scraper covers the video library — i.e., for how many videos can each scraper successfully resolve a source URL and pull metadata. This is a long-running process (Puppeteer per scraper per video) that must be resumable, store results incrementally to the DB, and show progress via the existing toast UI.

## Plan

### 1. New DB table: `coverage_results`

**`src/db.ts`** — Add table to store per-video per-scraper results as they are processed:

```sql
coverage_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,            -- groups results from one run
  video_id TEXT NOT NULL,
  scraper_type TEXT NOT NULL,
  success INTEGER NOT NULL,        -- 0 or 1
  created_at TIMESTAMP DEFAULT NOW,
  UNIQUE(run_id, video_id, scraper_type)
)
```

Index on `(run_id, scraper_type)`. The `run_id` is a UUID generated when the job starts — groups all results from one coverage run. The UNIQUE constraint enables resumability: on restart, skip video+scraper pairs that already have a row for the current `run_id`.

### 2. Coverage worker: `src/services/coverage-worker.ts`

New worker file, following the scrape-worker pattern. Receives `{ runId }` via `workerData`.

Flow:
1. Get all scraper names via `listScrapers()`
2. Get all video IDs + filenames from DB
3. Calculate total work: `videos.length * scrapers.length`
4. For each video, for each scraper:
   - **Resumability check**: query `coverage_results` for existing row with this `run_id + video_id + scraper_type`. If exists, skip (already processed).
   - Resolve source URL via `getResolver(scraperType)`
   - Call `scraper.scrape(filename, sourceUrl)` — success = returned non-null metadata
   - Insert result row into `coverage_results`
   - Close resolver and scraper after each scraper iteration
   - Send progress update: `{ processed, total, currentFile, step }`
5. On completion, send `{ status: 'done' }`

Key: iterate **by video** (outer loop) then **by scraper** (inner loop), closing each scraper before opening the next (Puppeteer memory constraint).

### 3. Scanner service: progress singleton + start function

**`src/services/scanner.ts`** — Add coverage progress singleton following the existing scan/scrape pattern:

- `coverageProgress: ScanProgress` — new singleton
- `getCoverageProgress()` / `resetCoverageProgress()` — getter and reset
- `startCoverage()` — guards against concurrent runs, generates `runId` (UUID), spawns `coverage-worker` with `{ runId }`

### 4. API endpoints

**`src/routes/api/library.ts`** — Add three endpoints:

- `POST /api/library/coverage` — starts coverage job, returns `{ success, runId }`
- `GET /api/library/coverage/status` — returns progress, resets on terminal state (same pattern as scan/scrape status)
- `GET /api/library/coverage/results` — returns the latest run's summary: per-scraper success count, total count, run timestamp. Queries `coverage_results` grouped by `scraper_type` for the most recent `run_id`.

### 5. Settings page UI

**`views/settings.ejs`** — Add a "Scraper Coverage" button in the library section, after Auto-Match:

- Button: "Run Coverage Test" (`bg-indigo-600`)
- Status span for inline messages
- Below: a results container (hidden initially) that shows a summary table after completion or from the latest stored run

**`src/routes/settings.ts`** — Load latest coverage results and pass to view for initial render.

### 6. Frontend: toast polling + results display

**`public/js/settings.js`** — Add `startCoverage()` handler:
- POST to `/api/library/coverage`
- Call `window.startScanPolling('coverage')` to activate toast progress

**`public/js/scan-toast.js`** — Extend to handle `coverage` job type:
- Add `coverage` to the status endpoint mapping (currently hardcoded to `scan` and `scrape`)
- Add `window.setCoverageButtonBusy` for releasing the button on completion

**`public/js/settings.js`** — Add `renderCoverageResults(data)` to display the summary table after completion. Show per-scraper row: scraper name, success count, total, percentage.

### Files to create/modify

**New files:**
- `src/services/coverage-worker.ts` — worker thread

**Modified files:**
- `src/db.ts` — add `coverage_results` table
- `src/services/scanner.ts` — add coverage progress singleton + `startCoverage()`
- `src/routes/api/library.ts` — add coverage endpoints
- `src/routes/settings.ts` — load latest coverage results
- `views/settings.ejs` — add coverage button + results section
- `public/js/settings.js` — add coverage handler + results renderer
- `public/js/scan-toast.js` — extend for `coverage` job type

### Resumability design

- Each run gets a `run_id` (UUID)
- Results are inserted per video+scraper as they are processed
- On restart (same `run_id`), the worker queries existing results and skips them
- The `run_id` is stored in the settings table (`key: 'coverage_run_id'`) so a restarted server can resume the last incomplete run
- The `POST /api/library/coverage` endpoint: if a run is already in progress, returns its ID. If a previous run is incomplete (has fewer results than expected), offers to resume it.

### Verification

1. `npm run dev`
2. Settings page — click "Run Coverage Test"
3. Toast shows progress (processed/total, current file)
4. Results table appears on completion showing per-scraper coverage %
5. Stop and restart the server mid-run — click "Run Coverage Test" again — it resumes from where it left off
6. `GET /api/library/coverage/results` returns the summary JSON
