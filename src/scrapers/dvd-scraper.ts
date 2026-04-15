import { Page } from 'puppeteer-core';
import { ScrapedMetadata } from './types';
import { PuppeteerScraper } from './puppeteer-base';

export class DvdScraper extends PuppeteerScraper {
  protected scraperType = 'dvd';

  protected buildUrl(_filename: string): string | null {
    return null;
  }

  protected async extractMetadata(page: Page): Promise<ScrapedMetadata | null> {
    return await page.evaluate(() => {
      const desc = document.getElementById('description');
      if (!desc) return null;

      function findByLabel(label: string): string | undefined {
        const spans = desc!.querySelectorAll('span');
        for (const span of spans) {
          if (span.textContent?.includes(label)) {
            const parent = span.parentElement;
            if (!parent) continue;
            const text = parent.textContent?.replace(span.textContent, '').trim();
            if (text) return text;
          }
        }
        return undefined;
      }

      const h1 = desc.querySelector('h1.lead');
      const code = findByLabel('DVD ID');
      const makerLink = desc.querySelector('a[href*="/studios/"]');

      let releaseDate: string | undefined;
      const rawDate = findByLabel('商品発売日');
      if (rawDate) {
        const match = rawDate.match(/(\d{4})[\/\-年](\d{1,2})[\/\-月](\d{1,2})/);
        releaseDate = match
          ? `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`
          : rawDate;
      }

      let coverImage: string | undefined;
      if (code) {
        const imgs = desc.querySelectorAll('img');
        for (const img of imgs) {
          if (img.alt?.includes(code)) {
            coverImage = img.src || undefined;
            break;
          }
        }
      }

      return {
        name: h1?.textContent?.trim() || undefined,
        code,
        releaseDate,
        director: findByLabel('監督'),
        maker: makerLink?.textContent?.trim() || undefined,
        genres: Array.from(desc.querySelectorAll('a[href*="/categories/"]'))
          .map(a => a.textContent?.trim()).filter(Boolean) as string[],
        cast: Array.from(desc.querySelectorAll('a[href*="/casts/"]'))
          .map(a => a.textContent?.trim()).filter(Boolean) as string[],
        coverImage,
      };
    });
  }
}
