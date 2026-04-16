import { Router } from 'express';
import db from '../db';
import { listScrapers } from '../scrapers/base';
import { getLatestValidationResults } from '../services/validator-scheduler';

const router = Router();

router.get('/', async (req, res) => {
  const paths = await db('library_paths').orderBy('created_at', 'desc');
  const countResult = (await db('videos').count('* as count').first()) as any;

  const validationResults = await getLatestValidationResults();

  res.render('settings', {
    title: 'Settings',
    paths,
    videoCount: countResult?.count || 0,
    scrapers: listScrapers(),
    validationResults,
  });
});

export default router;
