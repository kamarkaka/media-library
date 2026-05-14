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
    .select('genres.id', 'genres.name')
    .orderBy('genres.name');

  const cast = await db('cast_members')
    .join('video_cast', 'cast_members.id', 'video_cast.cast_id')
    .where('video_cast.video_id', video.id)
    .select('cast_members.id', 'cast_members.name')
    .orderBy('cast_members.name');

  const { prev: prevVideo, next: nextVideo } = await getVideoNeighbors(video);

  const seekStepRow = await db('settings').where('key', 'seek_step').first();
  const seekStep = seekStepRow ? parseInt(seekStepRow.value, 10) || 10 : 10;

  // Determine if the video can be played directly (H.264/AAC in MP4/M4V container)
  const ext = (video.full_path || '').split('.').pop()?.toLowerCase();
  const canDirectPlay = video.video_codec === 'h264'
    && (video.audio_codec === 'aac' || video.audio_codec === 'mp3')
    && (ext === 'mp4' || ext === 'm4v');

  res.render('player', {
    title: video.filename,
    video,
    playback,
    genres,
    cast,
    prevVideo,
    nextVideo,
    seekStep,
    canDirectPlay,
  });
});

export default router;
