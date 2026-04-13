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
}

export interface Scraper {
  scrape(filename: string): Promise<ScrapedMetadata | null>;
}
