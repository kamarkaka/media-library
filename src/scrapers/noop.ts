import { Scraper, ScrapedMetadata } from './types';

export class NoOpScraper implements Scraper {
  async scrape(_filename: string, _sourceUrl?: string): Promise<ScrapedMetadata | null> {
    return null;
  }
}
