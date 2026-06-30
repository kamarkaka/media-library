import knexInit from 'knex';
import type { Knex } from 'knex';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import { config } from './config';

const dataDir = path.dirname(config.dbPath);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = knexInit({
  client: 'better-sqlite3',
  connection: { filename: config.dbPath },
  useNullAsDefault: true,
});

export async function initDatabase(): Promise<void> {
  await db.raw('PRAGMA journal_mode = WAL');
  await db.raw('PRAGMA foreign_keys = ON');

  if (!(await db.schema.hasTable('library_paths'))) {
    await db.schema.createTable('library_paths', (t) => {
      t.increments('id').primary();
      t.text('path').notNullable().unique();
      t.timestamp('created_at').defaultTo(db.fn.now());
    });
  }

  if (!(await db.schema.hasTable('videos'))) {
    await db.schema.createTable('videos', (t) => {
      t.text('id').primary();
      t.text('code').nullable();
      t.text('name').nullable();
      t.text('filename').notNullable();
      t.text('full_path').notNullable().unique();
      t.date('release_date').nullable();
      t.date('added_date').nullable();
      t.integer('length').nullable();
      t.text('director').nullable();
      t.text('maker').nullable();
      t.text('label').nullable();
      t.text('cover_image').nullable();
      t.text('source_url').nullable();
      t.text('scraper_type').nullable();
      t.integer('width').nullable();
      t.integer('height').nullable();
      t.text('video_codec').nullable();
      t.text('audio_codec').nullable();
      t.integer('bitrate').nullable();
      t.float('framerate').nullable();
      t.integer('file_size').nullable();
      t.text('default_file_id').nullable();
      t.integer('matched').notNullable().defaultTo(0);
      t.timestamp('created_at').defaultTo(db.fn.now());
      t.timestamp('updated_at').defaultTo(db.fn.now());
    });
  }

  if (!(await db.schema.hasTable('genres'))) {
    await db.schema.createTable('genres', (t) => {
      t.increments('id').primary();
      t.text('name').notNullable().unique();
      t.text('alias').nullable();
    });
  }

  if (!(await db.schema.hasTable('video_genres'))) {
    await db.schema.createTable('video_genres', (t) => {
      t.text('video_id').references('id').inTable('videos').onDelete('CASCADE');
      t.integer('genre_id').references('id').inTable('genres').onDelete('CASCADE');
      t.primary(['video_id', 'genre_id']);
    });
  }

  if (!(await db.schema.hasTable('cast_members'))) {
    await db.schema.createTable('cast_members', (t) => {
      t.increments('id').primary();
      t.text('name').notNullable().unique();
    });
  }

  if (!(await db.schema.hasTable('video_cast'))) {
    await db.schema.createTable('video_cast', (t) => {
      t.text('video_id').references('id').inTable('videos').onDelete('CASCADE');
      t.integer('cast_id').references('id').inTable('cast_members').onDelete('CASCADE');
      t.primary(['video_id', 'cast_id']);
    });
  }

  if (!(await db.schema.hasTable('playback_state'))) {
    await db.schema.createTable('playback_state', (t) => {
      t.text('video_id').primary().references('id').inTable('videos').onDelete('CASCADE');
      t.float('position').notNullable().defaultTo(0);
      t.timestamp('last_viewed').defaultTo(db.fn.now());
    });
  }

  if (!(await db.schema.hasTable('settings'))) {
    await db.schema.createTable('settings', (t) => {
      t.text('key').primary();
      t.text('value');
    });
  }

  if (!(await db.schema.hasTable('sessions'))) {
    await db.schema.createTable('sessions', (t) => {
      t.text('sid').primary();
      t.text('data').notNullable();
      t.bigInteger('expires').notNullable();
    });
  }

  if (!(await db.schema.hasTable('validation_results'))) {
    await db.schema.createTable('validation_results', (t) => {
      t.increments('id').primary();
      t.text('scraper_type').notNullable();
      t.integer('success').notNullable();
      t.text('fields').notNullable();
      t.text('error').nullable();
      t.timestamp('created_at').defaultTo(db.fn.now());
    });
    await db.raw('CREATE INDEX idx_validation_scraper_date ON validation_results(scraper_type, created_at DESC)');
  }

  if (!(await db.schema.hasTable('coverage_results'))) {
    await db.schema.createTable('coverage_results', (t) => {
      t.increments('id').primary();
      t.text('run_id').notNullable();
      t.text('video_id').notNullable();
      t.text('scraper_type').notNullable();
      t.integer('success').notNullable();
      t.timestamp('created_at').defaultTo(db.fn.now());
      t.unique(['run_id', 'video_id', 'scraper_type']);
    });
    await db.raw('CREATE INDEX idx_coverage_run_scraper ON coverage_results(run_id, scraper_type)');
  }

  if (!(await db.schema.hasTable('field_sources'))) {
    await db.schema.createTable('field_sources', (t) => {
      t.text('video_id').notNullable().references('id').inTable('videos').onDelete('CASCADE');
      t.text('field').notNullable();
      t.text('source').notNullable();
      t.primary(['video_id', 'field']);
    });
  }

  if (!(await db.schema.hasTable('scraper_field_config'))) {
    await db.schema.createTable('scraper_field_config', (t) => {
      t.text('field').primary();
      t.text('scraper_type').notNullable();
    });
  }

  // One row per physical file; multiple files can belong to one logical videos entry
  if (!(await db.schema.hasTable('video_files'))) {
    await db.schema.createTable('video_files', (t) => {
      t.text('id').primary();
      t.text('video_id').notNullable().references('id').inTable('videos').onDelete('CASCADE');
      t.text('filename').notNullable();
      t.text('full_path').notNullable().unique();
      t.integer('length').nullable();
      t.integer('width').nullable();
      t.integer('height').nullable();
      t.text('video_codec').nullable();
      t.text('audio_codec').nullable();
      t.integer('bitrate').nullable();
      t.float('framerate').nullable();
      t.integer('file_size').nullable();
      t.integer('is_default').notNullable().defaultTo(0);
      t.timestamp('created_at').defaultTo(db.fn.now());
    });
  }

  // Favorite moments: a bookmark of one video at one timestamp (within a specific file)
  if (!(await db.schema.hasTable('favorite_moments'))) {
    await db.schema.createTable('favorite_moments', (t) => {
      t.text('id').primary();
      t.text('video_id').notNullable().references('id').inTable('videos').onDelete('CASCADE');
      t.text('file_id').nullable().references('id').inTable('video_files').onDelete('CASCADE');
      t.float('timestamp').notNullable();
      t.timestamp('created_at').defaultTo(db.fn.now());
    });
  }

  // Add columns for existing databases
  const cols = await db.raw("PRAGMA table_info('videos')");
  const colNames = new Set(cols.map((c: any) => c.name));
  const newCols: [string, string][] = [
    ['code', 'TEXT'],
    ['name', 'TEXT'],
    ['scraper_type', 'TEXT'],
    ['width', 'INTEGER'],
    ['height', 'INTEGER'],
    ['video_codec', 'TEXT'],
    ['audio_codec', 'TEXT'],
    ['bitrate', 'INTEGER'],
    ['framerate', 'REAL'],
    ['file_size', 'INTEGER'],
    ['matched', 'INTEGER DEFAULT 0'],
    ['source_url', 'TEXT'],
    ['default_file_id', 'TEXT'],
    ['added_date', 'DATE'],
  ];
  for (const [name, type] of newCols) {
    if (!colNames.has(name)) {
      await db.raw(`ALTER TABLE videos ADD COLUMN ${name} ${type}`);
    }
  }

  // Add alias column to genres for existing databases
  const genreCols = await db.raw("PRAGMA table_info('genres')");
  if (!genreCols.some((c: any) => c.name === 'alias')) {
    await db.raw('ALTER TABLE genres ADD COLUMN alias TEXT');
  }

  await db.raw('CREATE INDEX IF NOT EXISTS idx_videos_release_date ON videos(release_date)');
  await db.raw('CREATE INDEX IF NOT EXISTS idx_videos_added_date ON videos(added_date)');
  await db.raw('CREATE INDEX IF NOT EXISTS idx_videos_director ON videos(director)');
  await db.raw('CREATE INDEX IF NOT EXISTS idx_videos_maker ON videos(maker)');
  await db.raw('CREATE INDEX IF NOT EXISTS idx_videos_label ON videos(label)');
  await db.raw('CREATE INDEX IF NOT EXISTS idx_playback_last_viewed ON playback_state(last_viewed DESC)');
  await db.raw('CREATE INDEX IF NOT EXISTS idx_video_files_video_id ON video_files(video_id)');
  await db.raw('CREATE INDEX IF NOT EXISTS idx_favorite_moments_video ON favorite_moments(video_id)');

  // Backfill: ensure every videos row has a corresponding video_files row + default pointer.
  // Idempotent — only touches videos that have no video_files rows yet, so it is a no-op on later boots.
  const orphanVideos = await db('videos')
    .leftJoin('video_files', 'videos.id', 'video_files.video_id')
    .whereNull('video_files.id')
    .select(
      'videos.id', 'videos.filename', 'videos.full_path', 'videos.length',
      'videos.width', 'videos.height', 'videos.video_codec', 'videos.audio_codec',
      'videos.bitrate', 'videos.framerate', 'videos.file_size',
    );
  if (orphanVideos.length > 0) {
    await db.transaction(async (trx) => {
      for (const v of orphanVideos) {
        const fileId = randomUUID();
        await trx('video_files').insert({
          id: fileId, video_id: v.id, filename: v.filename, full_path: v.full_path,
          length: v.length, width: v.width, height: v.height, video_codec: v.video_codec,
          audio_codec: v.audio_codec, bitrate: v.bitrate, framerate: v.framerate,
          file_size: v.file_size, is_default: 1,
        }).onConflict('full_path').ignore();
        await trx('videos').where('id', v.id).update({ default_file_id: fileId });
      }
    });
  }

  // Backfill added_date for pre-existing videos that lack one. "Added date" = when the entry entered the
  // library; for rows that predate this column we approximate it with the earliest last-modified time among
  // the entry's files on disk. Rows whose files are all missing stay NULL and are retried on later boots
  // (cheap). New videos get added_date set at insert time, so they are never picked up here.
  const needsAddedDate = await db('videos').whereNull('added_date').select('id', 'full_path');
  if (needsAddedDate.length > 0) {
    // One query for all candidate files, grouped in memory (avoids an N+1 lookup per video).
    const filesByVideo = new Map<string, string[]>();
    const allFiles = await db('video_files')
      .whereIn('video_id', needsAddedDate.map((v) => v.id))
      .select('video_id', 'full_path');
    for (const f of allFiles) {
      if (!f.full_path) continue;
      const list = filesByVideo.get(f.video_id);
      if (list) list.push(f.full_path);
      else filesByVideo.set(f.video_id, [f.full_path]);
    }
    // Stat files outside the write transaction; collect each entry's earliest mtime, then batch the updates.
    const updates: { id: string; added_date: string }[] = [];
    for (const v of needsAddedDate) {
      // Legacy fallback: an entry with no video_files rows still has its path mirrored on the videos row.
      const paths = filesByVideo.get(v.id) || (v.full_path ? [v.full_path] : []);
      const mtimes = paths
        .map((p) => { try { return fs.statSync(p).mtimeMs; } catch { return null; } })
        .filter((m): m is number => m !== null);
      if (mtimes.length > 0) {
        updates.push({ id: v.id, added_date: new Date(Math.min(...mtimes)).toISOString().slice(0, 10) });
      }
    }
    if (updates.length > 0) {
      await db.transaction(async (trx) => {
        for (const u of updates) {
          await trx('videos').where('id', u.id).update({ added_date: u.added_date });
        }
      });
    }
  }
}

export async function setSetting(key: string, value: string): Promise<void> {
  await db('settings').insert({ key, value }).onConflict('key').merge();
}

// Read an integer setting (e.g. seek_step, thumbnail_count), falling back when unset/invalid.
export async function getIntSetting(dbh: Knex, key: string, fallback: number): Promise<number> {
  const row = await dbh('settings').where('key', key).first();
  return row ? parseInt(row.value, 10) || fallback : fallback;
}

export default db;
