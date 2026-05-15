import { Browser } from 'puppeteer-core';
import * as cheerio from 'cheerio';
import { launchBrowser, createPage } from '../base/browser';
import { SEARCH_URL_PREFIX, SOURCE_URL_PREFIX } from './config';

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
  if (!SEARCH_URL_PREFIX) {
    console.log(`[resolver] No SEARCH_URL_PREFIX configured, skipping`);
    return null;
  }

  const searchCode = filename.split(' ')[0];
  if (!searchCode) {
    console.log(`[resolver] Could not extract search code from "${filename}"`);
    return null;
  }

  const searchUrl = SEARCH_URL_PREFIX + '?keyword=' + searchCode;
  console.log(`[resolver] Searching for "${searchCode}" at ${searchUrl}`);

  const browser = await getBrowser();
  const page = await createPage(browser);
  try {
    await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    console.log(`[resolver] Page loaded — title: "${await page.title()}", url: ${page.url()}`);

    const searchHtml = await page.evaluate('document.getElementById("page-list")?.innerHTML || ""');
    if (!searchHtml) {
      console.warn(`[resolver] #search element not found or empty`);
      return null;
    }
    console.log(`[resolver] Got #search HTML (${(searchHtml as string).length} chars)`);

    const $ = cheerio.load(searchHtml as string);

    let sourceUrl: string | null = null;
    $('div.box-item .detail a').each((_, el) => {
      const title = $(el).text().trim();
      console.log(`[resolver] Found title: "${title}"`);
      if (title.toLowerCase().startsWith(searchCode.toLowerCase())) {
        const href = $(el).attr('href');
        if (href) {
          sourceUrl = href.startsWith('http') ? href : SOURCE_URL_PREFIX + href;
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
