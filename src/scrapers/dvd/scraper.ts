import { Page } from 'puppeteer-core';
import * as cheerio from 'cheerio';
import { ScrapedMetadata } from '../base/types';
import { PuppeteerScraper } from '../base/puppeteer-base';

export class DvdScraper extends PuppeteerScraper {
  protected scraperType = 'dvd';

  protected buildUrl(_filename: string): string | null {
    return null;
  }

  protected async extractMetadata(page: Page): Promise<ScrapedMetadata | null> {
    const pageTitle = await page.title();
    const pageUrl = page.url();
    console.log(`[scraper:dvd] Page loaded — title: "${pageTitle}", url: ${pageUrl}`);

    // Extract #description HTML from the page
    const descHtml = await page.evaluate('document.getElementById("description")?.innerHTML || ""');
    if (!descHtml) {
      console.warn(`[scraper:dvd] #description element not found or empty`);
      return null;
    }
    console.log(`[scraper:dvd] Got #description HTML (${(descHtml as string).length} chars)`);

    const $ = cheerio.load(descHtml as string);

    // Name
    const name = $('h1.lead').text().trim() || undefined;
    console.log(`[scraper:dvd] name: ${name || '(not found)'}`);

    // Helper: find text next to a label span
    const findByLabel = (label: string): string | undefined => {
      let result: string | undefined;
      $('span').each((_, el) => {
        const span = $(el);
        if (span.text().includes(label)) {
          const parent = span.parent();
          const text = parent.text().replace(span.text(), '').trim();
          if (text) result = text;
          return false; // break
        }
      });
      return result;
    };

    // Code
    const code = findByLabel('DVD ID');
    console.log(`[scraper:dvd] code: ${code || '(not found)'}`);

    // Release date
    let releaseDate: string | undefined;
    const rawDate = findByLabel('商品発売日');
    if (rawDate) {
      const match = rawDate.match(/(\d{4})[\/\-年](\d{1,2})[\/\-月](\d{1,2})/);
      releaseDate = match
        ? `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`
        : rawDate;
    }
    console.log(`[scraper:dvd] releaseDate: ${releaseDate || '(not found)'}`);

    // Director
    const director = findByLabel('監督');
    console.log(`[scraper:dvd] director: ${director || '(not found)'}`);

    // Maker
    const maker = $('a[href*="/studios/"]').first().text().trim() || undefined;
    console.log(`[scraper:dvd] maker: ${maker || '(not found)'}`);

    // Genres
    const genres: string[] = [];
    $('a[href*="/categories/"]').each((_, el) => {
      const text = $(el).text().trim();
      if (text) genres.push(text);
    });
    console.log(`[scraper:dvd] genres (${genres.length}): ${genres.join(', ') || '(none)'}`);

    // Cast
    const cast: string[] = [];
    $('a[href*="/casts/"]').each((_, el) => {
      const text = $(el).text().trim();
      if (text) cast.push(text);
    });
    console.log(`[scraper:dvd] cast (${cast.length}): ${cast.join(', ') || '(none)'}`);

    // Cover image
    let coverImage: string | undefined;
    if (code) {
      $('img').each((_, el) => {
        const img = $(el);
        const alt = img.attr('alt') || '';
        if (alt.includes(code)) {
          const dataSrc = img.attr('data-src');
          const src = img.attr('src');
          coverImage = (dataSrc && !dataSrc.startsWith('data:')) ? dataSrc
            : (src && !src.startsWith('data:')) ? src : undefined;
          return false; // break
        }
      });
    }
    console.log(`[scraper:dvd] coverImage: ${coverImage || '(not found)'}`);

    return { name, code, releaseDate, director, maker, genres, cast, coverImage };
  }
}

export function createScraper() { return new DvdScraper(); }
