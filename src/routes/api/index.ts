import { Router } from 'express';
import videosRouter from './videos';
import playbackRouter from './playback';
import pathsRouter from './paths';
import filtersRouter from './filters';
import libraryRouter from './library';
import authRouter from './auth';
import tagsRouter from './tags';
import scraperRouter from './scraper';

const router = Router();

router.use('/videos', videosRouter);
router.use('/playback', playbackRouter);
router.use('/paths', pathsRouter);
router.use('/library', libraryRouter);
router.use('/auth', authRouter);
router.use('/scraper', scraperRouter);
router.use('/', tagsRouter);
router.use('/', filtersRouter);

export default router;
