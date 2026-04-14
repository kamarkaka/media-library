import { Router } from 'express';

const router = Router();

router.get('/browser-session', (_req, res) => {
  res.render('browser-session', { title: 'Browser Session' });
});

export default router;
