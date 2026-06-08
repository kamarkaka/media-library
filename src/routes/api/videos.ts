import { Router } from 'express';
import fs from 'fs';
import mime from 'mime-types';
import db, { getIntSetting } from '../../db';
import { queryVideos, getPlaybackMap, getVideoNeighbors, parseVideoFilters } from '../../services/video-queries';
import {
  generateMasterPlaylist, isTranscoded, isTranscoding,
  getPlaylistContent, getSegmentPath, startTranscoding,
} from '../../services/hls-transcoder';
import path from 'path';
import { listScrapers, getScraper, getResolver } from '../../scrapers/base';
import { config } from '../../config';
import { downloadCover } from '../../services/cover-downloader';
import { listThumbnailsForFile, generateThumbnailsForFile, getThumbnailDir } from '../../services/thumbnail-generator';

const router = Router();

// Resolve which physical file to serve. ?file=<id> selects a specific file; absent => the
// entry's default file. The served path always comes from the DB row, never the client string.
async function resolveFile(video: any, fileSel: any): Promise<{
  fileKey: string; fullPath: string; videoCodec: string | null; audioCodec: string | null; height: number | null;
}> {
  if (fileSel) {
    const f = await db('video_files').where({ id: String(fileSel), video_id: video.id }).first();
    if (f) return { fileKey: f.id, fullPath: f.full_path, videoCodec: f.video_codec, audioCodec: f.audio_codec, height: f.height };
  }
  const def = video.default_file_id
    ? await db('video_files').where('id', video.default_file_id).first()
    : await db('video_files').where({ video_id: video.id, is_default: 1 }).first();
  if (def) return { fileKey: def.id, fullPath: def.full_path, videoCodec: def.video_codec, audioCodec: def.audio_codec, height: def.height };
  // Legacy fallback (no video_files rows yet): use the videos-row mirror
  return { fileKey: 'default', fullPath: video.full_path, videoCodec: video.video_codec, audioCodec: video.audio_codec, height: video.height };
}

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

  const file = await resolveFile(video, req.query.file);

  let stat;
  try {
    stat = fs.statSync(file.fullPath);
  } catch {
    return res.status(404).json({ error: 'Video file not found on disk' });
  }

  const fileSize = stat.size;
  const mimeType = mime.lookup(file.fullPath) || 'video/mp4';

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
    fs.createReadStream(file.fullPath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': mimeType,
      'Accept-Ranges': 'bytes',
    });
    fs.createReadStream(file.fullPath).pipe(res);
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

// Thumbnails are generated per physical file; list them grouped by file for the entry.
async function listEntryThumbnails(video: any): Promise<any[]> {
  const fileRows = await db('video_files').where('video_id', video.id).orderBy('filename', 'asc');
  return fileRows.map((f: any) => ({
    id: f.id,
    filename: f.filename,
    thumbnails: listThumbnailsForFile(video.id, f),
  }));
}

// Generate N thumbnails for EVERY file of this entry (N = thumbnail_count setting, default 10)
router.post('/:id/thumbnails', async (req, res) => {
  const video: any = await db('videos').where('id', req.params.id).first();
  if (!video) return res.status(404).json({ error: 'Video not found' });

  const count = await getIntSetting(db, 'thumbnail_count', 10);

  const fileRows = await db('video_files').where('video_id', video.id).orderBy('filename', 'asc');
  if (fileRows.length === 0) return res.status(400).json({ error: 'No files for this video' });

  const errors: string[] = [];
  for (const f of fileRows) {
    try {
      await generateThumbnailsForFile(f, count);
    } catch (err: any) {
      errors.push(`${f.filename}: ${err.message}`);
    }
  }

  res.json({ files: await listEntryThumbnails(video), errors });
});

// List existing thumbnails for the entry (grouped by file)
router.get('/:id/thumbnails', async (req, res) => {
  const video: any = await db('videos').where('id', req.params.id).first();
  if (!video) return res.status(404).json({ error: 'Video not found' });
  res.json({ files: await listEntryThumbnails(video) });
});

// Serve one thumbnail image. fileId/filename are sanitized so they can't escape the cache dir.
router.get('/:id/thumbnails/:fileId/:filename', (req, res) => {
  const { fileId, filename } = req.params;
  if (!/^[a-z0-9-]+$/i.test(fileId) || !/^\d{3}\.jpeg$/.test(filename)) {
    return res.status(400).json({ error: 'Invalid thumbnail' });
  }
  const filePath = path.join(getThumbnailDir(fileId), filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Thumbnail not found' });
  res.type('image/jpeg').sendFile(filePath);
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
      await db('genres').whereNotExists(function () {
        this.select(db.raw(1)).from('video_genres').whereRaw('video_genres.genre_id = genres.id');
      }).del();
    }
    if ('cast' in req.body) {
      await syncRelation(req.params.id, req.body.cast || '', 'cast_members', 'video_cast', 'cast_id');
      await db('cast_members').whereNotExists(function () {
        this.select(db.raw(1)).from('video_cast').whereRaw('video_cast.cast_id = cast_members.id');
      }).del();
    }

    // Rename cached cover image if video code changed
    if (updates.code && updates.code !== video.code) {
      const currentCover = updates.cover_image || video.cover_image;
      if (currentCover && !currentCover.startsWith('http') && fs.existsSync(currentCover)) {
        const ext = path.extname(currentCover);
        const newFilename = updates.code.replace(/[/\\:*?"<>|]/g, '_') + ext;
        const newPath = path.join(config.coverCacheDir, newFilename);
        try {
          fs.renameSync(currentCover, newPath);
          updates.cover_image = newPath;
        } catch (err: any) {
          console.warn(`[api] Failed to rename cover image: ${err.message}`);
        }
      }
    }

    // Download cover image if URL changed to a remote URL
    if (updates.cover_image && updates.cover_image.startsWith('http')) {
      const code = updates.code || video.code;
      if (code) {
        // Delete old cached file if it exists
        if (video.cover_image && !video.cover_image.startsWith('http') && fs.existsSync(video.cover_image)) {
          fs.unlinkSync(video.cover_image);
        }
        const localPath = await downloadCover(updates.cover_image, code, config.coverCacheDir);
        if (localPath) updates.cover_image = localPath;
      }
    }

    if (Object.keys(updates).length > 0) {
      updates.updated_at = new Date().toISOString();
      await db('videos').where('id', req.params.id).update(updates);
    }

    // Track field sources: use fieldSources from body (scrape comparison) or default to 'manual'
    const fieldSources: Record<string, string> = req.body.fieldSources || {};
    const trackedFields = ['code', 'name', 'release_date', 'director', 'maker', 'label', 'cover_image', 'genres', 'cast'];
    for (const field of trackedFields) {
      if (field in req.body) {
        const source = fieldSources[field] || 'manual';
        await db('field_sources')
          .insert({ video_id: req.params.id, field, source })
          .onConflict(['video_id', 'field']).merge();
      }
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
    // Remove orphaned tag if no videos reference it
    await db(cfg.table).where('id', req.params.tagId).whereNotExists(function () {
      this.select(db.raw(1)).from(cfg.joinTable).whereRaw(`${cfg.joinTable}.${cfg.fk} = ${cfg.table}.id`);
    }).del();
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

  const file = await resolveFile(video, req.query.file);
  const playlist = generateMasterPlaylist(video.id, file.height, file.fileKey);
  res.type('application/vnd.apple.mpegurl').send(playlist);
});

// HLS variant playlist (triggers transcoding if needed)
router.get('/:id/hls/:quality', async (req, res) => {
  const video: any = await db('videos').where('id', req.params.id).first();
  if (!video) return res.status(404).json({ error: 'Video not found' });

  const { quality } = req.params;
  const file = await resolveFile(video, req.query.file);

  if (!isTranscoded(video.id, file.fileKey, quality)) {
    try {
      // startTranscoding is idempotent — if already running, it waits for the playlist
      await startTranscoding(video.id, file.fileKey, quality, file.fullPath, file.videoCodec, file.audioCodec);
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  const content = getPlaylistContent(video.id, file.fileKey, quality);
  if (!content) return res.status(500).json({ error: 'Playlist not available' });

  // Rewrite segment paths to absolute URLs, carrying the file selector forward
  const sel = file.fileKey && file.fileKey !== 'default' ? `?file=${file.fileKey}` : '';
  const rewritten = content.replace(/^(seg\d+\.ts)$/gm, `/api/videos/${video.id}/hls/${quality}/$1${sel}`);
  res.type('application/vnd.apple.mpegurl').send(rewritten);
});

// HLS segment file
router.get('/:id/hls/:quality/:segment', async (req, res) => {
  const { id, quality, segment } = req.params;
  if (!/^seg\d+\.ts$/.test(segment)) return res.status(400).json({ error: 'Invalid segment' });

  // fileKey comes straight from the variant playlist's ?file selector (a video_files id or 'default').
  // Sanitized to a safe charset so it can't escape the cache dir; a bad value just misses the cache.
  // No DB lookup here — this is the per-segment hot path.
  const fileSel = req.query.file ? String(req.query.file) : 'default';
  const fileKey = /^[a-z0-9-]+$/i.test(fileSel) ? fileSel : 'default';

  const segPath = getSegmentPath(id, fileKey, quality, segment);
  if (!fs.existsSync(segPath)) return res.status(404).json({ error: 'Segment not found' });

  res.type('video/mp2t').sendFile(segPath);
});

// Scrape a single video across all available scrapers
router.post('/:id/scrape-all', async (req, res) => {
  const video: any = await db('videos').where('id', req.params.id).first();
  if (!video) return res.status(404).json({ error: 'Video not found' });

  const allScrapers = listScrapers();
  const requested = req.body?.scrapers;
  const scraperNames = Array.isArray(requested) && requested.length > 0
    ? requested.filter((s: string) => allScrapers.includes(s))
    : allScrapers;
  const results: Record<string, any> = {};

  for (const name of scraperNames) {
    const resolver = getResolver(name);
    const scraper = getScraper(name);
    try {
      let sourceUrl: string | null = null;
      if (resolver) {
        sourceUrl = await resolver.resolveSourceUrl(video.filename);
      }
      results[name] = await scraper.scrape(video.filename, sourceUrl || undefined);
    } catch (err: any) {
      console.error(`[scrape-all] ${name} failed:`, err.message);
      results[name] = null;
    } finally {
      if (resolver) await resolver.closeResolver();
      if (scraper.close) await scraper.close();
    }
  }

  res.json({ results });
});

export default router;
