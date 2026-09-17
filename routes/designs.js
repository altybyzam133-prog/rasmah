'use strict';

const crypto = require('crypto');
const express = require('express');
const { db, snapshotDesignVersion, listDesignVersions, getDesignVersion } = require('../lib/db');
const { requireUser } = require('../lib/auth');

const router = express.Router();
router.use(requireUser);

const qSetShare = db.prepare("UPDATE designs SET share_token = @tok WHERE id = @id AND user_id = @user_id");
const qSetPublic = db.prepare('UPDATE designs SET is_public = @val WHERE id = @id AND user_id = @user_id');

const qList = db.prepare(
  `SELECT id, title, width, height, thumbnail, pages, folder, is_public, created_at, updated_at
   FROM designs WHERE user_id = ? ORDER BY updated_at DESC`
);
const qGet = db.prepare('SELECT * FROM designs WHERE id = ? AND user_id = ?');
const qInsert = db.prepare(
  `INSERT INTO designs (user_id, title, width, height, data_json, thumbnail, pages, folder)
   VALUES (@user_id, @title, @width, @height, @data_json, @thumbnail, @pages, @folder)`
);
const qUpdate = db.prepare(
  `UPDATE designs SET title = @title, data_json = @data_json, thumbnail = @thumbnail, pages = @pages,
   width = @width, height = @height, folder = @folder, updated_at = datetime('now') WHERE id = @id AND user_id = @user_id`
);
const qMeta = db.prepare(
  `UPDATE designs SET title = @title, folder = @folder, updated_at = datetime('now')
   WHERE id = @id AND user_id = @user_id`
);
const qDelete = db.prepare('DELETE FROM designs WHERE id = ? AND user_id = ?');
const qTemplate = db.prepare('SELECT * FROM templates WHERE id = ? AND active = 1 AND (user_id IS NULL OR user_id = ?)');

const MIN = 16;
const MAX = 8000;
const clampDim = (n, d) => {
  n = Math.round(Number(n));
  return Number.isFinite(n) ? Math.min(MAX, Math.max(MIN, n)) : d;
};
const cleanTitle = (s, fallback) =>
  (String(s == null ? '' : s).trim().slice(0, 120)) || fallback;
const cleanFolder = (s) => String(s == null ? '' : s).trim().slice(0, 60);
const clampPages = (n, d) => {
  n = Math.round(Number(n));
  return Number.isFinite(n) ? Math.min(200, Math.max(1, n)) : d;
};

// ---- list ---------------------------------------------------------------------
router.get('/', (req, res) => {
  res.json({ designs: qList.all(res.locals.user.id) });
});

// ---- create -----------------------------------------------------------------
router.post('/', (req, res) => {
  const b = req.body || {};
  let width = clampDim(b.width, 1080);
  let height = clampDim(b.height, 1080);
  let dataJson = '';
  let thumbnail = '';
  let title = cleanTitle(b.title, res.locals.t('common_untitled'));

  if (b.fromTemplate) {
    const tpl = qTemplate.get(Number(b.fromTemplate), res.locals.user.id);
    if (!tpl) return res.status(404).json({ error: 'template_not_found' });
    width = tpl.width;
    height = tpl.height;
    dataJson = tpl.data_json;
    thumbnail = tpl.thumbnail || '';
    title = cleanTitle(b.title, res.locals.field(tpl, 'name'));
  }

  const info = qInsert.run({
    user_id: res.locals.user.id,
    title,
    width,
    height,
    data_json: dataJson,
    thumbnail,
    pages: 1,
    folder: cleanFolder(b.folder),
  });
  res.json({ id: info.lastInsertRowid });
});

// ---- read -------------------------------------------------------------------
router.get('/:id', (req, res) => {
  const d = qGet.get(Number(req.params.id), res.locals.user.id);
  if (!d) return res.status(404).json({ error: 'not_found' });
  res.json({ design: d });
});

// ---- save -----------------------------------------------------------------
router.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  const d = qGet.get(id, res.locals.user.id);
  if (!d) return res.status(404).json({ error: 'not_found' });
  const b = req.body || {};

  if (b.data_json === undefined && b.thumbnail === undefined && (b.title !== undefined || b.folder !== undefined)) {
    qMeta.run({
      id, user_id: res.locals.user.id,
      title: b.title === undefined ? d.title : cleanTitle(b.title, d.title),
      folder: b.folder === undefined ? d.folder : cleanFolder(b.folder),
    });
    return res.json({ ok: true });
  }

  const dataJson =
    b.data_json === undefined ? d.data_json : String(b.data_json).slice(0, 6_000_000);
  const thumbnail =
    b.thumbnail === undefined
      ? d.thumbnail
      : String(b.thumbnail || '').startsWith('data:image/')
      ? String(b.thumbnail).slice(0, 400_000)
      : d.thumbnail;
  const title = b.title === undefined ? d.title : cleanTitle(b.title, d.title);
  const pages = b.pages === undefined ? d.pages : clampPages(b.pages, d.pages);
  const width = b.width === undefined ? d.width : clampDim(b.width, d.width);
  const height = b.height === undefined ? d.height : clampDim(b.height, d.height);
  const folder = b.folder === undefined ? d.folder : cleanFolder(b.folder);

  qUpdate.run({ id, user_id: res.locals.user.id, title, data_json: dataJson, thumbnail, pages, width, height, folder });
  snapshotDesignVersion({ id, width, height, pages, data_json: dataJson, thumbnail });
  res.json({ ok: true });
});

// ---- version history --------------------------------------------------------
router.get('/:id/versions', (req, res) => {
  const id = Number(req.params.id);
  const d = qGet.get(id, res.locals.user.id);
  if (!d) return res.status(404).json({ error: 'not_found' });
  res.json({ versions: listDesignVersions(id) });
});

router.post('/:id/versions/:versionId/restore', (req, res) => {
  const id = Number(req.params.id);
  const d = qGet.get(id, res.locals.user.id);
  if (!d) return res.status(404).json({ error: 'not_found' });
  const v = getDesignVersion(id, Number(req.params.versionId));
  if (!v) return res.status(404).json({ error: 'version_not_found' });

  // capture the pre-restore state unconditionally, so restoring can never
  // lose whatever was live a moment ago even if it's within the throttle window
  snapshotDesignVersion(
    { id: d.id, width: d.width, height: d.height, pages: d.pages, data_json: d.data_json, thumbnail: d.thumbnail },
    { force: true }
  );

  qUpdate.run({
    id, user_id: res.locals.user.id, title: d.title, folder: d.folder,
    data_json: v.data_json, thumbnail: v.thumbnail, pages: v.pages, width: v.width, height: v.height,
  });
  res.json({ ok: true });
});

// ---- duplicate ------------------------------------------------------------
router.post('/:id/duplicate', (req, res) => {
  const d = qGet.get(Number(req.params.id), res.locals.user.id);
  if (!d) return res.status(404).json({ error: 'not_found' });
  const info = qInsert.run({
    user_id: res.locals.user.id,
    title: `${d.title} (${res.locals.t('common_duplicate')})`.slice(0, 120),
    width: d.width,
    height: d.height,
    data_json: d.data_json,
    thumbnail: d.thumbnail,
    pages: d.pages,
    folder: d.folder,
  });
  res.json({ id: info.lastInsertRowid });
});

// ---- delete -------------------------------------------------------------------
router.delete('/:id', (req, res) => {
  qDelete.run(Number(req.params.id), res.locals.user.id);
  res.json({ ok: true });
});

// ---- share link -------------------------------------------------------------
router.post('/:id/share', (req, res) => {
  const id = Number(req.params.id);
  const d = qGet.get(id, res.locals.user.id);
  if (!d) return res.status(404).json({ error: 'not_found' });
  let tok = d.share_token;
  if (!tok) {
    tok = crypto.randomBytes(12).toString('base64url');
    qSetShare.run({ id, user_id: res.locals.user.id, tok });
  }
  res.json({ token: tok, url: `/d/${tok}` });
});

router.delete('/:id/share', (req, res) => {
  qSetShare.run({ id: Number(req.params.id), user_id: res.locals.user.id, tok: null });
  res.json({ ok: true });
});

// ---- publish to the community gallery ---------------------------------------
// Deliberately immediate, no review/moderation step — matches this app's
// current scale (still single/few-user, per earlier sessions' notes) and was
// the explicit choice made when this feature was scoped. Unpublishing is
// entirely self-service (this same toggle, off) — no separate admin flow
// exists yet since none was asked for.
router.post('/:id/publish', (req, res) => {
  const id = Number(req.params.id);
  const d = qGet.get(id, res.locals.user.id);
  if (!d) return res.status(404).json({ error: 'not_found' });
  qSetPublic.run({ id, user_id: res.locals.user.id, val: 1 });
  res.json({ ok: true });
});

router.delete('/:id/publish', (req, res) => {
  const id = Number(req.params.id);
  const d = qGet.get(id, res.locals.user.id);
  if (!d) return res.status(404).json({ error: 'not_found' });
  qSetPublic.run({ id, user_id: res.locals.user.id, val: 0 });
  res.json({ ok: true });
});

module.exports = router;
