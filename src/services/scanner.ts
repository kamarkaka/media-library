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
  phase: string;
  total: number;
  processed: number;
  currentFile: string;
  added: number;
  removed: number;
  error?: string;
}

const scanProgress: ScanProgress = {
  status: 'idle',
  phase: '',
  total: 0,
  processed: 0,
  currentFile: '',
  added: 0,
  removed: 0,
};

export function getScanProgress(): ScanProgress {
  return { ...scanProgress };
}

function resetProgress(): void {
  scanProgress.status = 'scanning';
  scanProgress.phase = 'Discovering files...';
  scanProgress.total = 0;
  scanProgress.processed = 0;
  scanProgress.currentFile = '';
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

  resetProgress();

  try {
    // Phase 1: Discover files
    const libraryPaths = await db('library_paths').select('path');
    const allFiles = new Set<string>();
    for (const { path: dirPath } of libraryPaths) {
      if (fs.existsSync(dirPath)) {
        for (const file of walkDirectory(dirPath)) {
          allFiles.add(file);
        }
      }
    }

    // Figure out what work needs to be done
    const existingVideos = await db('videos').select('id', 'full_path', 'length');
    const existingPaths = new Set(existingVideos.map((v: any) => v.full_path));

    const newFiles = Array.from(allFiles).filter((f) => !existingPaths.has(f));
    const staleVideos = existingVideos.filter((v: any) => !allFiles.has(v.full_path));
    const missingLength = existingVideos.filter((v: any) => v.length == null && allFiles.has(v.full_path));

    scanProgress.total = newFiles.length + staleVideos.length + missingLength.length;
    scanProgress.processed = 0;

    // Phase 2: Add new files
    scanProgress.phase = 'Adding new videos';
    for (const filePath of newFiles) {
      const filename = path.basename(filePath);
      scanProgress.currentFile = filename;

      const videoId = uuidv4();
      try {
        const metadata = await scraper.scrape(filename);
        const id = metadata?.id || videoId;
        const duration = metadata?.length || getVideoDuration(filePath);

        await db('videos').insert({
          id,
          filename,
          full_path: filePath,
          release_date: metadata?.releaseDate || null,
          length: duration,
          director: metadata?.director || null,
          maker: metadata?.maker || null,
          label: metadata?.label || null,
          cover_image: metadata?.coverImage || null,
        });

        if (metadata?.genres) {
          for (const genreName of metadata.genres) {
            let genre: any = await db('genres').where('name', genreName).first();
            if (!genre) {
              const [genreId] = await db('genres').insert({ name: genreName });
              genre = { id: genreId };
            }
            await db('video_genres').insert({ video_id: id, genre_id: genre.id }).onConflict(['video_id', 'genre_id']).ignore();
          }
        }

        if (metadata?.cast) {
          for (const castName of metadata.cast) {
            let castMember: any = await db('cast_members').where('name', castName).first();
            if (!castMember) {
              const [castId] = await db('cast_members').insert({ name: castName });
              castMember = { id: castId };
            }
            await db('video_cast').insert({ video_id: id, cast_id: castMember.id }).onConflict(['video_id', 'cast_id']).ignore();
          }
        }

        scanProgress.added++;
      } catch (err) {
        console.error(`Error adding video ${filePath}:`, err);
      }

      scanProgress.processed++;
    }

    // Phase 3: Remove stale entries
    if (staleVideos.length > 0) {
      scanProgress.phase = 'Removing stale entries';
      for (const video of staleVideos) {
        const v = video as any;
        scanProgress.currentFile = path.basename(v.full_path);
        await db('videos').where('id', v.id).del();
        scanProgress.removed++;
        scanProgress.processed++;
      }
    }

    // Phase 4: Backfill durations
    if (missingLength.length > 0) {
      scanProgress.phase = 'Updating durations';
      for (const video of missingLength) {
        const v = video as any;
        scanProgress.currentFile = path.basename(v.full_path);
        if (fs.existsSync(v.full_path)) {
          const duration = getVideoDuration(v.full_path);
          if (duration) {
            await db('videos').where('id', v.id).update({ length: duration });
          }
        }
        scanProgress.processed++;
      }
    }

    scanProgress.status = 'done';
    scanProgress.phase = 'Complete';
    scanProgress.currentFile = '';
  } catch (err: any) {
    scanProgress.status = 'error';
    scanProgress.phase = 'Error';
    scanProgress.error = err.message;
    console.error('Scan error:', err);
  }
}
