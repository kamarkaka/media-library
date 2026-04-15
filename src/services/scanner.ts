import { Worker } from 'worker_threads';
import path from 'path';

export interface ScanProgress {
  status: 'idle' | 'scanning' | 'done' | 'error';
  total: number;
  processed: number;
  currentFile: string;
  step: string;
  added: number;
  updated: number;
  removed: number;
  error?: string;
}

function createProgress(): ScanProgress {
  return {
    status: 'idle',
    total: 0,
    processed: 0,
    currentFile: '',
    step: '',
    added: 0,
    updated: 0,
    removed: 0,
  };
}

const scanProgress: ScanProgress = createProgress();
const scrapeProgress: ScanProgress = createProgress();

export function getScanProgress(): ScanProgress {
  return { ...scanProgress };
}

export function getScrapeProgress(): ScanProgress {
  return { ...scrapeProgress };
}

export function resetScanProgress(): void {
  Object.assign(scanProgress, createProgress());
}

export function resetScrapeProgress(): void {
  Object.assign(scrapeProgress, createProgress());
}

function spawnWorker(workerFile: string, workerData: Record<string, any>, progress: ScanProgress): void {
  const ext = path.extname(__filename);
  const workerPath = path.join(__dirname, `${workerFile}${ext}`);

  let worker: Worker;
  if (ext === '.ts') {
    const code = [
      `require(${JSON.stringify(require.resolve('tsx/cjs'))})`,
      `require(${JSON.stringify(workerPath)})`,
    ].join(';');
    worker = new Worker(code, { eval: true, workerData });
  } else {
    worker = new Worker(workerPath, { workerData });
  }

  worker.on('message', (msg: Partial<ScanProgress>) => {
    Object.assign(progress, msg);
  });

  worker.on('error', (err) => {
    progress.status = 'error';
    progress.error = err.message;
    console.error(`[${workerFile}] Worker error:`, err);
  });

  worker.on('exit', (code) => {
    if (code !== 0 && progress.status === 'scanning') {
      progress.status = 'error';
      progress.error = `Worker exited with code ${code}`;
    }
  });
}

export function startScan(fullScan: boolean): void {
  if (scanProgress.status === 'scanning') return;
  Object.assign(scanProgress, createProgress());
  scanProgress.status = 'scanning';
  scanProgress.step = 'Starting scan...';
  spawnWorker('scan-worker', { fullScan }, scanProgress);
}

export function startScrape(fullScrape: boolean): void {
  if (scrapeProgress.status === 'scanning') return;
  Object.assign(scrapeProgress, createProgress());
  scrapeProgress.status = 'scanning';
  scrapeProgress.step = 'Starting scrape...';
  spawnWorker('scrape-worker', { fullScrape }, scrapeProgress);
}
