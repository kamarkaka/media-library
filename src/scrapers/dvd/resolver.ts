import { Browser } from 'puppeteer-core';
import * as cheerio from 'cheerio';
import { launchBrowser, createPage } from '../base/browser';
import { config } from '../../config';

let sharedBrowser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (sharedBrowser?.connected) return sharedBrowser;
  sharedBrowser = await launchBrowser();
  return sharedBrowser;
}

export async function closeResolver(): Promise<void> {
  if (sharedBrowser) {
    await sharedBrowser.close();
    sharedBrowser = null;
  }
}

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

  const browser = await getBrowser();
  const page = await createPage(browser);
  try {
    await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    console.log(`[resolver] Page loaded — title: "${await page.title()}", url: ${page.url()}`);

    const searchHtml = await page.evaluate('document.getElementById("search")?.innerHTML || ""');
    if (!searchHtml) {
      console.warn(`[resolver] #search element not found or empty`);
      return null;
    }
    console.log(`[resolver] Got #search HTML (${(searchHtml as string).length} chars)`);

    const $ = cheerio.load(searchHtml as string);

    let sourceUrl: string | null = null;
    $('p.card-text.title.vid-title').each((_, el) => {
      const title = $(el).text().trim();
      console.log(`[resolver] Found title: "${title}"`);
      if (title.startsWith(searchCode)) {
        const card = $(el).closest('.card-container');
        if (!card.length) {
          console.warn(`[resolver] Matched title but no .card-container parent found`);
          return;
        }
        const link = card.find('a.video-link');
        const href = link.attr('href');
        if (href) {
          sourceUrl = href.startsWith('http') ? href : config.sourceUrlPrefix + href;
          console.log(`[resolver] Found source URL: ${sourceUrl}`);
          return false; // break
        }
      }
    });

    if (!sourceUrl) {
      console.warn(`[resolver] No matching result found for "${searchCode}"`);
    }

    return sourceUrl;
  } catch (err) {
    console.error(`[resolver] Failed to resolve source URL for "${filename}":`, err);
    return null;
  } finally {
    await page.close();
  }
}
