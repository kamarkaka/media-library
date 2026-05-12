import { Router } from 'express';
import {
  startScan, startScrape,
  getScanProgress, getScrapeProgress,
  resetScanProgress, resetScrapeProgress,
} from '../../services/scanner';
import { runValidation, getValidatorConfig } from '../../scrapers/base';
import { getLatestValidationResults } from '../../services/validator-scheduler';
import db from '../../db';

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

// Get latest validation results per scraper
router.get('/validation-results', async (_req, res) => {
  try {
    const results = await getLatestValidationResults();
    res.json(results);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Fix release_date format: convert "DD Mon YYYY" to "YYYY-MM-DD"
router.post('/fix-dates', async (_req, res) => {
  try {
    const videos = await db('videos')
      .select('id', 'release_date')
      .whereNotNull('release_date')
      .where('release_date', '!=', '');

    const months: Record<string, string> = {
      Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
      Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
    };
    const ddMonYyyy = /^(\d{2}) ([A-Z][a-z]{2}) (\d{4})$/;
    let fixed = 0;

    for (const video of videos) {
      const match = ddMonYyyy.exec(video.release_date);
      if (match) {
        const iso = `${match[3]}-${months[match[2]]}-${match[1]}`;
        await db('videos').where('id', video.id).update({ release_date: iso });
        fixed++;
      }
    }

    res.json({ success: true, total: videos.length, fixed });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
