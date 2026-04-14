import { Router } from 'express';
import db from '../db';
import { getVideoNeighbors } from '../services/video-queries';

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

  const { prev: prevVideo, next: nextVideo } = await getVideoNeighbors(video);

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
