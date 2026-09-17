'use strict';

/* ============================================================================
   Standalone "Decompose" tab — upload a photo directly (without first placing
   it on the canvas), see the detected objects listed one by one, and either
   extract a piece onto its own layer or erase it from the working photo.
   Reuses the detect+extract+render core from decompose.js, the same split
   removebg-tab.js uses for bgremoval.js.
   ========================================================================== */

(function () {
  const ED = window.ED;

  const dropZone = document.getElementById('decomposeTabDrop');
  const dropInput = document.getElementById('decomposeTabInput');
  const preview = document.getElementById('decomposeTabPreview');
  const previewImg = document.getElementById('decomposeTabImg');
  const runBtn = document.getElementById('decomposeTabRun');
  const hint = document.getElementById('decomposeTabHint');
  const results = document.getElementById('decomposeTabResults');
  if (!dropZone || !dropInput || !runBtn) return;

  if (!ED.decomposeAvailable) {
    dropZone.classList.add('disabled');
    hint.textContent = ED.i18n.decomposeUnavailable || '';
    return;
  }

  // The working copy of the uploaded photo. Kept as a canvas (not just an
  // <img>) so an "erase" action can punch a transparent hole straight into
  // it — later extractions/erasures on this same source then see the result.
  let workCanvas = null;

  function refreshPreview() {
    previewImg.src = workCanvas.toDataURL('image/png');
  }

  function loadSourceFromImg(img) {
    workCanvas = document.createElement('canvas');
    workCanvas.width = img.naturalWidth || img.width;
    workCanvas.height = img.naturalHeight || img.height;
    workCanvas.getContext('2d').drawImage(img, 0, 0);
    refreshPreview();
    preview.hidden = false;
    results.hidden = true;
    results.innerHTML = '';
    hint.textContent = '';
  }

  function loadSource(file) {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { loadSourceFromImg(img); URL.revokeObjectURL(url); };
    img.onerror = () => { hint.textContent = ED.i18n.decomposeError || ''; URL.revokeObjectURL(url); };
    img.src = url;
  }

  // "or use a photo already in your design" — skips a redundant re-upload of
  // the same picture the user already placed on the canvas, background image
  // included (see ED.canvasImages in objects.js). The grid is rebuilt each
  // time this tab is opened, since what's on the canvas can change between
  // visits.
  const canvasPick = document.getElementById('decomposeTabCanvasPick');
  const canvasGrid = document.getElementById('decomposeTabCanvasGrid');
  let canvasPickImages = [];
  function renderCanvasPick() {
    if (!canvasPick || !canvasGrid) return;
    canvasPickImages = ED.canvasImages ? ED.canvasImages(true) : [];
    canvasPick.hidden = canvasPickImages.length === 0;
    canvasGrid.innerHTML = canvasPickImages
      .map((it, i) => `<div class="ed-upload-thumb" data-i="${i}"><img src="${it.url}" alt=""></div>`)
      .join('');
  }
  document.querySelector('.ed-tab[data-tab="decompose"]')?.addEventListener('click', renderCanvasPick);
  renderCanvasPick();
  canvasGrid?.addEventListener('click', (e) => {
    const thumb = e.target.closest('.ed-upload-thumb');
    if (!thumb) return;
    const src = canvasPickImages[Number(thumb.dataset.i)];
    if (!src) return;
    const img = new Image();
    img.onload = () => loadSourceFromImg(img);
    img.onerror = () => { hint.textContent = ED.i18n.decomposeError || ''; };
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

  runBtn.addEventListener('click', async () => {
    if (!workCanvas) return;
    runBtn.disabled = true;
    hint.textContent = ED.i18n.decomposeWorking || '…';
    results.hidden = true;
    try {
      const sw = workCanvas.width, sh = workCanvas.height;
      const src = document.createElement('canvas');
      src.width = sw; src.height = sh;
      src.getContext('2d').drawImage(workCanvas, 0, 0);

      const boxes = await ED.detectElements(src);
      if (!boxes.length) {
        hint.textContent = ED.i18n.decomposeNone || '';
        return;
      }

      // Same centred, fit-to-60%-width placement AI-generate and remove-bg
      // results land at when they're added fresh (not from an existing
      // canvas object), preserving the pieces' relative layout.
      const target = ED.W * 0.6;
      const scale = Math.min(1, target / sw);
      const frame = {
        left: ED.W / 2 - (sw * scale) / 2,
        top: ED.H / 2 - (sh * scale) / 2,
        scaleX: scale, scaleY: scale,
      };

      function eraseFromWorkCanvas(b) {
        workCanvas.getContext('2d').clearRect(b.bx, b.by, b.bw, b.bh);
        refreshPreview();
        return Promise.resolve();
      }

      hint.textContent = '';
      ED.decomposeRenderResults(results, src, boxes, frame, eraseFromWorkCanvas);
    } catch (e) {
      console.error('[decompose-tab]', e);
      hint.textContent = ED.i18n.decomposeError || '';
    } finally {
      runBtn.disabled = false;
    }
  });
})();
