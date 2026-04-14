import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import db from '../db';
import { Scraper } from '../scrapers/types';

const VIDEO_EXTENSIONS = new Set([
  '.mp4', '.mkv', '.avi', '.webm', '.mov', '.wmv', '.flv', '.m4v', '.ts', '.mts',
]);

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

export async function scanLibrary(scraper: Scraper): Promise<{ added: number; removed: number }> {
  const libraryPaths = await db('library_paths').select('path');

  const allFiles = new Set<string>();
  for (const { path: dirPath } of libraryPaths) {
    if (fs.existsSync(dirPath)) {
      for (const file of walkDirectory(dirPath)) {
        allFiles.add(file);
      }
    }
  }

  const existingVideos = await db('videos').select('id', 'full_path');
  const existingPaths = new Set(existingVideos.map((v: any) => v.full_path));

  let added = 0;
  for (const filePath of allFiles) {
    if (existingPaths.has(filePath)) continue;

    const filename = path.basename(filePath);
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

      added++;
    } catch (err) {
      console.error(`Error adding video ${filePath}:`, err);
    }
  }

  let removed = 0;
  for (const video of existingVideos) {
    if (!allFiles.has((video as any).full_path)) {
      await db('videos').where('id', (video as any).id).del();
      removed++;
    }
  }

  // Fill in duration for existing videos missing it
  const missingLength = await db('videos').whereNull('length').select('id', 'full_path');
  for (const video of missingLength) {
    const v = video as any;
    if (fs.existsSync(v.full_path)) {
      const duration = getVideoDuration(v.full_path);
      if (duration) {
        await db('videos').where('id', v.id).update({ length: duration });
      }
    }
  }

  return { added, removed };
}
