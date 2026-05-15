import { Page } from 'puppeteer-core';
import * as cheerio from 'cheerio';
import { ScrapedMetadata } from '../base/types';
import { PuppeteerScraper } from '../base/puppeteer-base';

export class JAVxxScraper extends PuppeteerScraper {
  protected scraperType = 'javxx';

  protected buildUrl(_filename: string): string | null {
    return null;
  }

  protected async extractMetadata(page: Page): Promise<ScrapedMetadata | null> {
    const pageTitle = await page.title();
    const pageUrl = page.url();
    console.log(`[scraper:javxx] Page loaded — title: "${pageTitle}", url: ${pageUrl}`);

    // Extract #description HTML from the page
    const descHtml = await page.evaluate('document.getElementById("app")?.innerHTML || ""');
    if (!descHtml) {
      console.warn(`[scraper:javxx] #description element not found or empty`);
      return null;
    }
    console.log(`[scraper:javxx] Got #description HTML (${(descHtml as string).length} chars)`);

    const $ = cheerio.load(descHtml as string);

    // Name
    const name = $('#video-info .title').text().trim() || undefined;
    console.log(`[scraper:javxx] name: ${name || '(not found)'}`);

    // Helper: find text next to a label span
    const findByLabel = (label: string): string | undefined => {
      let result: string | undefined;
      $('#video-details label').each((_, el) => {
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
    const code = findByLabel('コード');
    console.log(`[scraper:javxx] code: ${code || '(not found)'}`);

    // Release date — normalize to YYYY-MM-DD
    let releaseDate: string | undefined;
    const rawDate = findByLabel('発売日');
    if (rawDate) {
      // Try YYYY/MM/DD or YYYY-MM-DD or YYYY年MM月DD formats
      const match = rawDate.match(/(\d{4})[\/\-年](\d{1,2})[\/\-月](\d{1,2})/);
      if (match) {
        releaseDate = `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
      } else {
        // Try "DD Mon YYYY" format
        const ddMonYyyy = rawDate.match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/);
        if (ddMonYyyy) {
          const months: Record<string, string> = {
            Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
            Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
          };
          const mon = months[ddMonYyyy[2].charAt(0).toUpperCase() + ddMonYyyy[2].slice(1).toLowerCase()];
          if (mon) {
            releaseDate = `${ddMonYyyy[3]}-${mon}-${ddMonYyyy[1].padStart(2, '0')}`;
          }
        }
        // Fallback: try Date constructor
        if (!releaseDate) {
          const parsed = new Date(rawDate);
          if (!isNaN(parsed.getTime())) {
            releaseDate = parsed.toISOString().split('T')[0];
          }
        }
      }
    }
    console.log(`[scraper:javxx] releaseDate: ${releaseDate || '(not found)'}`);

    // Director
    const director = findByLabel('監督');
    console.log(`[scraper:javxx] director: ${director || '(not found)'}`);

    // Maker
    const maker = $('#video-details a[href*="/ja/makers/"]').first().text().trim() || undefined;
    console.log(`[scraper:javxx] maker: ${maker || '(not found)'}`);

    // Genres
    const genres: string[] = [];
    $('#video-details a[href*="/ja/genres/"]').each((_, el) => {
      const text = $(el).text().trim();
      if (text) genres.push(text);
    });
    console.log(`[scraper:javxx] genres (${genres.length}): ${genres.join(', ') || '(none)'}`);

    // Cast
    const cast: string[] = [];
    $('#video-details a[href*="/ja/actresses/"]').each((_, el) => {
      const text = $(el).text().trim();
      if (text) cast.push(text);
    });
    console.log(`[scraper:javxx] cast (${cast.length}): ${cast.join(', ') || '(none)'}`);

    // Cover image
    let coverImage: string | undefined;
    if (code) {
      coverImage = $('#player').attr('cover') || '';
    }
    console.log(`[scraper:javxx] coverImage: ${coverImage || '(not found)'}`);

    return { name, code, releaseDate, director, maker, genres, cast, coverImage };
  }
}

export function createScraper() { return new JAVxxScraper(); }
