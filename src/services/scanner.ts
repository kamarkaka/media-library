import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import db from '../db';
import { Scraper } from '../scrapers/types';

const VIDEO_EXTENSIONS = new Set([
  '.mp4', '.mkv', '.avi', '.webm', '.mov', '.wmv', '.flv', '.m4v', '.ts', '.mts',
]);

export interface ScanProgress {
  status: 'idle' | 'scanning' | 'done' | 'error';
  total: number;
  processed: number;
  currentFile: string;
  step: string;
  added: number;
  updated: number;
  removed: number;
  error?: string;
}

const scanProgress: ScanProgress = {
  status: 'idle',
  total: 0,
  processed: 0,
  currentFile: '',
  step: '',
  added: 0,
  updated: 0,
  removed: 0,
};

export function getScanProgress(): ScanProgress {
  return { ...scanProgress };
}

export function resetScanProgress(): void {
  scanProgress.status = 'idle';
  scanProgress.total = 0;
  scanProgress.processed = 0;
  scanProgress.currentFile = '';
  scanProgress.step = '';
  scanProgress.added = 0;
  scanProgress.updated = 0;
  scanProgress.removed = 0;
  scanProgress.error = undefined;
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

function getVideoDuration(filePath: string): number | null {
  try {
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

export async function scanLibrary(scraper: Scraper, fullRescan = false): Promise<void> {
  if (scanProgress.status === 'scanning') return;

  resetScanProgress();
  scanProgress.status = 'scanning';
  scanProgress.step = 'Discovering files...';

  try {
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
    scanProgress.total = filesToProcess.length;

    for (const filePath of filesToProcess) {
      const filename = path.basename(filePath);
      const existing = existingByPath.get(filePath);
      const isNew = !existing;
      const label = `[${scanProgress.processed + 1}/${scanProgress.total}]`;
      scanProgress.currentFile = filename;

      try {
        // Sub-step 1: Add or update in database
        let videoId: string;
        if (isNew) {
          scanProgress.step = 'Adding to database';
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
          scanProgress.step = 'Updating database';
          console.log(`[scan] ${label} ${filename} — already in database, updating`);

          // Update duration: always on full rescan, only if missing otherwise
          if (fullRescan || existing.length == null) {
            scanProgress.step = 'Processing duration';
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

        // Sub-step 3: Scrape metadata (always on new files and full rescan, skip on quick scan for existing)
        if (isNew || fullRescan) {
          scanProgress.step = 'Scraping metadata';
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
          scanProgress.added++;
        } else {
          scanProgress.updated++;
        }
        console.log(`[scan] ${label} ${filename} — done (${isNew ? 'added' : 'updated'})`);
      } catch (err) {
        console.error(`[scan] ${label} ${filename} — FAILED:`, err);
        if (isNew) {
          await db('videos').where('full_path', filePath).del().catch(() => {});
        }
      }

      scanProgress.processed++;
    }

    // Remove stale entries in batch
    if (staleIds.length > 0) {
      scanProgress.step = 'Removing stale entries';
      console.log(`[scan] Removing ${staleIds.length} stale entries`);
      await db('videos').whereIn('id', staleIds).del();
      scanProgress.removed = staleIds.length;
    }

    scanProgress.status = 'done';
    scanProgress.step = '';
    scanProgress.currentFile = '';
    console.log(`[scan] Complete — added ${scanProgress.added}, updated ${scanProgress.updated}, removed ${scanProgress.removed}`);
  } catch (err: any) {
    scanProgress.status = 'error';
    scanProgress.step = '';
    scanProgress.error = err.message;
    console.error('[scan] Fatal error:', err);
  }
}
