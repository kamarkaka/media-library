import { Router } from 'express';
import {
  startScan, startScrape,
  getScanProgress, getScrapeProgress,
  resetScanProgress, resetScrapeProgress,
  startCoverage, getCoverageProgress, resetCoverageProgress,
  startCoverDownload, getCoverDownloadProgress, resetCoverDownloadProgress,
  startMerge, getMergeProgress, resetMergeProgress,
  startThumbnail, getThumbnailProgress, resetThumbnailProgress,
} from '../../services/scanner';
import { runValidation, getValidatorConfig, listScrapers } from '../../scrapers/base';
import { getLatestValidationResults } from '../../services/validator-scheduler';
import db, { setSetting } from '../../db';

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

router.post('/validate-all', async (_req, res) => {
  const scraperNames = listScrapers();
  const results: Record<string, any> = {};

  for (const name of scraperNames) {
    try {
      const result = await runValidation(name);
      results[name] = result || { success: false, error: 'No test config' };
    } catch (err: any) {
      results[name] = { success: false, error: err.message };
    }
  }

  res.json({ results });
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

router.post('/auto-match', async (_req, res) => {
  try {
    const matched = await db('videos')
      .whereNotNull('code').where('code', '!=', '')
      .whereNotNull('name').where('name', '!=', '')
      .whereNotNull('cover_image').where('cover_image', '!=', '')
      .whereNotNull('release_date').where('release_date', '!=', '')
      .update({ matched: 1 });

    const unmatched = await db('videos')
      .where(function () {
        this.whereNull('code').orWhere('code', '')
          .orWhereNull('name').orWhere('name', '')
          .orWhereNull('cover_image').orWhere('cover_image', '')
          .orWhereNull('release_date').orWhere('release_date', '');
      })
      .update({ matched: 0 });

    res.json({ success: true, matched, unmatched });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/scraper-config', async (_req, res) => {
  const rows = await db('scraper_field_config').select('field', 'scraper_type');
  const config: Record<string, string> = {};
  for (const row of rows) config[row.field] = row.scraper_type;
  res.json(config);
});

router.put('/scraper-config', async (req, res) => {
  const fields = req.body;
  if (!fields || typeof fields !== 'object') {
    return res.status(400).json({ error: 'Expected field config object' });
  }
  const validFields = ['code', 'name', 'release_date', 'director', 'maker', 'label', 'cover_image', 'genres', 'cast'];
  for (const [field, scraperType] of Object.entries(fields)) {
    if (!validFields.includes(field)) continue;
    if (scraperType) {
      await db('scraper_field_config')
        .insert({ field, scraper_type: scraperType as string })
        .onConflict('field').merge();
    } else {
      await db('scraper_field_config').where('field', field).del();
    }
  }
  res.json({ success: true });
});

router.put('/settings/seek-step', async (req, res) => {
  const step = parseInt(req.body.step, 10);
  if (![5, 10, 15, 30].includes(step)) {
    return res.status(400).json({ error: 'Invalid step value' });
  }
  await setSetting('seek_step', String(step));
  res.json({ success: true, step });
});

router.put('/settings/default-scraper', async (req, res) => {
  const scraper = req.body.scraper;
  if (!scraper) return res.status(400).json({ error: 'scraper is required' });
  await setSetting('default_scraper', scraper);
  res.json({ success: true, scraper });
});

router.put('/settings/thumbnail-count', async (req, res) => {
  const count = parseInt(req.body.count, 10);
  if (![5, 10, 15, 20, 30].includes(count)) {
    return res.status(400).json({ error: 'Invalid count value' });
  }
  await setSetting('thumbnail_count', String(count));
  res.json({ success: true, count });
});

// Batch replace genre or cast across all videos
router.post('/batch-replace', async (req, res) => {
  const { type, source, destination } = req.body;
  if (!type || !source || !destination) {
    return res.status(400).json({ error: 'type, source, and destination are required' });
  }
  if (type !== 'genres' && type !== 'cast') {
    return res.status(400).json({ error: 'type must be genres or cast' });
  }

  const cfg = type === 'genres'
    ? { table: 'genres', joinTable: 'video_genres', fk: 'genre_id' }
    : { table: 'cast_members', joinTable: 'video_cast', fk: 'cast_id' };

  try {
    const sourceRow = await db(cfg.table).where('name', source.trim()).first();
    if (!sourceRow) return res.json({ success: true, replaced: 0 });

    // Ensure destination exists
    let destRow = await db(cfg.table).where('name', destination.trim()).first();
    if (!destRow) {
      const [id] = await db(cfg.table).insert({ name: destination.trim() });
      destRow = { id };
    }

    // Find all videos with the source tag
    const videoIds = await db(cfg.joinTable)
      .where(cfg.fk, sourceRow.id)
      .select('video_id');

    let replaced = 0;
    for (const { video_id } of videoIds) {
      // Remove source tag
      await db(cfg.joinTable).where({ video_id, [cfg.fk]: sourceRow.id }).del();
      // Add destination tag if not already present
      await db(cfg.joinTable)
        .insert({ video_id, [cfg.fk]: destRow.id })
        .onConflict(['video_id', cfg.fk]).ignore();
      replaced++;
    }

    // Remove orphaned tags with no videos linked
    await db(cfg.table)
      .whereNotExists(function () {
        this.select(db.raw(1)).from(cfg.joinTable).whereRaw(`${cfg.joinTable}.${cfg.fk} = ${cfg.table}.id`);
      })
      .del();

    res.json({ success: true, replaced });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Coverage test
router.post('/coverage', async (req, res) => {
  const progress = getCoverageProgress();
  if (progress.status === 'scanning') {
    return res.json({ success: false, message: 'Coverage test already in progress' });
  }
  // Check for incomplete previous run to resume
  const lastRunRow = await db('settings').where('key', 'coverage_run_id').first();
  const resumeId = req.body?.resume && lastRunRow ? lastRunRow.value : undefined;
  const runId = startCoverage(resumeId);
  await setSetting('coverage_run_id', runId);
  res.json({ success: true, runId });
});

router.get('/coverage/status', (_req, res) => {
  const progress = getCoverageProgress();
  res.json(progress);
  if (progress.status === 'done' || progress.status === 'error') {
    resetCoverageProgress();
  }
});

router.get('/coverage/results', async (_req, res) => {
  try {
    // Get the latest run_id
    const latestRun = await db('coverage_results')
      .select('run_id')
      .orderBy('created_at', 'desc')
      .first();
    if (!latestRun) return res.json({ results: [] });

    const runId = latestRun.run_id;
    const totalVideos = (await db('videos').count('* as c').first() as any)?.c || 0;
    const results = await db('coverage_results')
      .where('run_id', runId)
      .select('scraper_type')
      .sum('success as hits')
      .count('* as tested')
      .groupBy('scraper_type');

    res.json({
      runId,
      totalVideos,
      results: results.map((r: any) => ({
        scraper: r.scraper_type,
        hits: r.hits,
        tested: r.tested,
      })),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/cover-download', (_req, res) => {
  const progress = getCoverDownloadProgress();
  if (progress.status === 'scanning') {
    return res.json({ success: false, message: 'Cover download already in progress' });
  }
  startCoverDownload();
  res.json({ success: true });
});

router.get('/cover-download/status', (_req, res) => {
  const progress = getCoverDownloadProgress();
  res.json(progress);
  if (progress.status === 'done' || progress.status === 'error') {
    resetCoverDownloadProgress();
  }
});

// Merge entries that share the same code into one (files become selectable in the player)
router.post('/merge-dupes', (_req, res) => {
  const progress = getMergeProgress();
  if (progress.status === 'scanning') {
    return res.json({ success: false, message: 'Merge already in progress' });
  }
  startMerge();
  res.json({ success: true });
});

router.get('/merge-dupes/status', (_req, res) => {
  const progress = getMergeProgress();
  res.json(progress);
  if (progress.status === 'done' || progress.status === 'error') {
    resetMergeProgress();
  }
});

// Generate thumbnails for every file in the library (N per file)
router.post('/thumbnails', (_req, res) => {
  const progress = getThumbnailProgress();
  if (progress.status === 'scanning') {
    return res.json({ success: false, message: 'Thumbnail generation already in progress' });
  }
  startThumbnail();
  res.json({ success: true });
});

router.get('/thumbnails/status', (_req, res) => {
  const progress = getThumbnailProgress();
  res.json(progress);
  if (progress.status === 'done' || progress.status === 'error') {
    resetThumbnailProgress();
  }
});

router.post('/db-refresh', async (_req, res) => {
  await db.raw('PRAGMA wal_checkpoint(TRUNCATE)');
  res.json({ success: true });
});

export default router;
