'use strict';

/* ============================================================================
   Background removal core — runs MediaPipe's selfie-segmenter fully
   client-side (Apache-2.0, self-hosted, no network round-trip). Lazily loads
   the ~10 MB Wasm runtime + model on first use, once per session. Exposes
   ED.removeBackground(el, sx, sy, sw, sh, mode, backdropEl) for reuse by both
   the image-properties-panel controls below and the standalone "Remove
   Background" tab (removebg-tab.js). Three outcomes: transparent cutout,
   cutout on a white backdrop, or cutout composited onto a picked image.
   ========================================================================== */

(function () {
  const ED = window.ED;
  const canvas = ED.canvas;
  const cfg = ED.data.bgRemoval || {};

  let segmenterPromise = null;
  function getSegmenter() {
    if (!segmenterPromise) {
      segmenterPromise = import(/* webpackIgnore: true */ cfg.bundleUrl).then(async (mod) => {
        const fileset = await mod.FilesetResolver.forVisionTasks(cfg.wasmBase);
        return mod.ImageSegmenter.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: cfg.modelPath },
          outputCategoryMask: false,
          outputConfidenceMasks: true,
          runningMode: 'IMAGE',
        });
      });
    }
    return segmenterPromise;
  }

  // segments an already-drawn sw x sh canvas and punches out alpha per the mask;
  // returns a new transparent-background canvas.
  async function segmentCutout(srcCanvas, sw, sh) {
    const segmenter = await getSegmenter();
    const result = segmenter.segment(srcCanvas);
    const mask = result.confidenceMasks && result.confidenceMasks[0];
    if (!mask) throw new Error('no segmentation mask returned');
    const maskData = mask.getAsFloat32Array();
    const mw = mask.width, mh = mask.height;

    const cut = document.createElement('canvas');
    cut.width = sw; cut.height = sh;
    const cctx = cut.getContext('2d');
    cctx.drawImage(srcCanvas, 0, 0);
    const frame = cctx.getImageData(0, 0, sw, sh);
    const data = frame.data;
    for (let y = 0; y < sh; y++) {
      const my = mh === sh ? y : Math.min(mh - 1, Math.floor((y / sh) * mh));
      const rowBase = my * mw;
      for (let x = 0; x < sw; x++) {
        const mx = mw === sw ? x : Math.min(mw - 1, Math.floor((x / sw) * mw));
        const a = maskData[rowBase + mx];
        const idx = (y * sw + x) * 4 + 3;
        data[idx] = Math.round(data[idx] * a);
      }
    }
    cctx.putImageData(frame, 0, 0);
    if (mask.close) mask.close();
    return cut;
  }

  // draws `backdropEl` scaled to cover sw x sh, centred (no distortion, may crop edges)
  function drawCover(ctx, backdropEl, sw, sh) {
    const bw = backdropEl.naturalWidth || backdropEl.width;
    const bh = backdropEl.naturalHeight || backdropEl.height;
    const scale = Math.max(sw / bw, sh / bh);
    const dw = bw * scale, dh = bh * scale;
    ctx.drawImage(backdropEl, (sw - dw) / 2, (sh - dh) / 2, dw, dh);
  }

  function applyBackdrop(cut, sw, sh, mode, backdropEl) {
    if (mode !== 'white' && !(mode === 'image' && backdropEl)) return cut;
    const out = document.createElement('canvas');
    out.width = sw; out.height = sh;
    const octx = out.getContext('2d');
    if (mode === 'white') {
      octx.fillStyle = '#ffffff';
      octx.fillRect(0, 0, sw, sh);
    } else {
      drawCover(octx, backdropEl, sw, sh);
    }
    octx.drawImage(cut, 0, 0);
    return out;
  }

  // full pipeline: crops `el` to sx,sy,sw,sh, cuts out the background, composites
  // the requested backdrop, and returns a PNG data URL.
  async function removeBackground(el, sx, sy, sw, sh, mode, backdropEl) {
    const src = document.createElement('canvas');
    src.width = sw; src.height = sh;
    src.getContext('2d').drawImage(el, sx, sy, sw, sh, 0, 0, sw, sh);
    const cut = await segmentCutout(src, sw, sh);
    const out = applyBackdrop(cut, sw, sh, mode, backdropEl);
    return out.toDataURL('image/png');
  }
  ED.bgRemovalAvailable = !!cfg.available;
  ED.removeBackground = removeBackground;

  // The pure mutation, reusable for any already-placed fabric.Image — a
  // regular canvas object OR the non-selectable background image (which can
  // never become the "active object", so it needs its own entry point
  // instead of re-uploading the same photo as a separate regular image).
  async function applyRemoveBgTo(img, mode, backdropEl) {
    const dataUrl = await removeBackground(img._element, img.cropX || 0, img.cropY || 0, img.width, img.height, mode, backdropEl);
    await new Promise((resolve, reject) => {
      img.setSrc(dataUrl, (loaded) => {
        if (!loaded) return reject(new Error('setSrc failed'));
        img.set({ cropX: 0, cropY: 0 });
        canvas.requestRenderAll();
        ED.record();
        resolve();
      }, { crossOrigin: 'anonymous' });
    });
  }

  /* ---- image-properties-panel controls (an image already placed on canvas) - */
  const row = document.getElementById('removeBgRow');
  const imageBtn = document.getElementById('removeBgImageBtn');
  const imageInput = document.getElementById('removeBgImageInput');

  /* ---- background-panel controls (the design's own background image) ----- */
  const bgRow = document.getElementById('bgRemoveBgRow');
  const bgImageBtn = document.getElementById('bgRemoveBgImageBtn');
  const bgImageInput = document.getElementById('bgRemoveBgImageInput');
  const bgHint = document.getElementById('bgRemoveBgHint');

  if (!row || !imageBtn || !imageInput) return;

  if (!cfg.available) {
    [...row.querySelectorAll('button'), imageBtn].forEach((b) => { b.disabled = true; });
    row.title = imageBtn.title = ED.i18n.removeBgUnavailable || '';
    if (bgRow) {
      [...bgRow.querySelectorAll('button'), bgImageBtn].forEach((b) => { b.disabled = true; });
      bgRow.title = bgImageBtn.title = ED.i18n.removeBgUnavailable || '';
    }
    return;
  }

  async function run(mode, backdropEl) {
    const img = canvas.getActiveObject();
    if (!img || img.type !== 'image' || !img._element) return;
    const busyEls = [...row.querySelectorAll('button'), imageBtn];
    const prevLabels = busyEls.map((b) => b.textContent);
    busyEls.forEach((b) => { b.disabled = true; });
    row.previousElementSibling.textContent = ED.i18n.removeBgWorking || '…';
    try {
      await applyRemoveBgTo(img, mode, backdropEl);
    } catch (e) {
      alert(ED.i18n.removeBgError || 'Failed');
    } finally {
      busyEls.forEach((b, i) => { b.disabled = false; b.textContent = prevLabels[i]; });
      row.previousElementSibling.textContent = ED.i18n.removeBgLabel || row.previousElementSibling.textContent;
    }
  }

  row.addEventListener('click', (e) => {
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

  if (bgRow && bgImageBtn && bgImageInput && bgHint) {
    async function runOnBg(mode, backdropEl) {
      const img = ED.getBgImage && ED.getBgImage();
      if (!img) { bgHint.textContent = ED.i18n.bgNoImage || ''; return; }
      const busyEls = [...bgRow.querySelectorAll('button'), bgImageBtn];
      busyEls.forEach((b) => { b.disabled = true; });
      bgHint.textContent = ED.i18n.removeBgWorking || '…';
      try {
        await applyRemoveBgTo(img, mode, backdropEl);
        bgHint.textContent = '';
      } catch (e) {
        bgHint.textContent = ED.i18n.removeBgError || '';
      } finally {
        busyEls.forEach((b) => { b.disabled = false; });
      }
    }
    bgRow.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-mode]');
      if (!btn) return;
      runOnBg(btn.dataset.mode);
    });
    bgImageBtn.addEventListener('click', () => bgImageInput.click());
    bgImageInput.addEventListener('change', () => {
      const file = bgImageInput.files[0];
      bgImageInput.value = '';
      if (!file) return;
      const url = URL.createObjectURL(file);
      const backdropImg = new Image();
      backdropImg.onload = () => { runOnBg('image', backdropImg); URL.revokeObjectURL(url); };
      backdropImg.onerror = () => URL.revokeObjectURL(url);
      backdropImg.src = url;
    });
  }
})();
