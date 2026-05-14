import { Router } from 'express';
import fs from 'fs';
import mime from 'mime-types';
import db from '../../db';
import { queryVideos, getPlaybackMap, getVideoNeighbors, parseVideoFilters } from '../../services/video-queries';
import {
  generateMasterPlaylist, isTranscoded, isTranscoding,
  getPlaylistContent, getSegmentPath, startTranscoding,
} from '../../services/hls-transcoder';

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

async function syncRelation(
  videoId: string, csv: string,
  lookupTable: string, joinTable: string, foreignKey: string,
): Promise<void> {
  const names = csv.split(',').map((s: string) => s.trim()).filter(Boolean);
  await db(joinTable).where('video_id', videoId).del();
  for (const name of names) {
    let row: any = await db(lookupTable).where('name', name).first();
    if (!row) {
      const [id] = await db(lookupTable).insert({ name });
      row = { id };
    }
    await db(joinTable).insert({ video_id: videoId, [foreignKey]: row.id }).onConflict(['video_id', foreignKey]).ignore();
  }
}

router.put('/:id', async (req, res) => {
  try {
    const video = await db('videos').where('id', req.params.id).first();
    if (!video) {
      return res.status(404).json({ error: 'Video not found' });
    }

    const allowedFields = [
      'code', 'name', 'release_date', 'director', 'maker', 'label', 'cover_image',
    ];
    const updates: Record<string, any> = {};
    for (const field of allowedFields) {
      if (field in req.body) {
        const val = req.body[field];
        updates[field] = val === '' ? null : val;
      }
    }
    if ('matched' in req.body) {
      updates.matched = req.body.matched ? 1 : 0;
    }

    if ('genres' in req.body) {
      await syncRelation(req.params.id, req.body.genres || '', 'genres', 'video_genres', 'genre_id');
    }
    if ('cast' in req.body) {
      await syncRelation(req.params.id, req.body.cast || '', 'cast_members', 'video_cast', 'cast_id');
    }

    if (Object.keys(updates).length > 0) {
      updates.updated_at = new Date().toISOString();
      await db('videos').where('id', req.params.id).update(updates);
    }

    const updated = await db('videos').where('id', req.params.id).first();
    res.json(updated);
  } catch (err: any) {
    console.error('[api] Failed to update video:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// Add/remove genre or cast for a video
const relationTypes: Record<string, { table: string; joinTable: string; fk: string }> = {
  genres: { table: 'genres', joinTable: 'video_genres', fk: 'genre_id' },
  cast: { table: 'cast_members', joinTable: 'video_cast', fk: 'cast_id' },
};

for (const [route, cfg] of Object.entries(relationTypes)) {
  router.post(`/:id/${route}`, async (req, res) => {
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Name is required' });
    }
    let row: any = await db(cfg.table).where('name', name.trim()).first();
    if (!row) {
      const [id] = await db(cfg.table).insert({ name: name.trim() });
      row = { id, name: name.trim() };
    }
    await db(cfg.joinTable)
      .insert({ video_id: req.params.id, [cfg.fk]: row.id })
      .onConflict(['video_id', cfg.fk]).ignore();
    res.json({ id: row.id, name: row.name });
  });

  router.delete(`/:id/${route}/:tagId`, async (req, res) => {
    await db(cfg.joinTable)
      .where({ video_id: req.params.id, [cfg.fk]: req.params.tagId })
      .del();
    res.json({ success: true });
  });
}

// Get prev/next neighbors
router.get('/:id/neighbors', async (req, res) => {
  const video: any = await db('videos').where('id', req.params.id).first();
  if (!video) {
    return res.status(404).json({ error: 'Video not found' });
  }
  res.json(await getVideoNeighbors(video));
});

// HLS master playlist
router.get('/:id/hls', async (req, res) => {
  const video: any = await db('videos').where('id', req.params.id).first();
  if (!video) return res.status(404).json({ error: 'Video not found' });

  const playlist = generateMasterPlaylist(video.id, video.height);
  res.type('application/vnd.apple.mpegurl').send(playlist);
});

// HLS variant playlist (triggers transcoding if needed)
router.get('/:id/hls/:quality', async (req, res) => {
  const video: any = await db('videos').where('id', req.params.id).first();
  if (!video) return res.status(404).json({ error: 'Video not found' });

  const { quality } = req.params;

  if (!isTranscoded(video.id, quality)) {
    try {
      // startTranscoding is idempotent — if already running, it waits for the playlist
      await startTranscoding(video.id, quality, video.full_path, video.video_codec, video.audio_codec);
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  const content = getPlaylistContent(video.id, quality);
  if (!content) return res.status(500).json({ error: 'Playlist not available' });

  // Rewrite segment paths to include the quality prefix
  const rewritten = content.replace(/^(seg\d+\.ts)$/gm, `/api/videos/${video.id}/hls/${quality}/$1`);
  res.type('application/vnd.apple.mpegurl').send(rewritten);
});

// HLS segment file
router.get('/:id/hls/:quality/:segment', async (req, res) => {
  const { id, quality, segment } = req.params;
  if (!/^seg\d+\.ts$/.test(segment)) return res.status(400).json({ error: 'Invalid segment' });

  const segPath = getSegmentPath(id, quality, segment);
  if (!fs.existsSync(segPath)) return res.status(404).json({ error: 'Segment not found' });

  res.type('video/mp2t').sendFile(segPath);
});

export default router;
