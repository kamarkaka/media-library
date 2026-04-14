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
  step: string;        // current step for the file being processed
  added: number;
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

export async function scanLibrary(scraper: Scraper): Promise<void> {
  if (scanProgress.status === 'scanning') return;

  scanProgress.status = 'scanning';
  scanProgress.total = 0;
  scanProgress.processed = 0;
  scanProgress.currentFile = '';
  scanProgress.step = 'Discovering files...';
  scanProgress.added = 0;
  scanProgress.removed = 0;
  scanProgress.error = undefined;

  try {
    // Step 1: Discover all video files on disk
    console.log('[scan] Starting library scan');
    const libraryPaths = await db('library_paths').select('path');
    const allFiles: string[] = [];
    for (const { path: dirPath } of libraryPaths) {
      if (fs.existsSync(dirPath)) {
        console.log(`[scan] Scanning path: ${dirPath}`);
        allFiles.push(...walkDirectory(dirPath));
      }
    }

    const existingVideos = await db('videos').select('id', 'full_path');
    const existingPaths = new Set(existingVideos.map((v: any) => v.full_path));
    const allFilesSet = new Set(allFiles);

    const newFiles = allFiles.filter((f) => !existingPaths.has(f));
    const staleVideos = existingVideos.filter((v: any) => !allFilesSet.has(v.full_path));

    console.log(`[scan] Found ${allFiles.length} files on disk, ${newFiles.length} new, ${staleVideos.length} stale`);
    scanProgress.total = newFiles.length;

    // Step 2: Process each new file through 3 sub-steps
    for (const filePath of newFiles) {
      const filename = path.basename(filePath);
      scanProgress.currentFile = filename;

      try {
        // Sub-step 1: Add to database
        scanProgress.step = 'Adding to database';
        console.log(`[scan] [${scanProgress.processed + 1}/${scanProgress.total}] ${filename} — adding to database`);
        const videoId = uuidv4();
        await db('videos').insert({
          id: videoId,
          filename,
          full_path: filePath,
          release_date: null,
          length: null,
          director: null,
          maker: null,
          label: null,
          cover_image: null,
        });

        // Sub-step 2: Process duration
        scanProgress.step = 'Processing duration';
        console.log(`[scan] [${scanProgress.processed + 1}/${scanProgress.total}] ${filename} — processing duration`);
        const duration = getVideoDuration(filePath);
        if (duration) {
          await db('videos').where('id', videoId).update({ length: duration });
          console.log(`[scan] [${scanProgress.processed + 1}/${scanProgress.total}] ${filename} — duration: ${duration}s`);
        } else {
          console.log(`[scan] [${scanProgress.processed + 1}/${scanProgress.total}] ${filename} — duration: unknown`);
        }

        // Sub-step 3: Scrape metadata
        scanProgress.step = 'Scraping metadata';
        console.log(`[scan] [${scanProgress.processed + 1}/${scanProgress.total}] ${filename} — scraping metadata`);
        const metadata = await scraper.scrape(filename);
        if (metadata) {
          const updates: Record<string, any> = {};
          if (metadata.id) updates.id = metadata.id;
          if (metadata.releaseDate) updates.release_date = metadata.releaseDate;
          if (metadata.length) updates.length = metadata.length;
          if (metadata.director) updates.director = metadata.director;
          if (metadata.maker) updates.maker = metadata.maker;
          if (metadata.label) updates.label = metadata.label;
          if (metadata.coverImage) updates.cover_image = metadata.coverImage;
          if (Object.keys(updates).length > 0) {
            await db('videos').where('id', videoId).update(updates);
          }

          const finalId = metadata.id || videoId;
          if (metadata.id && metadata.id !== videoId) {
            await db('videos').where('id', videoId).update({ id: metadata.id });
          }

          if (metadata.genres) {
            for (const genreName of metadata.genres) {
              let genre: any = await db('genres').where('name', genreName).first();
              if (!genre) {
                const [genreId] = await db('genres').insert({ name: genreName });
                genre = { id: genreId };
              }
              await db('video_genres').insert({ video_id: finalId, genre_id: genre.id }).onConflict(['video_id', 'genre_id']).ignore();
            }
          }

          if (metadata.cast) {
            for (const castName of metadata.cast) {
              let castMember: any = await db('cast_members').where('name', castName).first();
              if (!castMember) {
                const [castId] = await db('cast_members').insert({ name: castName });
                castMember = { id: castId };
              }
              await db('video_cast').insert({ video_id: finalId, cast_id: castMember.id }).onConflict(['video_id', 'cast_id']).ignore();
            }
          }
        }

        // All 3 steps succeeded — count as added
        scanProgress.added++;
        console.log(`[scan] [${scanProgress.processed + 1}/${scanProgress.total}] ${filename} — done`);
      } catch (err) {
        console.error(`[scan] [${scanProgress.processed + 1}/${scanProgress.total}] ${filename} — FAILED:`, err);
        // Rollback: remove partially inserted video
        await db('videos').where('full_path', filePath).del().catch(() => {});
      }

      scanProgress.processed++;
    }

    // Step 3: Remove stale entries (files that no longer exist on disk)
    if (staleVideos.length > 0) {
      scanProgress.step = 'Removing stale entries';
      console.log(`[scan] Removing ${staleVideos.length} stale entries`);
      for (const video of staleVideos) {
        const v = video as any;
        scanProgress.currentFile = path.basename(v.full_path);
        console.log(`[scan] Removing stale: ${path.basename(v.full_path)}`);
        await db('videos').where('id', v.id).del();
        scanProgress.removed++;
      }
    }

    scanProgress.status = 'done';
    scanProgress.step = '';
    scanProgress.currentFile = '';
    console.log(`[scan] Complete — added ${scanProgress.added}, removed ${scanProgress.removed}`);
  } catch (err: any) {
    scanProgress.status = 'error';
    scanProgress.step = '';
    scanProgress.error = err.message;
    console.error('[scan] Fatal error:', err);
  }
}
