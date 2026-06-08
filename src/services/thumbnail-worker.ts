import { parentPort } from 'worker_threads';
import path from 'path';
import knexInit from 'knex';
import { config } from '../config';
import { generateThumbnailsForFile } from './thumbnail-generator';
import type { ScanProgress } from './scanner';

const db = knexInit({
  client: 'better-sqlite3',
  connection: { filename: config.dbPath },
  useNullAsDefault: true,
});

function progress(update: Partial<ScanProgress>): void {
  parentPort?.postMessage(update);
}

async function run(): Promise<void> {
  try {
    await db.raw('PRAGMA journal_mode = WAL');

    const countRow = await db('settings').where('key', 'thumbnail_count').first();
    const count = countRow ? parseInt(countRow.value, 10) || 10 : 10;

    // One run per physical file — every file in the library gets `count` thumbnails
    const files = await db('video_files').select('id', 'full_path', 'length');
    console.log(`[thumbnail] Generating ${count} thumbnails for ${files.length} files`);
    progress({ total: files.length });

    let processed = 0;
    let updated = 0;

    for (const file of files) {
      progress({ currentFile: path.basename(file.full_path), step: 'Generating' });
      try {
        await generateThumbnailsForFile(file, count);
        updated++;
      } catch (err: any) {
        console.error(`[thumbnail] failed for ${file.full_path}:`, err.message);
      }
      processed++;
      progress({ processed, updated });
    }

    console.log(`[thumbnail] Complete — ${updated} of ${processed} files`);
    progress({ status: 'done', step: '', currentFile: '', processed, updated });
  } catch (err: any) {
    console.error('[thumbnail] Fatal error:', err);
    progress({ status: 'error', step: '', error: err.message });
  } finally {
    await db.destroy();
  }
}

run();
