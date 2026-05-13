import { parentPort, workerData } from 'worker_threads';
import knexInit from 'knex';
import { config } from '../config';
import { getScraper, getResolver } from '../scrapers/base';
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
  const scraper = getScraper(scraperType);
  const resolver = getResolver(scraperType);
  console.log(`[scrape] Using scraper: ${scraperType || 'default'}, resolver: ${resolver ? 'loaded' : 'none'}`);

  try {
    await db.raw('PRAGMA journal_mode = WAL');
    await db.raw('PRAGMA foreign_keys = ON');

    let videos: any[];
    if (fullScrape) {
      // Full scrape: re-scrape all videos
      videos = await db('videos').select('id', 'filename');
      console.log(`[scrape] Full scrape — ${videos.length} videos`);
    } else {
      // Quick scrape: unmatched videos only
      videos = await db('videos')
        .where('videos.matched', '!=', 1)
        .select('videos.id', 'videos.filename');
      console.log(`[scrape] Quick scrape — ${videos.length} unmatched videos`);
    }

    progress({ total: videos.length });

    let processed = 0;
    let updated = 0;

    for (const video of videos) {
      const label = `[${processed + 1}/${videos.length}]`;
      progress({ currentFile: video.filename, step: 'Scraping' });

      try {
        // Always resolve source URL via resolver
        let sourceUrl: string | null = null;
        if (resolver) {
          progress({ step: 'Resolving source URL' });
          console.log(`[scrape] ${label} ${video.filename} — resolving source URL`);
          sourceUrl = await resolver.resolveSourceUrl(video.filename);
          if (sourceUrl) {
            console.log(`[scrape] ${label} ${video.filename} — resolved: ${sourceUrl}`);
          } else {
            console.log(`[scrape] ${label} ${video.filename} — could not resolve source URL`);
          }
        }

        console.log(`[scrape] ${label} ${video.filename} — source_url=${sourceUrl || 'none'}`);

        const metadata = await scraper.scrape(video.filename, sourceUrl || undefined);
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
          if (metadata.code && metadata.name && metadata.coverImage && metadata.releaseDate) {
            updates.matched = 1;
          }
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
    if (resolver) await resolver.closeResolver();
    await db.destroy();
  }
}

run();
