import { Router } from 'express';
import { scanLibrary } from '../../services/scanner';
import { getScraper } from '../../scrapers';

const router = Router();

router.post('/scan', async (_req, res) => {
  try {
    const scraper = getScraper();
    const result = await scanLibrary(scraper);
    res.json({ success: true, ...result });
  } catch (err: any) {
    console.error('Scan error:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
