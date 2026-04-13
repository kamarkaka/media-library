import { Router } from 'express';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';
import { config } from '../../config';

const router = Router();

router.put('/password', (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Both currentPassword and newPassword are required' });
  }

  if (!bcrypt.compareSync(currentPassword, config.authPasswordHash)) {
    return res.status(400).json({ error: 'Current password is incorrect' });
  }

  const newHash = bcrypt.hashSync(newPassword, 12);

  // Update in-memory config
  (config as any).authPasswordHash = newHash;

  // Update .env file
  const envPath = path.join(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    let content = fs.readFileSync(envPath, 'utf-8');
    const regex = /^AUTH_PASSWORD_HASH=.*$/m;
    if (regex.test(content)) {
      content = content.replace(regex, `AUTH_PASSWORD_HASH=${newHash}`);
    } else {
      content += `\nAUTH_PASSWORD_HASH=${newHash}\n`;
    }
    fs.writeFileSync(envPath, content);
  }

  res.json({ success: true });
});

export default router;
