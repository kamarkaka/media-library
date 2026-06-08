import { spawn, execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { config } from '../config';

// Snapshots are keyed by the stable video_files.id so they survive merges (a re-parented file
// keeps its id). Layout: THUMBNAIL_CACHE_DIR/<fileId>/<seq>.jpeg. Filesystem is the source of
// truth — no DB table, mirroring the HLS cache.

const THUMBNAIL_WIDTH = 480;
const JPEG_QUALITY = 3;

export interface ThumbInfo {
  seq: number;
  t: number;
  url: string;
}

export interface ThumbFile {
  id: string;
  full_path: string;
  length: number | null;
}

export function getThumbnailDir(fileId: string): string {
  return path.join(config.thumbnailCacheDir, fileId);
}

function thumbnailFilename(seq: number): string {
  return `${String(seq).padStart(3, '0')}.jpeg`;
}

// Probe duration as a fallback when video_files.length is missing.
function probeDuration(fullPath: string): number | null {
  try {
    const out = execFileSync('ffprobe', [
      '-v', 'fatal', '-show_entries', 'format=duration', '-of', 'json', fullPath,
    ], { timeout: 30000, encoding: 'utf-8' });
    const d = parseFloat(JSON.parse(out).format?.duration);
    return isNaN(d) ? null : Math.round(d);
  } catch {
    return null;
  }
}

function extractFrame(fullPath: string, t: number, outPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // -ss before -i = fast input seek; one frame per call gives an exact count and reliable spacing
    const args = [
      '-ss', String(t), '-i', fullPath,
      '-frames:v', '1', '-q:v', String(JPEG_QUALITY),
      '-vf', `scale=${THUMBNAIL_WIDTH}:-2`, '-y', outPath,
    ];
    const proc = spawn(config.ffmpegPath, args, { stdio: 'ignore' });
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))));
    proc.on('error', reject);
  });
}

// List the thumbnails already on disk for one file, recomputing each timestamp from its position.
export function listThumbnailsForFile(videoId: string, file: ThumbFile): ThumbInfo[] {
  const dir = getThumbnailDir(file.id);
  if (!fs.existsSync(dir)) return [];
  const names = fs.readdirSync(dir).filter((f) => /^\d{3}\.jpeg$/.test(f)).sort();
  const total = names.length;
  const D = file.length || 0;
  return names.map((name) => {
    const seq = parseInt(name.slice(0, 3), 10);
    return {
      seq,
      t: D > 0 ? (D * seq) / (total + 1) : 0,
      url: `/api/videos/${videoId}/thumbnails/${file.id}/${name}`,
    };
  });
}

// Generate `count` evenly-spaced snapshots for one file (regenerate semantics — clears existing).
export async function generateThumbnailsForFile(file: ThumbFile, count: number): Promise<number> {
  let D = file.length;
  if (!D || D <= 0) D = probeDuration(file.full_path);
  if (!D || D <= 0) throw new Error('Unknown video duration');

  const dir = getThumbnailDir(file.id);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

  // snapshot i (1-based) at t_i = D * i / (count + 1) — avoids the black first/last frames
  for (let seq = 1; seq <= count; seq++) {
    const t = (D * seq) / (count + 1);
    await extractFrame(file.full_path, t, path.join(dir, thumbnailFilename(seq)));
  }
  return count;
}

export function removeThumbnailsForFile(fileId: string): void {
  fs.rmSync(getThumbnailDir(fileId), { recursive: true, force: true });
}
