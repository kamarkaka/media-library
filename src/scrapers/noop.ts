import { Scraper, ScrapedMetadata } from './types';

export class NoOpScraper implements Scraper {
  async scrape(_filename: string): Promise<ScrapedMetadata | null> {
    return null;
  }
}
