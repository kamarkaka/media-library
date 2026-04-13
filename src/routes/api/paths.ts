import { Router } from 'express';
import fs from 'fs';
import db from '../../db';

const router = Router();

router.get('/', async (req, res) => {
  const paths = await db('library_paths').orderBy('created_at', 'desc');
  res.json(paths);
});

router.post('/', async (req, res) => {
  const { path: dirPath } = req.body;

  if (!dirPath || typeof dirPath !== 'string') {
    return res.status(400).json({ error: 'Path is required' });
  }

  if (!fs.existsSync(dirPath)) {
    return res.status(400).json({ error: 'Path does not exist on the filesystem' });
  }

  if (!fs.statSync(dirPath).isDirectory()) {
    return res.status(400).json({ error: 'Path is not a directory' });
  }

  try {
    const [id] = await db('library_paths').insert({ path: dirPath });
    const newPath = await db('library_paths').where('id', id).first();
    res.status(201).json(newPath);
  } catch (err: any) {
    if (err.message?.includes('UNIQUE constraint')) {
      return res.status(409).json({ error: 'Path already exists' });
    }
    throw err;
  }
});

router.delete('/:id', async (req, res) => {
  const deleted = await db('library_paths').where('id', req.params.id).del();
  if (!deleted) {
    return res.status(404).json({ error: 'Path not found' });
  }
  res.status(204).end();
});

export default router;
