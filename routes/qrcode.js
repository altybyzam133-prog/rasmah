'use strict';

/* QR code generator (editor "QR" panel). Returned as a data: URL — unlike
   stock photos/AI images, a data URL never taints the canvas, so there's no
   need to save it to disk/the uploads table at all; the client hands it
   straight to fabric.Image.fromURL(). */

const express = require('express');
const QRCode = require('qrcode');
const { requireUser } = require('../lib/auth');
const { qrLimiter } = require('../lib/rate-limit');

const router = express.Router();
router.use(requireUser);
router.use(qrLimiter);

const MAX_TEXT = 1000;

router.post('/', async (req, res) => {
  const text = String((req.body && req.body.text) || '').trim().slice(0, MAX_TEXT);
  if (!text) return res.status(400).json({ error: 'bad_text' });
  try {
    const url = await QRCode.toDataURL(text, {
      width: 512,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#000000ff', light: '#ffffffff' },
    });
    res.json({ url });
  } catch (err) {
    res.status(500).json({ error: 'qr_failed' });
  }
});

module.exports = router;
