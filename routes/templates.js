'use strict';

const express = require('express');
const { db, saveUserTemplate, deleteUserTemplate } = require('../lib/db');
const { requireUser } = require('../lib/auth');

const router = express.Router();
router.use(requireUser);

// global templates (user_id NULL) + this user's own personal ones (category
// 'mine' — never used by admin-managed templates, so it doubles as a filter
// chip in the editor's Templates panel with no extra client-side logic).
const qList = db.prepare(
  `SELECT id, slug, name_ar, name_en, category, width, height, thumbnail
   FROM templates WHERE active = 1 AND (user_id IS NULL OR user_id = ?) ORDER BY sort_order, id`
);
const qGet = db.prepare(
  'SELECT * FROM templates WHERE id = ? AND active = 1 AND (user_id IS NULL OR user_id = ?)'
);

router.get('/', (req, res) => {
  res.json({ templates: qList.all(res.locals.user.id) });
});

router.get('/:id', (req, res) => {
  const t = qGet.get(Number(req.params.id), res.locals.user.id);
  if (!t) return res.status(404).json({ error: 'not_found' });
  res.json({ template: t });
});

// ---- save the current page as a personal template --------------------------
router.post('/', (req, res) => {
  const b = req.body || {};
  const width = Math.round(Number(b.width));
  const height = Math.round(Number(b.height));
  let dataJson;
  try { dataJson = JSON.parse(b.data_json); } catch { dataJson = null; }
  if (!dataJson || !Number.isFinite(width) || width < 16 || !Number.isFinite(height) || height < 16) {
    return res.status(400).json({ error: 'bad_request' });
  }
  const name = String(b.name || '').trim().slice(0, 120) || res.locals.t('common_untitled');
  const thumbnail = String(b.thumbnail || '').startsWith('data:image/') ? String(b.thumbnail).slice(0, 400_000) : '';
  const tpl = saveUserTemplate({
    userId: res.locals.user.id,
    name,
    width,
    height,
    dataJson: b.data_json,
    thumbnail,
  });
  res.json({ template: tpl });
});

// ---- remove one of your own personal templates ------------------------------
router.delete('/:id', (req, res) => {
  const ok = deleteUserTemplate(Number(req.params.id), res.locals.user.id);
  if (!ok) return res.status(404).json({ error: 'not_found' });
  res.json({ ok: true });
});

module.exports = router;
