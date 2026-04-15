import { Page } from 'puppeteer-core';
import { launchBrowser, createPage } from './browser';
import { config } from '../config';

export async function resolveSourceUrl(filename: string): Promise<string | null> {
  if (!config.searchUrlPrefix) {
    console.log(`[resolver] No SEARCH_URL_PREFIX configured, skipping`);
    return null;
  }

  const searchCode = filename.split(' ')[0];
  if (!searchCode) {
    console.log(`[resolver] Could not extract search code from "${filename}"`);
    return null;
  }

  const searchUrl = config.searchUrlPrefix + searchCode;
  console.log(`[resolver] Searching for "${searchCode}" at ${searchUrl}`);

  const browser = await launchBrowser();
  try {
    const page = await createPage(browser);
    try {
      await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 30000 });
      console.log(`[resolver] Page loaded — title: "${await page.title()}", url: ${page.url()}`);

      const sourceUrl = await page.evaluate((code: string) => {
        const search = document.getElementById('search');
        if (!search) return null;

        const titles = search.querySelectorAll('p.card-text.title.vid-title');
        for (const title of titles) {
          if (title.textContent?.trim().startsWith(code)) {
            let el: HTMLElement | null = title as HTMLElement;
            while (el && !el.classList.contains('card-container')) {
              el = el.parentElement;
            }
            if (!el) continue;
            const link = el.querySelector('a.video-link') as HTMLAnchorElement | null;
            if (link?.href) return link.href;
          }
        }
        return null;
      }, searchCode);

      if (sourceUrl) {
        console.log(`[resolver] Found source URL: ${sourceUrl}`);
      } else {
        console.warn(`[resolver] No matching result found for "${searchCode}"`);
      }

      await page.close();
      return sourceUrl;
    } catch (err) {
      console.error(`[resolver] Failed to resolve source URL for "${filename}":`, err);
      return null;
    }
  } finally {
    await browser.close();
  }
}
