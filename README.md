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

## Scraper System

The system works fully without metadata — videos only need to be valid files on disk. Metadata scraping is handled by a pluggable scraper system where each scraper is a self-contained module with its own resolver and scraper.

### Architecture

Scrapers live in `src/scrapers/` and are loaded dynamically at runtime based on user selection in the Settings page. The system auto-discovers available scrapers by scanning subdirectories of `src/scrapers/`.

```
src/scrapers/
  base/                      # Framework — do not modify unless extending the base
    browser.ts               # Shared Puppeteer launch/page utilities
    index.ts                 # Dynamic loader: getScraper(), getResolver(), listScrapers()
    noop.ts                  # NoOp scraper (returns null, used as fallback)
    puppeteer-base.ts        # Abstract base class for Puppeteer-based scrapers
    types.ts                 # Scraper and ScrapedMetadata interfaces
  dvd/                       # Example scraper implementation
    config.ts                # Scraper-specific constants (URLs, etc.)
    resolver.ts              # Resolves a video filename → source URL
    scraper.ts               # Extracts metadata from the source URL
```

### How It Works

When the user clicks "Scrape Metadata" in Settings, the system:

1. **Resolves source URLs** — For each video without a `source_url`, the resolver derives a search code from the filename, searches a site, and finds the video's detail page URL. The resolved URL is saved to the database for future use.
2. **Scrapes metadata** — The scraper navigates to the `source_url` using Puppeteer, extracts metadata (name, code, release date, director, genres, cast, cover image, etc.), and writes it to the database.

### Adding a New Scraper

To add a scraper called `mysite`:

#### 1. Create the directory

```
src/scrapers/mysite/
  config.ts
  resolver.ts
  scraper.ts
```

#### 2. Create `config.ts` — scraper-specific constants

```typescript
// src/scrapers/mysite/config.ts
export const SEARCH_URL_PREFIX = 'https://mysite.com/search?q=';
export const SOURCE_URL_PREFIX = 'https://mysite.com';
```

#### 3. Create `resolver.ts` — maps filename → source URL

The resolver must export two functions:

- `resolveSourceUrl(filename: string): Promise<string | null>` — takes a video filename, returns the source URL to scrape (or null if not found)
- `closeResolver(): Promise<void>` — cleanup (close browser, etc.)

```typescript
// src/scrapers/mysite/resolver.ts
import { Browser } from 'puppeteer-core';
import * as cheerio from 'cheerio';
import { launchBrowser, createPage } from '../base/browser';
import { SEARCH_URL_PREFIX, SOURCE_URL_PREFIX } from './config';

let sharedBrowser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (sharedBrowser?.connected) return sharedBrowser;
  sharedBrowser = await launchBrowser();
  return sharedBrowser;
}

export async function closeResolver(): Promise<void> {
  if (sharedBrowser) {
    await sharedBrowser.close();
    sharedBrowser = null;
  }
}

export async function resolveSourceUrl(filename: string): Promise<string | null> {
  // 1. Extract a search term from the filename
  const searchTerm = filename.split(' ')[0];
  if (!searchTerm) return null;

  // 2. Load the search page
  const browser = await getBrowser();
  const page = await createPage(browser);
  try {
    await page.goto(SEARCH_URL_PREFIX + searchTerm, { waitUntil: 'networkidle2', timeout: 30000 });

    // 3. Extract the HTML and parse with cheerio
    const html = await page.evaluate('document.body.innerHTML');
    const $ = cheerio.load(html as string);

    // 4. Find the matching result and return its URL
    const href = $('a.result-link').first().attr('href');
    if (!href) return null;

    return href.startsWith('http') ? href : SOURCE_URL_PREFIX + href;
  } catch (err) {
    console.error(`[resolver:mysite] Failed:`, err);
    return null;
  } finally {
    await page.close();
  }
}
```

**Key patterns:**
- Use a shared browser instance (`sharedBrowser`) to avoid launching Chromium for every file
- Always close the page in a `finally` block
- Use `cheerio` for HTML parsing instead of `page.evaluate` to avoid esbuild/tsx compatibility issues
- Prefix relative hrefs with `SOURCE_URL_PREFIX`

#### 4. Create `scraper.ts` — extracts metadata from a page

The scraper must export a `createScraper()` factory function that returns a `Scraper` instance. The easiest approach is to extend `PuppeteerScraper`:

```typescript
// src/scrapers/mysite/scraper.ts
import { Page } from 'puppeteer-core';
import * as cheerio from 'cheerio';
import { ScrapedMetadata } from '../base/types';
import { PuppeteerScraper } from '../base/puppeteer-base';

export class MySiteScraper extends PuppeteerScraper {
  protected scraperType = 'mysite';

  // Called when no sourceUrl is provided — derive URL from filename
  // Return null if this scraper requires a resolver instead
  protected buildUrl(filename: string): string | null {
    return null;
  }

  // Extract metadata from the loaded page
  protected async extractMetadata(page: Page): Promise<ScrapedMetadata | null> {
    // Get the page HTML and parse with cheerio
    const html = await page.evaluate('document.getElementById("content")?.innerHTML || ""');
    if (!html) return null;

    const $ = cheerio.load(html as string);

    return {
      name: $('h1.title').text().trim() || undefined,
      code: $('.product-code').text().trim() || undefined,
      releaseDate: $('.release-date').text().trim() || undefined,
      director: $('.director').text().trim() || undefined,
      maker: $('.studio a').first().text().trim() || undefined,
      genres: $('a.genre').map((_, el) => $(el).text().trim()).get().filter(Boolean),
      cast: $('a.actor').map((_, el) => $(el).text().trim()).get().filter(Boolean),
      coverImage: $('img.cover').attr('data-src') || $('img.cover').attr('src') || undefined,
    };
  }
}

// Required: factory function used by the dynamic loader
export function createScraper() { return new MySiteScraper(); }
```

**Key patterns:**
- Set `scraperType` to match the directory name
- Use a single `page.evaluate` string call to extract HTML, then parse server-side with cheerio
- Avoid function declarations inside `page.evaluate` (esbuild adds `__name` which doesn't exist in the browser context — use arrow functions if you must evaluate code in-page)
- `buildUrl()` is used when no `source_url` exists and there's no resolver. Return `null` if the scraper relies on the resolver
- `createScraper()` **must** be exported — the dynamic loader requires it

#### 5. That's it — no registration needed

The scraper auto-discovers by scanning `src/scrapers/` for directories containing a `scraper.ts` with a `createScraper()` export. It will automatically appear in the Settings page dropdown.

### ScrapedMetadata Fields

All fields are optional — return only what you can extract:

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Override the video's database ID |
| `name` | `string` | Video display name |
| `code` | `string` | Product/catalog code |
| `releaseDate` | `string` | Release date (YYYY-MM-DD preferred) |
| `length` | `number` | Duration in seconds |
| `director` | `string` | Director name |
| `maker` | `string` | Studio/maker name |
| `label` | `string` | Label/sublabel name |
| `genres` | `string[]` | Genre names |
| `cast` | `string[]` | Cast member names |
| `coverImage` | `string` | Cover image URL |

### Tips

- **Always use cheerio for HTML parsing** — `page.evaluate` runs in the browser context where esbuild transforms cause `__name is not defined` errors with named functions
- **Share the browser instance** in the resolver to avoid launching Chromium per file
- **Close pages in `finally` blocks** to prevent memory leaks
- **Log generously** — scraping is fragile; detailed logs help debug when site structures change
- **Store URLs in `config.ts`** — keep scraper-specific constants in the scraper directory, not in env vars or global config

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `DB_PATH` | `./data/library.db` | SQLite database path |
| `SCRAPER_TYPE` | `dvd` | Default scraper (`noop` = no metadata) |
| `CHROMIUM_PATH` | `/usr/bin/chromium-browser` | Path to Chromium binary (for scrapers) |
