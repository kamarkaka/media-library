# Media Management System - Implementation Plan

## Overview

A self-hosted media management system (similar to Jellyfin/Plex) for browsing, streaming, and managing a local video library through a web UI. Videos are indexed from user-configured filesystem paths, metadata is optionally scraped from a pluggable 3rd-party source, and playback supports resume and sequential navigation.

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│                     Browser                     │
│  Server-rendered pages (EJS) + vanilla JS for   │
│  interactivity (player, infinite scroll, etc.)  │
└──────────────────┬──────────────────────────────┘
                   │ HTTP (pages + API)
┌──────────────────▼──────────────────────────────┐
│            Node.js / Express (single process)   │
│  - Server-rendered HTML pages (EJS templates)   │
│  - JSON API for async operations (/api/*)       │
│  - Video streaming (range-request support)      │
│  - Metadata scraper interface (pluggable)       │
└──────────────────┬──────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────┐
│             SQLite Database (single file)        │
│  videos, genres, casts, paths, playback_state   │
└─────────────────────────────────────────────────┘
```

### Single-Package Design

Everything ships as **one npm package / one Docker image**:
- Express renders HTML pages via EJS and serves static assets (CSS, JS)
- No separate frontend build step — client JS is plain `.js` files served from `public/`
- `/api/*` routes return JSON for async operations (playback saves, scan trigger, lazy loading)
- Page routes (`/`, `/player/:id`, `/settings`) return server-rendered HTML
- SQLite DB is a single file on a mounted volume
- One `package.json`, one `Dockerfile`, one image

### Tech Stack

| Layer      | Technology                     | Rationale                                              |
|------------|--------------------------------|--------------------------------------------------------|
| Server     | Node.js + Express + TypeScript | Native Puppeteer support for future scraper            |
| Templates  | EJS                            | Simple server-side rendering, no build step for views  |
| Database   | SQLite (via better-sqlite3)    | Zero-config, single-file, synchronous API              |
| ORM        | Knex.js                        | Lightweight query builder with migration support       |
| Player     | Native `<video>` element       | Handles range-request streaming natively               |
| Styling    | Tailwind CSS (CDN)             | Dark theme, rapid styling, no build tooling            |
| Client JS  | Vanilla JavaScript             | Small scripts for interactivity — no framework needed  |

---

## Database Schema

```sql
-- User-configured library paths
CREATE TABLE library_paths (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    path        TEXT NOT NULL UNIQUE,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Core video record
-- Only filename, full_path, and id are required.
-- All metadata fields are nullable — videos are fully functional without metadata.
CREATE TABLE videos (
    id           TEXT PRIMARY KEY,          -- derived from filename or assigned UUID
    filename     TEXT NOT NULL,             -- always present (from filesystem)
    full_path    TEXT NOT NULL UNIQUE,      -- always present (from filesystem)
    release_date DATE,                      -- nullable (from scraper)
    length       INTEGER,                   -- nullable, duration in seconds (from scraper)
    director     TEXT,                      -- nullable (from scraper)
    maker        TEXT,                      -- nullable (from scraper)
    label        TEXT,                      -- nullable (from scraper)
    cover_image  TEXT,                      -- nullable, URL or local path (from scraper)
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Many-to-many: video <-> genre
CREATE TABLE genres (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE
);
CREATE TABLE video_genres (
    video_id TEXT REFERENCES videos(id) ON DELETE CASCADE,
    genre_id INTEGER REFERENCES genres(id) ON DELETE CASCADE,
    PRIMARY KEY (video_id, genre_id)
);

-- Many-to-many: video <-> cast member
CREATE TABLE cast_members (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE
);
CREATE TABLE video_cast (
    video_id     TEXT REFERENCES videos(id) ON DELETE CASCADE,
    cast_id      INTEGER REFERENCES cast_members(id) ON DELETE CASCADE,
    PRIMARY KEY (video_id, cast_id)
);

-- Playback state (resume support)
CREATE TABLE playback_state (
    video_id      TEXT PRIMARY KEY REFERENCES videos(id) ON DELETE CASCADE,
    position      REAL NOT NULL DEFAULT 0,  -- seconds
    last_viewed   DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX idx_videos_release_date ON videos(release_date);
CREATE INDEX idx_videos_director ON videos(director);
CREATE INDEX idx_videos_maker ON videos(maker);
CREATE INDEX idx_videos_label ON videos(label);
CREATE INDEX idx_playback_last_viewed ON playback_state(last_viewed DESC);
```

---

## Authentication

Single-owner system — no registration, just login to protect against unauthorized remote access.

### Design

- **Credentials**: username + password stored in environment variables (or `.env` file). Password is bcrypt-hashed at rest.
- **Session-based auth**: uses `express-session` with a SQLite session store (reuses the same DB file). No JWT, no refresh tokens — a simple session cookie.
- **Login flow**: `GET /login` renders a login form. `POST /login` validates credentials, creates a session, redirects to `/`. On failure, re-renders the login page with an error message.
- **Route protection**: middleware checks for a valid session on all routes except `/login`. If no session, redirects to `/login`.
- **Video streaming**: session cookie is sent automatically by the browser for `<video src="...">` requests — no `?token=` workaround needed.
- **Logout**: `POST /logout` destroys the session and redirects to `/login`.

### Config

```env
# .env or environment variables
AUTH_USERNAME=admin
AUTH_PASSWORD_HASH=$2b$12$...   # bcrypt hash
SESSION_SECRET=<random-secret>  # auto-generated on first run if not set
```

A CLI helper generates the initial config:
```bash
# Local development
npx ts-node src/cli.ts setup-auth

# Inside Docker
docker compose exec video-player node dist/cli.js setup-auth
# Prompts for username/password, writes hashed credentials to /data/.env
```

### Implementation

```typescript
// src/middleware/auth.ts
import { Request, Response, NextFunction } from 'express';

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (req.session?.authenticated) {
    return next();
  }
  res.redirect('/login');
}
```

Applied to all routes:
```typescript
// Public routes
app.use('/login', authRouter);

// Everything else requires auth
app.use(requireAuth);
app.use('/', libraryRouter);
app.use('/player', playerRouter);
app.use('/settings', settingsRouter);
app.use('/api', apiRouter);
```

### Routes

| Method | Route              | Auth | Description                        |
|--------|--------------------|----- |------------------------------------|
| GET    | `/login`           | No   | Render login page                  |
| POST   | `/login`           | No   | Validate credentials, set session  |
| POST   | `/logout`          | Yes  | Destroy session, redirect to login |
| PUT    | `/api/auth/password` | Yes | Change password                    |

---

## Routes & API

### Page Routes (return server-rendered HTML)

| Method | Route              | Description                              |
|--------|--------------------|------------------------------------------|
| GET    | `/login`           | Login page                               |
| GET    | `/`                | Library page — video grid + filter sidebar |
| GET    | `/player/:id`      | Player page — video + metadata + prev/next |
| GET    | `/settings`        | Path management + scan trigger           |

The library page (`/`) accepts query params for filtering and pagination:
- `page` — page number (default 1)
- `genre`, `director`, `maker`, `label`, `cast` — filter by metadata
- `q` — free-text search on filename
- `sort` — `release_date`, `filename`, `last_viewed`

On initial page load, the server renders the first page of results. Subsequent pages are loaded via the JSON API (infinite scroll).

### JSON API (for async operations from client JS)

| Method | Endpoint                     | Description                              |
|--------|------------------------------|------------------------------------------|
| GET    | `/api/videos`                | Paginated video list (JSON, for infinite scroll) |
| GET    | `/api/videos/:id/stream`     | Stream video file (HTTP range requests)  |
| GET    | `/api/videos/:id/cover`      | Serve cover image                        |
| GET    | `/api/videos/:id/neighbors`  | Get prev/next video by current sort order |
| PUT    | `/api/playback/:id`          | Save playback position                   |
| GET    | `/api/playback/recent`       | Get last viewed video + position         |
| GET    | `/api/paths`                 | List configured paths                    |
| POST   | `/api/paths`                 | Add a new library path                   |
| DELETE | `/api/paths/:id`             | Remove a library path                    |
| POST   | `/api/library/scan`          | Trigger library rescan                   |
| GET    | `/api/genres`                | List all genres                          |
| GET    | `/api/directors`             | List all directors                       |
| GET    | `/api/makers`                | List all makers                          |
| GET    | `/api/labels`                | List all labels                          |
| GET    | `/api/cast`                  | List all cast members                    |

All API routes require authentication (session cookie sent automatically).

---

## Metadata & Scraper

### Core Principle: Metadata is Entirely Optional

The system must be fully functional with **zero metadata**. Scraping is an optional enhancement — the default configuration uses `NoOpScraper` which returns nothing, and that is a first-class supported mode, not a degraded fallback. A video only needs to be a valid video file on disk to be playable.

- **Scanner**: registers any valid video file found in configured paths. The only required fields are `filename`, `full_path`, and an auto-generated `id`. All other metadata columns (`release_date`, `director`, `maker`, `label`, `cover_image`, `length`) are nullable and left `NULL` when no scraper is configured.
- **API**: all metadata fields are returned as `null` in JSON responses when absent. Filter endpoints return empty lists if no metadata has been populated. Pagination, streaming, playback state, and prev/next navigation all work regardless of metadata.
- **Templates**: gracefully handle missing metadata everywhere:
  - Video card: shows filename as title when no metadata exists. Shows a generic placeholder icon when no cover image is available.
  - Filter sidebar: filter dropdowns are hidden when no values exist in the library. Filters only appear once at least one video has that metadata populated.
  - Player page: metadata section is omitted when no metadata exists. Playback, resume, and prev/next work the same regardless.
  - Search (`?q=`) always works because it matches against filename, which is always present.

### Scraper Interface

The scraper is a **pluggable module** behind a well-defined interface. The system ships with a `NoOpScraper` that returns no metadata; a real scraper can be swapped in later.

```typescript
// src/scrapers/types.ts
export interface ScrapedMetadata {
  id?: string;
  releaseDate?: string;       // ISO date string
  length?: number;            // duration in seconds
  director?: string;
  maker?: string;
  label?: string;
  genres?: string[];
  cast?: string[];
  coverImage?: string;        // URL or local file path
}

// src/scrapers/base.ts
export interface Scraper {
  scrape(filename: string): Promise<ScrapedMetadata | null>;
}

// src/scrapers/noop.ts
export class NoOpScraper implements Scraper {
  async scrape(_filename: string): Promise<ScrapedMetadata | null> {
    return null;
  }
}

// Future: src/scrapers/puppeteer-scraper.ts
// import puppeteer from 'puppeteer';
// export class PuppeteerScraper implements Scraper { ... }
```

### Library Scan Flow

1. Walk all configured paths for video files (`.mp4`, `.mkv`, `.avi`, `.webm`, `.mov`, etc.)
2. For each new file not already in DB:
   a. Create a video record with `filename`, `full_path`, and auto-generated `id` — this is sufficient for the video to appear in the library and be playable
   b. If a scraper is configured (anything other than `NoOpScraper`), call `scraper.scrape(filename)` and populate whatever metadata fields it returns
   c. If the scraper returns `null` or is not configured, the video is still inserted — just without metadata
3. For existing files already in DB: skip (no re-scrape unless explicitly triggered)
4. Remove DB entries whose files no longer exist on disk

The active scraper is selected via config (environment variable or config file). Default: `NoOpScraper`.

---

## Pages & UI Behavior

### Login Page (`/login`)
Simple form with username + password fields. On error, re-renders with message. On success, redirects to `/`.

### Library Page (`/`)
- Server renders the first page of video cards with current filters/search applied
- **Video card**: cover image (or placeholder icon) + filename/title. Links to `/player/:id`
- **Filter sidebar**: dropdowns for genre, director, maker, label, cast. Only shown when the library has metadata for that field. Selecting a filter reloads the page with query params
- **Search bar**: free-text search on filename, standard form submission
- **Sort control**: dropdown for sort order (release date, filename, last viewed)
- **Infinite scroll**: client JS (`library.js`) uses IntersectionObserver to fetch `/api/videos?page=N` and append rendered cards as the user scrolls
- **Resume banner**: if a video has saved playback state, shows a "Resume" link at the top

### Player Page (`/player/:id`)
- **Video element**: `<video src="/api/videos/:id/stream">` — session cookie authenticates automatically
- **Resume**: on page load, client JS reads the saved position from a data attribute rendered by the server, seeks to it
- **Position save**: client JS periodically (every 5s) sends `PUT /api/playback/:id` with the current position
- **Prev/Next**: server renders prev/next links in the page using the current sort order. Arrow buttons navigate between videos
- **Metadata panel**: shows available metadata (director, maker, label, genres, cast, release date, duration). Omitted entirely if no metadata exists

### Settings Page (`/settings`)
- **Path list**: shows all configured paths with a delete button for each
- **Add path form**: text input + submit button
- **Scan button**: triggers `POST /api/library/scan` via JS, shows progress/status
- **Password change form**: current password + new password fields

---

## Video Streaming

The backend serves video files with **HTTP Range Request** support, enabling browser-native seeking without full download.

```typescript
// src/routes/api/videos.ts — streaming endpoint
router.get('/:id/stream', async (req, res) => {
  const video = getVideo(req.params.id);
  const stat = fs.statSync(video.fullPath);
  const fileSize = stat.size;
  const mimeType = mime.lookup(video.fullPath) || 'video/mp4';

  const range = req.headers.range;
  if (range) {
    const [startStr, endStr] = range.replace(/bytes=/, '').split('-');
    const start = parseInt(startStr, 10);
    const end = endStr ? parseInt(endStr, 10) : fileSize - 1;
    const chunkSize = end - start + 1;

    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': mimeType,
    });
    fs.createReadStream(video.fullPath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': mimeType,
    });
    fs.createReadStream(video.fullPath).pipe(res);
  }
});
```

---

## Project Structure

Single package — no workspaces, no frontend build step.

```
video-player/
├── package.json               # Dependencies, scripts
├── tsconfig.json              # TypeScript config
├── knexfile.ts                # Knex config (migrations)
├── Dockerfile                 # Multi-stage: compile TS → production image
├── docker-compose.yml         # Volume mounts for data/ and media paths
├── .env.example               # Template for environment variables
├── src/
│   ├── index.ts               # Express app entry, session, middleware
│   ├── config.ts              # Settings (DB path, session secret, scraper)
│   ├── db.ts                  # Knex instance + SQLite connection
│   ├── cli.ts                 # CLI helpers (setup-auth, hash-password)
│   ├── middleware/
│   │   └── auth.ts            # requireAuth session check
│   ├── routes/
│   │   ├── auth.ts            # GET/POST /login, POST /logout
│   │   ├── library.ts         # GET / (library page)
│   │   ├── player.ts          # GET /player/:id (player page)
│   │   ├── settings.ts        # GET /settings (settings page)
│   │   └── api/
│   │       ├── videos.ts      # Video list, stream, cover, neighbors
│   │       ├── playback.ts    # Save/load playback position
│   │       ├── paths.ts       # Path CRUD + scan trigger
│   │       └── filters.ts     # Genre/director/maker/label/cast lists
│   ├── services/
│   │   └── scanner.ts         # Library scan logic
│   └── scrapers/
│       ├── types.ts           # ScrapedMetadata interface
│       ├── base.ts            # Scraper interface
│       └── noop.ts            # NoOpScraper (default)
├── views/
│   ├── layout.ejs             # Base layout (head, nav, footer)
│   ├── login.ejs              # Login form
│   ├── library.ejs            # Video grid + filter sidebar
│   ├── player.ejs             # Video player + metadata + prev/next
│   ├── settings.ejs           # Path management + scan
│   └── partials/
│       └── video-card.ejs     # Single video card (reused in grid + API response)
├── public/
│   ├── css/
│   │   └── styles.css         # Custom styles (supplements Tailwind CDN)
│   └── js/
│       ├── library.js         # Infinite scroll, filter interactions
│       ├── player.js          # Playback position save, seek on load
│       └── settings.js        # Path management, scan trigger
├── migrations/                # Knex migration files
├── data/                      # SQLite DB (gitignored, Docker volume)
└── plan/
```

---

## Docker & Deployment

### Dockerfile

```dockerfile
# Stage 1: Compile TypeScript
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json knexfile.ts ./
COPY src/ ./src/
RUN npm run build

# Stage 2: Production image
FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY views/ ./views/
COPY public/ ./public/
COPY migrations/ ./migrations/

EXPOSE 3000
VOLUME ["/data"]
CMD ["node", "dist/index.js"]
```

### docker-compose.yml

```yaml
services:
  video-player:
    build: .
    ports:
      - "3000:3000"
    volumes:
      - ./data:/data                    # SQLite DB + session persistence
      - /path/to/your/videos:/media     # Mount your video library (read-only)
    environment:
      - DB_PATH=/data/library.db
      - AUTH_USERNAME=admin
      - AUTH_PASSWORD_HASH=              # Generate with: node dist/cli.js hash-password
      - SESSION_SECRET=                  # Auto-generated on first run if not set
    restart: unless-stopped
```

### Usage

```bash
# Development
npm install
npm run dev              # tsc --watch + nodemon, serves on http://localhost:3000

# Production (Docker)
docker compose up -d

# Initial auth setup
docker compose exec video-player node dist/cli.js setup-auth
```

### Key deployment details

- **Single port**: Express serves everything on port 3000 — pages, API, streaming, static assets
- **No frontend build**: EJS templates are rendered at request time; client JS is served as-is from `public/`
- **Volume `/data`**: persists the SQLite database and session store across container restarts
- **Media mount**: video directories are mounted read-only into the container; users configure these paths via the settings page (paths inside the container, e.g. `/media/movies`)
- **No reverse proxy required**: works standalone, but can sit behind nginx/Caddy for TLS if desired

---

## Implementation Phases

### Phase 1: Project Scaffold & Backend Core
1. Project setup: `package.json`, TypeScript config, Express app, EJS view engine, static file serving
2. Database: Knex setup, SQLite connection, migrations for all tables
3. Authentication: express-session with SQLite store, login/logout routes, `requireAuth` middleware, CLI setup-auth command
4. Path management API (CRUD)
5. Library scanner: walk configured paths, register video files in DB
6. Scraper interface with NoOpScraper
7. Video list API with pagination and filtering
8. Video streaming endpoint with range-request support
9. Playback state API (save/load position)
10. Neighbors API (prev/next)

### Phase 2: Pages & UI
1. Base layout template (dark theme, nav bar)
2. Login page
3. Library page: server-rendered video grid with filter sidebar and search
4. Video card partial (cover image or placeholder, filename as title)
5. Player page: `<video>` element, metadata panel, prev/next links
6. Settings page: path list, add/remove, scan trigger
7. Client JS: infinite scroll on library page
8. Client JS: playback position save/restore on player page
9. Client JS: async path management and scan on settings page

### Phase 3: Polish
1. Loading states and error feedback
2. Sort options (by date, name, last viewed)
3. Resume banner on library page
4. Dockerfile + docker-compose.yml
5. `.env.example` and setup documentation

---

## Open Decisions

- **Scraper implementation**: deferred by design — the `Scraper` interface is the contract; implement when ready (Puppeteer-based scraper can be added as a new class)
- **Transcoding**: not included; assumes videos are in browser-compatible formats (MP4/WebM). Could add FFmpeg transcoding later
- **Thumbnail generation**: could auto-generate from video frames via FFmpeg — not in initial scope
