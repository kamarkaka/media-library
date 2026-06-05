import { Worker } from 'worker_threads';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

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
const coverageProgress: ScanProgress = createProgress();
const coverDownloadProgress: ScanProgress = createProgress();
const mergeProgress: ScanProgress = createProgress();

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

export function startScrape(fullScrape: boolean, scraperType?: string): void {
  if (scrapeProgress.status === 'scanning') return;
  Object.assign(scrapeProgress, createProgress());
  scrapeProgress.status = 'scanning';
  scrapeProgress.step = 'Starting scrape...';
  spawnWorker('scrape-worker', { fullScrape, scraperType }, scrapeProgress);
}

export function getCoverageProgress(): ScanProgress {
  return { ...coverageProgress };
}

export function resetCoverageProgress(): void {
  Object.assign(coverageProgress, createProgress());
}

let currentCoverageRunId: string | null = null;

export function startCoverage(resumeRunId?: string): string {
  if (coverageProgress.status === 'scanning') return currentCoverageRunId!;
  const runId = resumeRunId || uuidv4();
  currentCoverageRunId = runId;
  Object.assign(coverageProgress, createProgress());
  coverageProgress.status = 'scanning';
  coverageProgress.step = 'Starting coverage test...';
  spawnWorker('coverage-worker', { runId }, coverageProgress);
  return runId;
}

export function getCoverDownloadProgress(): ScanProgress {
  return { ...coverDownloadProgress };
}

export function resetCoverDownloadProgress(): void {
  Object.assign(coverDownloadProgress, createProgress());
}

export function startCoverDownload(): void {
  if (coverDownloadProgress.status === 'scanning') return;
  Object.assign(coverDownloadProgress, createProgress());
  coverDownloadProgress.status = 'scanning';
  coverDownloadProgress.step = 'Starting cover download...';
  spawnWorker('cover-download-worker', {}, coverDownloadProgress);
}

export function getMergeProgress(): ScanProgress {
  return { ...mergeProgress };
}

export function resetMergeProgress(): void {
  Object.assign(mergeProgress, createProgress());
}

export function startMerge(): void {
  if (mergeProgress.status === 'scanning') return;
  Object.assign(mergeProgress, createProgress());
  mergeProgress.status = 'scanning';
  mergeProgress.step = 'Starting merge...';
  spawnWorker('merge-worker', {}, mergeProgress);
}
