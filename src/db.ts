import knexInit from 'knex';
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
  await db.raw('CREATE INDEX IF NOT EXISTS idx_videos_director ON videos(director)');
  await db.raw('CREATE INDEX IF NOT EXISTS idx_videos_maker ON videos(maker)');
  await db.raw('CREATE INDEX IF NOT EXISTS idx_videos_label ON videos(label)');
  await db.raw('CREATE INDEX IF NOT EXISTS idx_playback_last_viewed ON playback_state(last_viewed DESC)');
  await db.raw('CREATE INDEX IF NOT EXISTS idx_video_files_video_id ON video_files(video_id)');

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
}

export async function setSetting(key: string, value: string): Promise<void> {
  await db('settings').insert({ key, value }).onConflict('key').merge();
}

export default db;
