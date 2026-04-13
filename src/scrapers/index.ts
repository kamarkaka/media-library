import { Scraper } from './types';
import { NoOpScraper } from './noop';
import { config } from '../config';

export function getScraper(): Scraper {
  switch (config.scraperType) {
    case 'noop':
    default:
      return new NoOpScraper();
  }
}
