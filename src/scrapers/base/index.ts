import path from 'path';
import fs from 'fs';
import { Scraper } from './types';
import { NoOpScraper } from './noop';
import { config } from '../../config';

const VALID_NAME = /^[a-z0-9_-]+$/i;

function validateScraperName(name: string): boolean {
  return VALID_NAME.test(name);
}

/**
 * Dynamically load a scraper by name.
 * Expects src/scrapers/<name>/scraper.ts to export createScraper(): Scraper
 */
export function getScraper(type?: string | null): Scraper {
  const scraperType = type || config.scraperType;
  if (!scraperType || scraperType === 'noop') {
    return new NoOpScraper();
  }
  if (!validateScraperName(scraperType)) {
    console.error(`[scraper] Invalid scraper name: "${scraperType}"`);
    return new NoOpScraper();
  }

  try {
    const scraperModule = require(`../${scraperType}/scraper`);
    if (typeof scraperModule.createScraper !== 'function') {
      console.error(`[scraper] Module "${scraperType}/scraper" has no createScraper() export`);
      return new NoOpScraper();
    }
    return scraperModule.createScraper();
  } catch (err) {
    console.error(`[scraper] Failed to load scraper "${scraperType}":`, err);
    return new NoOpScraper();
  }
}

/**
 * Dynamically load a resolver by scraper name.
 * Expects src/scrapers/<name>/resolver.ts to export resolveSourceUrl() and closeResolver()
 */
export function getResolver(type?: string | null): {
  resolveSourceUrl: (filename: string) => Promise<string | null>;
  closeResolver: () => Promise<void>;
} | null {
  const scraperType = type || config.scraperType;
  if (!scraperType || scraperType === 'noop') return null;
  if (!validateScraperName(scraperType)) {
    console.error(`[scraper] Invalid scraper name: "${scraperType}"`);
    return null;
  }

  try {
    const resolverModule = require(`../${scraperType}/resolver`);
    if (typeof resolverModule.resolveSourceUrl !== 'function') {
      console.error(`[scraper] Module "${scraperType}/resolver" has no resolveSourceUrl() export`);
      return null;
    }
    return {
      resolveSourceUrl: resolverModule.resolveSourceUrl,
      closeResolver: resolverModule.closeResolver || (async () => {}),
    };
  } catch (err) {
    console.error(`[scraper] Failed to load resolver "${scraperType}":`, err);
    return null;
  }
}

/**
 * List available scraper names by scanning the scrapers directory.
 */
export function listScrapers(): string[] {
  const scrapersDir = path.join(__dirname, '..');
  try {
    return fs.readdirSync(scrapersDir, { withFileTypes: true })
      .filter(d => d.isDirectory() && d.name !== 'base')
      .filter(d => {
        const scraperPath = path.join(scrapersDir, d.name, 'scraper');
        try { require.resolve(scraperPath); return true; } catch { return false; }
      })
      .map(d => d.name);
  } catch {
    return [];
  }
}
