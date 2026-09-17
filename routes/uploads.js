'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');
const multer = require('multer');

const config = require('../lib/config');
const { db } = require('../lib/db');
const { requireUser } = require('../lib/auth');

const router = express.Router();
router.use(requireUser);

const UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads');
// existsSync guard: see server.js's own copy of this comment — a plain
// recursive mkdirSync throws ENOENT when the target is already a symlink
// (true on a cloud deploy with a mounted volume), not a no-op like it would
// be for a real directory.
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/svg+xml': '.svg',
};

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = ALLOWED[file.mimetype] || path.extname(file.originalname) || '.bin';
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => cb(null, Boolean(ALLOWED[file.mimetype])),
});

const qInsert = db.prepare(
  `INSERT INTO uploads (user_id, url, original_name, mime, size)
   VALUES (@user_id, @url, @original_name, @mime, @size)`
);
const qList = db.prepare(
  'SELECT id, url, original_name, created_at FROM uploads WHERE user_id = ? ORDER BY created_at DESC'
);
const qGet = db.prepare('SELECT * FROM uploads WHERE id = ? AND user_id = ?');
const qDelete = db.prepare('DELETE FROM uploads WHERE id = ? AND user_id = ?');

// optional: downscale/recompress big raster uploads so designs stay light
let sharp = null;
try { sharp = require('sharp'); } catch { /* not installed — keep originals */ }
const MAX_DIM = 2400;

async function optimize(absPath, mime) {
  if (!sharp || !/image\/(png|jpeg|webp)/.test(mime)) return;
  try {
    const before = fs.statSync(absPath).size;
    const img = sharp(absPath, { failOn: 'none' }).rotate();
    const meta = await img.metadata();
    let pipeline = img;
    if ((meta.width || 0) > MAX_DIM || (meta.height || 0) > MAX_DIM) {
      pipeline = pipeline.resize({ width: MAX_DIM, height: MAX_DIM, fit: 'inside', withoutEnlargement: true });
    }
    if (mime === 'image/jpeg') pipeline = pipeline.jpeg({ quality: 82, mozjpeg: true });
    else if (mime === 'image/webp') pipeline = pipeline.webp({ quality: 82 });
    else pipeline = pipeline.png({ compressionLevel: 9, palette: true });
    const buf = await pipeline.toBuffer();
    if (buf.length && buf.length <= before) fs.writeFileSync(absPath, buf);
  } catch { /* leave the original in place */ }
}

router.get('/', (req, res) => {
  res.json({ uploads: qList.all(res.locals.user.id) });
});

router.post('/', upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no_file' });
  const abs = path.join(UPLOAD_DIR, req.file.filename);
  await optimize(abs, req.file.mimetype);
  const size = fs.existsSync(abs) ? fs.statSync(abs).size : req.file.size;
  const url = `/static/uploads/${req.file.filename}`;
  const info = qInsert.run({
    user_id: res.locals.user.id,
    url,
    original_name: String(req.file.originalname || '').slice(0, 200),
    mime: req.file.mimetype,
    size,
  });
  res.json({ id: info.lastInsertRowid, url });
});

router.delete('/:id', (req, res) => {
  const row = qGet.get(Number(req.params.id), res.locals.user.id);
  if (row) {
    qDelete.run(row.id, res.locals.user.id);
    const abs = path.join(UPLOAD_DIR, path.basename(row.url));
    fs.promises.unlink(abs).catch(() => {});
  }
  res.json({ ok: true });
});

module.exports = router;
