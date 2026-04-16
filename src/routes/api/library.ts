import { Router } from 'express';
import {
  startScan, startScrape,
  getScanProgress, getScrapeProgress,
  resetScanProgress, resetScrapeProgress,
} from '../../services/scanner';
import { runValidation, getValidatorConfig } from '../../scrapers/base';

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
  const scraperType = req.body?.scraperType || undefined;
  startScrape(fullScrape, scraperType);
  res.json({ success: true, message: fullScrape ? 'Full scrape started' : 'Quick scrape started' });
});

router.get('/scrape/status', (_req, res) => {
  const progress = getScrapeProgress();
  res.json(progress);
  if (progress.status === 'done' || progress.status === 'error') {
    resetScrapeProgress();
  }
});

// Validate a scraper against its test configuration
router.post('/validate', async (req, res) => {
  const scraperType = req.body?.scraperType;
  if (!scraperType) {
    return res.status(400).json({ error: 'scraperType is required' });
  }

  const testConfig = getValidatorConfig(scraperType);
  if (!testConfig) {
    return res.json({ error: `No validator configured for "${scraperType}". Set the validator env vars.` });
  }

  try {
    const result = await runValidation(scraperType);
    res.json(result);
  } catch (err: any) {
    console.error(`[validator] Error running validation for "${scraperType}":`, err);
    res.status(500).json({ error: err.message || 'Validation failed' });
  }
});

export default router;
