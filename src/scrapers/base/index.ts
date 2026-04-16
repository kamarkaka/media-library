import path from 'path';
import fs from 'fs';
import { Scraper, ValidatorTestConfig, ValidationResult, ScrapedMetadata } from './types';
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

/**
 * Get the test configuration for a scraper's validator.
 * Expects src/scrapers/<name>/validator.ts to export getTestConfig(): ValidatorTestConfig | null
 */
export function getValidatorConfig(type: string): ValidatorTestConfig | null {
  if (!validateScraperName(type)) return null;
  try {
    const validatorModule = require(`../${type}/validator`);
    if (typeof validatorModule.getTestConfig !== 'function') return null;
    return validatorModule.getTestConfig();
  } catch {
    return null;
  }
}

/**
 * Run validation for a scraper: resolve URL, scrape, compare with expected values.
 */
export async function runValidation(type: string): Promise<ValidationResult | null> {
  const testConfig = getValidatorConfig(type);
  if (!testConfig) {
    console.log(`[validator:${type}] No test config available`);
    return null;
  }

  console.log(`[validator:${type}] Starting validation with filename: "${testConfig.testFilename}"`);

  // Resolve source URL and scrape, with cleanup in finally
  const resolver = getResolver(type);
  const scraper = getScraper(type);
  let metadata: ScrapedMetadata | null = null;

  try {
    let sourceUrl: string | null = null;
    if (resolver) {
      sourceUrl = await resolver.resolveSourceUrl(testConfig.testFilename);
      console.log(`[validator:${type}] Resolved URL: ${sourceUrl || 'none'}`);
    }
    metadata = await scraper.scrape(testConfig.testFilename, sourceUrl || undefined);
  } finally {
    if (resolver) await resolver.closeResolver();
    if (scraper.close) await scraper.close();
  }

  if (!metadata) {
    console.log(`[validator:${type}] Scraper returned no metadata`);
    return {
      success: false,
      fields: Object.keys(testConfig.expected).map(field => ({
        field,
        expected: (testConfig.expected as any)[field],
        actual: null,
        match: false,
      })),
    };
  }

  // Compare fields
  const fields: ValidationResult['fields'] = [];
  for (const [field, expectedValue] of Object.entries(testConfig.expected)) {
    const actualValue = (metadata as any)[field];
    let match: boolean;

    if (Array.isArray(expectedValue) && Array.isArray(actualValue)) {
      // For arrays (genres, cast), check that all expected values are present
      match = expectedValue.every(v => actualValue.includes(v));
    } else if (field === 'coverImage' && typeof expectedValue === 'string' && typeof actualValue === 'string') {
      // Cover image: prefix match (URLs may have query params that change)
      match = actualValue.startsWith(expectedValue);
    } else {
      match = actualValue === expectedValue;
    }

    fields.push({ field, expected: expectedValue, actual: actualValue ?? null, match });
  }

  const success = fields.every(f => f.match);
  console.log(`[validator:${type}] Result: ${success ? 'PASS' : 'FAIL'}`);
  fields.forEach(f => {
    console.log(`[validator:${type}]   ${f.match ? '✓' : '✗'} ${f.field}: expected=${JSON.stringify(f.expected)}, actual=${JSON.stringify(f.actual)}`);
  });

  return { success, fields };
}
