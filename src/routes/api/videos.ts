import { Router } from 'express';
import fs from 'fs';
import mime from 'mime-types';
import db from '../../db';
import { queryVideos } from '../../services/video-queries';

const router = Router();

// Paginated video list (JSON, for infinite scroll)
router.get('/', async (req, res) => {
  const filters = {
    q: req.query.q as string | undefined,
    genre: req.query.genre as string | undefined,
    director: req.query.director as string | undefined,
    maker: req.query.maker as string | undefined,
    label: req.query.label as string | undefined,
    cast: req.query.cast as string | undefined,
    sort: (req.query.sort as string) || 'filename',
    page: parseInt(req.query.page as string) || 1,
    pageSize: parseInt(req.query.page_size as string) || 24,
  };

  const result = await queryVideos(filters);

  // Attach playback state for progress bars
  const videoIds = result.videos.map((v: any) => v.id);
  const playbackStates =
    videoIds.length > 0 ? await db('playback_state').whereIn('video_id', videoIds) : [];
  const playbackMap = Object.fromEntries(playbackStates.map((p: any) => [p.video_id, p]));

  res.json({ ...result, playbackMap });
});

// Stream video file with range-request support
router.get('/:id/stream', async (req, res) => {
  const video: any = await db('videos').where('id', req.params.id).first();
  if (!video || !fs.existsSync(video.full_path)) {
    return res.status(404).json({ error: 'Video not found' });
  }

  const stat = fs.statSync(video.full_path);
  const fileSize = stat.size;
  const mimeType = mime.lookup(video.full_path) || 'video/mp4';

  const range = req.headers.range;
  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunkSize = end - start + 1;

    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': mimeType,
    });
    fs.createReadStream(video.full_path, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': mimeType,
      'Accept-Ranges': 'bytes',
    });
    fs.createReadStream(video.full_path).pipe(res);
  }
});

// Serve cover image
router.get('/:id/cover', async (req, res) => {
  const video: any = await db('videos').where('id', req.params.id).first();
  if (!video || !video.cover_image) {
    return res.status(404).json({ error: 'No cover image' });
  }

  // If it's a URL, redirect
  if (video.cover_image.startsWith('http://') || video.cover_image.startsWith('https://')) {
    return res.redirect(video.cover_image);
  }

  // Local file
  if (fs.existsSync(video.cover_image)) {
    const mimeType = mime.lookup(video.cover_image) || 'image/jpeg';
    res.type(mimeType);
    return fs.createReadStream(video.cover_image).pipe(res);
  }

  res.status(404).json({ error: 'Cover image not found' });
});

// Get prev/next neighbors
router.get('/:id/neighbors', async (req, res) => {
  const video: any = await db('videos').where('id', req.params.id).first();
  if (!video) {
    return res.status(404).json({ error: 'Video not found' });
  }

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

  res.json({ prev: prevVideo || null, next: nextVideo || null });
});

export default router;
