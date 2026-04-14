import { Router } from 'express';
import {
  startSession, takeScreenshot, sendClick, sendType, sendKeypress,
  saveSession, closeSession, getActiveSession, SESSION_VIEWPORT,
} from '../../services/browser-session';

const router = Router();

router.post('/session/start', async (req, res) => {
  const { url, scraperType } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });
  try {
    const result = await startSession(url, scraperType || 'default');
    res.json({ ...result, viewport: SESSION_VIEWPORT });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/session', (_req, res) => {
  const session = getActiveSession();
  if (!session) return res.json({ active: false });
  res.json({ active: true, ...session });
});

router.get('/session/screenshot', async (_req, res) => {
  try {
    const screenshot = await takeScreenshot();
    res.json({ screenshot });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/session/click', async (req, res) => {
  const { x, y } = req.body;
  try {
    const screenshot = await sendClick(x, y);
    res.json({ screenshot });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/session/type', async (req, res) => {
  const { text } = req.body;
  try {
    const screenshot = await sendType(text || '');
    res.json({ screenshot });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/session/keypress', async (req, res) => {
  const { key } = req.body;
  try {
    const screenshot = await sendKeypress(key);
    res.json({ screenshot });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/session/save', async (_req, res) => {
  try {
    await saveSession();
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/session/close', async (_req, res) => {
  await closeSession();
  res.json({ success: true });
});

export default router;
