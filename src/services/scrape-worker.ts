import { parentPort, workerData } from 'worker_threads';
import knexInit from 'knex';
import { config } from '../config';
import { listScrapers, getScraper, getResolver } from '../scrapers/base';
import { downloadCover } from './cover-downloader';
import { mergeAllDuplicates } from './merge-helpers';
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

const FIELD_TO_META: Record<string, string> = {
  code: 'code', name: 'name', release_date: 'releaseDate',
  director: 'director', maker: 'maker', label: 'label',
  cover_image: 'coverImage', genres: 'genres', cast: 'cast',
};

async function run(): Promise<void> {
  try {
    await db.raw('PRAGMA journal_mode = WAL');
    await db.raw('PRAGMA foreign_keys = ON');

    // Load per-field scraper config
    const fieldConfigRows = await db('scraper_field_config').select('field', 'scraper_type');
    const fieldConfig: Record<string, string> = {};
    for (const row of fieldConfigRows) {
      fieldConfig[row.field] = row.scraper_type;
    }

    const defaultScraperType = scraperType || config.scraperType;
    const allScraperNames = listScrapers();

    // Determine which scrapers are needed (group fields by scraper)
    const scraperFields: Record<string, string[]> = {};
    for (const field of Object.keys(FIELD_TO_META)) {
      const st = fieldConfig[field] || defaultScraperType;
      if (!scraperFields[st]) scraperFields[st] = [];
      scraperFields[st].push(field);
    }

    const scrapersNeeded = Object.keys(scraperFields).filter(s => allScraperNames.includes(s));
    console.log(`[scrape] Per-field config: ${JSON.stringify(scraperFields)}`);

    let videos: any[];
    if (fullScrape) {
      videos = await db('videos').select('id', 'filename', 'code', 'name', 'cover_image', 'release_date');
      console.log(`[scrape] Full scrape — ${videos.length} videos`);
    } else {
      videos = await db('videos')
        .where('videos.matched', '!=', 1)
        .select('videos.id', 'videos.filename', 'videos.code', 'videos.name', 'videos.cover_image', 'videos.release_date');
      console.log(`[scrape] Quick scrape — ${videos.length} unmatched videos`);
    }

    progress({ total: videos.length });

    // Batch-load all manual field sources to avoid N+1 queries
    const allManualRows = await db('field_sources').where('source', 'manual').select('video_id', 'field');
    const manualFieldsByVideo = new Map<string, Set<string>>();
    for (const row of allManualRows) {
      if (!manualFieldsByVideo.has(row.video_id)) manualFieldsByVideo.set(row.video_id, new Set());
      manualFieldsByVideo.get(row.video_id)!.add(row.field);
    }

    let processed = 0;
    let updated = 0;

    // Pre-create scrapers and resolvers to avoid per-video browser launches
    const scraperInstances: Record<string, any> = {};
    const resolverInstances: Record<string, any> = {};
    for (const st of scrapersNeeded) {
      scraperInstances[st] = getScraper(st);
      resolverInstances[st] = getResolver(st);
    }

    try {
    for (const video of videos) {
      const label = `[${processed + 1}/${videos.length}]`;
      progress({ currentFile: video.filename, step: 'Scraping' });

      try {
        const manualFields = manualFieldsByVideo.get(video.id) || new Set();

        // Call each needed scraper once using pre-created instances
        const scraperResults: Record<string, any> = {};
        for (const st of scrapersNeeded) {
          const resolver = resolverInstances[st];
          const scraper = scraperInstances[st];
          try {
            let sourceUrl: string | null = null;
            if (resolver) {
              sourceUrl = await resolver.resolveSourceUrl(video.filename);
            }
            if (sourceUrl) {
              scraperResults[st] = await scraper.scrape(video.filename, sourceUrl);
            }
          } catch (err: any) {
            console.error(`[scrape] ${label} ${video.filename} × ${st} — ERROR: ${err.message}`);
          }
        }

        // Build updates from per-field config, skipping manual fields
        const updates: Record<string, any> = {};
        const sources: Record<string, string> = {};

        for (const [dbField, metaKey] of Object.entries(FIELD_TO_META)) {
          if (manualFields.has(dbField)) continue;

          const st = fieldConfig[dbField] || defaultScraperType;
          const metadata = scraperResults[st];
          if (!metadata) continue;

          const val = metadata[metaKey];
          if (dbField === 'genres' || dbField === 'cast') continue;
          if (!val) continue;

          if (dbField === 'cover_image') {
            if (metadata.code) {
              const localPath = await downloadCover(val, metadata.code, config.coverCacheDir);
              updates.cover_image = localPath || val;
            } else {
              updates.cover_image = val;
            }
          } else {
            updates[dbField] = val;
          }
          sources[dbField] = st;
        }

        // Check matched using both new updates and existing DB values
        const code = updates.code || video.code;
        const name = updates.name || video.name;
        const coverImage = updates.cover_image || video.cover_image;
        const releaseDate = updates.release_date || video.release_date;
        if (code && name && coverImage && releaseDate) {
          updates.matched = 1;
        }

        if (Object.keys(updates).length > 0) {
          updates.updated_at = new Date().toISOString();
          console.log(`[scrape] ${label} ${video.filename} — updating: ${Object.keys(updates).join(', ')}`);
          await db('videos').where('id', video.id).update(updates);
        }

        // Handle ID override from the default scraper's result
        const defaultMeta = scraperResults[defaultScraperType];
        if (defaultMeta?.id && defaultMeta.id !== video.id) {
          await db('videos').where('id', video.id).update({ id: defaultMeta.id });
        }

        if (!manualFields.has('genres')) {
          const genreScraper = fieldConfig['genres'] || defaultScraperType;
          const genreMeta = scraperResults[genreScraper];
          if (genreMeta?.genres && genreMeta.genres.length > 0) {
            await syncRelation(video.id, genreMeta.genres, 'genres', 'video_genres', 'genre_id');
            sources['genres'] = genreScraper;
          }
        }

        if (!manualFields.has('cast')) {
          const castScraper = fieldConfig['cast'] || defaultScraperType;
          const castMeta = scraperResults[castScraper];
          if (castMeta?.cast && castMeta.cast.length > 0) {
            await syncRelation(video.id, castMeta.cast, 'cast_members', 'video_cast', 'cast_id');
            sources['cast'] = castScraper;
          }
        }

        for (const [field, source] of Object.entries(sources)) {
          await db('field_sources')
            .insert({ video_id: video.id, field, source })
            .onConflict(['video_id', 'field']).merge();
        }

        if (Object.keys(updates).length > 0 || Object.keys(sources).length > 0) updated++;
      } catch (err) {
        console.error(`[scrape] ${label} ${video.filename} — FAILED:`, err);
      }

      processed++;
      progress({ processed, updated });
    }

    } finally {
      // Close all pre-created scrapers and resolvers
      for (const st of scrapersNeeded) {
        if (resolverInstances[st]) await resolverInstances[st].closeResolver();
        if (scraperInstances[st]?.close) await scraperInstances[st].close();
      }
    }

    // Auto-merge: collapse entries that now share the same code (codes are assigned during scraping)
    progress({ step: 'Merging duplicate codes...', currentFile: '' });
    await mergeAllDuplicates(db);

    console.log(`[scrape] Complete — processed ${processed}, updated ${updated}`);
    progress({ status: 'done', step: '', currentFile: '', processed, updated });
  } catch (err: any) {
    console.error('[scrape] Fatal error:', err);
    progress({ status: 'error', step: '', error: err.message });
  } finally {
    await db.destroy();
  }
}

run();
