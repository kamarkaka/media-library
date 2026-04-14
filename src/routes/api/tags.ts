import { Router } from 'express';
import db from '../../db';

const router = Router();

const tagTypes: Record<string, { table: string; joinTable: string; fk: string; label: string }> = {
  genres: { table: 'genres', joinTable: 'video_genres', fk: 'genre_id', label: 'Genre' },
  cast: { table: 'cast_members', joinTable: 'video_cast', fk: 'cast_id', label: 'Cast member' },
};

for (const [route, cfg] of Object.entries(tagTypes)) {
  router.get(`/${route}`, async (_req, res) => {
    const items = await db(cfg.table).orderBy('name');
    res.json(items);
  });

  router.post(`/${route}`, async (req, res) => {
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Name is required' });
    }
    const existing = await db(cfg.table).where('name', name.trim()).first();
    if (existing) {
      return res.status(409).json({ error: `${cfg.label} already exists` });
    }
    const [id] = await db(cfg.table).insert({ name: name.trim() });
    res.json({ id, name: name.trim() });
  });

  router.delete(`/${route}/:id`, async (req, res) => {
    await db(cfg.joinTable).where(cfg.fk, req.params.id).del();
    await db(cfg.table).where('id', req.params.id).del();
    res.json({ success: true });
  });
}

export default router;
