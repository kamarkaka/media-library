import { Router } from 'express';
import db from '../db';

const router = Router();

router.get('/genres', async (_req, res) => {
  const genres = await db('genres')
    .leftJoin('video_genres', 'genres.id', 'video_genres.genre_id')
    .select('genres.id', 'genres.name', 'genres.alias')
    .count('video_genres.video_id as count')
    .groupBy('genres.id')
    .orderBy('genres.name');
  res.render('tags', { title: 'Genres', tagType: 'genres', tags: genres });
});

router.get('/cast', async (_req, res) => {
  // Per-video cast-size subquery so we can tell whether a member ever appears alone.
  const videoCastCounts = db('video_cast')
    .select('video_id')
    .count('* as cnt')
    .groupBy('video_id')
    .as('vc_counts');

  const cast = await db('cast_members')
    .leftJoin('video_cast', 'cast_members.id', 'video_cast.cast_id')
    .leftJoin(videoCastCounts, 'video_cast.video_id', 'vc_counts.video_id')
    .select('cast_members.id', 'cast_members.name')
    .count('video_cast.video_id as count')
    // has_solo = featured in at least one video where they are the only cast member.
    .select(db.raw('MAX(CASE WHEN vc_counts.cnt = 1 THEN 1 ELSE 0 END) as has_solo'))
    .groupBy('cast_members.id')
    .orderBy('cast_members.name');

  res.render('tags', {
    title: 'Cast',
    tagType: 'cast',
    groups: [
      { label: 'Featured solo', tags: cast.filter((c) => c.has_solo) },
      // New members start with no videos, so they belong here — mark it the add target.
      // Folded by default: this group is usually the larger, less-interesting bucket.
      { label: 'Always co-starring', tags: cast.filter((c) => !c.has_solo), isAddTarget: true, collapsed: true },
    ],
  });
});

export default router;
