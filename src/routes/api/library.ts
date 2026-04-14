import { Router } from 'express';
import { scanLibrary, getScanProgress } from '../../services/scanner';
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
  res.json(getScanProgress());
});

export default router;
