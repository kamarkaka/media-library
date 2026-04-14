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

const scanProgress: ScanProgress = {
  status: 'idle',
  total: 0,
  processed: 0,
  currentFile: '',
  step: '',
  added: 0,
  updated: 0,
  removed: 0,
};

export function getScanProgress(): ScanProgress {
  return { ...scanProgress };
}

export function resetScanProgress(): void {
  scanProgress.status = 'idle';
  scanProgress.total = 0;
  scanProgress.processed = 0;
  scanProgress.currentFile = '';
  scanProgress.step = '';
  scanProgress.added = 0;
  scanProgress.updated = 0;
  scanProgress.removed = 0;
  scanProgress.error = undefined;
}

export function startScan(fullRescan: boolean): void {
  if (scanProgress.status === 'scanning') return;

  resetScanProgress();
  scanProgress.status = 'scanning';
  scanProgress.step = 'Starting worker...';

  const ext = path.extname(__filename);
  const workerPath = path.join(__dirname, `scan-worker${ext}`);

  let worker: Worker;
  if (ext === '.ts') {
    // Dev mode: bootstrap tsx CJS hooks so .ts imports resolve without extensions
    const code = [
      `require(${JSON.stringify(require.resolve('tsx/cjs'))})`,
      `require(${JSON.stringify(workerPath)})`,
    ].join(';');
    worker = new Worker(code, { eval: true, workerData: { fullRescan } });
  } else {
    // Production: compiled JS, no loader needed
    worker = new Worker(workerPath, { workerData: { fullRescan } });
  }

  worker.on('message', (msg: Partial<ScanProgress>) => {
    Object.assign(scanProgress, msg);
  });

  worker.on('error', (err) => {
    scanProgress.status = 'error';
    scanProgress.error = err.message;
    console.error('[scan] Worker error:', err);
  });

  worker.on('exit', (code) => {
    if (code !== 0 && scanProgress.status === 'scanning') {
      scanProgress.status = 'error';
      scanProgress.error = `Worker exited with code ${code}`;
    }
  });
}
