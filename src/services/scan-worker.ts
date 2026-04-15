import { parentPort, workerData } from 'worker_threads';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import knexInit from 'knex';
import { config } from '../config';
import type { ScanProgress } from './scanner';

const { fullScan } = workerData as { fullScan: boolean };

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

interface VideoInfo {
  duration: number | null;
  width: number | null;
  height: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  bitrate: number | null;
  framerate: number | null;
  fileSize: number | null;
}

function getVideoInfo(filePath: string): VideoInfo {
  const info: VideoInfo = {
    duration: null, width: null, height: null,
    videoCodec: null, audioCodec: null, bitrate: null,
    framerate: null, fileSize: null,
  };
  try {
    const output = execFileSync('ffprobe', [
      '-v', 'fatal',
      '-show_entries', 'format=duration,size,bit_rate',
      '-show_entries', 'stream=codec_type,codec_name,width,height,r_frame_rate',
      '-of', 'json',
      filePath,
    ], { timeout: 30000, encoding: 'utf-8' });

    const data = JSON.parse(output);
    const format = data.format || {};
    const streams: any[] = data.streams || [];
    const videoStream = streams.find((s: any) => s.codec_type === 'video');
    const audioStream = streams.find((s: any) => s.codec_type === 'audio');

    const dur = parseFloat(format.duration);
    info.duration = isNaN(dur) ? null : Math.round(dur);
    info.fileSize = format.size ? parseInt(format.size, 10) : null;
    info.bitrate = format.bit_rate ? parseInt(format.bit_rate, 10) : null;

    if (videoStream) {
      info.width = videoStream.width || null;
      info.height = videoStream.height || null;
      info.videoCodec = videoStream.codec_name || null;
      if (videoStream.r_frame_rate) {
        const [num, den] = videoStream.r_frame_rate.split('/').map(Number);
        if (den && !isNaN(num / den)) {
          info.framerate = Math.round((num / den) * 100) / 100;
        }
      }
    }
    if (audioStream) {
      info.audioCodec = audioStream.codec_name || null;
    }

    return info;
  } catch (err) {
    console.warn(`[scan] ffprobe failed for ${path.basename(filePath)}:`, err);
    return info;
  }
}

function videoInfoColumns(info: VideoInfo): Record<string, any> {
  return {
    length: info.duration,
    width: info.width,
    height: info.height,
    video_codec: info.videoCodec,
    audio_codec: info.audioCodec,
    bitrate: info.bitrate,
    framerate: info.framerate,
    file_size: info.fileSize,
  };
}

function formatVideoSummary(info: VideoInfo): string {
  const dur = info.duration ? info.duration + 's' : 'duration unknown';
  const res = `${info.width}x${info.height}`;
  return `${dur}, ${res}, ${info.videoCodec || '?'}`;
}

async function run(): Promise<void> {
  try {
    await db.raw('PRAGMA journal_mode = WAL');
    await db.raw('PRAGMA foreign_keys = ON');

    progress({ step: 'Discovering files...' });
    console.log(`[scan] Starting library scan (fullScan=${fullScan})`);

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
    const filesToProcess = fullScan ? allFiles : newFiles;
    console.log(`[scan] Found ${allFiles.length} files on disk (${newFiles.length} new, ${allFiles.length - newFiles.length} existing, ${staleIds.length} stale)`);
    if (!fullScan && filesToProcess.length < allFiles.length) {
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
        if (isNew) {
          progress({ step: 'Adding to database' });
          console.log(`[scan] ${label} ${filename} — adding to database`);
          const videoId = uuidv4();
          const info = getVideoInfo(filePath);
          await db('videos').insert({
            id: videoId,
            filename,
            full_path: filePath,
            ...videoInfoColumns(info),
          });
          console.log(`[scan] ${label} ${filename} — ${formatVideoSummary(info)}`);
          added++;
        } else {
          if (fullScan || existing.length == null) {
            progress({ step: 'Probing video info' });
            console.log(`[scan] ${label} ${filename} — probing video info`);
            const info = getVideoInfo(filePath);
            await db('videos').where('id', existing.id).update(videoInfoColumns(info));
            console.log(`[scan] ${label} ${filename} — ${formatVideoSummary(info)}`);
          }
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
