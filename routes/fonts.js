'use strict';

/* Custom fonts (editor Brand tab: "upload a custom font"). Font files are
   served statically like image uploads; browsers are frequently inconsistent
   about the MIME type they report for .ttf/.otf (often a generic
   application/octet-stream), so this validates by extension rather than
   trusting file.mimetype — the same practical concession most font-upload
   features make. Never executed server-side, just served as static bytes,
   so a disguised non-font file poses no more risk than any other upload. */

const path = require('path');
const fs = require('fs');
const express = require('express');
const multer = require('multer');
const { db } = require('../lib/db');
const { requireUser } = require('../lib/auth');

const router = express.Router();
router.use(requireUser);

const FONT_DIR = path.join(__dirname, '..', 'public', 'uploads', 'fonts');
// existsSync guard: see server.js's copy of this comment (symlink + recursive
// mkdirSync throws ENOENT on a cloud deploy with a mounted volume).
if (!fs.existsSync(FONT_DIR)) fs.mkdirSync(FONT_DIR, { recursive: true });

const ALLOWED_EXT = new Set(['.ttf', '.otf', '.woff', '.woff2']);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, FONT_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 6 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => cb(null, ALLOWED_EXT.has(path.extname(file.originalname).toLowerCase())),
});

const qInsert = db.prepare('INSERT INTO custom_fonts (user_id, family, url) VALUES (?, ?, ?)');
const qList = db.prepare('SELECT id, family, url FROM custom_fonts WHERE user_id = ? ORDER BY created_at DESC');
const qGet = db.prepare('SELECT * FROM custom_fonts WHERE id = ? AND user_id = ?');
const qDelete = db.prepare('DELETE FROM custom_fonts WHERE id = ? AND user_id = ?');

router.get('/', (req, res) => {
  res.json({ fonts: qList.all(res.locals.user.id) });
});

router.post('/', upload.single('font'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'bad_file' });
  const original = path.basename(req.file.originalname, path.extname(req.file.originalname));
  // letters (any script)/digits/space/-/_ only — strips anything that could
  // be a problem as a CSS font-family identifier, keeps Arabic names intact
  let family = String((req.body && req.body.family) || original || '')
    .trim().replace(/[^\p{L}\p{N} _-]/gu, '').slice(0, 60);
  if (!family) family = 'Custom Font';
  const url = `/static/uploads/fonts/${req.file.filename}`;
  const info = qInsert.run(res.locals.user.id, family, url);
  res.json({ id: info.lastInsertRowid, family, url });
});

router.delete('/:id', (req, res) => {
  const row = qGet.get(Number(req.params.id), res.locals.user.id);
  if (row) {
    qDelete.run(row.id, res.locals.user.id);
    fs.promises.unlink(path.join(FONT_DIR, path.basename(row.url))).catch(() => {});
  }
  res.json({ ok: true });
});

module.exports = router;
