'use strict';

/* ============================================================================
   Standalone "Remove Background" tab — upload a photo (from disk, or a phone's
   camera/gallery via the native file picker) and cut it out directly, without
   first having to place it on the canvas. Reuses the core from bgremoval.js.
   ========================================================================== */

(function () {
  const ED = window.ED;

  const dropZone = document.getElementById('removeBgTabDrop');
  const dropInput = document.getElementById('removeBgTabInput');
  const preview = document.getElementById('removeBgTabPreview');
  const previewImg = document.getElementById('removeBgTabImg');
  const opts = document.getElementById('removeBgTabOpts');
  const imageBtn = document.getElementById('removeBgTabImageBtn');
  const imageInput = document.getElementById('removeBgTabImageInput');
  const hint = document.getElementById('removeBgTabHint');
  if (!dropZone || !dropInput || !opts) return;

  if (!ED.bgRemovalAvailable) {
    dropZone.classList.add('disabled');
    hint.textContent = ED.i18n.removeBgUnavailable || '';
    return;
  }

  let sourceEl = null;

  function loadSourceFromImg(img) {
    sourceEl = img;
    previewImg.src = img.src;
    preview.hidden = false;
    hint.textContent = '';
  }

  function loadSource(file) {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { loadSourceFromImg(img); URL.revokeObjectURL(url); };
    img.onerror = () => { hint.textContent = ED.i18n.removeBgError || ''; URL.revokeObjectURL(url); };
    img.src = url;
  }

  // "or use a photo already in your design" — see ED.canvasImages in objects.js
  // (background image included, so this tab's own icon can act on it too).
  const canvasPick = document.getElementById('removeBgTabCanvasPick');
  const canvasGrid = document.getElementById('removeBgTabCanvasGrid');
  let canvasPickImages = [];
  function renderCanvasPick() {
    if (!canvasPick || !canvasGrid) return;
    canvasPickImages = ED.canvasImages ? ED.canvasImages(true) : [];
    canvasPick.hidden = canvasPickImages.length === 0;
    canvasGrid.innerHTML = canvasPickImages
      .map((it, i) => `<div class="ed-upload-thumb" data-i="${i}"><img src="${it.url}" alt=""></div>`)
      .join('');
  }
  document.querySelector('.ed-tab[data-tab="removebg"]')?.addEventListener('click', renderCanvasPick);
  renderCanvasPick();
  canvasGrid?.addEventListener('click', (e) => {
    const thumb = e.target.closest('.ed-upload-thumb');
    if (!thumb) return;
    const src = canvasPickImages[Number(thumb.dataset.i)];
    if (!src) return;
    const img = new Image();
    img.onload = () => loadSourceFromImg(img);
    img.onerror = () => { hint.textContent = ED.i18n.removeBgError || ''; };
    img.src = src.url;
  });

  dropInput.addEventListener('change', () => { loadSource(dropInput.files[0]); dropInput.value = ''; });
  ['dragover', 'dragenter'].forEach((ev) =>
    dropZone.addEventListener(ev, (e) => { e.preventDefault(); dropZone.classList.add('drag'); })
  );
  ['dragleave', 'drop'].forEach((ev) =>
    dropZone.addEventListener(ev, (e) => { e.preventDefault(); if (ev === 'dragleave') dropZone.classList.remove('drag'); })
  );
  dropZone.addEventListener('drop', (e) => {
    dropZone.classList.remove('drag');
    loadSource(e.dataTransfer.files[0]);
  });

  async function run(mode, backdropEl) {
    if (!sourceEl) return;
    const busy = [...opts.querySelectorAll('button'), imageBtn];
    busy.forEach((b) => { b.disabled = true; });
    hint.textContent = ED.i18n.removeBgWorking || '…';
    try {
      const sw = sourceEl.naturalWidth, sh = sourceEl.naturalHeight;
      const dataUrl = await ED.removeBackground(sourceEl, 0, 0, sw, sh, mode, backdropEl);
      fabric.Image.fromURL(dataUrl, (img) => {
        if (!img || !img.width) return;
        const target = ED.W * 0.6;
        const scale = Math.min(1, target / img.width);
        img.set({ scaleX: scale, scaleY: scale });
        ED.addObject(img);
      });
      hint.textContent = '';
    } catch (e) {
      hint.textContent = ED.i18n.removeBgError || '';
    } finally {
      busy.forEach((b) => { b.disabled = false; });
    }
  }

  opts.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-mode]');
    if (!btn) return;
    run(btn.dataset.mode);
  });

  imageBtn.addEventListener('click', () => imageInput.click());
  imageInput.addEventListener('change', () => {
    const file = imageInput.files[0];
    imageInput.value = '';
    if (!file) return;
    const url = URL.createObjectURL(file);
    const backdropImg = new Image();
    backdropImg.onload = () => { run('image', backdropImg); URL.revokeObjectURL(url); };
    backdropImg.onerror = () => URL.revokeObjectURL(url);
    backdropImg.src = url;
  });
})();
