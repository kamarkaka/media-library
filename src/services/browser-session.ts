import { Browser, Page } from 'puppeteer-core';
import { launchBrowser, createPage, loadCookies, saveCookies } from '../scrapers/browser';

const VIEWPORT = { width: 1280, height: 800 };

interface Session {
  id: string;
  browser: Browser;
  page: Page;
  scraperType: string;
  url: string;
}

let activeSession: Session | null = null;

async function waitForPageSettle(page: Page): Promise<void> {
  try {
    await page.waitForNetworkIdle({ idleTime: 300, timeout: 3000 });
  } catch {
    // Timeout is fine — page may have continuous network activity
  }
}

export async function startSession(url: string, scraperType: string): Promise<{ id: string; screenshot: string }> {
  if (activeSession) {
    await closeSession();
  }

  const browser = await launchBrowser();
  const page = await createPage(browser);
  await page.setViewport(VIEWPORT);
  await loadCookies(page, scraperType);
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

  const id = Date.now().toString(36);
  activeSession = { id, browser, page, scraperType, url };

  const screenshot = await takeScreenshot();
  return { id, screenshot };
}

export async function takeScreenshot(): Promise<string> {
  if (!activeSession) throw new Error('No active session');
  return await activeSession.page.screenshot({ encoding: 'base64' }) as string;
}

export async function sendClick(x: number, y: number): Promise<string> {
  if (!activeSession) throw new Error('No active session');
  await activeSession.page.mouse.click(x, y);
  await waitForPageSettle(activeSession.page);
  return takeScreenshot();
}

export async function sendType(text: string): Promise<string> {
  if (!activeSession) throw new Error('No active session');
  await activeSession.page.keyboard.type(text);
  return takeScreenshot();
}

export async function sendKeypress(key: string): Promise<string> {
  if (!activeSession) throw new Error('No active session');
  await activeSession.page.keyboard.press(key as any);
  await waitForPageSettle(activeSession.page);
  return takeScreenshot();
}

export async function saveSession(): Promise<void> {
  if (!activeSession) throw new Error('No active session');
  await saveCookies(activeSession.page, activeSession.scraperType);
  await closeSession();
}

export async function closeSession(): Promise<void> {
  if (!activeSession) return;
  try {
    await activeSession.browser.close();
  } catch {
    // Browser may already be closed
  }
  activeSession = null;
}

export function getActiveSession(): { id: string; scraperType: string; url: string } | null {
  if (!activeSession) return null;
  return { id: activeSession.id, scraperType: activeSession.scraperType, url: activeSession.url };
}

// Clean up browser process on server shutdown
process.on('SIGTERM', () => closeSession());
process.on('SIGINT', () => closeSession());

export const SESSION_VIEWPORT = VIEWPORT;
