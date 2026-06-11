import { Router } from 'express';
import db, { getIntSetting } from '../db';
import { getVideoNeighbors, fileMissing } from '../services/video-queries';
import { listScrapers } from '../scrapers/base';
import { listThumbnailsForCode } from '../services/thumbnail-generator';

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

  const seekStep = await getIntSetting(db, 'seek_step', 10);

  // Load all physical files for this entry (alphabetical; the first is the default to play)
  const fileRows = await db('video_files').where('video_id', video.id).orderBy('filename', 'asc');
  const files = await Promise.all(fileRows.map(async (f: any) => ({
    id: f.id,
    filename: f.filename,
    isDefault: f.id === video.default_file_id,
    directPlay: computeDirectPlay(f.full_path, f.video_codec, f.audio_codec),
    streamUrl: `/api/videos/${video.id}/stream?file=${f.id}`,
    hlsUrl: `/api/videos/${video.id}/hls?file=${f.id}`,
    path: f.full_path,
    missing: await fileMissing(f.full_path),
  })));

  // Thumbnails are stored per code (continuous across the entry's files)
  const thumbnails = listThumbnailsForCode(video.id, video.code);

  // Direct-play decision is per file; use the default file (falling back to the videos-row mirror)
  const defaultFile = files.length ? files[0] : null;
  const canDirectPlay = defaultFile
    ? defaultFile.directPlay
    : computeDirectPlay(video.full_path, video.video_codec, video.audio_codec);

  // Load field sources for this video
  const fieldSourceRows = await db('field_sources').where('video_id', video.id).select('field', 'source');
  const fieldSources: Record<string, string> = {};
  for (const row of fieldSourceRows) fieldSources[row.field] = row.source;

  // Deep link from a favorite moment: start at ?t= (seconds), optionally on a specific ?file=
  const startAt = parseFloat(req.query.t as string) || 0;
  const startFile = (req.query.file as string) || '';

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
    thumbnails,
    startAt,
    startFile,
    scrapers: listScrapers(),
    fieldSources,
  });
});

export default router;
