import { parentPort } from 'worker_threads';
import knexInit from 'knex';
import { config } from '../config';
import { generateThumbnailsForEntry } from './thumbnail-generator';
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

    // One run per coded entry — each of its files contributes `count` thumbnails (numbered per code)
    const videos = await db('videos')
      .whereNotNull('code').where('code', '!=', '')
      .select('id', 'code');
    console.log(`[thumbnail] Generating ${count} thumbnails per file for ${videos.length} coded entries`);
    progress({ total: videos.length });

    let processed = 0;
    let updated = 0;

    for (const video of videos) {
      progress({ currentFile: video.code, step: 'Generating' });
      try {
        const files = await db('video_files').where('video_id', video.id).orderBy('filename', 'asc').select('full_path', 'length');
        const n = await generateThumbnailsForEntry(video.code, files, count);
        if (n > 0) updated++;
      } catch (err: any) {
        console.error(`[thumbnail] failed for ${video.code}:`, err.message);
      }
      processed++;
      progress({ processed, updated });
    }

    console.log(`[thumbnail] Complete — ${updated} of ${processed} entries`);
    progress({ status: 'done', step: '', currentFile: '', processed, updated });
  } catch (err: any) {
    console.error('[thumbnail] Fatal error:', err);
    progress({ status: 'error', step: '', error: err.message });
  } finally {
    await db.destroy();
  }
}

run();
