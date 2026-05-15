import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

export interface AppConfig {
  port: number;
  dbPath: string;
  scraperType: string;
  authUsername: string;
  authPasswordHash: string;
  sessionSecret: string;
  validatorCron: string;
  hlsCacheDir: string;
  ffmpegPath: string;
}

export const config: AppConfig = {
  port: parseInt(process.env.PORT || '3000', 10),
  dbPath: process.env.DB_PATH || path.join(__dirname, '../data/library.db'),
  scraperType: process.env.SCRAPER_TYPE || 'javtrailers',
  authUsername: 'admin',
  authPasswordHash: '',
  sessionSecret: '',
  validatorCron: process.env.VALIDATOR_CRON || '0 8 * * *',
  hlsCacheDir: process.env.HLS_CACHE_DIR || path.join(__dirname, '../data/hls-cache'),
  ffmpegPath: process.env.FFMPEG_PATH || 'ffmpeg',
};
