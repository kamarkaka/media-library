import { Page } from 'puppeteer-core';
import { ScrapedMetadata } from './types';
import { PuppeteerScraper } from './puppeteer-base';

export class DvdScraper extends PuppeteerScraper {
  protected scraperType = 'dvd';

  protected buildUrl(_filename: string): string | null {
    return null;
  }

  protected async extractMetadata(page: Page): Promise<ScrapedMetadata | null> {
    const pageTitle = await page.title();
    const pageUrl = page.url();
    console.log(`[scraper:dvd] Page loaded — title: "${pageTitle}", url: ${pageUrl}`);

    const hasDescription = await page.$('#description');
    if (!hasDescription) {
      const bodySnippet = await page.evaluate(() => {
        const body = document.body;
        return body ? body.innerHTML.substring(0, 500) : '(no body)';
      });
      console.warn(`[scraper:dvd] #description element not found. Body preview:\n${bodySnippet}`);
      return null;
    }
    console.log(`[scraper:dvd] Found #description element`);

    const result = await page.evaluate(() => {
      const desc = document.getElementById('description')!;

      const findByLabel = (label: string): string | undefined => {
        const spans = desc.querySelectorAll('span');
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
            const dataSrc = img.getAttribute('data-src');
            coverImage = (dataSrc && !dataSrc.startsWith('data:')) ? dataSrc
              : (!img.src.startsWith('data:') ? img.src : undefined);
            break;
          }
        }
      }

      return {
        metadata: {
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
        },
        debug: {
          hasDescription: true,
          hasH1: !!h1,
          h1Text: h1?.textContent?.trim() || null,
          code,
          rawDate: rawDate || null,
          hasMakerLink: !!makerLink,
          genreCount: desc.querySelectorAll('a[href*="/categories/"]').length,
          castCount: desc.querySelectorAll('a[href*="/casts/"]').length,
          imgCount: desc.querySelectorAll('img').length,
          descriptionPreview: desc.innerHTML.substring(0, 500),
        },
      };
    });

    console.log(`[scraper:dvd] Extraction debug:`, JSON.stringify(result.debug, null, 2));

    return result.metadata;
  }
}
