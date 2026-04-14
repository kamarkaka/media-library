import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { config } from '../../config';
import { setSetting } from '../../db';

const router = Router();

router.put('/password', async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Both currentPassword and newPassword are required' });
  }

  if (!bcrypt.compareSync(currentPassword, config.authPasswordHash)) {
    return res.status(400).json({ error: 'Current password is incorrect' });
  }

  const newHash = bcrypt.hashSync(newPassword, 12);

  await setSetting('auth_password_hash', newHash);
  config.authPasswordHash = newHash;

  res.json({ success: true });
});

export default router;
