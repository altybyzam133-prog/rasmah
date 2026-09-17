'use strict';

/* Minimal express-session store backed by the app's SQLite database.
   Keeps sessions across restarts and avoids the MemoryStore prod warning. */

module.exports = function makeStore(session) {
  const { Store } = session;
  const { db } = require('./db');

  const selStmt = db.prepare('SELECT sess, expire FROM sessions WHERE sid = ?');
  const upStmt = db.prepare(
    `INSERT INTO sessions (sid, sess, expire) VALUES (@sid, @sess, @expire)
     ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expire = excluded.expire`
  );
  const delStmt = db.prepare('DELETE FROM sessions WHERE sid = ?');
  const touchStmt = db.prepare('UPDATE sessions SET expire = ? WHERE sid = ?');
  const pruneStmt = db.prepare('DELETE FROM sessions WHERE expire < ?');

  const DEFAULT_TTL = 1000 * 60 * 60 * 24 * 14; // 14 days fallback

  function expiryOf(sess) {
    if (sess && sess.cookie && sess.cookie.expires) {
      return new Date(sess.cookie.expires).getTime();
    }
    return Date.now() + DEFAULT_TTL;
  }

  class SqliteStore extends Store {
    get(sid, cb) {
      try {
        const row = selStmt.get(sid);
        if (!row) return cb(null, null);
        if (row.expire < Date.now()) {
          delStmt.run(sid);
          return cb(null, null);
        }
        return cb(null, JSON.parse(row.sess));
      } catch (err) {
        return cb(err);
      }
    }

    set(sid, sess, cb) {
      try {
        upStmt.run({ sid, sess: JSON.stringify(sess), expire: expiryOf(sess) });
        return cb && cb(null);
      } catch (err) {
        return cb && cb(err);
      }
    }

    destroy(sid, cb) {
      try {
        delStmt.run(sid);
        return cb && cb(null);
      } catch (err) {
        return cb && cb(err);
      }
    }

    touch(sid, sess, cb) {
      try {
        touchStmt.run(expiryOf(sess), sid);
        return cb && cb(null);
      } catch (err) {
        return cb && cb(err);
      }
    }
  }

  // prune expired sessions hourly
  setInterval(() => {
    try {
      pruneStmt.run(Date.now());
    } catch {
      /* ignore */
    }
  }, 60 * 60 * 1000).unref();

  return new SqliteStore();
};
