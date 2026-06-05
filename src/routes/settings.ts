import { Router } from 'express';
import db from '../db';
import { listScrapers } from '../scrapers/base';
import { getLatestValidationResults } from '../services/validator-scheduler';

const router = Router();

router.get('/', async (req, res) => {
  const paths = await db('library_paths').orderBy('created_at', 'desc');
  const countResult = (await db('videos').count('* as count').first()) as any;

  const validationResults = await getLatestValidationResults();
  const seekStepRow = await db('settings').where('key', 'seek_step').first();
  const seekStep = seekStepRow ? parseInt(seekStepRow.value, 10) || 10 : 10;
  const defaultScraperRow = await db('settings').where('key', 'default_scraper').first();
  const defaultScraper = defaultScraperRow ? defaultScraperRow.value : listScrapers()[0] || '';

  const scraperFieldConfigRows = await db('scraper_field_config').select('field', 'scraper_type');
  const scraperFieldConfig: Record<string, string> = {};
  for (const row of scraperFieldConfigRows) scraperFieldConfig[row.field] = row.scraper_type;

  // Coverage results
  let coverageResults: any[] = [];
  let coverageTotalVideos = 0;
  const latestCoverageRun = await db('coverage_results').select('run_id').orderBy('created_at', 'desc').first();
  if (latestCoverageRun) {
    coverageTotalVideos = (countResult?.count || 0) as number;
    coverageResults = await db('coverage_results')
      .where('run_id', latestCoverageRun.run_id)
      .select('scraper_type')
      .sum('success as hits')
      .count('* as tested')
      .groupBy('scraper_type');
  }

  res.render('settings', {
    title: 'Settings',
    paths,
    videoCount: countResult?.count || 0,
    scrapers: listScrapers(),
    validationResults,
    seekStep,
    defaultScraper,
    scraperFieldConfig,
    coverageResults,
    coverageTotalVideos,
  });
});

export default router;
