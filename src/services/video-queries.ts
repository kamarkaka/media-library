import db from '../db';
import type { Knex } from 'knex';

export interface VideoFilters {
  q?: string;
  genre?: string[];
  director?: string[];
  maker?: string[];
  label?: string[];
  cast?: string[];
  match?: 'matched' | 'unmatched';
  sort?: string;
  page?: number;
  pageSize?: number;
}

function parseCSV(value: any): string[] | undefined {
  if (!value) return undefined;
  const items = String(value).split(',').map(s => s.trim()).filter(Boolean);
  return items.length > 0 ? items : undefined;
}

export function parseVideoFilters(query: Record<string, any>): VideoFilters {
  const match = query.match as string | undefined;
  return {
    q: query.q as string | undefined,
    genre: parseCSV(query.genre),
    director: parseCSV(query.director),
    maker: parseCSV(query.maker),
    label: parseCSV(query.label),
    cast: parseCSV(query.cast),
    match: match === 'matched' || match === 'unmatched' ? match : undefined,
    sort: (query.sort as string) || 'release_date',
    page: parseInt(query.page as string) || 1,
    pageSize: parseInt(query.page_size as string) || 24,
  };
}

function applyFilters(query: Knex.QueryBuilder, filters: VideoFilters): Knex.QueryBuilder {
  const { q, genre, director, maker, label, cast, match } = filters;

  if (q) {
    const like = `%${q}%`;
    query.where(function () {
      this.where('videos.filename', 'like', like)
        .orWhere('videos.code', 'like', like)
        .orWhere('videos.name', 'like', like)
        .orWhereExists(function (this: Knex.QueryBuilder) {
          this.select(db.raw(1))
            .from('video_genres')
            .join('genres', 'video_genres.genre_id', 'genres.id')
            .whereRaw('video_genres.video_id = videos.id')
            .where('genres.name', 'like', like);
        })
        .orWhereExists(function (this: Knex.QueryBuilder) {
          this.select(db.raw(1))
            .from('video_cast')
            .join('cast_members', 'video_cast.cast_id', 'cast_members.id')
            .whereRaw('video_cast.video_id = videos.id')
            .where('cast_members.name', 'like', like);
        });
    });
  }

  if (director) query.whereIn('videos.director', director);
  if (maker) query.whereIn('videos.maker', maker);
  if (label) query.whereIn('videos.label', label);

  if (genre) {
    query.whereExists(function (this: Knex.QueryBuilder) {
      this.select(db.raw(1))
        .from('video_genres')
        .join('genres', 'video_genres.genre_id', 'genres.id')
        .whereRaw('video_genres.video_id = videos.id')
        .whereIn('genres.name', genre);
    });
  }

  if (cast) {
    query.whereExists(function (this: Knex.QueryBuilder) {
      this.select(db.raw(1))
        .from('video_cast')
        .join('cast_members', 'video_cast.cast_id', 'cast_members.id')
        .whereRaw('video_cast.video_id = videos.id')
        .whereIn('cast_members.name', cast);
    });
  }

  if (match === 'unmatched') {
    query.where(function () {
      this.whereNull('videos.code').orWhere('videos.code', '')
        .orWhereNull('videos.name').orWhere('videos.name', '')
        .orWhereNull('videos.cover_image').orWhere('videos.cover_image', '')
        .orWhereNotExists(function (this: Knex.QueryBuilder) {
          this.select(db.raw(1)).from('video_genres').whereRaw('video_genres.video_id = videos.id');
        })
        .orWhereNotExists(function (this: Knex.QueryBuilder) {
          this.select(db.raw(1)).from('video_cast').whereRaw('video_cast.video_id = videos.id');
        });
    });
  } else if (match === 'matched') {
    query.whereNotNull('videos.code').where('videos.code', '!=', '')
      .whereNotNull('videos.name').where('videos.name', '!=', '')
      .whereNotNull('videos.cover_image').where('videos.cover_image', '!=', '')
      .whereExists(function (this: Knex.QueryBuilder) {
        this.select(db.raw(1)).from('video_genres').whereRaw('video_genres.video_id = videos.id');
      })
      .whereExists(function (this: Knex.QueryBuilder) {
        this.select(db.raw(1)).from('video_cast').whereRaw('video_cast.video_id = videos.id');
      });
  }

  return query;
}

export async function queryVideos(filters: VideoFilters) {
  const { sort = 'filename', page = 1, pageSize = 24 } = filters;
  const offset = (page - 1) * pageSize;

  const countResult = (await applyFilters(db('videos'), filters).count('* as total').first()) as any;
  const total: number = countResult?.total || 0;

  let query = applyFilters(db('videos').select('videos.*'), filters);

  if (sort === 'last_viewed') {
    query = query
      .leftJoin('playback_state', 'videos.id', 'playback_state.video_id')
      .orderByRaw('playback_state.last_viewed DESC NULLS LAST');
  } else {
    query = query.orderByRaw('release_date ASC NULLS LAST');
  }

  const videos = await query.limit(pageSize).offset(offset);

  return {
    videos,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
    hasMore: offset + pageSize < total,
  };
}

export async function getPlaybackMap(videoIds: string[]): Promise<Record<string, any>> {
  if (videoIds.length === 0) return {};
  const rows = await db('playback_state').whereIn('video_id', videoIds);
  return Object.fromEntries(rows.map((p: any) => [p.video_id, p]));
}

export async function getRecentPlayback(): Promise<any | null> {
  const recent = await db('playback_state')
    .join('videos', 'playback_state.video_id', 'videos.id')
    .orderBy('playback_state.last_viewed', 'desc')
    .select('videos.*', 'playback_state.position', 'playback_state.last_viewed')
    .first();
  return recent || null;
}

export async function getVideoNeighbors(video: { release_date: string | null; id: string }) {
  const rd = video.release_date;

  // Previous: the video right before this one in release_date ASC NULLS LAST order
  const prevVideo = await db('videos')
    .where(function () {
      if (rd) {
        // Earlier date, or same date with smaller id, or null date (nulls sort last, so they're "after")
        this.where('release_date', '<', rd)
          .orWhere(function () { this.where('release_date', rd).where('id', '<', video.id); });
      } else {
        // Current is null: only other nulls with smaller id come before
        this.whereNull('release_date').where('id', '<', video.id);
      }
    })
    .orderByRaw('release_date DESC NULLS FIRST')
    .orderBy('id', 'desc')
    .select('id', 'filename')
    .first();

  // Next: the video right after this one in release_date ASC NULLS LAST order
  const nextVideo = await db('videos')
    .where(function () {
      if (rd) {
        // Later date, or same date with larger id, or null date
        this.where('release_date', '>', rd)
          .orWhere(function () { this.where('release_date', rd).where('id', '>', video.id); })
          .orWhereNull('release_date');
      } else {
        // Current is null: only other nulls with larger id come after
        this.whereNull('release_date').where('id', '>', video.id);
      }
    })
    .orderByRaw('release_date ASC NULLS LAST')
    .orderBy('id', 'asc')
    .select('id', 'filename')
    .first();

  return { prev: prevVideo || null, next: nextVideo || null };
}

export async function getFilterOptions() {
  const [genres, directors, makers, labels, castMembers] = await Promise.all([
    db('genres')
      .join('video_genres', 'genres.id', 'video_genres.genre_id')
      .distinct('genres.name as name')
      .orderBy('name'),
    db('videos')
      .whereNotNull('director')
      .where('director', '!=', '')
      .distinct('director as name')
      .orderBy('name'),
    db('videos')
      .whereNotNull('maker')
      .where('maker', '!=', '')
      .distinct('maker as name')
      .orderBy('name'),
    db('videos')
      .whereNotNull('label')
      .where('label', '!=', '')
      .distinct('label as name')
      .orderBy('name'),
    db('cast_members')
      .join('video_cast', 'cast_members.id', 'video_cast.cast_id')
      .distinct('cast_members.name as name')
      .orderBy('name'),
  ]);

  return { genres, directors, makers, labels, castMembers };
}
