'use strict';

/* ============================================================================
   Magic Write — short AI-drafted on-design copy (Text tab). Replaces the
   currently selected text object's content if one is selected, otherwise adds
   a new text object (reusing ED.addText's normal font/direction/size setup —
   inserted at the "body" size, same as a manually-added body text).
   ========================================================================== */

(function () {
  const ED = window.ED;
  const promptEl = document.getElementById('mwPrompt');
  const toneEl = document.getElementById('mwTone');
  const btn = document.getElementById('mwGenerate');
  const hint = document.getElementById('mwHint');
  if (!promptEl || !btn) return;
  const CSRF = document.querySelector('meta[name="csrf-token"]').content;
  const I = ED.i18n || {};

  btn.addEventListener('click', async () => {
    const prompt = promptEl.value.trim();
    if (!prompt) { hint.textContent = I.mwEmpty || ''; return; }
    btn.disabled = true;
    hint.textContent = I.mwWorking || '';
    try {
      const res = await fetch('/api/ai/write', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': CSRF },
        body: JSON.stringify({ prompt, tone: toneEl.value }),
      });
      const j = await res.json();
      if (res.status === 429) { hint.textContent = I.mwQuota || ''; return; }
      if (!res.ok || !j.text) throw new Error(j.error || 'failed');

      const active = ED.canvas.getActiveObject();
      if (active && (active.type === 'textbox' || active.type === 'i-text' || active.type === 'text')) {
        active.set('text', j.text);
        active.setCoords();
        ED.canvas.requestRenderAll();
        ED.record();
      } else if (ED.addText) {
        ED.addText('body', j.text);
      }
      hint.textContent = '';
    } catch (err) {
      hint.textContent = I.mwError || '';
    } finally {
      btn.disabled = false;
    }
  });
})();
