import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import { config } from '../config';

export interface QualityLevel {
  name: string;
  height: number;
  bitrate: string;
  bandwidth: number;
}

const QUALITY_LEVELS: QualityLevel[] = [
  { name: '360p', height: 360, bitrate: '800k', bandwidth: 1000000 },
  { name: '720p', height: 720, bitrate: '2500k', bandwidth: 3000000 },
  { name: '1080p', height: 1080, bitrate: '5000k', bandwidth: 6000000 },
];

// Track active transcoding jobs: key = "<videoId>/<quality>"
const activeJobs = new Map<string, ChildProcess>();

function getCacheDir(videoId: string, quality: string): string {
  return path.join(config.hlsCacheDir, videoId, quality);
}

function getPlaylistPath(videoId: string, quality: string): string {
  return path.join(getCacheDir(videoId, quality), 'playlist.m3u8');
}

export function getAvailableQualities(sourceHeight: number | null): QualityLevel[] {
  const h = sourceHeight || 0;
  return QUALITY_LEVELS.filter(q => q.height <= h);
}

export function generateMasterPlaylist(videoId: string, sourceHeight: number | null): string {
  const qualities = getAvailableQualities(sourceHeight);

  let playlist = '#EXTM3U\n';

  // Add transcoded quality levels
  for (const q of qualities) {
    playlist += `#EXT-X-STREAM-INF:BANDWIDTH=${q.bandwidth},RESOLUTION=${Math.round(q.height * 16 / 9)}x${q.height},NAME="${q.name}"\n`;
    playlist += `/api/videos/${videoId}/hls/${q.name}\n`;
  }

  // Always add original quality as highest bandwidth
  const origBandwidth = qualities.length > 0
    ? qualities[qualities.length - 1].bandwidth * 2
    : 10000000;
  const resTag = sourceHeight
    ? `,RESOLUTION=${Math.round(sourceHeight * 16 / 9)}x${sourceHeight}`
    : '';
  playlist += `#EXT-X-STREAM-INF:BANDWIDTH=${origBandwidth}${resTag},NAME="original"\n`;
  playlist += `/api/videos/${videoId}/hls/original\n`;

  return playlist;
}

export function isTranscoded(videoId: string, quality: string): boolean {
  const playlistPath = getPlaylistPath(videoId, quality);
  return fs.existsSync(playlistPath);
}

export function isTranscoding(videoId: string, quality: string): boolean {
  return activeJobs.has(`${videoId}/${quality}`);
}

export function getPlaylistContent(videoId: string, quality: string): string | null {
  const playlistPath = getPlaylistPath(videoId, quality);
  try {
    return fs.readFileSync(playlistPath, 'utf-8');
  } catch {
    return null;
  }
}

export function getSegmentPath(videoId: string, quality: string, segment: string): string {
  return path.join(getCacheDir(videoId, quality), segment);
}

export function startTranscoding(
  videoId: string,
  quality: string,
  inputPath: string,
  sourceVideoCodec: string | null,
  sourceAudioCodec: string | null,
): Promise<void> {
  const jobKey = `${videoId}/${quality}`;
  if (activeJobs.has(jobKey)) {
    return waitForPlaylist(videoId, quality);
  }

  const cacheDir = getCacheDir(videoId, quality);
  fs.mkdirSync(cacheDir, { recursive: true });

  const playlistPath = getPlaylistPath(videoId, quality);
  const segmentPattern = path.join(cacheDir, 'seg%04d.ts');

  let args: string[];

  if (quality === 'original') {
    // For original: copy streams if H.264/AAC, otherwise transcode at source quality
    const canCopy = sourceVideoCodec === 'h264' && (sourceAudioCodec === 'aac' || sourceAudioCodec === 'mp3');
    if (canCopy) {
      args = [
        '-i', inputPath,
        '-c:v', 'copy', '-c:a', 'copy',
        '-hls_time', '10', '-hls_list_size', '0', '-hls_segment_type', 'mpegts',
        '-hls_segment_filename', segmentPattern,
        playlistPath,
      ];
    } else {
      args = [
        '-i', inputPath,
        '-c:v', 'libx264', '-c:a', 'aac', '-preset', 'veryfast',
        '-hls_time', '10', '-hls_list_size', '0', '-hls_segment_type', 'mpegts',
        '-hls_segment_filename', segmentPattern,
        playlistPath,
      ];
    }
  } else {
    const level = QUALITY_LEVELS.find(q => q.name === quality);
    if (!level) throw new Error(`Unknown quality: ${quality}`);

    args = [
      '-i', inputPath,
      '-c:v', 'libx264', '-c:a', 'aac', '-preset', 'veryfast',
      '-vf', `scale=-2:${level.height}`,
      '-b:v', level.bitrate,
      '-hls_time', '10', '-hls_list_size', '0', '-hls_segment_type', 'mpegts',
      '-hls_segment_filename', segmentPattern,
      playlistPath,
    ];
  }

  console.log(`[hls] Starting transcode: ${videoId}/${quality}`);
  const proc = spawn(config.ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  activeJobs.set(jobKey, proc);

  proc.stderr?.on('data', (data: Buffer) => {
    const msg = data.toString().trim();
    if (msg.includes('frame=') || msg.includes('time=')) {
      // Progress — only log occasionally
    }
  });

  proc.on('close', (code) => {
    activeJobs.delete(jobKey);
    if (code === 0) {
      console.log(`[hls] Transcode complete: ${videoId}/${quality}`);
    } else {
      console.error(`[hls] Transcode failed (exit ${code}): ${videoId}/${quality}`);
    }
  });

  proc.on('error', (err) => {
    activeJobs.delete(jobKey);
    console.error(`[hls] Transcode error: ${videoId}/${quality}:`, err.message);
  });

  return waitForPlaylist(videoId, quality);
}

// Wait for the playlist file to appear (FFmpeg writes it once the first segment is ready)
function waitForPlaylist(videoId: string, quality: string): Promise<void> {
  const playlistPath = getPlaylistPath(videoId, quality);
  const jobKey = `${videoId}/${quality}`;
  return new Promise((resolve, reject) => {
    let elapsed = 0;
    const interval = setInterval(() => {
      if (fs.existsSync(playlistPath)) {
        clearInterval(interval);
        setTimeout(resolve, 500);
        return;
      }
      // Detect if the FFmpeg process has exited without producing a playlist
      if (!activeJobs.has(jobKey)) {
        clearInterval(interval);
        reject(new Error('Transcoding failed — FFmpeg process exited'));
        return;
      }
      elapsed += 500;
      if (elapsed > 60000) {
        clearInterval(interval);
        reject(new Error('Transcoding timeout waiting for playlist'));
      }
    }, 500);
  });
}

export function cleanupCache(videoId: string): void {
  const dir = path.join(config.hlsCacheDir, videoId);
  fs.rmSync(dir, { recursive: true, force: true });
}
