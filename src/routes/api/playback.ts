import { Router } from 'express';
import db from '../../db';

const router = Router();

// Get most recently viewed video
router.get('/recent', async (req, res) => {
  const recent = await db('playback_state')
    .join('videos', 'playback_state.video_id', 'videos.id')
    .orderBy('playback_state.last_viewed', 'desc')
    .select('videos.*', 'playback_state.position', 'playback_state.last_viewed')
    .first();

  res.json(recent || null);
});

// Save playback position
router.put('/:id', async (req, res) => {
  const { position } = req.body;
  const videoId = req.params.id;

  if (typeof position !== 'number') {
    return res.status(400).json({ error: 'position must be a number' });
  }

  const now = new Date().toISOString();
  await db('playback_state')
    .insert({ video_id: videoId, position, last_viewed: now })
    .onConflict('video_id')
    .merge({ position, last_viewed: now });

  res.json({ success: true });
});

// Log a playback event
const VALID_EVENTS = new Set(['start', 'pause', 'resume', 'next', 'prev', 'snapshot']);

router.post('/:id/log', (req, res) => {
  const { event, position } = req.body;
  const videoId = req.params.id;

  if (!event || !VALID_EVENTS.has(event)) {
    return res.status(400).json({ error: 'Invalid event type' });
  }

  const pos = typeof position === 'number' ? position.toFixed(1) : '0.0';
  console.log(`[playback] ${event} video=${videoId} position=${pos}s`);

  res.json({ success: true });
});

export default router;
