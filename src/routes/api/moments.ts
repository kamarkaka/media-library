import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import db from '../../db';
import { config } from '../../config';
import { extractFrame } from '../../services/thumbnail-generator';
import { resolveFile } from '../../services/video-queries';

const router = Router();

// Path to a moment's on-disk snapshot (keyed by moment id). Exported so a video delete can clean up.
export function snapshotPath(id: string): string {
  return path.join(config.momentCacheDir, `${id}.jpeg`);
}

// Generate the moment's snapshot if it isn't already on disk.
async function ensureSnapshot(moment: any): Promise<void> {
  const out = snapshotPath(moment.id);
  if (fs.existsSync(out)) return;
  const video = await db('videos').where('id', moment.video_id).first();
  if (!video) return;
  const { fullPath } = await resolveFile(video, moment.file_id);
  if (!fullPath) return;
  fs.mkdirSync(config.momentCacheDir, { recursive: true });
  await extractFrame(fullPath, moment.timestamp, out);
}

// Add a favorite moment (and generate its snapshot)
router.post('/', async (req, res) => {
  const videoId = req.body.videoId;
  const fileId = req.body.fileId || null;
  const timestamp = Number(req.body.timestamp);
  if (!videoId || !isFinite(timestamp) || timestamp < 0) {
    return res.status(400).json({ error: 'videoId and a non-negative timestamp are required' });
  }
  const video = await db('videos').where('id', videoId).first();
  if (!video) return res.status(404).json({ error: 'Video not found' });

  const moment = {
    id: randomUUID(),
    video_id: videoId,
    file_id: fileId,
    timestamp,
    created_at: new Date().toISOString(),
  };
  await db('favorite_moments').insert(moment);
  // Best-effort: a snapshot failure must not fail the save (card falls back to the cover)
  try {
    await ensureSnapshot(moment);
  } catch (err: any) {
    console.warn(`[moments] snapshot failed for ${moment.id}:`, err.message);
  }
  res.json(moment);
});

// Remove a favorite moment (and its snapshot)
router.delete('/:id', async (req, res) => {
  await db('favorite_moments').where('id', req.params.id).del();
  fs.rmSync(snapshotPath(req.params.id), { force: true });
  res.json({ success: true });
});

// Serve a moment's snapshot, lazily (re)generating it if missing
router.get('/:id/snapshot', async (req, res) => {
  const out = snapshotPath(req.params.id);
  if (!fs.existsSync(out)) {
    const moment = await db('favorite_moments').where('id', req.params.id).first();
    if (!moment) return res.status(404).json({ error: 'Moment not found' });
    try {
      await ensureSnapshot(moment);
    } catch {
      /* fall through to 404 below */
    }
  }
  if (!fs.existsSync(out)) return res.status(404).json({ error: 'Snapshot not available' });
  res.set('Cache-Control', 'public, max-age=86400');
  res.type('image/jpeg').sendFile(out, (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: 'Snapshot not available' });
  });
});

export default router;
