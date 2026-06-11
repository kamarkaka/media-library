import { spawn, execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { config } from '../config';

// Snapshots are stored per code: THUMBNAIL_CACHE_DIR/<code>/<code>-<seq>.jpeg. For a multi-file
// entry, every file contributes `countPerFile` frames, numbered continuously across the code's
// files (file A → 001..N, file B → N+1..2N). Filesystem is the source of truth — no DB table.

const THUMBNAIL_WIDTH = 480;
const JPEG_QUALITY = 3;

export interface ThumbInfo {
  url: string;
}

export interface ThumbFile {
  full_path: string;
  length: number | null;
}

// Match the cover-downloader sanitization so a code maps to a safe directory/filename.
function sanitizeCode(code: string): string {
  return code.replace(/[/\\:*?"<>|]/g, '_');
}

function getThumbnailDir(code: string): string {
  return path.join(config.thumbnailCacheDir, sanitizeCode(code));
}

function thumbnailFilename(code: string, seq: number): string {
  return `${sanitizeCode(code)}-${String(seq).padStart(3, '0')}.jpeg`;
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

// Extract a single JPEG frame at time `t` to `outPath` (shared with the favorite-moments snapshots).
export function extractFrame(fullPath: string, t: number, outPath: string): Promise<void> {
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

// List an entry's thumbnails (read the code directory), sorted by sequence number.
export function listThumbnailsForCode(videoId: string, code: string | null): ThumbInfo[] {
  if (!code) return [];
  const dir = getThumbnailDir(code);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .map((name) => {
      const m = /-(\d{3})\.jpeg$/.exec(name);
      return m ? { seq: parseInt(m[1], 10), name } : null;
    })
    .filter((x): x is { seq: number; name: string } => x !== null)
    .sort((a, b) => a.seq - b.seq)
    .map((x) => ({ url: `/api/videos/${videoId}/thumbnails/${encodeURIComponent(x.name)}` }));
}

// Remove every thumbnail for a code (its whole <code>/ directory). Best-effort; no-op without a code.
// Caller must ensure no other entry still shares the code (thumbnails are keyed by code, not video id).
export function deleteThumbnailsForCode(code: string | null): void {
  if (!code) return;
  fs.rmSync(getThumbnailDir(code), { recursive: true, force: true });
}

// Generate `countPerFile` evenly-spaced snapshots for EACH file of an entry, numbered continuously
// under <code>/. Regenerate semantics — clears the code directory first. Requires a non-empty code.
export async function generateThumbnailsForEntry(
  code: string | null,
  files: ThumbFile[],
  countPerFile: number,
): Promise<number> {
  if (!code) throw new Error('Video has no code');

  const dir = getThumbnailDir(code);
  deleteThumbnailsForCode(code); // clear any previous thumbnails for this code before regenerating
  fs.mkdirSync(dir, { recursive: true });

  let seq = 0;
  for (const file of files) {
    let D = file.length;
    if (!D || D <= 0) D = probeDuration(file.full_path);
    if (!D || D <= 0) continue; // skip files whose duration can't be determined
    // snapshot i (1-based) at t_i = D * i / (countPerFile + 1) — avoids the black first/last frames
    for (let i = 1; i <= countPerFile; i++) {
      seq++;
      const t = (D * i) / (countPerFile + 1);
      await extractFrame(file.full_path, t, path.join(dir, thumbnailFilename(code, seq)));
    }
  }
  return seq;
}
