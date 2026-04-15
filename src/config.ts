import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

export interface AppConfig {
  port: number;
  dbPath: string;
  scraperType: string;
  searchUrlPrefix: string;
  authUsername: string;
  authPasswordHash: string;
  sessionSecret: string;
}

export const config: AppConfig = {
  port: parseInt(process.env.PORT || '3000', 10),
  dbPath: process.env.DB_PATH || path.join(__dirname, '../data/library.db'),
  scraperType: process.env.SCRAPER_TYPE || 'noop',
  searchUrlPrefix: process.env.SEARCH_URL_PREFIX || '',
  authUsername: 'admin',
  authPasswordHash: '',
  sessionSecret: '',
};
