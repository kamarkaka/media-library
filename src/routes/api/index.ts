import { Router } from 'express';
import videosRouter from './videos';
import playbackRouter from './playback';
import pathsRouter from './paths';
import filtersRouter from './filters';
import libraryRouter from './library';
import authRouter from './auth';
import tagsRouter from './tags';

const router = Router();

router.use('/videos', videosRouter);
router.use('/playback', playbackRouter);
router.use('/paths', pathsRouter);
router.use('/library', libraryRouter);
router.use('/auth', authRouter);
router.use('/', tagsRouter);
router.use('/', filtersRouter);

export default router;
