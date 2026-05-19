import { Router } from 'express';
import db from '../db';

const router = Router();

router.get('/genres', async (_req, res) => {
  const genres = await db('genres')
    .leftJoin('video_genres', 'genres.id', 'video_genres.genre_id')
    .select('genres.id', 'genres.name')
    .count('video_genres.video_id as count')
    .groupBy('genres.id')
    .orderBy('genres.name');
  res.render('tags', { title: 'Genres', tagType: 'genres', tags: genres });
});

router.get('/cast', async (_req, res) => {
  const cast = await db('cast_members')
    .leftJoin('video_cast', 'cast_members.id', 'video_cast.cast_id')
    .select('cast_members.id', 'cast_members.name')
    .count('video_cast.video_id as count')
    .groupBy('cast_members.id')
    .orderBy('cast_members.name');
  res.render('tags', { title: 'Cast', tagType: 'cast', tags: cast });
});

export default router;
