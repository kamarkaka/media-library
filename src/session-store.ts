import session from 'express-session';
import type { Knex } from 'knex';

export class SQLiteSessionStore extends session.Store {
  private db: Knex;

  constructor(db: Knex) {
    super();
    this.db = db;
  }

  get(sid: string, callback: (err?: any, session?: session.SessionData | null) => void): void {
    this.db('sessions')
      .where({ sid })
      .andWhere('expires', '>', Date.now())
      .first()
      .then((row: any) => {
        callback(null, row ? JSON.parse(row.data) : null);
      })
      .catch((err: any) => callback(err));
  }

  set(sid: string, sessionData: session.SessionData, callback?: (err?: any) => void): void {
    const maxAge = sessionData.cookie?.maxAge || 86400000;
    const expires = Date.now() + maxAge;
    this.db('sessions')
      .insert({ sid, data: JSON.stringify(sessionData), expires })
      .onConflict('sid')
      .merge({ data: JSON.stringify(sessionData), expires })
      .then(() => callback?.())
      .catch((err: any) => callback?.(err));
  }

  destroy(sid: string, callback?: (err?: any) => void): void {
    this.db('sessions')
      .where({ sid })
      .del()
      .then(() => callback?.())
      .catch((err: any) => callback?.(err));
  }

  touch(sid: string, sessionData: session.SessionData, callback?: () => void): void {
    const maxAge = sessionData.cookie?.maxAge || 86400000;
    const expires = Date.now() + maxAge;
    this.db('sessions')
      .where({ sid })
      .update({ expires })
      .then(() => callback?.())
      .catch(() => callback?.());
  }
}
