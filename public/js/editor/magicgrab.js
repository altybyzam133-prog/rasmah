'use strict';

/* ============================================================================
   "Magic Grab" — a clone of Canva's Magic Grab: click directly on any object
   in a photo (or paint over it, or let it auto-detect the main subject) to
   pull it out onto its own layer, with the hole left behind content-aware
   filled instead of just erased flat. Three selection modes, matching
   Canva's own "Select Objects to Grab" panel:
     - Foreground: auto-selects the main subject — a point prompt at the
       centroid of the largest object the app's existing COCO-SSD detector
       (already vendored for the classic Decompose tool, reused rather than
       shipping a second detection model) finds, falling back to the plain
       image center if detection is unavailable/finds nothing. An
       approximation of Canva's own automatic detection, which isn't
       publicly documented, but a meaningfully better one than a blind
       center guess for off-center subjects.
     - Click: click any point on the photo; each click segments whatever
       object is under it via MobileSAM (a distilled Segment Anything model)
       and adds it to the running selection — click a second, unrelated
       object and it's added too, matching "select multiple objects by
       clicking each one". Clicking AND DRAGGING draws a box instead and
       segments whatever's inside it in one shot (SAM's box-prompt
       convention — two "points" labeled 2/3 for the corners — matching
       Canva's own documented "select multiple objects by clicking and
       dragging over them" gesture).
     - Brush: paint over an arbitrary area freehand, no ML — for irregular
       selections SAM doesn't segment cleanly, or on unavailable/slow
       hardware where the model is skipped entirely.
   All three modes accumulate into ONE soft (0-255 per-pixel) alpha mask;
   "Grab" cuts that region out onto a new layer and content-aware-fills
   (opencv.js's Telea inpaint — classical, not generative, see the comment on
   buildInpaintedDataUrl) the hole left in the source image, falling back to
   a flat transparent erase if opencv.js wasn't vendored.

   Unlike lasso.js (a plain polygon cut, no ML, always available), this needs
   MobileSAM + ONNX Runtime Web for Foreground/Click — both self-hosted via
   `npm run fetch-vendor`, lazily loaded on first use only (nothing
   downloads just from opening the editor). Brush mode alone needs neither
   and stays available even when the model wasn't fetched.

   MobileSAM's ONNX I/O contract used here (point_coords in the
   resize-longest-side-to-1024 coordinate space, orig_im_size as [H,W] to get
   the mask directly at full original resolution, point_labels 1=foreground/
   -1=padding) was verified two ways before any of this browser code was
   written: by loading the actual downloaded .onnx files in Node
   (onnxruntime-node) to read their real input/output tensor names/shapes
   rather than assume them, and by running a full synthetic encoder+decoder
   forward pass against a known test image (a solid rectangle) to confirm a
   center click on it produced a clean, spatially-correct mask (inside-rect
   logit ~+20, outside ~-20) — not just wiring that compiles. Still, real
   end-to-end browser verification (a real photo, real click, real mask
   quality) has not happened this session — ask the user to try it on an
   actual photo and report back if results look off.
   ========================================================================== */

(function () {
  const ED = window.ED;
  const canvas = ED.canvas;
  const cfg = ED.data.magicGrab || {};
  ED.magicGrabModelAvailable = !!cfg.modelAvailable;
  ED.magicGrabInpaintAvailable = !!cfg.inpaintAvailable;

  const workspace = document.getElementById('workspace');
  const bar = document.getElementById('magicgrabbar');
  const hintEl = document.getElementById('magicgrabHint');
  const modeButtons = bar ? [...bar.querySelectorAll('[data-mggmode]')] : [];
  const brushRow = document.getElementById('magicgrabBrushRow');
  const brushSizeInput = document.getElementById('magicgrabBrushSize');
  const grabBtn = document.getElementById('magicgrabGrab');
  const clearBtn = document.getElementById('magicgrabClear');
  const doneBtn = document.getElementById('magicgrabDone');
  if (!bar) return;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error(`failed to load ${src}`));
      document.head.appendChild(s);
    });
  }

  /* ---- lazy loaders: ONNX Runtime Web + the two MobileSAM sessions, opencv.js */

  let ortPromise = null;
  function loadOrt() {
    if (!ortPromise) {
      ortPromise = loadScript(cfg.ortUrl).then(() => {
        if (!window.ort) throw new Error('ort failed to load');
        window.ort.env.wasm.wasmPaths = cfg.wasmBase;
        // Force single-threaded: the alternative needs SharedArrayBuffer,
        // which needs COOP/COEP response headers across the whole site — too
        // big a blast radius to take on just for this. Decoding one point is
        // fast enough single-threaded (only the encoder is a heavier, but
        // one-time-per-image, cost).
        window.ort.env.wasm.numThreads = 1;
        return window.ort;
      });
    }
    return ortPromise;
  }
  let encoderSessionPromise = null;
  function getEncoderSession() {
    if (!encoderSessionPromise) encoderSessionPromise = loadOrt().then((ort) => ort.InferenceSession.create(cfg.encoderUrl));
    return encoderSessionPromise;
  }
  let decoderSessionPromise = null;
  function getDecoderSession() {
    if (!decoderSessionPromise) decoderSessionPromise = loadOrt().then((ort) => ort.InferenceSession.create(cfg.decoderUrl));
    return decoderSessionPromise;
  }

  let opencvPromise = null;
  function loadOpenCV() {
    if (!opencvPromise) {
      opencvPromise = loadScript(cfg.opencvUrl).then(() => new Promise((resolve, reject) => {
        const cv = window.cv;
        if (!cv) return reject(new Error('cv not defined'));
        if (cv.Mat) return resolve(cv); // rare synchronous-ready path
        cv.onRuntimeInitialized = () => resolve(cv);
      }));
    }
    return opencvPromise;
  }

  /* ---- pure preprocessing / math helpers (exposed for direct testing) ---- */

  function toImageSpace(p, fr) {
    return { x: (p.x - fr.left) / fr.scaleX, y: (p.y - fr.top) / fr.scaleY };
  }
  ED.magicGrabToImageSpace = toImageSpace;

  // Resizes `srcCanvas` so its LONGEST side is exactly 1024px (preserving
  // aspect ratio, no padding — see the file header + fetch-vendor.js for why
  // this graph wants that instead of the classical padded-square SAM
  // pipeline) and returns the raw HWC float32 pixel buffer in 0-255 range
  // (this exported encoder has normalization baked in — no mean/std
  // subtraction needed here) plus the scale factor, which point_coords must
  // also be multiplied by to land in the same coordinate space.
  function buildEncoderInput(srcCanvas, sw, sh) {
    const scale = 1024 / Math.max(sw, sh);
    const rw = Math.max(1, Math.round(sw * scale));
    const rh = Math.max(1, Math.round(sh * scale));
    const rc = document.createElement('canvas');
    rc.width = rw; rc.height = rh;
    rc.getContext('2d').drawImage(srcCanvas, 0, 0, rw, rh);
    const { data } = rc.getContext('2d').getImageData(0, 0, rw, rh);
    const hwc = new Float32Array(rw * rh * 3);
    for (let i = 0, p = 0; i < data.length; i += 4, p += 3) {
      hwc[p] = data[i]; hwc[p + 1] = data[i + 1]; hwc[p + 2] = data[i + 2];
    }
    return { hwc, rw, rh, scale };
  }
  ED.magicGrabBuildEncoderInput = buildEncoderInput;

  function sigmoid(v) { return 1 / (1 + Math.exp(-v)); }

  // OR's a raw decoder logits array into the running soft-alpha accumulator
  // (both length sw*sh) — sigmoid converts a logit to a 0-255 alpha, and OR
  // (max, not add/replace) is what lets multiple independent clicks each add
  // their own object to the selection without one undoing another.
  function orLogitsIntoAccum(accum, logitsData, sw, sh) {
    for (let i = 0; i < accum.length && i < logitsData.length; i++) {
      const a = Math.round(sigmoid(logitsData[i]) * 255);
      if (a > accum[i]) accum[i] = a;
    }
  }
  ED.magicGrabOrLogitsIntoAccum = orLogitsIntoAccum;

  function paintBrush(accum, sw, sh, cx, cy, radius) {
    const x0 = Math.max(0, Math.floor(cx - radius)), x1 = Math.min(sw - 1, Math.ceil(cx + radius));
    const y0 = Math.max(0, Math.floor(cy - radius)), y1 = Math.min(sh - 1, Math.ceil(cy + radius));
    const r2 = radius * radius;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx, dy = y - cy;
        if (dx * dx + dy * dy <= r2) accum[y * sw + x] = 255;
      }
    }
  }
  ED.magicGrabPaintBrush = paintBrush;

  function accumHasAny(accum) {
    for (let i = 0; i < accum.length; i++) if (accum[i] > 10) return true;
    return false;
  }
  ED.magicGrabAccumHasAny = accumHasAny;

  function accumBBox(accum, sw, sh) {
    let minX = sw, minY = sh, maxX = -1, maxY = -1;
    for (let y = 0; y < sh; y++) {
      const row = y * sw;
      for (let x = 0; x < sw; x++) {
        if (accum[row + x] > 10) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < minX) return null;
    return { minX, minY, w: maxX - minX + 1, h: maxY - minY + 1 };
  }
  ED.magicGrabAccumBBox = accumBBox;

  // Crops `srcCanvas` to the accumulator's bounding box and alpha-mattes it
  // per-pixel by the (soft) accumulator value — same idea as decompose.js's
  // cropToDataUrl / bgremoval.js's segmentCutout, but driven by an arbitrary
  // per-pixel mask instead of a rectangle or a whole-image segmenter output.
  function buildExtractedDataUrl(srcCanvas, accum, sw, sh) {
    const bbox = accumBBox(accum, sw, sh);
    if (!bbox) return null;
    const { minX, minY, w, h } = bbox;
    const piece = document.createElement('canvas');
    piece.width = w; piece.height = h;
    const pctx = piece.getContext('2d');
    pctx.drawImage(srcCanvas, minX, minY, w, h, 0, 0, w, h);
    const frame = pctx.getImageData(0, 0, w, h);
    const data = frame.data;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const a = accum[(y + minY) * sw + (x + minX)];
        const idx = (y * w + x) * 4 + 3;
        data[idx] = Math.round(data[idx] * (a / 255));
      }
    }
    pctx.putImageData(frame, 0, 0);
    return { dataUrl: piece.toDataURL('image/png'), minX, minY, w, h };
  }
  ED.magicGrabBuildExtractedDataUrl = buildExtractedDataUrl;

  // Flat transparent erase (no inpainting) — the fallback when opencv.js
  // isn't vendored, same end result lasso.js's/decompose.js's own erase
  // already produce, just driven by the soft accumulator instead of a
  // polygon/box.
  function buildErasedTransparentDataUrl(srcCanvas, accum, sw, sh) {
    const full = document.createElement('canvas');
    full.width = sw; full.height = sh;
    const ctx = full.getContext('2d');
    ctx.drawImage(srcCanvas, 0, 0);
    const frame = ctx.getImageData(0, 0, sw, sh);
    const data = frame.data;
    for (let i = 0, p = 0; i < accum.length; i++, p += 4) {
      const a = accum[i];
      if (a > 0) data[p + 3] = Math.round(data[p + 3] * (1 - a / 255));
    }
    ctx.putImageData(frame, 0, 0);
    return full.toDataURL('image/png');
  }
  ED.magicGrabBuildErasedTransparentDataUrl = buildErasedTransparentDataUrl;

  // Content-aware fill via opencv.js's cv.inpaint (Telea algorithm) —
  // classical, not generative: reconstructs the hole from its surrounding
  // texture/color rather than hallucinating new content the way Canva's own
  // (paid) Magic Grab fill does. It's the closest free, offline-capable
  // approximation and was the explicit, agreed scope for this. Dilates the
  // mask by a few px first so the fill also covers the soft/antialiased edge
  // the sigmoid conversion leaves, not just its 100%-confidence core.
  //
  // Seam feathering (added after the user flagged the fill boundary as a
  // likely weak spot before even testing it — a reasonable concern: Telea
  // reconstructs texture well but can leave a faint hard edge exactly where
  // "algorithmically-filled" meets "untouched camera pixel", especially on
  // textured backgrounds): a thin ring straddling that exact boundary — the
  // dilated erase mask's own morphological edge, dilate(mask) minus
  // erode(mask) — gets a light Gaussian blur composited back only within
  // that ring. Deliberately narrow and centered ON the boundary, not spread
  // into the hole's interior: it only softens the transition LINE, it never
  // blends the removed object's original pixels back into the hole (that
  // would leave a ghost of it behind once the user drags the grabbed piece
  // away, defeating the point of "grab").
  async function buildInpaintedDataUrl(srcCanvas, accum, sw, sh) {
    const cv = await loadOpenCV();
    const src = cv.imread(srcCanvas);
    const maskMat = new cv.Mat(sh, sw, cv.CV_8UC1);
    for (let i = 0; i < accum.length; i++) maskMat.data[i] = accum[i] > 20 ? 255 : 0;
    const kernel = cv.Mat.ones(5, 5, cv.CV_8U);
    const dilated = new cv.Mat();
    cv.dilate(maskMat, dilated, kernel);
    const dst = new cv.Mat();
    // radius bumped 5 -> 7: pulls from a slightly wider neighborhood, giving
    // Telea a bit more texture to work with on busier backgrounds
    cv.inpaint(src, dilated, dst, 7, cv.INPAINT_TELEA);

    const ringKernel = cv.Mat.ones(7, 7, cv.CV_8U);
    const ringOuter = new cv.Mat();
    const ringInner = new cv.Mat();
    cv.dilate(dilated, ringOuter, ringKernel);
    cv.erode(dilated, ringInner, ringKernel);
    const ring = new cv.Mat();
    cv.subtract(ringOuter, ringInner, ring);
    const blurred = new cv.Mat();
    cv.GaussianBlur(dst, blurred, new cv.Size(5, 5), 0);
    blurred.copyTo(dst, ring);

    const out = document.createElement('canvas');
    out.width = sw; out.height = sh;
    cv.imshow(out, dst);
    src.delete(); maskMat.delete(); kernel.delete(); dilated.delete(); dst.delete();
    ringKernel.delete(); ringOuter.delete(); ringInner.delete(); ring.delete(); blurred.delete();
    return out.toDataURL('image/png');
  }

  function buildSourceCanvas(img) {
    const sw = img.width, sh = img.height;
    const src = document.createElement('canvas');
    src.width = sw; src.height = sh;
    src.getContext('2d').drawImage(img._element, img.cropX || 0, img.cropY || 0, sw, sh, 0, 0, sw, sh);
    return src;
  }

  async function computeEmbedding(srcCanvas, sw, sh) {
    const ort = await loadOrt();
    const { hwc, rw, rh, scale } = buildEncoderInput(srcCanvas, sw, sh);
    const inputTensor = new ort.Tensor('float32', hwc, [rh, rw, 3]);
    const session = await getEncoderSession();
    const out = await session.run({ input_image: inputTensor });
    return { embeddings: out.image_embeddings, scale };
  }

  // One point-prompt decode: `label` 1 = foreground (the only kind this tool
  // issues — verified against the real model this way round, not the
  // opposite, via a Node forward-pass test against a known test image before
  // writing this). A second, fixed (0,0) point labeled -1 pads the input to
  // the 2-point shape this exported decoder graph expects.
  async function decodePoint(embeddings, scale, x, y, sw, sh) {
    const ort = await loadOrt();
    const pointCoords = new ort.Tensor('float32', new Float32Array([x * scale, y * scale, 0, 0]), [1, 2, 2]);
    const pointLabels = new ort.Tensor('float32', new Float32Array([1, -1]), [1, 2]);
    const maskInput = new ort.Tensor('float32', new Float32Array(256 * 256), [1, 1, 256, 256]);
    const hasMask = new ort.Tensor('float32', new Float32Array([0]), [1]);
    const origSize = new ort.Tensor('float32', new Float32Array([sh, sw]), [2]);
    const session = await getDecoderSession();
    const out = await session.run({
      image_embeddings: embeddings,
      point_coords: pointCoords,
      point_labels: pointLabels,
      mask_input: maskInput,
      has_mask_input: hasMask,
      orig_im_size: origSize,
    });
    return out.masks; // ort.Tensor, dims [1,1,sh,sw], raw logits at full original resolution
  }

  // Box-prompt decode: SAM's documented convention encodes a box as two
  // "points" — top-left labeled 2, bottom-right labeled 3 — instead of a
  // single foreground point. Confirmed this exact decoder honors it (not
  // just assumed from general SAM docs) via the same kind of Node
  // forward-pass test the single-point path got: a box drawn slightly
  // larger than a known test rectangle correctly segmented just the
  // rectangle (inside logit +10, outside -16).
  async function decodeBox(embeddings, scale, x0, y0, x1, y1, sw, sh) {
    const ort = await loadOrt();
    const pointCoords = new ort.Tensor('float32', new Float32Array([x0 * scale, y0 * scale, x1 * scale, y1 * scale]), [1, 2, 2]);
    const pointLabels = new ort.Tensor('float32', new Float32Array([2, 3]), [1, 2]);
    const maskInput = new ort.Tensor('float32', new Float32Array(256 * 256), [1, 1, 256, 256]);
    const hasMask = new ort.Tensor('float32', new Float32Array([0]), [1]);
    const origSize = new ort.Tensor('float32', new Float32Array([sh, sw]), [2]);
    const session = await getDecoderSession();
    const out = await session.run({
      image_embeddings: embeddings,
      point_coords: pointCoords,
      point_labels: pointLabels,
      mask_input: maskInput,
      has_mask_input: hasMask,
      orig_im_size: origSize,
    });
    return out.masks;
  }

  // Foreground mode's "auto-detect the main subject": reuses the app's
  // existing COCO-SSD detector (ED.detectElements, from decompose.js —
  // lazily loads/caches its own model independently of MobileSAM, no
  // double-loading) rather than shipping a second detection model. Picks
  // the largest detected box (an ordinary prominence heuristic — a big
  // object filling much of the frame is usually the intended subject) and
  // returns its center as the SAM point prompt. Falls back to the plain
  // image center — the only behavior this had before — if the detector
  // isn't vendored or finds nothing, same graceful-degrade convention as
  // every other optional asset in this app.
  async function pickForegroundPoint(srcCanvas, sw, sh) {
    if (ED.decomposeAvailable && typeof ED.detectElements === 'function') {
      try {
        const boxes = await ED.detectElements(srcCanvas);
        if (boxes && boxes.length) {
          const best = boxes.reduce((a, b) => (a.bw * a.bh > b.bw * b.bh ? a : b));
          return { x: best.bx + best.bw / 2, y: best.by + best.bh / 2 };
        }
      } catch (e) {
        console.error('[magicgrab] foreground auto-detect failed, falling back to image center', e);
      }
    }
    return { x: sw / 2, y: sh / 2 };
  }

  /* ---- interactive session -------------------------------------------- */

  let state = null;

  function setHint(text) { if (hintEl) hintEl.textContent = text || ''; }

  function syncButtons() {
    const has = state && accumHasAny(state.accum);
    grabBtn.disabled = !has;
    clearBtn.disabled = !has;
  }

  function setAllDisabled(v) {
    [...bar.querySelectorAll('button')].forEach((b) => { b.disabled = v; });
    if (!v) {
      syncButtons();
      modeButtons.forEach((b) => { if (b.dataset.mggmode !== 'brush' && !ED.magicGrabModelAvailable) b.disabled = true; });
    }
  }

  function ensurePreviewObj() {
    if (state.previewObj) return state.previewObj;
    const pc = document.createElement('canvas');
    pc.width = state.sw; pc.height = state.sh;
    const obj = new fabric.Image(pc, {
      left: state.frame.left, top: state.frame.top,
      scaleX: state.frame.scaleX, scaleY: state.frame.scaleY,
      selectable: false, evented: false, excludeFromExport: true, objectCaching: false,
    });
    canvas.add(obj);
    canvas.bringToFront(obj);
    state.previewObj = obj;
    state.previewCanvas = pc;
    return obj;
  }

  function redrawPreview() {
    const obj = ensurePreviewObj();
    const pctx = state.previewCanvas.getContext('2d');
    const id = pctx.createImageData(state.sw, state.sh);
    for (let i = 0, p = 0; i < state.accum.length; i++, p += 4) {
      id.data[p] = 124; id.data[p + 1] = 92; id.data[p + 2] = 255; // brand purple, matches lasso's preview color
      id.data[p + 3] = Math.round(state.accum[i] * 0.55);
    }
    pctx.putImageData(id, 0, 0);
    obj.dirty = true;
    canvas.requestRenderAll();
    syncButtons();
  }

  function ensureEmbedding() {
    if (!state.embeddingPromise) {
      setHint(ED.i18n.magicGrabAnalyzing || '…');
      state.embeddingPromise = computeEmbedding(state.srcCanvas, state.sw, state.sh);
    }
    return state.embeddingPromise;
  }

  async function runPointClick(ix, iy, replace) {
    if (!ED.magicGrabModelAvailable) return;
    setAllDisabled(true);
    setHint(ED.i18n.magicGrabWorking || '…');
    try {
      const emb = await ensureEmbedding();
      const masks = await decodePoint(emb.embeddings, emb.scale, ix, iy, state.sw, state.sh);
      if (replace) state.accum.fill(0);
      orLogitsIntoAccum(state.accum, masks.data, state.sw, state.sh);
      redrawPreview();
      setHint(accumHasAny(state.accum) ? (ED.i18n.magicGrabHintReady || '') : (ED.i18n.magicGrabNone || ''));
    } catch (e) {
      console.error('[magicgrab] point decode failed', e);
      setHint(ED.i18n.magicGrabError || '');
    } finally {
      setAllDisabled(false);
    }
  }

  async function runBoxSelect(x0, y0, x1, y1) {
    if (!ED.magicGrabModelAvailable) return;
    setAllDisabled(true);
    setHint(ED.i18n.magicGrabWorking || '…');
    try {
      const emb = await ensureEmbedding();
      const masks = await decodeBox(emb.embeddings, emb.scale, x0, y0, x1, y1, state.sw, state.sh);
      orLogitsIntoAccum(state.accum, masks.data, state.sw, state.sh);
      redrawPreview();
      setHint(accumHasAny(state.accum) ? (ED.i18n.magicGrabHintReady || '') : (ED.i18n.magicGrabNone || ''));
    } catch (e) {
      console.error('[magicgrab] box decode failed', e);
      setHint(ED.i18n.magicGrabError || '');
    } finally {
      setAllDisabled(false);
    }
  }

  function setMode(mode) {
    // Foreground/Click need the model — fall back to Brush (never disabled)
    // rather than silently landing on a mode whose button is greyed out.
    if ((mode === 'foreground' || mode === 'click') && !ED.magicGrabModelAvailable) mode = 'brush';
    state.mode = mode;
    modeButtons.forEach((b) => b.classList.toggle('on', b.dataset.mggmode === mode));
    if (brushRow) brushRow.hidden = mode !== 'brush';
    if (mode === 'foreground') {
      setHint(ED.i18n.magicGrabAnalyzing || '…');
      pickForegroundPoint(state.srcCanvas, state.sw, state.sh).then((pt) => {
        if (!state || state.mode !== 'foreground') return; // exited/switched mode while detecting
        runPointClick(pt.x, pt.y, true);
      });
    } else if (mode === 'brush') {
      setHint(ED.magicGrabModelAvailable ? (ED.i18n.magicGrabHintBrush || '') : (ED.i18n.magicGrabModelUnavailable || ''));
    } else {
      setHint(ED.i18n.magicGrabHintClick || '');
    }
  }

  function attachHandlers() {
    let brushDown = false;
    // Click/Foreground mode drag tracking: a plain click (down+up under the
    // threshold) still does a single-point prompt as before; a real drag
    // draws a box and switches to the box-prompt path on release — mirrors
    // Canva's "click, or click-and-drag over multiple objects" gesture.
    let dragStart = null; // image-space
    let dragLast = null;
    let dragBoxObj = null;
    const DRAG_THRESHOLD = 6; // image-pixel space

    function updateDragBox() {
      const x0 = Math.min(dragStart.x, dragLast.x), y0 = Math.min(dragStart.y, dragLast.y);
      const x1 = Math.max(dragStart.x, dragLast.x), y1 = Math.max(dragStart.y, dragLast.y);
      const left = state.frame.left + x0 * state.frame.scaleX;
      const top = state.frame.top + y0 * state.frame.scaleY;
      const w = (x1 - x0) * state.frame.scaleX, h = (y1 - y0) * state.frame.scaleY;
      if (!dragBoxObj) {
        dragBoxObj = new fabric.Rect({
          left, top, width: w, height: h, fill: 'rgba(124,92,255,0.12)',
          stroke: '#7c5cff', strokeWidth: 2, strokeDashArray: [6, 4],
          selectable: false, evented: false, excludeFromExport: true, objectCaching: false,
        });
        canvas.add(dragBoxObj);
        canvas.bringToFront(dragBoxObj);
      } else {
        dragBoxObj.set({ left, top, width: w, height: h });
      }
      canvas.requestRenderAll();
    }

    state.onMouseDown = (opt) => {
      const p = canvas.getPointer(opt.e);
      const ip = toImageSpace(p, state.frame);
      if (ip.x < 0 || ip.y < 0 || ip.x >= state.sw || ip.y >= state.sh) return;
      if (state.mode === 'brush') {
        brushDown = true;
        paintBrush(state.accum, state.sw, state.sh, ip.x, ip.y, Number(brushSizeInput.value) || 40);
        redrawPreview();
      } else if (state.mode === 'click' || state.mode === 'foreground') {
        dragStart = ip; dragLast = ip;
      }
    };
    state.onMouseMove = (opt) => {
      if (state.mode === 'brush') {
        if (!brushDown) return;
        const p = canvas.getPointer(opt.e);
        const ip = toImageSpace(p, state.frame);
        paintBrush(state.accum, state.sw, state.sh, ip.x, ip.y, Number(brushSizeInput.value) || 40);
        redrawPreview();
        return;
      }
      if (!dragStart) return;
      const p = canvas.getPointer(opt.e);
      dragLast = toImageSpace(p, state.frame);
      if (dragBoxObj || Math.hypot(dragLast.x - dragStart.x, dragLast.y - dragStart.y) >= DRAG_THRESHOLD) {
        updateDragBox();
      }
    };
    state.onMouseUp = () => {
      brushDown = false;
      if (!dragStart) return;
      if (dragBoxObj) {
        canvas.remove(dragBoxObj);
        dragBoxObj = null;
        runBoxSelect(
          Math.min(dragStart.x, dragLast.x), Math.min(dragStart.y, dragLast.y),
          Math.max(dragStart.x, dragLast.x), Math.max(dragStart.y, dragLast.y),
        );
      } else {
        runPointClick(dragStart.x, dragStart.y, false);
      }
      dragStart = null; dragLast = null;
    };
    canvas.on('mouse:down', state.onMouseDown);
    canvas.on('mouse:move', state.onMouseMove);
    canvas.on('mouse:up', state.onMouseUp);
  }

  function detachHandlers() {
    if (state.onMouseDown) canvas.off('mouse:down', state.onMouseDown);
    if (state.onMouseMove) canvas.off('mouse:move', state.onMouseMove);
    if (state.onMouseUp) canvas.off('mouse:up', state.onMouseUp);
  }

  function magicGrabStart(img) {
    if (!img || img.type !== 'image' || !img._element || ED._lassoing || ED._magicGrabbing) return;
    const srcCanvas = buildSourceCanvas(img);
    const rect = img.getBoundingRect(true, true);
    state = {
      img, srcCanvas, sw: srcCanvas.width, sh: srcCanvas.height,
      frame: { left: rect.left, top: rect.top, scaleX: rect.width / srcCanvas.width, scaleY: rect.height / srcCanvas.height },
      accum: new Uint8ClampedArray(srcCanvas.width * srcCanvas.height),
      mode: 'foreground',
      embeddingPromise: null,
      previewObj: null, previewCanvas: null,
      savedSelection: canvas.selection, savedSkipTargetFind: canvas.skipTargetFind,
    };
    ED._magicGrabbing = true;
    canvas.discardActiveObject();
    canvas.selection = false;
    canvas.skipTargetFind = true;
    canvas.requestRenderAll();
    attachHandlers();
    bar.hidden = false;
    if (workspace) workspace.classList.add('lassoing'); // reuses the crosshair-cursor rule
    modeButtons.forEach((b) => { b.disabled = b.dataset.mggmode !== 'brush' && !ED.magicGrabModelAvailable; });
    syncButtons();
    setMode('foreground');
  }
  ED.magicGrabStart = magicGrabStart;

  function exitMagicGrab() {
    if (!ED._magicGrabbing) return;
    detachHandlers();
    if (state.previewObj) canvas.remove(state.previewObj);
    const reselect = state.img && state.img.selectable !== false ? state.img : null;
    canvas.selection = state.savedSelection;
    canvas.skipTargetFind = state.savedSkipTargetFind;
    ED._magicGrabbing = false;
    bar.hidden = true;
    if (workspace) workspace.classList.remove('lassoing');
    state = null;
    if (reselect && canvas.getObjects().includes(reselect)) canvas.setActiveObject(reselect);
    canvas.requestRenderAll();
    if (window.ED_syncProps) window.ED_syncProps();
  }
  ED.magicGrabCancel = exitMagicGrab;

  modeButtons.forEach((b) => b.addEventListener('click', () => { if (!b.disabled) setMode(b.dataset.mggmode); }));

  clearBtn.addEventListener('click', () => {
    if (!state) return;
    state.accum.fill(0);
    redrawPreview();
    setHint(state.mode === 'brush' ? (ED.i18n.magicGrabHintBrush || '') : (ED.i18n.magicGrabHintClick || ''));
  });

  doneBtn.addEventListener('click', exitMagicGrab);

  grabBtn.addEventListener('click', async () => {
    if (!state || !accumHasAny(state.accum)) return;
    setAllDisabled(true);
    setHint(ED.i18n.magicGrabGrabbing || '…');
    try {
      const extracted = buildExtractedDataUrl(state.srcCanvas, state.accum, state.sw, state.sh);
      if (!extracted) return;
      await new Promise((resolve, reject) => {
        fabric.Image.fromURL(extracted.dataUrl, (obj) => {
          if (!obj) return reject(new Error('image load failed'));
          obj.set({
            left: state.frame.left + extracted.minX * state.frame.scaleX,
            top: state.frame.top + extracted.minY * state.frame.scaleY,
            scaleX: state.frame.scaleX, scaleY: state.frame.scaleY,
            name: ED.i18n.magicGrabLayerName || 'Grabbed object',
          });
          canvas.add(obj);
          canvas.setActiveObject(obj);
          resolve();
        });
      });

      let erasedDataUrl = null;
      if (ED.magicGrabInpaintAvailable) {
        setHint(ED.i18n.magicGrabInpainting || '…');
        try {
          erasedDataUrl = await buildInpaintedDataUrl(state.srcCanvas, state.accum, state.sw, state.sh);
        } catch (e) {
          console.error('[magicgrab] inpaint failed, falling back to a transparent erase', e);
        }
      }
      if (!erasedDataUrl) erasedDataUrl = buildErasedTransparentDataUrl(state.srcCanvas, state.accum, state.sw, state.sh);

      await new Promise((resolve, reject) => {
        state.img.setSrc(erasedDataUrl, (loaded) => {
          if (!loaded) return reject(new Error('setSrc failed'));
          state.img.set({ cropX: 0, cropY: 0 });
          canvas.requestRenderAll();
          resolve();
        }, { crossOrigin: 'anonymous' });
      });

      ED.record();

      // pixels just changed under us — refresh the working snapshot and drop
      // the now-stale embedding/mask so a further grab in the same session
      // sees the erased/inpainted result (same pattern lasso.js follows
      // after its own erase action)
      state.srcCanvas = buildSourceCanvas(state.img);
      state.accum.fill(0);
      state.embeddingPromise = null;
      redrawPreview();
      setHint(state.mode === 'brush' ? (ED.i18n.magicGrabHintBrush || '') : (ED.i18n.magicGrabHintClick || ''));
    } catch (e) {
      console.error('[magicgrab] grab failed', e);
      setHint(ED.i18n.magicGrabError || '');
    } finally {
      setAllDisabled(false);
    }
  });

  /* ---- entry points: image-properties panel + background panel ---------- */
  const btn = document.getElementById('magicGrabBtn');
  const bgBtn = document.getElementById('bgMagicGrabBtn');
  const bgHint = document.getElementById('bgMagicGrabHint');

  if (btn) {
    if (!ED.magicGrabModelAvailable) btn.title = ED.i18n.magicGrabModelUnavailable || '';
    btn.addEventListener('click', () => magicGrabStart(canvas.getActiveObject()));
  }
  if (bgBtn) {
    if (!ED.magicGrabModelAvailable) bgBtn.title = ED.i18n.magicGrabModelUnavailable || '';
    bgBtn.addEventListener('click', () => {
      const img = ED.getBgImage && ED.getBgImage();
      if (!img) { if (bgHint) bgHint.textContent = ED.i18n.bgNoImage || ''; return; }
      if (bgHint) bgHint.textContent = '';
      magicGrabStart(img);
    });
  }
})();
