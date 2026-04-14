import { Router } from 'express';
import { startScan, getScanProgress, resetScanProgress } from '../../services/scanner';

const router = Router();

router.post('/scan', (req, res) => {
  const progress = getScanProgress();
  if (progress.status === 'scanning') {
    return res.json({ success: false, message: 'Scan already in progress' });
  }

  const fullRescan = req.body?.fullRescan === true;
  startScan(fullRescan);

  res.json({ success: true, message: fullRescan ? 'Full rescan started' : 'Scan started' });
});

router.get('/scan/status', (_req, res) => {
  const progress = getScanProgress();
  res.json(progress);

  // Once a terminal state has been read by the client, reset to idle
  // so stale results don't show on next page load
  if (progress.status === 'done' || progress.status === 'error') {
    resetScanProgress();
  }
});

export default router;
