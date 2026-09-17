'use strict';

/* ============================================================================
   QR code — editor "QR" panel (server generates a PNG data URL via `qrcode`)
   ========================================================================== */

(function () {
  const ED = window.ED;
  const CSRF = document.querySelector('meta[name="csrf-token"]').content;

  const text = document.getElementById('qrText');
  const btn = document.getElementById('qrInsertBtn');
  const hint = document.getElementById('qrHint');
  if (!text || !btn) return;

  const I = ED.i18n || {};

  btn.addEventListener('click', async () => {
    const value = text.value.trim();
    if (!value) { hint.textContent = I.qrEmpty || ''; return; }
    btn.disabled = true;
    hint.textContent = I.qrWorking || '';
    try {
      const res = await fetch('/api/qrcode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': CSRF },
        body: JSON.stringify({ text: value }),
      });
      const j = await res.json();
      if (!j.url) throw new Error('qr failed');
      fabric.Image.fromURL(j.url, (img) => {
        if (!img || !img.width) return;
        const target = ED.W * 0.28;
        const scale = Math.min(1, target / img.width);
        img.set({ scaleX: scale, scaleY: scale, name: 'qr' });
        ED.addObject(img);
        hint.textContent = '';
      });
    } catch (err) {
      hint.textContent = I.qrError || '';
    } finally {
      btn.disabled = false;
    }
  });
})();
