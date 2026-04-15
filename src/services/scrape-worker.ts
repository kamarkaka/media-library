import { parentPort, workerData } from 'worker_threads';
import knexInit from 'knex';
import { config } from '../config';
import { getScraper } from '../scrapers/base';
import { resolveSourceUrl, closeResolver } from '../scrapers/dvd/resolver';
import type { ScanProgress } from './scanner';

const { fullScrape, scraperType } = workerData as { fullScrape: boolean; scraperType?: string };

const db = knexInit({
  client: 'better-sqlite3',
  connection: { filename: config.dbPath },
  useNullAsDefault: true,
});

function progress(update: Partial<ScanProgress>): void {
  parentPort?.postMessage(update);
}

async function syncRelation(
  videoId: string,
  items: string[],
  lookupTable: string,
  joinTable: string,
  foreignKey: string,
): Promise<void> {
  await db(joinTable).where('video_id', videoId).del();
  for (const name of items) {
    let row: any = await db(lookupTable).where('name', name).first();
    if (!row) {
      const [id] = await db(lookupTable).insert({ name });
      row = { id };
    }
    await db(joinTable).insert({ video_id: videoId, [foreignKey]: row.id }).onConflict(['video_id', foreignKey]).ignore();
  }
}

async function run(): Promise<void> {
  try {
    await db.raw('PRAGMA journal_mode = WAL');
    await db.raw('PRAGMA foreign_keys = ON');

    const scraper = getScraper(scraperType);
    console.log(`[scrape] Using scraper: ${scraperType || 'default'}`);

    // Get videos to scrape
    let videos: any[];
    if (fullScrape) {
      videos = await db('videos').select('id', 'filename', 'source_url');
      console.log(`[scrape] Full scrape — ${videos.length} videos`);
    } else {
      videos = await db('videos')
        .whereNull('name').orWhereNull('code').orWhere('name', '').orWhere('code', '')
        .select('id', 'filename', 'source_url');
      console.log(`[scrape] Quick scrape — ${videos.length} videos with missing info`);
    }

    progress({ total: videos.length });

    let processed = 0;
    let updated = 0;

    for (const video of videos) {
      const label = `[${processed + 1}/${videos.length}]`;
      progress({ currentFile: video.filename, step: 'Scraping' });

      try {
        let sourceUrl = video.source_url;

        // Resolve source URL if not set
        if (!sourceUrl) {
          progress({ step: 'Resolving source URL' });
          console.log(`[scrape] ${label} ${video.filename} — resolving source URL`);
          const resolved = await resolveSourceUrl(video.filename);
          if (resolved) {
            sourceUrl = resolved;
            await db('videos').where('id', video.id).update({ source_url: resolved });
            console.log(`[scrape] ${label} ${video.filename} — resolved: ${resolved}`);
          }
        }

        console.log(`[scrape] ${label} ${video.filename} — source_url=${sourceUrl || 'none'}`);

        const metadata = await scraper.scrape(video.filename, sourceUrl);
        if (metadata) {
          const updates: Record<string, any> = {};
          if (metadata.code) updates.code = metadata.code;
          if (metadata.name) updates.name = metadata.name;
          if (metadata.releaseDate) updates.release_date = metadata.releaseDate;
          if (metadata.length) updates.length = metadata.length;
          if (metadata.director) updates.director = metadata.director;
          if (metadata.maker) updates.maker = metadata.maker;
          if (metadata.label) updates.label = metadata.label;
          if (metadata.coverImage) updates.cover_image = metadata.coverImage;
          if (Object.keys(updates).length > 0) {
            updates.updated_at = new Date().toISOString();
            console.log(`[scrape] ${label} ${video.filename} — updating: ${Object.keys(updates).join(', ')}`);
            await db('videos').where('id', video.id).update(updates);
          }

          if (metadata.id && metadata.id !== video.id) {
            await db('videos').where('id', video.id).update({ id: metadata.id });
          }

          if (metadata.genres) {
            await syncRelation(video.id, metadata.genres, 'genres', 'video_genres', 'genre_id');
          }
          if (metadata.cast) {
            await syncRelation(video.id, metadata.cast, 'cast_members', 'video_cast', 'cast_id');
          }

          updated++;
        } else {
          console.log(`[scrape] ${label} ${video.filename} — no metadata returned`);
        }
      } catch (err) {
        console.error(`[scrape] ${label} ${video.filename} — FAILED:`, err);
      }

      processed++;
      progress({ processed, updated });
    }

    console.log(`[scrape] Complete — processed ${processed}, updated ${updated}`);
    progress({ status: 'done', step: '', currentFile: '', processed, updated });
  } catch (err: any) {
    console.error('[scrape] Fatal error:', err);
    progress({ status: 'error', step: '', error: err.message });
  } finally {
    await closeResolver();
    await db.destroy();
  }
}

run();
