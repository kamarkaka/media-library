import { Scraper } from './types';
import { NoOpScraper } from './noop';
import { DvdScraper } from '../dvd/scraper';
import { config } from '../../config';

export function getScraper(type?: string | null): Scraper {
  const scraperType = type || config.scraperType;
  switch (scraperType) {
    case 'dvd':
      return new DvdScraper();
    case 'noop':
    default:
      return new NoOpScraper();
  }
}
