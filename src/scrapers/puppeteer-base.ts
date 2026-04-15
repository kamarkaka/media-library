import { Browser, Page } from 'puppeteer-core';
import { Scraper, ScrapedMetadata } from './types';
import { launchBrowser, createPage } from './browser';
import { config } from '../config';

export abstract class PuppeteerScraper implements Scraper {
  private browser: Browser | null = null;
  protected abstract scraperType: string;

  protected async getBrowser(): Promise<Browser> {
    if (this.browser?.connected) return this.browser;
    this.browser = await launchBrowser();
    return this.browser;
  }

  protected async newPage(): Promise<Page> {
    const browser = await this.getBrowser();
    return await createPage(browser);
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  protected abstract buildUrl(filename: string): string | null;
  protected abstract extractMetadata(page: Page): Promise<ScrapedMetadata | null>;

  async scrape(filename: string, sourceUrl?: string): Promise<ScrapedMetadata | null> {
    let url = sourceUrl || this.buildUrl(filename);
    if (url && !url.startsWith('http') && config.sourceUrlPrefix) {
      url = config.sourceUrlPrefix + url;
    }
    if (!url) {
      console.log(`[scraper:${this.scraperType}] No URL for ${filename}, skipping`);
      return null;
    }

    console.log(`[scraper:${this.scraperType}] Scraping ${url}`);
    const page = await this.newPage();
    try {
      console.log(`[scraper:${this.scraperType}] Navigating to ${url}`);
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      console.log(`[scraper:${this.scraperType}] Page loaded, extracting metadata`);
      const metadata = await this.extractMetadata(page);
      if (metadata) {
        console.log(`[scraper:${this.scraperType}] Extracted:`, JSON.stringify(metadata, null, 2));
      } else {
        console.warn(`[scraper:${this.scraperType}] No metadata extracted from ${url}`);
      }
      return metadata;
    } catch (err) {
      console.error(`[scraper:${this.scraperType}] Failed to scrape ${url}:`, err);
      return null;
    } finally {
      await page.close();
    }
  }
}
