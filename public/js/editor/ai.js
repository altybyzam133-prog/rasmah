'use strict';

/* ============================================================================
   AI image generation ("AI" tab) + AI-assisted editing of the selected image
   (image properties panel). Calls the server's /api/ai/* routes, which proxy
   to Pollinations.ai (free, no key needed). Rate-limited per user per day
   server-side.
   ========================================================================== */

(function () {
  const ED = window.ED;
  const canvas = ED.canvas;
  const CSRF = document.querySelector('meta[name="csrf-token"]').content;

  function errorMessage(status, body) {
    if (status === 429) return ED.i18n.aiQuota;
    return (body && body.message) || ED.i18n.aiError;
  }

  async function callApi(path, payload) {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': CSRF },
      body: JSON.stringify(payload),
    });
    let body = null;
    try { body = await res.json(); } catch (e) { /* ignore */ }
    if (!res.ok) throw new Error(errorMessage(res.status, body));
    return body;
  }

  /* ---- generate (AI tab) --------------------------------------------------- */
  const promptEl = document.getElementById('aiPrompt');
  const generateBtn = document.getElementById('aiGenerateBtn');
  const generateHint = document.getElementById('aiGenerateHint');
  const resultGrid = document.getElementById('aiResultGrid');

  function addResultThumb(url) {
    const div = document.createElement('div');
    div.className = 'ed-upload-thumb';
    div.draggable = true;
    div.dataset.url = url;
    div.innerHTML = `<img src="${url}" alt="" loading="lazy">`;
    div.addEventListener('click', () => addImageToCanvas(url));
    resultGrid.prepend(div);
  }

  function addImageToCanvas(url) {
    fabric.Image.fromURL(url, (img) => {
      if (!img || !img.width) return;
      const target = ED.W * 0.6;
      const scale = Math.min(1, target / img.width);
      img.set({ scaleX: scale, scaleY: scale });
      ED.addObject(img);
    });
  }

  if (generateBtn) {
    generateBtn.addEventListener('click', async () => {
      const prompt = (promptEl.value || '').trim();
      if (!prompt) return;
      generateBtn.disabled = true;
      generateHint.textContent = ED.i18n.aiWorking || '…';
      try {
        const result = await callApi('/api/ai/generate', { prompt });
        addResultThumb(result.url);
        addImageToCanvas(result.url);
        if (ED.loadUploads) ED.loadUploads(true);
        generateHint.textContent = '';
      } catch (e) {
        generateHint.textContent = e.message;
      } finally {
        generateBtn.disabled = false;
      }
    });
  }

})();
