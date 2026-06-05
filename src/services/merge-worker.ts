import { parentPort } from 'worker_threads';
import knexInit from 'knex';
import { config } from '../config';
import { mergeAllDuplicates } from './merge-helpers';
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
    await db.raw('PRAGMA foreign_keys = ON');

    progress({ step: 'Finding duplicate codes...' });

    const { mergedGroups, removedRows } = await mergeAllDuplicates(db, progress);

    console.log(`[merge] Complete — merged ${mergedGroups} group(s), removed ${removedRows} entries`);
    progress({ status: 'done', step: '', currentFile: '', added: mergedGroups, removed: removedRows });
  } catch (err: any) {
    console.error('[merge] Fatal error:', err);
    progress({ status: 'error', step: '', error: err.message });
  } finally {
    await db.destroy();
  }
}

run();
