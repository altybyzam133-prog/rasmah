'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');
const { db } = require('../lib/db');
const { requireUser } = require('../lib/auth');

const router = express.Router();

const VENDOR = path.join(__dirname, '..', 'public', 'vendor');
const MEDIAPIPE = path.join(VENDOR, 'mediapipe');
const COCO_MODEL = path.join(VENDOR, 'coco-ssd-model');
const MAGICGRAB = path.join(VENDOR, 'magicgrab');
const vendorLocal = {
  fabric: fs.existsSync(path.join(VENDOR, 'fabric.min.js')),
  jspdf: fs.existsSync(path.join(VENDOR, 'jspdf.umd.min.js')),
  tf: fs.existsSync(path.join(VENDOR, 'tf.min.js')),
  cocoSsd: fs.existsSync(path.join(VENDOR, 'coco-ssd.min.js')),
  bgRemoval: ['vision_bundle.mjs', 'vision_wasm_internal.js', 'vision_wasm_internal.wasm', 'selfie_segmenter.tflite']
    .every((f) => fs.existsSync(path.join(MEDIAPIPE, f))),
  // both required (not a CDN-fallback pair like fabric/jspdf above) — the
  // worker script a Worker() loads must always be same-origin, so without a
  // local gif.worker.js the feature can't work even if gif.js itself loaded fine.
  gif: fs.existsSync(path.join(VENDOR, 'gif.js')) && fs.existsSync(path.join(VENDOR, 'gif.worker.js')),
  zip: fs.existsSync(path.join(VENDOR, 'jszip.min.js')),
};
vendorLocal.decompose = vendorLocal.tf && vendorLocal.cocoSsd &&
  ['model.json', 'group1-shard1of5', 'group1-shard2of5', 'group1-shard3of5', 'group1-shard4of5', 'group1-shard5of5']
    .every((f) => fs.existsSync(path.join(COCO_MODEL, f)));
// Magic Grab: Foreground/Click modes need the SAM model + ONNX runtime;
// Brush mode needs neither (pure canvas painting, always available, same
// reasoning as the plain lasso tool needing no availability gate at all).
// Content-aware-fill (opencv.js) is its own separate, independently-optional
// flag — its absence just means "Grab" erases to transparent instead.
vendorLocal.magicGrabModel = ['ort.min.js', 'ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm',
  'mobilesam.encoder.onnx', 'mobilesam.decoder.onnx']
  .every((f) => fs.existsSync(path.join(MAGICGRAB, f)));
vendorLocal.magicGrabInpaint = fs.existsSync(path.join(MAGICGRAB, 'opencv.js'));

const CATEGORIES = ['social', 'presentation', 'business', 'marketing', 'personal'];

const qFeaturedTemplates = db.prepare(
  `SELECT id, slug, name_ar, name_en, category, width, height, thumbnail
   FROM templates WHERE active = 1 AND user_id IS NULL ORDER BY sort_order, id LIMIT 8`
);
const qAllTemplates = db.prepare(
  `SELECT id, slug, name_ar, name_en, category, width, height, thumbnail
   FROM templates WHERE active = 1 AND user_id IS NULL ORDER BY sort_order, id`
);
const qUserDesigns = db.prepare(
  `SELECT id, title, width, height, thumbnail, pages, folder, is_public, created_at, updated_at
   FROM designs WHERE user_id = ? ORDER BY updated_at DESC`
);
const qCommunityDesigns = db.prepare(
  `SELECT designs.id, designs.user_id, designs.title, designs.width, designs.height, designs.thumbnail, designs.updated_at,
          users.name AS author_name
   FROM designs JOIN users ON users.id = designs.user_id
   WHERE designs.is_public = 1
   ORDER BY designs.updated_at DESC`
);
const qCommunityDesignById = db.prepare('SELECT * FROM designs WHERE id = ? AND is_public = 1');
const qDesignOwned = db.prepare(
  'SELECT * FROM designs WHERE id = ? AND user_id = ?'
);

const qByShareToken = db.prepare(
  "SELECT id, title, width, height, data_json FROM designs WHERE share_token = ? AND share_token IS NOT NULL"
);

// ---- public read-only viewer --------------------------------------------
router.get('/d/:token', (req, res) => {
  const d = qByShareToken.get(String(req.params.token));
  if (!d) return res.status(404).render('404');
  res.render('view', {
    pageTitle: d.title || res.locals.t('ed_untitled'),
    design: d,
    vendorLocal,
    noindex: true,
  });
});

// ---- PWA manifest -------------------------------------------------------------
router.get('/manifest.webmanifest', (req, res) => {
  res.type('application/manifest+json');
  res.render('manifest');
});

// pre-cached by the service worker and shown for a navigation the network
// can't serve and the browser hasn't already cached a copy of.
router.get('/offline', (req, res) => {
  res.render('offline', { pageTitle: res.locals.t('offline_title') });
});

// ---- landing ----------------------------------------------------------------
router.get('/', (req, res) => {
  res.render('index', {
    pageTitle: null,
    templates: safeAll(qFeaturedTemplates),
  });
});

// ---- templates gallery ----------------------------------------------------
router.get('/templates', (req, res) => {
  const cat = CATEGORIES.includes(req.query.category) ? req.query.category : 'all';
  let list = safeAll(qAllTemplates);
  if (cat !== 'all') list = list.filter((t) => t.category === cat);
  res.render('templates', {
    pageTitle: res.locals.t('tpl_title'),
    templates: list,
    categories: CATEGORIES,
    activeCat: cat,
  });
});

// ---- auth pages ---------------------------------------------------------------
router.get('/login', (req, res) => {
  if (res.locals.user) return res.redirect('/dashboard');
  res.render('login', {
    pageTitle: res.locals.t('auth_login_title'),
    next: cleanNext(req.query.next),
    values: {},
    error: null,
  });
});

router.get('/register', (req, res) => {
  if (res.locals.user) return res.redirect('/dashboard');
  res.render('register', {
    pageTitle: res.locals.t('auth_register_title'),
    next: cleanNext(req.query.next),
    values: {},
    error: null,
  });
});

router.get('/forgot-password', (req, res) => {
  res.render('forgot-password', {
    pageTitle: res.locals.t('auth_forgot_title'),
    sent: false,
    values: {},
    error: null,
  });
});

// ---- dashboard -------------------------------------------------------------
router.get('/dashboard', requireUser, (req, res) => {
  res.render('dashboard', {
    pageTitle: res.locals.t('dash_title'),
    designs: qUserDesigns.all(res.locals.user.id),
  });
});

// ---- use a template: create a design from it, then open the editor --------
const qTemplateById = db.prepare('SELECT * FROM templates WHERE id = ? AND active = 1 AND (user_id IS NULL OR user_id = ?)');
const qInsertDesign = db.prepare(
  `INSERT INTO designs (user_id, title, width, height, data_json, thumbnail, pages)
   VALUES (@user_id, @title, @width, @height, @data_json, @thumbnail, @pages)`
);
router.get('/use-template/:id', requireUser, (req, res) => {
  const tpl = qTemplateById.get(Number(req.params.id), res.locals.user.id);
  if (!tpl) return res.status(404).render('404');
  const info = qInsertDesign.run({
    user_id: res.locals.user.id,
    title: res.locals.field(tpl, 'name'),
    width: tpl.width,
    height: tpl.height,
    data_json: tpl.data_json,
    thumbnail: tpl.thumbnail || '',
    pages: 1,
  });
  res.redirect(`/editor/${info.lastInsertRowid}`);
});

// ---- community gallery: designs users have chosen to publish --------------
// Separate from the admin-curated /templates gallery on purpose — these are
// real users' own finished designs, not vetted starting-point templates.
// Requires login to browse (the explicit choice made when this was scoped).
router.get('/community', requireUser, (req, res) => {
  res.render('community', {
    pageTitle: res.locals.t('community_title'),
    items: safeAll(qCommunityDesigns),
  });
});

router.get('/use-community/:id', requireUser, (req, res) => {
  const src = qCommunityDesignById.get(Number(req.params.id));
  if (!src) return res.status(404).render('404');
  const info = qInsertDesign.run({
    user_id: res.locals.user.id,
    title: src.title || res.locals.t('common_untitled'),
    width: src.width,
    height: src.height,
    data_json: src.data_json,
    thumbnail: src.thumbnail || '',
    pages: src.pages || 1,
  });
  res.redirect(`/editor/${info.lastInsertRowid}`);
});

// ---- editor -------------------------------------------------------------------
router.get('/editor/:id', requireUser, (req, res) => {
  const design = qDesignOwned.get(Number(req.params.id), res.locals.user.id);
  if (!design) return res.status(404).render('404');
  res.render('editor', {
    pageTitle: design.title || res.locals.t('ed_untitled'),
    design,
    vendorLocal,
    bodyClass: 'editor-body',
  });
});

function safeAll(stmt) {
  try {
    return stmt.all();
  } catch {
    return [];
  }
}
function cleanNext(n) {
  n = String(n || '');
  return n.startsWith('/') && !n.startsWith('//') ? n : '';
}

module.exports = router;
