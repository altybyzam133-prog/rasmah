'use strict';

/* Stock photo search (editor "Photos" panel) — Pexels' free API. Search
   results are just thumbnail URLs pointed straight at Pexels' own CDN (fine
   for browsing). Only when the user actually places one do we download it
   and re-host it under our own origin: core.js never sets crossOrigin on
   image loads (an earlier fix — see design-studio memory — removed it
   because it broke same-origin uploads), so any cross-origin image left on
   the canvas would taint it and break toDataURL()-based export/thumbnails.
   Same reason AI-generated images (routes/ai.js) are downloaded rather than
   linked directly. */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const config = require('../lib/config');
const { db } = require('../lib/db');
const { requireUser } = require('../lib/auth');
const { stockLimiter } = require('../lib/rate-limit');
const { translateIfArabic } = require('../lib/translate');
const { isExplicit } = require('../lib/safe-search');

const router = express.Router();
router.use(requireUser);
router.use(stockLimiter);

const UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads');
// existsSync guard: see server.js's copy of this comment (symlink + recursive
// mkdirSync throws ENOENT on a cloud deploy with a mounted volume).
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const qInsertUpload = db.prepare(
  `INSERT INTO uploads (user_id, url, original_name, mime, size) VALUES (@user_id, @url, @original_name, @mime, @size)`
);

router.get('/search', async (req, res) => {
  if (!config.pexelsApiKey) return res.json({ available: false, results: [] });
  const q = String(req.query.q || '').trim().slice(0, 100);
  if (!q) return res.json({ available: true, results: [] });
  if (isExplicit(q)) return res.json({ available: true, results: [], hasMore: false });
  const page = Math.max(1, Math.min(50, parseInt(req.query.page, 10) || 1));
  try {
    // Pexels' search only understands English — an Arabic query like "قطة"
    // returns nothing relevant (confirmed by the user), same underlying gap
    // already fixed for AI image prompts (routes/ai.js) via this same helper
    const searchQ = await translateIfArabic(q);
    if (isExplicit(searchQ)) return res.json({ available: true, results: [], hasMore: false });
    const r = await fetch(
      `https://api.pexels.com/v1/search?query=${encodeURIComponent(searchQ)}&page=${page}&per_page=24`,
      { headers: { Authorization: config.pexelsApiKey } }
    );
    if (!r.ok) throw new Error(`pexels HTTP ${r.status}`);
    const j = await r.json();
    const results = (j.photos || []).map((p) => ({
      id: p.id,
      thumb: (p.src && p.src.medium) || '',
      full: (p.src && (p.src.large2x || p.src.large || p.src.original)) || '',
      width: p.width,
      height: p.height,
      alt: p.alt || '',
      photographer: p.photographer || '',
    })).filter((p) => p.thumb && p.full && !isExplicit(p.alt));
    res.json({ available: true, results, hasMore: !!j.next_page });
  } catch (err) {
    res.status(502).json({ error: 'stock_failed', message: config.isProd ? undefined : err.message });
  }
});

router.post('/import', async (req, res) => {
  if (!config.pexelsApiKey) return res.status(503).json({ error: 'stock_unavailable' });
  const url = String((req.body && req.body.url) || '');
  // only ever fetch from Pexels' own image CDN — never an arbitrary URL a client could pass (SSRF guard)
  if (!/^https:\/\/images\.pexels\.com\//.test(url)) return res.status(400).json({ error: 'bad_url' });
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`pexels image HTTP ${r.status}`);
    const mime = r.headers.get('content-type') || 'image/jpeg';
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 200) throw new Error('empty image response');
    const ext = mime.includes('png') ? '.png' : '.jpg';
    const filename = `stock-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`;
    fs.writeFileSync(path.join(UPLOAD_DIR, filename), buf);
    const fileUrl = `/static/uploads/${filename}`;
    const info = qInsertUpload.run({
      user_id: res.locals.user.id,
      url: fileUrl,
      original_name: String((req.body && req.body.label) || 'stock photo').slice(0, 200),
      mime,
      size: buf.length,
    });
    res.json({ id: info.lastInsertRowid, url: fileUrl });
  } catch (err) {
    res.status(502).json({ error: 'stock_import_failed', message: config.isProd ? undefined : err.message });
  }
});

module.exports = router;
