import { Router } from 'express';
import db from '../db';

const router = Router();

// Server-rendered list of favorite moments, newest first (mirrors the Settings paths-list pattern).
router.get('/', async (_req, res) => {
  const moments = await db('favorite_moments')
    .join('videos', 'videos.id', 'favorite_moments.video_id')
    .orderBy('favorite_moments.created_at', 'desc')
    .select(
      'favorite_moments.id as id',
      'favorite_moments.video_id as video_id',
      'favorite_moments.file_id as file_id',
      'favorite_moments.timestamp as timestamp',
      'videos.name as name',
      'videos.filename as filename',
      'videos.cover_image as cover_image',
      'videos.code as code',
    );
  res.render('moments', { title: 'Moments', moments });
});

export default router;
