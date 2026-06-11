import { spawn } from 'child_process';
import { config } from '../config';

// On-the-fly single-frame extraction for the seek-bar scrub preview. Frames are produced live with
// a fast keyframe seek (-ss before -i), scaled small, and cached in a bounded in-memory LRU so
// re-scrubbing the same spot is instant. Independent of the pre-generated thumbnail snapshots.

const PREVIEW_WIDTH = 240;
const JPEG_QUALITY = 5;
const FRAME_STEP = 5;        // seconds — snap preview frames to a 5s grid (bounds ffmpeg work + caches)
const MAX_CACHE = 200;       // most-recent frames kept in memory

const cache = new Map<string, Buffer>(); // insertion order = LRU recency

function roundT(t: number): number {
  if (!isFinite(t) || t < 0) return 0;
  return Math.round(t / FRAME_STEP) * FRAME_STEP;
}

function cacheGet(key: string): Buffer | undefined {
  const buf = cache.get(key);
  if (buf) { cache.delete(key); cache.set(key, buf); } // bump to most-recent
  return buf;
}

function cacheSet(key: string, buf: Buffer): void {
  cache.set(key, buf);
  if (cache.size > MAX_CACHE) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}

// Extract one JPEG frame near time `t` of `fullPath`. Pass an AbortSignal (e.g. from the HTTP
// request) to kill a superseded ffmpeg run when the client disconnects.
export function getFrame(
  fullPath: string,
  fileKey: string,
  t: number,
  signal?: AbortSignal,
): Promise<Buffer> {
  const rt = roundT(t);
  const key = `${fileKey}:${rt}`;
  const cached = cacheGet(key);
  if (cached) return Promise.resolve(cached);
  if (signal?.aborted) return Promise.reject(new Error('aborted'));

  return new Promise((resolve, reject) => {
    const args = [
      '-ss', String(rt), '-i', fullPath,
      '-frames:v', '1', '-q:v', String(JPEG_QUALITY),
      '-vf', `scale=${PREVIEW_WIDTH}:-2`, '-f', 'mjpeg', 'pipe:1',
    ];
    const proc = spawn(config.ffmpegPath, args, { stdio: ['ignore', 'pipe', 'ignore'] });
    const chunks: Buffer[] = [];
    const onAbort = () => proc.kill('SIGKILL');
    signal?.addEventListener('abort', onAbort, { once: true });

    proc.stdout.on('data', (c: Buffer) => chunks.push(c));
    proc.on('error', reject);
    proc.on('close', (code) => {
      signal?.removeEventListener('abort', onAbort);
      if (signal?.aborted) return reject(new Error('aborted'));
      if (code === 0 && chunks.length) {
        const buf = Buffer.concat(chunks);
        cacheSet(key, buf);
        resolve(buf);
      } else {
        reject(new Error(`ffmpeg exited ${code}`));
      }
    });
  });
}
