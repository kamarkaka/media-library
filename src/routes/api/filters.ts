import { Router } from 'express';
import db from '../../db';
import { getFilterOptions } from '../../services/video-queries';

const router = Router();

// Search suggestions across code, name, filename, cast, genre
router.get('/search-suggestions', async (req, res) => {
  const q = (req.query.q as string || '').trim();
  if (!q) return res.json({});

  const like = `%${q}%`;
  const limit = 5;

  const [codes, names, filenames, genres, cast] = await Promise.all([
    db('videos').where('code', 'like', like).whereNotNull('code')
      .distinct('code as value').limit(limit),
    db('videos').where('name', 'like', like).whereNotNull('name')
      .distinct('name as value').limit(limit),
    db('videos').where('filename', 'like', like)
      .distinct('filename as value').limit(limit),
    db('genres')
      .join('video_genres', 'genres.id', 'video_genres.genre_id')
      .where('genres.name', 'like', like)
      .distinct('genres.name as value').limit(limit),
    db('cast_members')
      .join('video_cast', 'cast_members.id', 'video_cast.cast_id')
      .where('cast_members.name', 'like', like)
      .distinct('cast_members.name as value').limit(limit),
  ]);

  const result: Record<string, string[]> = {};
  if (codes.length) result.code = codes.map((r: any) => r.value);
  if (names.length) result.name = names.map((r: any) => r.value);
  if (filenames.length) result.filename = filenames.map((r: any) => r.value);
  if (genres.length) result.genre = genres.map((r: any) => r.value);
  if (cast.length) result.cast = cast.map((r: any) => r.value);

  res.json(result);
});

router.get('/genres', async (_req, res) => {
  const { genres } = await getFilterOptions();
  res.json(genres.map((r: any) => r.name));
});

router.get('/directors', async (_req, res) => {
  const { directors } = await getFilterOptions();
  res.json(directors.map((r: any) => r.name));
});

router.get('/makers', async (_req, res) => {
  const { makers } = await getFilterOptions();
  res.json(makers.map((r: any) => r.name));
});

router.get('/labels', async (_req, res) => {
  const { labels } = await getFilterOptions();
  res.json(labels.map((r: any) => r.name));
});

router.get('/cast', async (_req, res) => {
  const { castMembers } = await getFilterOptions();
  res.json(castMembers.map((r: any) => r.name));
});

export default router;
