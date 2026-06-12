import { parentPort, workerData } from 'worker_threads';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import knexInit from 'knex';
import { config } from '../config';
import { applyFileMetadata, relinkFile, regenerateEntryThumbnails } from './merge-helpers';
import { getVideoInfo, videoInfoColumns, type VideoInfo } from './video-probe';
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

function formatVideoSummary(info: VideoInfo): string {
  const dur = info.duration ? info.duration + 's' : 'duration unknown';
  const res = `${info.width}x${info.height}`;
  return `${dur}, ${res}, ${info.videoCodec || '?'}`;
}

// The code token of a filename = the part before its first space, with the video extension stripped
// and lowercased (e.g. "ABC-123 Title.mp4" and "ABC-123.mp4" both → "abc-123"). A relink candidate
// matches an entry when this equals its code. The extension is stripped because the scraped `code`
// has none, so a space-less filename ("ABC-123.mp4") would otherwise never match code "ABC-123".
function codeToken(filePath: string): string {
  let base = path.basename(filePath).trim();
  const ext = path.extname(base).toLowerCase();
  if (VIDEO_EXTENSIONS.has(ext)) base = base.slice(0, -ext.length);
  return base.split(' ')[0].trim().toLowerCase();
}

// Reconcile moved/renamed files BEFORE adding new entries. For each missing (stale) file, look among the
// on-disk files not yet linked to any entry (`candidatePaths`) for one whose code token matches the
// entry's code (case-insensitive); if found, relink the existing row to it. Returns the set of candidate
// paths consumed, so the caller can exclude them from the new-file scan (otherwise a moved/renamed file
// would both leave its entry unlinked AND be re-added as a duplicate). Best-effort: a per-file failure is
// logged and skipped, never aborting the scan.
async function relinkMissingFiles(
  staleFiles: any[],
  candidatePaths: string[],
  thumbnailCount: number,
): Promise<Set<string>> {
  const consumed = new Set<string>();
  // Entries (video_id -> code) that got at least one relink — thumbnails are refreshed once per entry
  // after the loop, so a multi-file entry isn't regenerated once per relinked file.
  const relinkedEntries = new Map<string, string | null>();
  // Only entries with a code can be matched (the match key is the code token).
  const withCode = staleFiles.filter((f) => f.code && String(f.code).trim());
  if (withCode.length === 0 || candidatePaths.length === 0) return consumed;

  // Index candidates by code token for O(1) lookup.
  const byToken = new Map<string, string[]>();
  for (const p of candidatePaths) {
    const token = codeToken(p);
    if (!token) continue;
    const list = byToken.get(token);
    if (list) list.push(p);
    else byToken.set(token, [p]);
  }

  progress({ step: 'Checking for moved or renamed files...' });
  // Process in a stable order so repeated runs behave identically.
  const ordered = [...withCode].sort((a, b) =>
    a.full_path < b.full_path ? -1 : a.full_path > b.full_path ? 1 : 0,
  );

  for (const file of ordered) {
    const token = String(file.code).trim().toLowerCase();
    const candidates = byToken.get(token);
    if (!candidates) continue;

    // Prefer an exact-basename candidate (a pure move) over a code-only match (a rename); this keeps
    // multi-file entries from cross-assigning when several of their files moved.
    const oldBase = path.basename(file.full_path || '');
    const pick = candidates.find((c) => !consumed.has(c) && path.basename(c) === oldBase)
      ?? candidates.find((c) => !consumed.has(c));
    if (!pick) continue;

    const filename = path.basename(pick);
    progress({ currentFile: filename, step: 'Relinking moved/renamed file' });
    try {
      // Defer thumbnail regen (last arg false) — done once per entry below to avoid redundant work.
      await relinkFile(db, { id: file.file_id }, { id: file.video_id, code: file.code }, pick, thumbnailCount, false);
      consumed.add(pick);
      relinkedEntries.set(file.video_id, file.code);
      console.log(`[scan] relinked "${oldBase || '(empty path)'}" -> "${filename}" (code=${file.code})`);
      progress({ relinked: consumed.size });
    } catch (err: any) {
      console.error(`[scan] relink FAILED for code=${file.code} -> ${filename}:`, err.message);
    }
  }

  // Refresh thumbnails once per relinked entry (best-effort) now that all its files point at real paths.
  if (relinkedEntries.size > 0) progress({ step: 'Refreshing thumbnails for relinked files' });
  for (const [videoId, code] of relinkedEntries) {
    await regenerateEntryThumbnails(db, videoId, code, thumbnailCount);
  }

  return consumed;
}

async function run(): Promise<void> {
  try {
    await db.raw('PRAGMA journal_mode = WAL');
    await db.raw('PRAGMA foreign_keys = ON');

    // Read on our own knex (workers avoid the db singleton); used by relink thumbnail regeneration.
    const thumbRow = await db('settings').where('key', 'thumbnail_count').first();
    const thumbnailCount = thumbRow ? parseInt(thumbRow.value, 10) || 10 : 10;

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

    // Identity/staleness is tracked per physical file in video_files (a videos entry may own many files).
    // Join the parent video's code too — it is the match key for relinking moved/renamed files below.
    const existingFiles = await db('video_files')
      .leftJoin('videos', 'video_files.video_id', 'videos.id')
      .select(
        'video_files.id as file_id',
        'video_files.video_id as video_id',
        'video_files.full_path as full_path',
        'video_files.length as length',
        'video_files.is_default as is_default',
        'videos.code as code',
      );
    const existingByPath = new Map(existingFiles.map((f: any) => [f.full_path, f]));
    const allFilesSet = new Set(allFiles);
    const staleFiles = existingFiles.filter((f: any) => !allFilesSet.has(f.full_path));

    // Candidate replacements for relinking: on-disk files not currently linked to any video_files row.
    const candidatePaths = allFiles.filter((f) => !existingByPath.has(f));

    // Reconcile missing files first: relink each stale row to a code-matching candidate where possible.
    const consumed = await relinkMissingFiles(staleFiles, candidatePaths, thumbnailCount);
    const relinked = consumed.size;

    // New files = on-disk files that are neither already linked nor just consumed by a relink. Excluding
    // consumed paths is what prevents a moved/renamed file from being re-added as a duplicate entry.
    const newFiles = candidatePaths.filter((f) => !consumed.has(f));
    // A full scan re-probes all on-disk files, minus the relinked ones (just re-probed during the relink);
    // a quick scan only touches new files, which already exclude consumed paths.
    const filesToProcess = fullScan ? allFiles.filter((f) => !consumed.has(f)) : newFiles;
    const existingCount = allFiles.length - candidatePaths.length;
    console.log(`[scan] Found ${allFiles.length} files on disk (${newFiles.length} new, ${existingCount} existing, ${staleFiles.length} stale, ${relinked} relinked)`);
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
          const fileId = uuidv4();
          const info = getVideoInfo(filePath);
          const cols = videoInfoColumns(info);
          // A new file starts as its own single-file entry; the merge pass collapses same-code entries later
          await db.transaction(async (trx) => {
            await trx('videos').insert({
              id: videoId,
              filename,
              full_path: filePath,
              default_file_id: fileId,
              ...cols,
            });
            await trx('video_files').insert({
              id: fileId,
              video_id: videoId,
              filename,
              full_path: filePath,
              is_default: 1,
              ...cols,
            });
          });
          console.log(`[scan] ${label} ${filename} — ${formatVideoSummary(info)}`);
          added++;
        } else {
          if (fullScan || existing.length == null) {
            progress({ step: 'Probing video info' });
            console.log(`[scan] ${label} ${filename} — probing video info`);
            const info = getVideoInfo(filePath);
            // Update the file's columns, mirroring onto the videos row if it's the default file
            await applyFileMetadata(db, existing.file_id, existing.video_id, existing.is_default, videoInfoColumns(info));
            console.log(`[scan] ${label} ${filename} — ${formatVideoSummary(info)}`);
          }
          updated++;
        }
        console.log(`[scan] ${label} ${filename} — done (${isNew ? 'added' : 'updated'})`);
      } catch (err) {
        console.error(`[scan] ${label} ${filename} — FAILED:`, err);
        if (isNew) {
          await db('video_files').where('full_path', filePath).del().catch(() => {});
          await db('videos').where('full_path', filePath).del().catch(() => {});
        }
      }

      processed++;
      progress({ processed, added, updated });
    }

    // We intentionally NEVER delete unlinked records. A video_files row whose file has vanished from
    // disk (and could not be relinked above) is kept (along with its videos entry) so the entry surfaces
    // in the Settings "missing files" list, where the user can relink the path or remove the video.
    const removed = 0;
    const stillMissing = staleFiles.length - relinked;
    if (stillMissing > 0) {
      console.log(`[scan] ${stillMissing} file(s) no longer on disk — kept as unlinked (not removed)`);
    }

    console.log(`[scan] Complete — added ${added}, updated ${updated}, removed ${removed}, relinked ${relinked}`);
    progress({ status: 'done', step: '', currentFile: '', added, updated, removed, relinked });
  } catch (err: any) {
    console.error('[scan] Fatal error:', err);
    progress({ status: 'error', step: '', error: err.message });
  } finally {
    await db.destroy();
  }
}

run();
