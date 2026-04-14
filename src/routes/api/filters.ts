import { Router } from 'express';
import { getFilterOptions } from '../../services/video-queries';

const router = Router();

router.get('/genres', async (_req, res) => {
  const { genres } = await getFilterOptions();
  res.json(genres.map((r: any) => r.name));
});

router.get('/directors', async (_req, res) => {
  const { directors } = await getFilterOptions();
  res.json(directors.map((r: any) => r.name));
});

router.get('/makers', async (_req, res) => {
  const { makers } = await getFilterOptions();
  res.json(makers.map((r: any) => r.name));
});

router.get('/labels', async (_req, res) => {
  const { labels } = await getFilterOptions();
  res.json(labels.map((r: any) => r.name));
});

router.get('/cast', async (_req, res) => {
  const { castMembers } = await getFilterOptions();
  res.json(castMembers.map((r: any) => r.name));
});

export default router;
