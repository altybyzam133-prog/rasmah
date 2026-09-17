'use strict';

const express = require('express');
const { db } = require('../lib/db');
const { requireUser } = require('../lib/auth');

const router = express.Router();
router.use(requireUser);

const qGet = db.prepare('SELECT colors, font_heading, font_body, logo_url FROM brand_kits WHERE user_id = ?');
const qUpsert = db.prepare(
  `INSERT INTO brand_kits (user_id, colors, font_heading, font_body, logo_url, updated_at)
   VALUES (@user_id, @colors, @font_heading, @font_body, @logo_url, datetime('now'))
   ON CONFLICT(user_id) DO UPDATE SET
     colors = excluded.colors, font_heading = excluded.font_heading,
     font_body = excluded.font_body, logo_url = excluded.logo_url,
     updated_at = datetime('now')`
);

const HEX = /^#[0-9a-fA-F]{3,8}$/;

router.get('/', (req, res) => {
  const row = qGet.get(res.locals.user.id) || { colors: '[]', font_heading: '', font_body: '', logo_url: '' };
  let colors = [];
  try { colors = JSON.parse(row.colors); } catch { colors = []; }
  res.json({
    brand: {
      colors: Array.isArray(colors) ? colors.slice(0, 12) : [],
      fontHeading: row.font_heading || '',
      fontBody: row.font_body || '',
      logoUrl: row.logo_url || '',
    },
  });
});

router.put('/', (req, res) => {
  const b = req.body || {};
  const colors = Array.isArray(b.colors)
    ? b.colors.filter((c) => typeof c === 'string' && HEX.test(c)).slice(0, 12)
    : [];
  const logo = typeof b.logoUrl === 'string' && b.logoUrl.startsWith('/static/uploads/') ? b.logoUrl : '';
  qUpsert.run({
    user_id: res.locals.user.id,
    colors: JSON.stringify(colors),
    font_heading: String(b.fontHeading || '').slice(0, 60),
    font_body: String(b.fontBody || '').slice(0, 60),
    logo_url: logo,
  });
  res.json({ ok: true });
});

module.exports = router;
