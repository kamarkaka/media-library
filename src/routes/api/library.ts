import { Router } from 'express';
import {
  startScan, startScrape,
  getScanProgress, getScrapeProgress,
  resetScanProgress, resetScrapeProgress,
} from '../../services/scanner';

const router = Router();

router.post('/scan', (req, res) => {
  const progress = getScanProgress();
  if (progress.status === 'scanning') {
    return res.json({ success: false, message: 'Scan already in progress' });
  }
  const fullScan = req.body?.fullScan === true;
  startScan(fullScan);
  res.json({ success: true, message: fullScan ? 'Full scan started' : 'Quick scan started' });
});

router.get('/scan/status', (_req, res) => {
  const progress = getScanProgress();
  res.json(progress);
  if (progress.status === 'done' || progress.status === 'error') {
    resetScanProgress();
  }
});

router.post('/scrape', (req, res) => {
  const progress = getScrapeProgress();
  if (progress.status === 'scanning') {
    return res.json({ success: false, message: 'Scrape already in progress' });
  }
  const fullScrape = req.body?.fullScrape === true;
  startScrape(fullScrape);
  res.json({ success: true, message: fullScrape ? 'Full scrape started' : 'Quick scrape started' });
});

router.get('/scrape/status', (_req, res) => {
  const progress = getScrapeProgress();
  res.json(progress);
  if (progress.status === 'done' || progress.status === 'error') {
    resetScrapeProgress();
  }
});

export default router;
