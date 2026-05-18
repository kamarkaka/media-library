import { parentPort, workerData } from 'worker_threads';
import knexInit from 'knex';
import { config } from '../config';
import { listScrapers, getScraper, getResolver } from '../scrapers/base';
import type { ScanProgress } from './scanner';

const { runId } = workerData as { runId: string };

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

    const scraperNames = listScrapers();
    const videos = await db('videos').select('id', 'filename');

    if (scraperNames.length === 0 || videos.length === 0) {
      console.log(`[coverage] Nothing to do — ${scraperNames.length} scrapers, ${videos.length} videos`);
      progress({ status: 'done', step: '', currentFile: '' });
      return;
    }

    const total = videos.length * scraperNames.length;
    progress({ total });

    // Load already-processed pairs for resumability
    const done = new Set<string>();
    const existing = await db('coverage_results')
      .where('run_id', runId)
      .select('video_id', 'scraper_type');
    for (const row of existing) {
      done.add(`${row.video_id}:${row.scraper_type}`);
    }

    const skipped = done.size;
    if (skipped > 0) {
      console.log(`[coverage] Resuming run ${runId} — skipping ${skipped} already processed`);
    }

    let processed = skipped;
    progress({ processed });

    for (const video of videos) {
      for (const scraperName of scraperNames) {
        const key = `${video.id}:${scraperName}`;
        if (done.has(key)) continue;

        const label = `[${processed + 1}/${total}]`;
        progress({ currentFile: video.filename, step: `Testing ${scraperName}` });

        let success = 0;
        const resolver = getResolver(scraperName);
        const scraper = getScraper(scraperName);
        try {
          let sourceUrl: string | null = null;
          if (resolver) {
            sourceUrl = await resolver.resolveSourceUrl(video.filename);
          }
          if (sourceUrl) {
            const metadata = await scraper.scrape(video.filename, sourceUrl);
            success = metadata ? 1 : 0;
          }
          console.log(`[coverage] ${label} ${video.filename} × ${scraperName} — ${success ? 'HIT' : 'MISS'}`);
        } catch (err: any) {
          console.error(`[coverage] ${label} ${video.filename} × ${scraperName} — ERROR: ${err.message}`);
        } finally {
          if (resolver) await resolver.closeResolver();
          if (scraper.close) await scraper.close();
        }

        await db('coverage_results').insert({
          run_id: runId,
          video_id: video.id,
          scraper_type: scraperName,
          success,
        }).onConflict(['run_id', 'video_id', 'scraper_type']).ignore();

        processed++;
        progress({ processed });
      }
    }

    console.log(`[coverage] Run ${runId} complete — ${processed} total`);
    progress({ status: 'done', step: '', currentFile: '', processed });
  } catch (err: any) {
    console.error('[coverage] Fatal error:', err);
    progress({ status: 'error', step: '', error: err.message });
  } finally {
    await db.destroy();
  }
}

run();
