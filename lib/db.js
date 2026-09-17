'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const config = require('./config');

const dataDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, config.dbFile));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL,
  email_lower   TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  lang          TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS designs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       TEXT NOT NULL DEFAULT '',
  width       INTEGER NOT NULL DEFAULT 1080,
  height      INTEGER NOT NULL DEFAULT 1080,
  data_json   TEXT NOT NULL DEFAULT '',
  thumbnail   TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_designs_user ON designs(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS uploads (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  url           TEXT NOT NULL,
  original_name TEXT NOT NULL DEFAULT '',
  mime          TEXT NOT NULL DEFAULT '',
  size          INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_uploads_user ON uploads(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS templates (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  slug        TEXT NOT NULL UNIQUE,
  name_ar     TEXT NOT NULL,
  name_en     TEXT NOT NULL,
  category    TEXT NOT NULL DEFAULT 'other',
  width       INTEGER NOT NULL DEFAULT 1080,
  height      INTEGER NOT NULL DEFAULT 1080,
  thumbnail   TEXT NOT NULL DEFAULT '',
  data_json   TEXT NOT NULL DEFAULT '',
  sort_order  INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS brand_kits (
  user_id      INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  colors       TEXT NOT NULL DEFAULT '[]',
  font_heading TEXT NOT NULL DEFAULT '',
  font_body    TEXT NOT NULL DEFAULT '',
  logo_url     TEXT NOT NULL DEFAULT '',
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ai_generations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ai_gen_user_time ON ai_generations(user_id, created_at);

CREATE TABLE IF NOT EXISTS custom_fonts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family      TEXT NOT NULL,
  url         TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_custom_fonts_user ON custom_fonts(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS design_versions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  design_id   INTEGER NOT NULL REFERENCES designs(id) ON DELETE CASCADE,
  width       INTEGER NOT NULL,
  height      INTEGER NOT NULL,
  pages       INTEGER NOT NULL DEFAULT 1,
  data_json   TEXT NOT NULL DEFAULT '',
  thumbnail   TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_design_versions_design ON design_versions(design_id, id DESC);

CREATE TABLE IF NOT EXISTS sessions (
  sid    TEXT PRIMARY KEY,
  sess   TEXT NOT NULL,
  expire INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_expire ON sessions(expire);
`);

// ---- lightweight migrations for older databases --------------------------
function columns(table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
}
if (!columns('designs').includes('share_token')) {
  db.exec('ALTER TABLE designs ADD COLUMN share_token TEXT');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_designs_share ON designs(share_token)');
}
if (!columns('designs').includes('pages')) {
  db.exec("ALTER TABLE designs ADD COLUMN pages INTEGER NOT NULL DEFAULT 1");
}
if (!columns('users').includes('reset_code_hash')) {
  db.exec('ALTER TABLE users ADD COLUMN reset_code_hash TEXT');
  db.exec('ALTER TABLE users ADD COLUMN reset_code_expires INTEGER');
}
if (!columns('designs').includes('folder')) {
  db.exec("ALTER TABLE designs ADD COLUMN folder TEXT NOT NULL DEFAULT ''");
}
if (!columns('templates').includes('user_id')) {
  db.exec('ALTER TABLE templates ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE');
}
if (!columns('designs').includes('is_public')) {
  db.exec('ALTER TABLE designs ADD COLUMN is_public INTEGER NOT NULL DEFAULT 0');
  db.exec('CREATE INDEX IF NOT EXISTS idx_designs_public ON designs(is_public, updated_at DESC)');
}

// ---- users --------------------------------------------------------------
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function createUser({ name, email, password }) {
  name = String(name || '').trim().slice(0, 60);
  email = String(email || '').trim();
  if (!name) {
    const e = new Error('bad_name');
    e.code = 'BAD_NAME';
    throw e;
  }
  if (!EMAIL_RE.test(email)) {
    const e = new Error('bad_email');
    e.code = 'BAD_EMAIL';
    throw e;
  }
  if (String(password || '').length < 8) {
    const e = new Error('short_password');
    e.code = 'SHORT_PASSWORD';
    throw e;
  }
  const hash = bcrypt.hashSync(String(password), 10);
  try {
    const info = db
      .prepare(
        `INSERT INTO users (name, email, email_lower, password_hash)
         VALUES (?, ?, ?, ?)`
      )
      .run(name, email, email.toLowerCase(), hash);
    return getUserById(info.lastInsertRowid);
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      const e = new Error('email_taken');
      e.code = 'EMAIL_TAKEN';
      throw e;
    }
    throw err;
  }
}

function getUserById(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}
function getUserByEmail(email) {
  return db
    .prepare('SELECT * FROM users WHERE email_lower = ?')
    .get(String(email || '').trim().toLowerCase());
}
function verifyUser(email, password) {
  const u = getUserByEmail(email);
  if (!u) return null;
  return bcrypt.compareSync(String(password || ''), u.password_hash) ? u : null;
}
function verifyUserById(id, password) {
  const u = getUserById(id);
  if (!u) return null;
  return bcrypt.compareSync(String(password || ''), u.password_hash) ? u : null;
}
function setUserLang(id, lang) {
  db.prepare('UPDATE users SET lang = ? WHERE id = ?').run(lang, id);
}
function updateProfile(id, { name, email }) {
  name = String(name || '').trim().slice(0, 60);
  email = String(email || '').trim();
  if (!name) { const e = new Error('bad_name'); e.code = 'BAD_NAME'; throw e; }
  if (!EMAIL_RE.test(email)) { const e = new Error('bad_email'); e.code = 'BAD_EMAIL'; throw e; }
  try {
    db.prepare('UPDATE users SET name = ?, email = ?, email_lower = ? WHERE id = ?')
      .run(name, email, email.toLowerCase(), id);
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) { const e = new Error('email_taken'); e.code = 'EMAIL_TAKEN'; throw e; }
    throw err;
  }
  return getUserById(id);
}
function setUserPassword(id, password) {
  if (String(password || '').length < 8) { const e = new Error('short_password'); e.code = 'SHORT_PASSWORD'; throw e; }
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(String(password), 10), id);
}
function deleteUser(id) {
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
}

// ---- password reset -------------------------------------------------------
const RESET_CODE_TTL_MS = 15 * 60 * 1000;

function setResetCode(id, code) {
  const hash = bcrypt.hashSync(String(code), 8); // low cost: a 6-digit code isn't worth a slow hash, and this runs on every request attempt
  db.prepare('UPDATE users SET reset_code_hash = ?, reset_code_expires = ? WHERE id = ?')
    .run(hash, Date.now() + RESET_CODE_TTL_MS, id);
}
function verifyResetCode(id, code) {
  const u = getUserById(id);
  if (!u || !u.reset_code_hash || !u.reset_code_expires) return false;
  if (Date.now() > u.reset_code_expires) return false;
  return bcrypt.compareSync(String(code || ''), u.reset_code_hash);
}
function clearResetCode(id) {
  db.prepare('UPDATE users SET reset_code_hash = NULL, reset_code_expires = NULL WHERE id = ?').run(id);
}

// ---- personal templates ---------------------------------------------------
// Stored in the same `templates` table as the admin-seeded ones — user_id
// NULL means a global template, set means it's private to that user. Given
// the category 'mine' (never used by admin-managed templates), which the
// editor's Templates panel picks up as a normal filter chip for free.
function saveUserTemplate({ userId, name, width, height, dataJson, thumbnail }) {
  const slug = `personal-${userId}-${crypto.randomBytes(6).toString('hex')}`;
  const info = db
    .prepare(
      `INSERT INTO templates (slug, name_ar, name_en, category, width, height, thumbnail, data_json, sort_order, active, user_id)
       VALUES (?, ?, ?, 'mine', ?, ?, ?, ?, 0, 1, ?)`
    )
    .run(slug, name, name, width, height, thumbnail || '', dataJson, userId);
  return db
    .prepare('SELECT id, slug, name_ar, name_en, category, width, height, thumbnail FROM templates WHERE id = ?')
    .get(info.lastInsertRowid);
}
function deleteUserTemplate(id, userId) {
  return db.prepare('DELETE FROM templates WHERE id = ? AND user_id = ?').run(id, userId).changes > 0;
}

// ---- design version history -----------------------------------------------
// Auto-checkpoints only (no explicit "named save" UI yet) — throttled to at
// most one snapshot per design per VERSION_GAP so a normal editing session's
// stream of 1.2s autosaves doesn't flood the table; VERSION_CAP bounds total
// storage per design by dropping the oldest once exceeded. The throttle check
// and trim both run as plain SQL against created_at/id directly, deliberately
// avoiding any JS-side parsing of SQLite's `datetime('now')` string (no
// timezone marker on it — easy to get wrong comparing it to `Date.now()`).
const VERSION_GAP = '-10 minutes';
const VERSION_CAP = 50;
const qRecentVersion = db.prepare(
  `SELECT id FROM design_versions WHERE design_id = ? AND created_at > datetime('now', ?) LIMIT 1`
);
const qInsertVersion = db.prepare(
  `INSERT INTO design_versions (design_id, width, height, pages, data_json, thumbnail)
   VALUES (@design_id, @width, @height, @pages, @data_json, @thumbnail)`
);
const qTrimVersions = db.prepare(
  `DELETE FROM design_versions WHERE design_id = ? AND id NOT IN (
     SELECT id FROM design_versions WHERE design_id = ? ORDER BY id DESC LIMIT ?
   )`
);
const qListVersions = db.prepare(
  `SELECT id, width, height, pages, thumbnail, created_at FROM design_versions
   WHERE design_id = ? ORDER BY id DESC LIMIT ?`
);
const qGetVersion = db.prepare('SELECT * FROM design_versions WHERE id = ? AND design_id = ?');

// `design` is a plain {id, width, height, pages, data_json, thumbnail} object
// (the row's just-saved new state) — pass { force: true } to bypass the
// throttle, used once before applying a restore so the pre-restore state is
// never lost even if it falls inside the same 10-minute window.
function snapshotDesignVersion(design, opts) {
  opts = opts || {};
  if (!design.data_json) return;
  if (!opts.force && qRecentVersion.get(design.id, VERSION_GAP)) return;
  qInsertVersion.run({
    design_id: design.id, width: design.width, height: design.height,
    pages: design.pages, data_json: design.data_json, thumbnail: design.thumbnail,
  });
  qTrimVersions.run(design.id, design.id, VERSION_CAP);
}
function listDesignVersions(designId) {
  return qListVersions.all(designId, VERSION_CAP);
}
function getDesignVersion(designId, versionId) {
  return qGetVersion.get(versionId, designId);
}

module.exports = {
  db,
  EMAIL_RE,
  createUser,
  getUserById,
  getUserByEmail,
  verifyUser,
  verifyUserById,
  setUserLang,
  updateProfile,
  setUserPassword,
  deleteUser,
  setResetCode,
  verifyResetCode,
  clearResetCode,
  saveUserTemplate,
  deleteUserTemplate,
  snapshotDesignVersion,
  listDesignVersions,
  getDesignVersion,
};
