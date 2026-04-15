export interface ScrapedMetadata {
  id?: string;
  releaseDate?: string;
  length?: number;
  director?: string;
  maker?: string;
  label?: string;
  genres?: string[];
  cast?: string[];
  coverImage?: string;
  name?: string;
  code?: string;
}

export interface Scraper {
  scrape(filename: string, sourceUrl?: string): Promise<ScrapedMetadata | null>;
}
