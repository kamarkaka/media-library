import puppeteer from 'puppeteer-core';
import { Browser, Page } from 'puppeteer-core';

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
  return await browser.newPage();
}
