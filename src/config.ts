import dotenv from 'dotenv';
import path from 'path';
import crypto from 'crypto';

dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  dbPath: process.env.DB_PATH || path.join(__dirname, '../data/library.db'),
  authUsername: process.env.AUTH_USERNAME || 'admin',
  authPasswordHash: process.env.AUTH_PASSWORD_HASH || '',
  sessionSecret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  scraperType: process.env.SCRAPER_TYPE || 'noop',
};
