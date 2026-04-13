import { Router } from 'express';
import db from '../db';

const router = Router();

router.get('/:id', async (req, res) => {
  const video = await db('videos').where('id', req.params.id).first();
  if (!video) {
    return res.status(404).send('Video not found');
  }

  const playback = await db('playback_state').where('video_id', video.id).first();

  const genres = await db('genres')
    .join('video_genres', 'genres.id', 'video_genres.genre_id')
    .where('video_genres.video_id', video.id)
    .select('genres.name');

  const cast = await db('cast_members')
    .join('video_cast', 'cast_members.id', 'video_cast.cast_id')
    .where('video_cast.video_id', video.id)
    .select('cast_members.name');

  // Prev/next by filename order (with id tiebreaker)
  const prevVideo = await db('videos')
    .whereRaw('(filename < ? OR (filename = ? AND id < ?))', [
      video.filename,
      video.filename,
      video.id,
    ])
    .orderBy('filename', 'desc')
    .orderBy('id', 'desc')
    .select('id', 'filename')
    .first();

  const nextVideo = await db('videos')
    .whereRaw('(filename > ? OR (filename = ? AND id > ?))', [
      video.filename,
      video.filename,
      video.id,
    ])
    .orderBy('filename', 'asc')
    .orderBy('id', 'asc')
    .select('id', 'filename')
    .first();

  res.render('player', {
    title: video.filename,
    video,
    playback,
    genres,
    cast,
    prevVideo,
    nextVideo,
  });
});

export default router;
