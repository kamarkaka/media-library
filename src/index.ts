import express from 'express';
import session from 'express-session';
import path from 'path';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { config } from './config';
import { initDatabase } from './db';
import db from './db';
import { SQLiteSessionStore } from './session-store';
import { requireAuth } from './middleware/auth';
import authRouter from './routes/auth';
import libraryRouter from './routes/library';
import playerRouter from './routes/player';
import settingsRouter from './routes/settings';
import apiRouter from './routes/api';

async function main() {
  await initDatabase();

  // Auto-generate password if none configured
  if (!config.authPasswordHash) {
    const tempPassword = crypto.randomBytes(8).toString('hex');
    (config as any).authPasswordHash = bcrypt.hashSync(tempPassword, 12);
    console.log('='.repeat(50));
    console.log('No password configured!');
    console.log(`Temporary password: ${tempPassword}`);
    console.log('Run `npm run setup-auth` to set a permanent password');
    console.log('='.repeat(50));
  }

  const app = express();

  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '../views'));

  if (process.env.NODE_ENV !== 'production') {
    app.disable('view cache');
  }

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(express.static(path.join(__dirname, '../public')));

  app.use(
    session({
      store: new SQLiteSessionStore(db),
      secret: config.sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
        httpOnly: true,
        sameSite: 'lax',
      },
    })
  );

  // Make auth state available to templates
  app.use((req, res, next) => {
    res.locals.authenticated = req.session?.authenticated || false;
    next();
  });

  // Public routes
  app.use(authRouter);

  // All routes below require authentication
  app.use(requireAuth);
  app.use(libraryRouter);
  app.use('/player', playerRouter);
  app.use('/settings', settingsRouter);
  app.use('/api', apiRouter);

  app.listen(config.port, () => {
    console.log(`Media Library running at http://localhost:${config.port}`);
  });
}

main().catch(console.error);
