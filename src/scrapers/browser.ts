import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { Browser, Page } from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
import { config } from '../config';

puppeteer.use(StealthPlugin());

const COOKIES_DIR = path.join(path.dirname(config.dbPath), 'cookies');
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const LAUNCH_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
];

export async function launchBrowser(): Promise<Browser> {
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium-browser',
    args: LAUNCH_ARGS,
  });
  if (!browser) throw new Error('Failed to launch browser');
  return browser;
}

export async function createPage(browser: Browser): Promise<Page> {
  const page = await browser.newPage();
  await page.setUserAgent(USER_AGENT);
  return page;
}

export function cookiePath(scraperType: string): string {
  return path.join(COOKIES_DIR, `${scraperType}.json`);
}

export async function loadCookies(page: Page, scraperType: string): Promise<void> {
  try {
    const filePath = cookiePath(scraperType);
    if (fs.existsSync(filePath)) {
      const cookies = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      await page.setCookie(...cookies);
    }
  } catch {
    // Ignore corrupt cookie files
  }
}

export async function saveCookies(page: Page, scraperType: string): Promise<void> {
  if (!fs.existsSync(COOKIES_DIR)) {
    fs.mkdirSync(COOKIES_DIR, { recursive: true });
  }
  const cookies = await page.cookies();
  fs.writeFileSync(cookiePath(scraperType), JSON.stringify(cookies, null, 2));
}
