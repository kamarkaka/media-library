import { Router } from 'express';
import db from '../../db';

const router = Router();

router.get('/genres', async (_req, res) => {
  const rows = await db('genres')
    .join('video_genres', 'genres.id', 'video_genres.genre_id')
    .distinct('genres.name as name')
    .orderBy('name');
  res.json(rows.map((r: any) => r.name));
});

router.get('/directors', async (_req, res) => {
  const rows = await db('videos')
    .whereNotNull('director')
    .where('director', '!=', '')
    .distinct('director as name')
    .orderBy('name');
  res.json(rows.map((r: any) => r.name));
});

router.get('/makers', async (_req, res) => {
  const rows = await db('videos')
    .whereNotNull('maker')
    .where('maker', '!=', '')
    .distinct('maker as name')
    .orderBy('name');
  res.json(rows.map((r: any) => r.name));
});

router.get('/labels', async (_req, res) => {
  const rows = await db('videos')
    .whereNotNull('label')
    .where('label', '!=', '')
    .distinct('label as name')
    .orderBy('name');
  res.json(rows.map((r: any) => r.name));
});

router.get('/cast', async (_req, res) => {
  const rows = await db('cast_members')
    .join('video_cast', 'cast_members.id', 'video_cast.cast_id')
    .distinct('cast_members.name as name')
    .orderBy('name');
  res.json(rows.map((r: any) => r.name));
});

export default router;
