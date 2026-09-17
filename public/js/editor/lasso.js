'use strict';

/* ============================================================================
   "Freehand select" — manual lasso tool for cutting an arbitrary region out
   of a photo, independent of the auto-detection Decompose tool (which only
   recognizes COCO-SSD's fixed 80-class vocabulary). The user draws a closed
   shape directly on top of an image (a regular placed image OR the design's
   background image, the same two entry points Decompose/Remove-Background
   already offer) and can then:
     - extract that exact region onto its own new layer (transparent outside
       the drawn shape), or
     - erase that region from the photo it was drawn on,
   repeating as many times as they like in one session (drawing again after
   an action stays in the tool rather than closing it).

   No ML model, no vendor download — pure canvas path-clipping — so unlike
   Decompose/Remove-Background this needs no availability gating.

   Points are collected via canvas.getPointer(), which already returns
   coordinates in the same canvas OBJECT space that fabric object left/top
   use (unaffected by pan/zoom) — the same space img.getBoundingRect(true,
   true) (the "frame") is expressed in, mirroring decompose.js's own
   canvas-space <-> image-pixel-space mapping. Exact when the image isn't
   rotated, an approximation when it is (same accepted limitation
   decompose.js documents for the same reason).
   ========================================================================== */

(function () {
  const ED = window.ED;
  const canvas = ED.canvas;

  const workspace = document.getElementById('workspace');
  const bar = document.getElementById('lassobar');
  const hintEl = document.getElementById('lassoHint');
  const extractBtn = document.getElementById('lassoExtract');
  const eraseBtn = document.getElementById('lassoErase');
  const redrawBtn = document.getElementById('lassoRedraw');
  const doneBtn = document.getElementById('lassoDone');
  if (!bar) return;

  const MIN_DIST = 3; // canvas-object-space units between recorded points

  let drawing = false;
  let points = [];
  let previewObj = null;
  let activeImg = null;
  let srcCanvas = null;
  let frame = null;
  let savedSelection = true;
  let savedSkipTargetFind = false;
  let onMouseDown = null, onMouseMove = null, onMouseUp = null;

  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

  function clearPreview() {
    if (previewObj) { canvas.remove(previewObj); previewObj = null; }
  }

  function rebuildPreview(closed) {
    clearPreview();
    if (points.length < 2) return;
    const Ctor = closed ? fabric.Polygon : fabric.Polyline;
    previewObj = new Ctor(points.map((p) => ({ x: p.x, y: p.y })), {
      fill: closed ? 'rgba(124,92,255,0.18)' : 'transparent',
      stroke: '#7c5cff', strokeWidth: 2, strokeDashArray: [6, 4],
      selectable: false, evented: false, excludeFromExport: true, objectCaching: false,
    });
    canvas.add(previewObj);
    canvas.bringToFront(previewObj);
    canvas.requestRenderAll();
  }

  function setLassoHint(text) { if (hintEl) hintEl.textContent = text || ''; }

  function setLassoState(state) {
    const ready = state === 'ready';
    const busy = state === 'busy';
    extractBtn.disabled = !ready;
    eraseBtn.disabled = !ready;
    redrawBtn.disabled = busy;
    doneBtn.disabled = busy;
    if (state === 'idle') setLassoHint(ED.i18n.lassoHintDraw || '');
    else if (state === 'ready') setLassoHint(ED.i18n.lassoHintReady || '');
  }

  function buildSourceCanvas(img) {
    const sw = img.width, sh = img.height;
    const src = document.createElement('canvas');
    src.width = sw; src.height = sh;
    src.getContext('2d').drawImage(img._element, img.cropX || 0, img.cropY || 0, sw, sh, 0, 0, sw, sh);
    return src;
  }

  /* ---- pure coordinate/pixel helpers (exposed for direct testing too) ---- */

  function pointsToImageSpace(pts, fr) {
    return pts.map((p) => ({
      x: (p.x - fr.left) / fr.scaleX,
      y: (p.y - fr.top) / fr.scaleY,
    }));
  }
  ED.lassoPointsToImageSpace = pointsToImageSpace;

  function clipToPath(ctx, pts, offsetX, offsetY) {
    ctx.beginPath();
    pts.forEach((p, i) => {
      const x = p.x - offsetX, y = p.y - offsetY;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.clip();
  }

  // Cuts the polygon out of `sc` onto its own tightly-cropped transparent
  // canvas — same idea as decompose.js's cropToDataUrl, but clipped to an
  // arbitrary polygon instead of a plain rectangle.
  function buildExtractedDataUrl(sc, imgPoints) {
    const xs = imgPoints.map((p) => p.x), ys = imgPoints.map((p) => p.y);
    const minX = Math.max(0, Math.floor(Math.min(...xs)));
    const minY = Math.max(0, Math.floor(Math.min(...ys)));
    const maxX = Math.min(sc.width, Math.ceil(Math.max(...xs)));
    const maxY = Math.min(sc.height, Math.ceil(Math.max(...ys)));
    const w = Math.max(1, maxX - minX), h = Math.max(1, maxY - minY);
    const piece = document.createElement('canvas');
    piece.width = w; piece.height = h;
    const ctx = piece.getContext('2d');
    ctx.save();
    clipToPath(ctx, imgPoints, minX, minY);
    ctx.drawImage(sc, minX, minY, w, h, 0, 0, w, h);
    ctx.restore();
    return { dataUrl: piece.toDataURL('image/png'), minX, minY, w, h };
  }
  ED.lassoBuildExtractedDataUrl = buildExtractedDataUrl;

  // Punches a transparent hole shaped like the polygon into a full copy of
  // `sc` — same idea as decompose.js's eraseFromCanvasImage's clearRect, but
  // clipped to the polygon instead of a plain box.
  function buildErasedDataUrl(sc, imgPoints) {
    const full = document.createElement('canvas');
    full.width = sc.width; full.height = sc.height;
    const ctx = full.getContext('2d');
    ctx.drawImage(sc, 0, 0);
    ctx.save();
    clipToPath(ctx, imgPoints, 0, 0);
    ctx.clearRect(0, 0, full.width, full.height);
    ctx.restore();
    return full.toDataURL('image/png');
  }
  ED.lassoBuildErasedDataUrl = buildErasedDataUrl;

  /* ---- side-effecting actions (add a layer / mutate the source image) --- */

  function lassoExtractRegion(sc, fr, imgPoints) {
    const { dataUrl, minX, minY } = buildExtractedDataUrl(sc, imgPoints);
    return new Promise((resolve, reject) => {
      fabric.Image.fromURL(dataUrl, (obj) => {
        if (!obj) return reject(new Error('image load failed'));
        obj.set({
          left: fr.left + minX * fr.scaleX,
          top: fr.top + minY * fr.scaleY,
          scaleX: fr.scaleX, scaleY: fr.scaleY,
          name: ED.i18n.lassoLayerName || 'Selection',
        });
        canvas.add(obj);
        canvas.setActiveObject(obj);
        canvas.requestRenderAll();
        ED.record();
        resolve(obj);
      });
    });
  }
  ED.lassoExtractRegion = lassoExtractRegion;

  function lassoEraseRegion(img, sc, imgPoints) {
    const dataUrl = buildErasedDataUrl(sc, imgPoints);
    return new Promise((resolve, reject) => {
      img.setSrc(dataUrl, (loaded) => {
        if (!loaded) return reject(new Error('setSrc failed'));
        img.set({ cropX: 0, cropY: 0 });
        canvas.requestRenderAll();
        ED.record();
        resolve();
      }, { crossOrigin: 'anonymous' });
    });
  }
  ED.lassoEraseRegion = lassoEraseRegion;

  /* ---- interactive drawing mode ------------------------------------------ */

  function attachHandlers() {
    onMouseDown = (opt) => {
      if (drawing) return;
      const p = canvas.getPointer(opt.e);
      points = [{ x: p.x, y: p.y }];
      drawing = true;
      rebuildPreview(false);
    };
    onMouseMove = (opt) => {
      if (!drawing) return;
      const p = canvas.getPointer(opt.e);
      const last = points[points.length - 1];
      if (dist(p, last) < MIN_DIST) return;
      points.push({ x: p.x, y: p.y });
      rebuildPreview(false);
    };
    onMouseUp = () => {
      if (!drawing) return;
      drawing = false;
      if (points.length < 3) {
        points = [];
        clearPreview();
        setLassoHint(ED.i18n.lassoTooSmall || '');
        setLassoState('idle');
        return;
      }
      rebuildPreview(true);
      setLassoState('ready');
    };
    canvas.on('mouse:down', onMouseDown);
    canvas.on('mouse:move', onMouseMove);
    canvas.on('mouse:up', onMouseUp);
  }

  function detachHandlers() {
    if (onMouseDown) canvas.off('mouse:down', onMouseDown);
    if (onMouseMove) canvas.off('mouse:move', onMouseMove);
    if (onMouseUp) canvas.off('mouse:up', onMouseUp);
    onMouseDown = onMouseMove = onMouseUp = null;
  }

  function lassoStart(img) {
    if (!img || img.type !== 'image' || !img._element || ED._lassoing || ED._magicGrabbing) return;
    activeImg = img;
    srcCanvas = buildSourceCanvas(img);
    const rect = img.getBoundingRect(true, true);
    frame = { left: rect.left, top: rect.top, scaleX: rect.width / srcCanvas.width, scaleY: rect.height / srcCanvas.height };
    points = [];
    ED._lassoing = true;
    savedSelection = canvas.selection;
    savedSkipTargetFind = canvas.skipTargetFind;
    canvas.discardActiveObject();
    canvas.selection = false;
    canvas.skipTargetFind = true;
    canvas.requestRenderAll();
    attachHandlers();
    bar.hidden = false;
    if (workspace) workspace.classList.add('lassoing');
    setLassoState('idle');
  }
  ED.lassoStart = lassoStart;

  function exitLasso() {
    if (!ED._lassoing) return;
    detachHandlers();
    clearPreview();
    const reselect = activeImg && activeImg.selectable !== false ? activeImg : null;
    points = [];
    canvas.selection = savedSelection;
    canvas.skipTargetFind = savedSkipTargetFind;
    ED._lassoing = false;
    bar.hidden = true;
    if (workspace) workspace.classList.remove('lassoing');
    activeImg = null; srcCanvas = null; frame = null;
    if (reselect && canvas.getObjects().includes(reselect)) canvas.setActiveObject(reselect);
    canvas.requestRenderAll();
    if (window.ED_syncProps) window.ED_syncProps();
  }
  ED.lassoCancel = exitLasso;

  redrawBtn.addEventListener('click', () => {
    points = [];
    clearPreview();
    setLassoState('idle');
  });
  doneBtn.addEventListener('click', exitLasso);

  extractBtn.addEventListener('click', async () => {
    if (points.length < 3) return;
    setLassoState('busy');
    try {
      const imgPoints = pointsToImageSpace(points, frame);
      await lassoExtractRegion(srcCanvas, frame, imgPoints);
      points = [];
      clearPreview();
      setLassoState('idle');
    } catch (e) {
      console.error('[lasso] extract failed', e);
      setLassoHint(ED.i18n.lassoError || '');
      setLassoState('ready');
    }
  });

  eraseBtn.addEventListener('click', async () => {
    if (points.length < 3) return;
    setLassoState('busy');
    try {
      const imgPoints = pointsToImageSpace(points, frame);
      await lassoEraseRegion(activeImg, srcCanvas, imgPoints);
      // pixels just changed under us (erase mutates the source) — refresh the
      // snapshot so a further lasso pass in the same session sees the result
      srcCanvas = buildSourceCanvas(activeImg);
      points = [];
      clearPreview();
      setLassoState('idle');
    } catch (e) {
      console.error('[lasso] erase failed', e);
      setLassoHint(ED.i18n.lassoError || '');
      setLassoState('ready');
    }
  });

  /* ---- entry points: image-properties panel + background panel ---------- */
  const lassoBtn = document.getElementById('lassoBtn');
  if (lassoBtn) lassoBtn.addEventListener('click', () => lassoStart(canvas.getActiveObject()));

  const bgLassoBtn = document.getElementById('bgLassoBtn');
  const bgLassoHint = document.getElementById('bgLassoHint');
  if (bgLassoBtn) {
    bgLassoBtn.addEventListener('click', () => {
      const img = ED.getBgImage && ED.getBgImage();
      if (!img) { if (bgLassoHint) bgLassoHint.textContent = ED.i18n.bgNoImage || ''; return; }
      if (bgLassoHint) bgLassoHint.textContent = '';
      lassoStart(img);
    });
  }
})();
