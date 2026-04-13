import { Router } from 'express';
import db from '../db';

const router = Router();

router.get('/', async (req, res) => {
  const paths = await db('library_paths').orderBy('created_at', 'desc');
  const countResult = (await db('videos').count('* as count').first()) as any;

  res.render('settings', {
    title: 'Settings',
    paths,
    videoCount: countResult?.count || 0,
  });
});

export default router;
