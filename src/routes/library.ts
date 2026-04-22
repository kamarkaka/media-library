import { Router } from 'express';
import { queryVideos, getPlaybackMap, getRecentPlayback, parseVideoFilters } from '../services/video-queries';

const router = Router();

router.get('/', async (req, res) => {
  const filters = { ...parseVideoFilters(req.query as Record<string, any>), page: 1, pageSize: 24 };
  const result = await queryVideos(filters);
  const playbackMap = await getPlaybackMap(result.videos.map((v: any) => v.id));
  const recentPlayback = await getRecentPlayback();

  res.render('library', {
    title: 'Library',
    videos: result.videos,
    playbackMap: new Map(Object.entries(playbackMap)),
    recentPlayback,
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
