import { Router } from 'express';
import db from '../db';
import { getVideoNeighbors } from '../services/video-queries';
import { listScrapers } from '../scrapers/base';

const router = Router();

// A file can be played directly (no transcode) when it is H.264/AAC|MP3 in an MP4/M4V container
function computeDirectPlay(fullPath: string | null, videoCodec: string | null, audioCodec: string | null): boolean {
  const ext = (fullPath || '').split('.').pop()?.toLowerCase();
  return videoCodec === 'h264'
    && (audioCodec === 'aac' || audioCodec === 'mp3')
    && (ext === 'mp4' || ext === 'm4v');
}

router.get('/:id', async (req, res) => {
  const video = await db('videos').where('id', req.params.id).first();
  if (!video) {
    return res.status(404).send('Video not found');
  }

  const playback = await db('playback_state').where('video_id', video.id).first();

  const genres = await db('genres')
    .join('video_genres', 'genres.id', 'video_genres.genre_id')
    .where('video_genres.video_id', video.id)
    .select('genres.id', 'genres.name', 'genres.alias')
    .orderBy('genres.name');

  const cast = await db('cast_members')
    .join('video_cast', 'cast_members.id', 'video_cast.cast_id')
    .where('video_cast.video_id', video.id)
    .select('cast_members.id', 'cast_members.name')
    .orderBy('cast_members.name');

  const { prev: prevVideo, next: nextVideo } = await getVideoNeighbors(video);

  const seekStepRow = await db('settings').where('key', 'seek_step').first();
  const seekStep = seekStepRow ? parseInt(seekStepRow.value, 10) || 10 : 10;

  // Load all physical files for this entry (alphabetical; the first is the default to play)
  const fileRows = await db('video_files').where('video_id', video.id).orderBy('filename', 'asc');
  const files = fileRows.map((f: any) => ({
    id: f.id,
    filename: f.filename,
    isDefault: f.id === video.default_file_id,
    directPlay: computeDirectPlay(f.full_path, f.video_codec, f.audio_codec),
    streamUrl: `/api/videos/${video.id}/stream?file=${f.id}`,
    hlsUrl: `/api/videos/${video.id}/hls?file=${f.id}`,
  }));

  // Direct-play decision is per file; use the default file (falling back to the videos-row mirror)
  const defaultFile = files.length ? files[0] : null;
  const canDirectPlay = defaultFile
    ? defaultFile.directPlay
    : computeDirectPlay(video.full_path, video.video_codec, video.audio_codec);

  // Load field sources for this video
  const fieldSourceRows = await db('field_sources').where('video_id', video.id).select('field', 'source');
  const fieldSources: Record<string, string> = {};
  for (const row of fieldSourceRows) fieldSources[row.field] = row.source;

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
    files,
    scrapers: listScrapers(),
    fieldSources,
  });
});

export default router;
