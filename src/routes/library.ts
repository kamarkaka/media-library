import { Router } from 'express';
import db from '../db';
import { queryVideos, getFilterOptions } from '../services/video-queries';

const router = Router();

router.get('/', async (req, res) => {
  const filters = {
    q: req.query.q as string | undefined,
    genre: req.query.genre as string | undefined,
    director: req.query.director as string | undefined,
    maker: req.query.maker as string | undefined,
    label: req.query.label as string | undefined,
    cast: req.query.cast as string | undefined,
    sort: (req.query.sort as string) || 'filename',
    page: 1,
    pageSize: 24,
  };

  const result = await queryVideos(filters);

  // Get playback state for rendered videos
  const videoIds = result.videos.map((v: any) => v.id);
  const playbackStates =
    videoIds.length > 0 ? await db('playback_state').whereIn('video_id', videoIds) : [];
  const playbackMap = new Map(playbackStates.map((p: any) => [p.video_id, p]));

  // Get most recent playback for resume banner
  const recentPlayback = await db('playback_state')
    .join('videos', 'playback_state.video_id', 'videos.id')
    .orderBy('playback_state.last_viewed', 'desc')
    .select('videos.*', 'playback_state.position', 'playback_state.last_viewed')
    .first();

  const filterOptions = await getFilterOptions();

  res.render('library', {
    title: 'Library',
    videos: result.videos,
    playbackMap,
    recentPlayback,
    filters: filterOptions,
    currentFilters: filters,
    pagination: {
      page: result.page,
      pageSize: result.pageSize,
      total: result.total,
      totalPages: result.totalPages,
      hasMore: result.hasMore,
    },
  });
});

export default router;
