'use strict';

const crypto = require('crypto');
const express = require('express');
const config = require('../lib/config');
const { db } = require('../lib/db');

const router = express.Router();

const CATS = ['social', 'presentation', 'business', 'marketing', 'personal', 'other'];

function localOnlyOk(req) {
  if (!config.adminLocalOnly) return true;
  const ip = req.socket.remoteAddress || '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

function timingEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

router.use((req, res, next) => {
  if (!config.adminPassword) return res.status(404).render('404');
  if (!localOnlyOk(req)) return res.status(403).render('error', { message: 'Admin is restricted to localhost.' });
  res.locals.pageTitle = 'Admin';
  next();
});

router.get('/login', (req, res) => {
  if (req.session.isAdmin) return res.redirect('/admin');
  res.render('admin/login', { error: null });
});

router.post('/login', (req, res) => {
  if (timingEqual(req.body.password || '', config.adminPassword)) {
    req.session.isAdmin = true;
    return res.redirect('/admin');
  }
  res.status(401).render('admin/login', { error: 'كلمة المرور غير صحيحة / Wrong password' });
});

router.post('/logout', (req, res) => {
  req.session.isAdmin = false;
  res.redirect('/admin/login');
});

router.use((req, res, next) => {
  if (!req.session.isAdmin) return res.redirect('/admin/login');
  next();
});

const qList = db.prepare(
  'SELECT id, slug, name_ar, name_en, category, width, height, sort_order, active FROM templates WHERE user_id IS NULL ORDER BY sort_order, id'
);
const qUpdate = db.prepare(
  `UPDATE templates SET name_ar = @name_ar, name_en = @name_en, category = @category,
   sort_order = @sort_order, active = @active WHERE id = @id AND user_id IS NULL`
);
const qDelete = db.prepare('DELETE FROM templates WHERE id = ? AND user_id IS NULL');
const qInsert = db.prepare(
  `INSERT INTO templates (slug, name_ar, name_en, category, width, height, thumbnail, data_json, sort_order, active)
   VALUES (@slug, @name_ar, @name_en, @category, @width, @height, '', @data_json, @sort_order, 1)`
);

router.get('/', (req, res) => {
  res.render('admin/index', { templates: qList.all(), cats: CATS, ok: req.query.ok || null, error: null });
});

router.post('/templates/:id', (req, res) => {
  const b = req.body;
  qUpdate.run({
    id: Number(req.params.id),
    name_ar: String(b.name_ar || '').slice(0, 120),
    name_en: String(b.name_en || '').slice(0, 120),
    category: CATS.includes(b.category) ? b.category : 'other',
    sort_order: Number(b.sort_order) || 0,
    active: b.active ? 1 : 0,
  });
  res.redirect('/admin?ok=1');
});

router.post('/templates/:id/delete', (req, res) => {
  qDelete.run(Number(req.params.id));
  res.redirect('/admin?ok=1');
});

router.post('/import', (req, res) => {
  const b = req.body;
  let parsed;
  try { parsed = JSON.parse(b.data_json); } catch { parsed = null; }
  const w = Number(b.width) || 0;
  const h = Number(b.height) || 0;
  const slug = String(b.slug || '').trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!parsed || !parsed.objects || !w || !h || !slug) {
    return res.status(400).render('admin/index', {
      templates: qList.all(), cats: CATS, ok: null,
      error: 'يلزم slug صحيح + أبعاد + JSON فيه objects / need valid slug, size and a JSON with objects',
    });
  }
  try {
    qInsert.run({
      slug, name_ar: String(b.name_ar || slug).slice(0, 120), name_en: String(b.name_en || slug).slice(0, 120),
      category: CATS.includes(b.category) ? b.category : 'other',
      width: w, height: h, data_json: JSON.stringify(parsed),
      sort_order: Number(b.sort_order) || 999,
    });
  } catch (err) {
    return res.status(400).render('admin/index', {
      templates: qList.all(), cats: CATS, ok: null,
      error: String(err.message).includes('UNIQUE') ? 'هذا الـ slug مستخدم / slug already exists' : String(err.message),
    });
  }
  res.redirect('/admin?ok=1');
});

module.exports = router;
