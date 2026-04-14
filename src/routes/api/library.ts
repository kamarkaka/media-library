import { Router } from 'express';
import { scanLibrary, getScanProgress, resetScanProgress } from '../../services/scanner';
import { getScraper } from '../../scrapers';

const router = Router();

router.post('/scan', (_req, res) => {
  const progress = getScanProgress();
  if (progress.status === 'scanning') {
    return res.json({ success: true, message: 'Scan already in progress' });
  }

  // Fire and forget — scan runs in background
  const scraper = getScraper();
  scanLibrary(scraper).catch(console.error);

  res.json({ success: true, message: 'Scan started' });
});

router.get('/scan/status', (_req, res) => {
  const progress = getScanProgress();
  res.json(progress);

  // Once a terminal state has been read by the client, reset to idle
  // so stale results don't show on next page load
  if (progress.status === 'done' || progress.status === 'error') {
    resetScanProgress();
  }
});

export default router;
