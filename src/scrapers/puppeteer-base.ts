import { Browser, Page } from 'puppeteer-core';
import { Scraper, ScrapedMetadata } from './types';
import { launchBrowser, createPage } from './browser';

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
    const url = sourceUrl || this.buildUrl(filename);
    if (!url) return null;

    const page = await this.newPage();
    try {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      return await this.extractMetadata(page);
    } catch (err) {
      console.error(`[scraper:${this.scraperType}] Failed to scrape ${url}:`, err);
      return null;
    } finally {
      await page.close();
    }
  }
}
