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
    coverageResults,
    coverageTotalVideos,
  });
});

export default router;
