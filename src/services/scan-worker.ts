import { parentPort, workerData } from 'worker_threads';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import knexInit from 'knex';
import { config } from '../config';
import { getScraper } from '../scrapers';
import type { ScanProgress } from './scanner';

const { fullRescan } = workerData as { fullRescan: boolean };

const db = knexInit({
  client: 'better-sqlite3',
  connection: { filename: config.dbPath },
  useNullAsDefault: true,
});

const VIDEO_EXTENSIONS = new Set([
  '.mp4', '.mkv', '.avi', '.webm', '.mov', '.wmv', '.flv', '.m4v', '.ts', '.mts',
]);

function progress(update: Partial<ScanProgress>): void {
  parentPort?.postMessage(update);
}

function walkDirectory(dir: string): string[] {
  const results: string[] = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...walkDirectory(fullPath));
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (VIDEO_EXTENSIONS.has(ext)) {
          results.push(fullPath);
        }
      }
    }
  } catch (err) {
    console.error(`Error scanning directory ${dir}:`, err);
  }
  return results;
}

function sleep(ms: number): void {
  const end = Date.now() + ms;
  while (Date.now() < end) {} // busy-wait for sync context
}

function getVideoDuration(filePath: string): number | null {
  try {
    sleep(10000); // DEBUG: 10s delay before ffprobe
    const output = execFileSync('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'csv=p=0',
      filePath,
    ], { timeout: 30000, encoding: 'utf-8' });
    const seconds = parseFloat(output.trim());
    return isNaN(seconds) ? null : Math.round(seconds);
  } catch {
    return null;
  }
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

    const scraper = getScraper();

    progress({ step: 'Discovering files...' });
    console.log(`[scan] Starting library scan (fullRescan=${fullRescan})`);

    const libraryPaths = await db('library_paths').select('path');
    const allFiles: string[] = [];
    for (const { path: dirPath } of libraryPaths) {
      if (fs.existsSync(dirPath)) {
        console.log(`[scan] Scanning path: ${dirPath}`);
        allFiles.push(...walkDirectory(dirPath));
      }
    }

    const existingVideos = await db('videos').select('id', 'full_path', 'length');
    const existingByPath = new Map(existingVideos.map((v: any) => [v.full_path, { id: v.id, length: v.length }]));
    const allFilesSet = new Set(allFiles);
    const staleIds = existingVideos.filter((v: any) => !allFilesSet.has(v.full_path)).map((v: any) => v.id);

    const newFiles = allFiles.filter((f) => !existingByPath.has(f));
    const filesToProcess = fullRescan ? allFiles : newFiles;
    console.log(`[scan] Found ${allFiles.length} files on disk (${newFiles.length} new, ${allFiles.length - newFiles.length} existing, ${staleIds.length} stale)`);
    if (!fullRescan && filesToProcess.length < allFiles.length) {
      console.log(`[scan] Quick scan — processing ${filesToProcess.length} new files only`);
    }

    let processed = 0;
    let added = 0;
    let updated = 0;

    progress({ total: filesToProcess.length });

    for (const filePath of filesToProcess) {
      const filename = path.basename(filePath);
      const existing = existingByPath.get(filePath);
      const isNew = !existing;
      const label = `[${processed + 1}/${filesToProcess.length}]`;
      progress({ currentFile: filename });

      try {
        let videoId: string;
        if (isNew) {
          progress({ step: 'Adding to database' });
          console.log(`[scan] ${label} ${filename} — adding to database`);
          videoId = uuidv4();
          const duration = getVideoDuration(filePath);
          await db('videos').insert({
            id: videoId,
            filename,
            full_path: filePath,
            length: duration,
          });
          if (duration) {
            console.log(`[scan] ${label} ${filename} — duration: ${duration}s`);
          } else {
            console.log(`[scan] ${label} ${filename} — duration: unknown`);
          }
        } else {
          videoId = existing.id;
          progress({ step: 'Updating database' });
          console.log(`[scan] ${label} ${filename} — already in database, updating`);

          if (fullRescan || existing.length == null) {
            progress({ step: 'Processing duration' });
            console.log(`[scan] ${label} ${filename} — processing duration`);
            const duration = getVideoDuration(filePath);
            if (duration) {
              await db('videos').where('id', videoId).update({ length: duration });
              console.log(`[scan] ${label} ${filename} — duration: ${duration}s`);
            } else {
              console.log(`[scan] ${label} ${filename} — duration: unknown`);
            }
          }
        }

        if (isNew || fullRescan) {
          progress({ step: 'Scraping metadata' });
          console.log(`[scan] ${label} ${filename} — scraping metadata`);
        }
        const metadata = (isNew || fullRescan) ? await scraper.scrape(filename) : null;
        if (metadata) {
          const updates: Record<string, any> = {};
          if (metadata.releaseDate) updates.release_date = metadata.releaseDate;
          if (metadata.length) updates.length = metadata.length;
          if (metadata.director) updates.director = metadata.director;
          if (metadata.maker) updates.maker = metadata.maker;
          if (metadata.label) updates.label = metadata.label;
          if (metadata.coverImage) updates.cover_image = metadata.coverImage;
          if (Object.keys(updates).length > 0) {
            updates.updated_at = new Date().toISOString();
            await db('videos').where('id', videoId).update(updates);
          }

          if (metadata.id && metadata.id !== videoId) {
            await db('videos').where('id', videoId).update({ id: metadata.id });
            videoId = metadata.id;
          }

          if (metadata.genres) {
            await syncRelation(videoId, metadata.genres, 'genres', 'video_genres', 'genre_id');
          }
          if (metadata.cast) {
            await syncRelation(videoId, metadata.cast, 'cast_members', 'video_cast', 'cast_id');
          }
        }

        if (isNew) {
          added++;
        } else {
          updated++;
        }
        console.log(`[scan] ${label} ${filename} — done (${isNew ? 'added' : 'updated'})`);
      } catch (err) {
        console.error(`[scan] ${label} ${filename} — FAILED:`, err);
        if (isNew) {
          await db('videos').where('full_path', filePath).del().catch(() => {});
        }
      }

      processed++;
      progress({ processed, added, updated });
    }

    let removed = 0;
    if (staleIds.length > 0) {
      progress({ step: 'Removing stale entries' });
      console.log(`[scan] Removing ${staleIds.length} stale entries`);
      await db('videos').whereIn('id', staleIds).del();
      removed = staleIds.length;
    }

    console.log(`[scan] Complete — added ${added}, updated ${updated}, removed ${removed}`);
    progress({ status: 'done', step: '', currentFile: '', added, updated, removed });
  } catch (err: any) {
    console.error('[scan] Fatal error:', err);
    progress({ status: 'error', step: '', error: err.message });
  } finally {
    await db.destroy();
  }
}

run();
