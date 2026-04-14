import { Scraper } from './types';
import { NoOpScraper } from './noop';
import { config } from '../config';

export function getScraper(type?: string | null): Scraper {
  const scraperType = type || config.scraperType;
  switch (scraperType) {
    case 'noop':
    default:
      return new NoOpScraper();
  }
}
