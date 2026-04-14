import { Router } from 'express';
import db from '../db';

const router = Router();

router.get('/genres', async (_req, res) => {
  const genres = await db('genres').orderBy('name');
  res.render('tags', { title: 'Genres', tagType: 'genres', tags: genres });
});

router.get('/cast', async (_req, res) => {
  const cast = await db('cast_members').orderBy('name');
  res.render('tags', { title: 'Cast', tagType: 'cast', tags: cast });
});

export default router;
