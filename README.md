# Media Library

A self-hosted media management system for browsing, streaming, and managing a local video library through a web UI. Similar to Jellyfin or Plex, but simpler — no transcoding, no user accounts, just one owner.

## Features

- **Video library** — scan configured directories, browse with cover images, search and filter by metadata
- **Streaming** — HTTP range-request support for browser-native seeking without downloading
- **Resume playback** — saves position automatically, resume from where you left off
- **Prev/next navigation** — quickly move between videos
- **Metadata support** — director, maker, label, genres, cast, release date, cover images (all optional)
- **Pluggable scraper** — metadata fetching via a scraper interface; ships with NoOpScraper, bring your own Puppeteer-based scraper later
- **Authentication** — session-based login to protect against unauthorized remote access
- **Docker deployment** — single image, single port, SQLite database

## Quick Start

```bash
# Install dependencies
npm install

# Set up login credentials
npm run setup-auth

# Start development server
npm run dev
```

Open http://localhost:3000, log in, go to **Settings** to add video paths and scan your library.

## Docker

```bash
docker compose up -d

# Set up credentials inside the container
docker compose exec media-library node dist/cli.js setup-auth
```

Edit `docker-compose.yml` to mount your video directories:

```yaml
volumes:
  - ./data:/data
  - /your/videos:/media:ro
```

Then add `/media` as a library path in the Settings page.

## Tech Stack

| Layer     | Technology                    |
|-----------|-------------------------------|
| Server    | Node.js + Express + TypeScript |
| Templates | EJS (server-rendered)         |
| Database  | SQLite (better-sqlite3 + Knex) |
| Styling   | Tailwind CSS (CDN)            |
| Client JS | Vanilla JavaScript            |

## Project Structure

```
src/
├── index.ts                # Express app entry
├── config.ts               # Environment config
├── db.ts                   # SQLite schema + connection
├── cli.ts                  # setup-auth, hash-password
├── middleware/auth.ts       # Session auth
├── routes/                 # Page routes + API routes
├── services/               # Scanner, query helpers
└── scrapers/               # Pluggable scraper interface
views/                      # EJS templates
public/                     # CSS + client JS
```

## Scraper Interface

The system works fully without metadata — videos only need to be valid files on disk. To add metadata scraping, implement the `Scraper` interface:

```typescript
import { Scraper, ScrapedMetadata } from './scrapers/types';

class MyScraper implements Scraper {
  async scrape(filename: string): Promise<ScrapedMetadata | null> {
    // Fetch metadata from a 3rd-party site
    return { director: '...', genres: ['...'], /* ... */ };
  }
}
```

Register it in `src/scrapers/index.ts` and set `SCRAPER_TYPE` in your `.env`.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `DB_PATH` | `./data/library.db` | SQLite database path |
| `AUTH_USERNAME` | `admin` | Login username |
| `AUTH_PASSWORD_HASH` | — | bcrypt hash (use `npm run setup-auth`) |
| `SESSION_SECRET` | auto-generated | Session signing secret |
| `SCRAPER_TYPE` | `noop` | Active scraper (`noop` = no metadata) |
