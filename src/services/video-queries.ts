import db from '../db';
import type { Knex } from 'knex';

export interface VideoFilters {
  q?: string;
  genre?: string;
  director?: string;
  maker?: string;
  label?: string;
  cast?: string;
  sort?: string;
  page?: number;
  pageSize?: number;
}

export function parseVideoFilters(query: Record<string, any>): VideoFilters {
  return {
    q: query.q as string | undefined,
    genre: query.genre as string | undefined,
    director: query.director as string | undefined,
    maker: query.maker as string | undefined,
    label: query.label as string | undefined,
    cast: query.cast as string | undefined,
    sort: (query.sort as string) || 'filename',
    page: parseInt(query.page as string) || 1,
    pageSize: parseInt(query.page_size as string) || 24,
  };
}

function applyFilters(query: Knex.QueryBuilder, filters: VideoFilters): Knex.QueryBuilder {
  const { q, genre, director, maker, label, cast } = filters;

  if (q) query.where('videos.filename', 'like', `%${q}%`);
  if (director) query.where('videos.director', director);
  if (maker) query.where('videos.maker', maker);
  if (label) query.where('videos.label', label);

  if (genre) {
    query.whereExists(function (this: Knex.QueryBuilder) {
      this.select(db.raw(1))
        .from('video_genres')
        .join('genres', 'video_genres.genre_id', 'genres.id')
        .whereRaw('video_genres.video_id = videos.id')
        .where('genres.name', genre);
    });
  }

  if (cast) {
    query.whereExists(function (this: Knex.QueryBuilder) {
      this.select(db.raw(1))
        .from('video_cast')
        .join('cast_members', 'video_cast.cast_id', 'cast_members.id')
        .whereRaw('video_cast.video_id = videos.id')
        .where('cast_members.name', cast);
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
  } else if (sort === 'release_date') {
    query = query.orderByRaw('release_date DESC NULLS LAST');
  } else {
    query = query.orderBy('videos.filename', 'asc');
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

export async function getVideoNeighbors(video: { filename: string; id: string }) {
  const prevVideo = await db('videos')
    .whereRaw('(filename < ? OR (filename = ? AND id < ?))', [video.filename, video.filename, video.id])
    .orderBy('filename', 'desc')
    .orderBy('id', 'desc')
    .select('id', 'filename')
    .first();

  const nextVideo = await db('videos')
    .whereRaw('(filename > ? OR (filename = ? AND id > ?))', [video.filename, video.filename, video.id])
    .orderBy('filename', 'asc')
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
