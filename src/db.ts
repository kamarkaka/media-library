import knexInit from 'knex';
import path from 'path';
import fs from 'fs';
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
      t.integer('width').nullable();
      t.integer('height').nullable();
      t.text('video_codec').nullable();
      t.text('audio_codec').nullable();
      t.integer('bitrate').nullable();
      t.float('framerate').nullable();
      t.integer('file_size').nullable();
      t.timestamp('created_at').defaultTo(db.fn.now());
      t.timestamp('updated_at').defaultTo(db.fn.now());
    });
  }

  if (!(await db.schema.hasTable('genres'))) {
    await db.schema.createTable('genres', (t) => {
      t.increments('id').primary();
      t.text('name').notNullable().unique();
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

  // Add columns for existing databases
  const cols = await db.raw("PRAGMA table_info('videos')");
  const colNames = new Set(cols.map((c: any) => c.name));
  const newCols: [string, string][] = [
    ['code', 'TEXT'],
    ['name', 'TEXT'],
    ['width', 'INTEGER'],
    ['height', 'INTEGER'],
    ['video_codec', 'TEXT'],
    ['audio_codec', 'TEXT'],
    ['bitrate', 'INTEGER'],
    ['framerate', 'REAL'],
    ['file_size', 'INTEGER'],
  ];
  for (const [name, type] of newCols) {
    if (!colNames.has(name)) {
      await db.raw(`ALTER TABLE videos ADD COLUMN ${name} ${type}`);
    }
  }

  await db.raw('CREATE INDEX IF NOT EXISTS idx_videos_release_date ON videos(release_date)');
  await db.raw('CREATE INDEX IF NOT EXISTS idx_videos_director ON videos(director)');
  await db.raw('CREATE INDEX IF NOT EXISTS idx_videos_maker ON videos(maker)');
  await db.raw('CREATE INDEX IF NOT EXISTS idx_videos_label ON videos(label)');
  await db.raw('CREATE INDEX IF NOT EXISTS idx_playback_last_viewed ON playback_state(last_viewed DESC)');
}

export async function setSetting(key: string, value: string): Promise<void> {
  await db('settings').insert({ key, value }).onConflict('key').merge();
}

export default db;
