import { Router } from 'express';
import fs from 'fs';
import mime from 'mime-types';
import db from '../../db';
import { queryVideos, getPlaybackMap, getVideoNeighbors, parseVideoFilters } from '../../services/video-queries';

const router = Router();

// Paginated video list (JSON, for infinite scroll)
router.get('/', async (req, res) => {
  const filters = parseVideoFilters(req.query as Record<string, any>);
  const result = await queryVideos(filters);
  const playbackMap = await getPlaybackMap(result.videos.map((v: any) => v.id));
  res.json({ ...result, playbackMap });
});

// Stream video file with range-request support
router.get('/:id/stream', async (req, res) => {
  const video: any = await db('videos').where('id', req.params.id).first();
  if (!video) {
    return res.status(404).json({ error: 'Video not found' });
  }

  let stat;
  try {
    stat = fs.statSync(video.full_path);
  } catch {
    return res.status(404).json({ error: 'Video file not found on disk' });
  }

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

  if (video.cover_image.startsWith('http://') || video.cover_image.startsWith('https://')) {
    return res.redirect(video.cover_image);
  }

  const mimeType = mime.lookup(video.cover_image) || 'image/jpeg';
  const stream = fs.createReadStream(video.cover_image);
  stream.on('error', () => res.status(404).json({ error: 'Cover image not found' }));
  res.type(mimeType);
  stream.pipe(res);
});

// Get prev/next neighbors
router.get('/:id/neighbors', async (req, res) => {
  const video: any = await db('videos').where('id', req.params.id).first();
  if (!video) {
    return res.status(404).json({ error: 'Video not found' });
  }
  res.json(await getVideoNeighbors(video));
});

export default router;
