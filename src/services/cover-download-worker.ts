import { parentPort } from 'worker_threads';
import knexInit from 'knex';
import { config } from '../config';
import { downloadCover } from './cover-downloader';
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

    const videos = await db('videos')
      .where('cover_image', 'like', 'http%')
      .whereNotNull('code')
      .where('code', '!=', '')
      .select('id', 'code', 'cover_image');

    console.log(`[cover-download] ${videos.length} videos with remote cover images`);
    progress({ total: videos.length });

    let processed = 0;
    let updated = 0;

    for (const video of videos) {
      progress({ currentFile: video.code, step: 'Downloading' });

      const localPath = await downloadCover(video.cover_image, video.code, config.coverCacheDir);
      if (localPath) {
        await db('videos').where('id', video.id).update({
          cover_image: localPath,
          updated_at: new Date().toISOString(),
        });
        updated++;
      }

      processed++;
      progress({ processed, updated });
    }

    console.log(`[cover-download] Complete — ${updated} downloaded, ${processed - updated} skipped/failed`);
    progress({ status: 'done', step: '', currentFile: '', processed, updated });
  } catch (err: any) {
    console.error('[cover-download] Fatal error:', err);
    progress({ status: 'error', step: '', error: err.message });
  } finally {
    await db.destroy();
  }
}

run();
