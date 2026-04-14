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
      t.text('filename').notNullable();
      t.text('full_path').notNullable().unique();
      t.date('release_date').nullable();
      t.integer('length').nullable();
      t.text('director').nullable();
      t.text('maker').nullable();
      t.text('label').nullable();
      t.text('cover_image').nullable();
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

  if (!(await db.schema.hasTable('sessions'))) {
    await db.schema.createTable('sessions', (t) => {
      t.text('sid').primary();
      t.text('data').notNullable();
      t.bigInteger('expires').notNullable();
    });
  }

  if (!(await db.schema.hasTable('playback_logs'))) {
    await db.schema.createTable('playback_logs', (t) => {
      t.increments('id').primary();
      t.text('video_id').references('id').inTable('videos').onDelete('CASCADE');
      t.text('event').notNullable(); // start, pause, resume, next, prev, snapshot
      t.float('position').notNullable().defaultTo(0); // playback position in seconds
      t.timestamp('created_at').defaultTo(db.fn.now());
    });
  }

  await db.raw('CREATE INDEX IF NOT EXISTS idx_playback_logs_video ON playback_logs(video_id)');
  await db.raw('CREATE INDEX IF NOT EXISTS idx_playback_logs_created ON playback_logs(created_at DESC)');
  await db.raw('CREATE INDEX IF NOT EXISTS idx_videos_release_date ON videos(release_date)');
  await db.raw('CREATE INDEX IF NOT EXISTS idx_videos_director ON videos(director)');
  await db.raw('CREATE INDEX IF NOT EXISTS idx_videos_maker ON videos(maker)');
  await db.raw('CREATE INDEX IF NOT EXISTS idx_videos_label ON videos(label)');
  await db.raw('CREATE INDEX IF NOT EXISTS idx_playback_last_viewed ON playback_state(last_viewed DESC)');
}

export default db;
