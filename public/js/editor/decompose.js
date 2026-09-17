'use strict';

/* ============================================================================
   "Decompose elements" — detects individual objects inside a photo
   (TensorFlow.js + COCO-SSD, running fully client-side, self-hosted so it
   works offline) and lists each one so the user can act on it individually:
   extract it onto its own layer (optionally cutting its background out via
   the same segmenter bgremoval.js uses, on a transparent/white/custom-image
   backdrop — reusing ED.removeBackground exactly as the Remove Background
   panel does), or erase it from the photo instead. Nothing is placed on the
   canvas until the user picks an action for a specific piece — running
   detection no longer dumps every detected box onto the canvas at once.

   COCO-SSD only gives bounding boxes, not per-object silhouettes, so a plain
   "crop only" extraction is a rectangular cutout that may include bits of
   whatever is next to it in the photo; picking one of the background-removal
   modes mattes it properly instead (best on a detected "person", the one
   class the segmenter is actually trained for, but available for any box).

   Exposes the detect+extract+render core (ED.detectElements /
   ED.decomposeExtractPiece / ED.decomposeRenderResults) for reuse by the
   standalone "Decompose" tab (decompose-tab.js), the same split bgremoval.js
   uses for its own standalone tab.
   ========================================================================== */

(function () {
  const ED = window.ED;
  const canvas = ED.canvas;
  const cfg = ED.data.decompose || {};
  ED.decomposeAvailable = !!cfg.available;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error(`failed to load ${src}`));
      document.head.appendChild(s);
    });
  }

  function withTimeout(promise, ms, message) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }

  // Loading tf.js/coco-ssd is cached per backend, so a fallback to a different
  // backend (see runDetection) gets its own freshly-loaded model rather than
  // reusing one whose weights/ops were bound to the backend that just failed.
  const modelPromises = {};
  function getModel(backend) {
    const key = backend || 'default';
    if (!modelPromises[key]) {
      modelPromises[key] = Promise.resolve()
        .then(() => (window.tf ? null : loadScript(cfg.tfUrl)))
        .then(() => (window.cocoSsd ? null : loadScript(cfg.cocoSsdUrl)))
        .then(() => (backend ? window.tf.setBackend(backend).then(() => window.tf.ready()) : null))
        .then(() => window.cocoSsd.load({ modelUrl: cfg.modelUrl }))
        .catch((e) => { delete modelPromises[key]; throw e; }); // let a later click retry after a transient failure
    }
    return modelPromises[key];
  }

  // COCO's fixed 80-class vocabulary — only used to label the detected pieces.
  const LABELS_AR = {
    person: 'شخص', bicycle: 'دراجة هوائية', car: 'سيارة', motorcycle: 'دراجة نارية',
    airplane: 'طائرة', bus: 'حافلة', train: 'قطار', truck: 'شاحنة', boat: 'قارب',
    'traffic light': 'إشارة مرور', 'fire hydrant': 'صنبور إطفاء', 'stop sign': 'لافتة توقف',
    'parking meter': 'عداد موقف', bench: 'مقعد', bird: 'طائر', cat: 'قطة', dog: 'كلب',
    horse: 'حصان', sheep: 'خروف', cow: 'بقرة', elephant: 'فيل', bear: 'دب',
    zebra: 'حمار وحشي', giraffe: 'زرافة', backpack: 'حقيبة ظهر', umbrella: 'مظلة',
    handbag: 'حقيبة يد', tie: 'ربطة عنق', suitcase: 'حقيبة سفر', frisbee: 'طبق طائر',
    skis: 'زلاجات تزلج', snowboard: 'لوح تزلج', 'sports ball': 'كرة رياضية', kite: 'طائرة ورقية',
    'baseball bat': 'مضرب بيسبول', 'baseball glove': 'قفاز بيسبول', skateboard: 'لوح تزلج بعجلات',
    surfboard: 'لوح ركمجة', 'tennis racket': 'مضرب تنس', bottle: 'زجاجة', 'wine glass': 'كأس نبيذ',
    cup: 'كوب', fork: 'شوكة', knife: 'سكين', spoon: 'ملعقة', bowl: 'وعاء', banana: 'موز',
    apple: 'تفاحة', sandwich: 'ساندويتش', orange: 'برتقالة', broccoli: 'بروكلي', carrot: 'جزر',
    'hot dog': 'هوت دوج', pizza: 'بيتزا', donut: 'دونات', cake: 'كيكة', chair: 'كرسي',
    couch: 'أريكة', 'potted plant': 'نبتة أصيص', bed: 'سرير', 'dining table': 'طاولة طعام',
    toilet: 'مرحاض', tv: 'تلفاز', laptop: 'لابتوب', mouse: 'فأرة', remote: 'ريموت',
    keyboard: 'لوحة مفاتيح', 'cell phone': 'هاتف', microwave: 'ميكروويف', oven: 'فرن',
    toaster: 'محمصة', sink: 'مغسلة', refrigerator: 'ثلاجة', book: 'كتاب', clock: 'ساعة',
    vase: 'مزهرية', scissors: 'مقص', 'teddy bear': 'دبدوب', 'hair drier': 'مجفف شعر',
    toothbrush: 'فرشاة أسنان',
  };
  function labelFor(cls) {
    return (ED.lang === 'ar' && LABELS_AR[cls]) || cls;
  }

  function cropToDataUrl(srcCanvas, x, y, w, h) {
    const piece = document.createElement('canvas');
    piece.width = w; piece.height = h;
    piece.getContext('2d').drawImage(srcCanvas, x, y, w, h, 0, 0, w, h);
    return piece.toDataURL('image/png');
  }

  async function runDetection(srcCanvas) {
    let model = await getModel();
    let backendUsed = window.tf.getBackend();
    let raw = await model.detect(srcCanvas, 10, 0.2);
    console.log('[decompose] backend', backendUsed, 'raw detections:', raw.length, raw);
    if (!raw.length && backendUsed !== 'cpu') {
      // Mobile WebGL implementations have a history of silently producing
      // empty/degenerate output with TF.js on some devices — cpu is slower
      // but far more consistent, so it's worth one retry before giving up.
      console.log('[decompose] retrying detection on the cpu backend');
      model = await getModel('cpu');
      raw = await model.detect(srcCanvas, 10, 0.2);
      console.log('[decompose] backend cpu, raw detections:', raw.length, raw);
    }
    return raw;
  }

  // Runs detection on an already-drawn sw x sh canvas; returns up to 10 boxes
  // sorted by confidence, each { bx, by, bw, bh, cls, name }. COCO-SSD's own
  // default confidence floor (0.5) missed most real photos in testing —
  // lite_mobilenet_v2 is a small, fast model, and 0.5 is a high bar for
  // anything but a clean, canonically-posed subject. 0.2 trades some junk
  // boxes (easy to just ignore) for actually finding something most of the
  // time — the right side of that trade-off, since a false positive costs
  // nothing (the user simply skips it) and a false negative makes the
  // feature feel broken.
  async function detectElements(srcCanvas) {
    const sw = srcCanvas.width, sh = srcCanvas.height;
    const raw = await withTimeout(runDetection(srcCanvas), 30000, 'model timed out');
    return raw
      .sort((a, b) => b.score - a.score)
      .map((d) => {
        const [bx, by, bw, bh] = d.bbox.map((v) => Math.max(0, Math.round(v)));
        return { bx, by, bw, bh, cls: d.class, name: labelFor(d.class) };
      })
      .filter((b) => b.bw >= 4 && b.bh >= 4 && b.bx + b.bw <= sw && b.by + b.bh <= sh);
  }

  // Produces the data URL for one piece per the chosen mode:
  //  - 'crop'        plain rectangular cutout (old default, no ML beyond detection)
  //  - 'transparent' / 'white' / 'image'  matte it via the same selfie
  //    segmenter bgremoval.js uses (ED.removeBackground), same three modes
  //    the Remove Background panel already offers for a placed image.
  async function pieceDataUrl(srcCanvas, b, mode, backdropEl) {
    if (mode && mode !== 'crop' && ED.bgRemovalAvailable && ED.removeBackground) {
      return ED.removeBackground(srcCanvas, b.bx, b.by, b.bw, b.bh, mode, backdropEl);
    }
    return cropToDataUrl(srcCanvas, b.bx, b.by, b.bw, b.bh);
  }

  // Extracts exactly ONE detected box onto its own new fabric.Image layer —
  // never the rest of the detected boxes — positioned within {left, top,
  // scaleX, scaleY} (the on-canvas frame the srcCanvas's own sw x sh pixels
  // map onto).
  async function decomposeExtractPiece(srcCanvas, b, frame, mode, backdropEl) {
    const dataUrl = await pieceDataUrl(srcCanvas, b, mode, backdropEl);
    return new Promise((resolve, reject) => {
      fabric.Image.fromURL(dataUrl, (obj) => {
        if (!obj) return reject(new Error('image load failed'));
        obj.set({
          left: frame.left + b.bx * frame.scaleX,
          top: frame.top + b.by * frame.scaleY,
          scaleX: frame.scaleX, scaleY: frame.scaleY,
          name: b.name,
        });
        canvas.add(obj);
        canvas.setActiveObject(obj);
        canvas.requestRenderAll();
        ED.record();
        resolve(obj);
      });
    });
  }

  // Builds the interactive per-piece results list inside `container`: a
  // thumbnail + label per detected box, a background-mode row for
  // extraction (crop only / transparent / white / from a second photo) and
  // an erase button. `onErase(box)` is the only part that differs between
  // callers (an already-placed canvas image vs. the standalone tab's own
  // working copy) — everything else (extraction) is identical either way.
  function renderResults(container, srcCanvas, boxes, frame, onErase) {
    container.innerHTML = '';
    container.hidden = false;

    const hint = document.createElement('p');
    hint.className = 'ed-hint';
    hint.textContent = ED.i18n.decomposePick || '';
    container.appendChild(hint);

    // Bulk action: extract EVERY detected piece with its background removed
    // AND erase each from the base photo in the same pass — so what's left
    // of the original image is just whatever wasn't detected as an object
    // ("the background"), and every detected thing is now its own separate
    // transparent-background layer. The per-piece controls below still work
    // individually/first if some rows are already marked done.
    const allBtn = document.createElement('button');
    allBtn.type = 'button';
    allBtn.className = 'btn btn-primary btn-sm ed-block ed-decompose-all';
    allBtn.textContent = ED.i18n.decomposeExtractAll || 'Decompose everything';
    allBtn.title = ED.i18n.decomposeExtractAllHint || '';
    allBtn.addEventListener('click', async () => {
      allBtn.disabled = true;
      const rows = [...container.querySelectorAll('.ed-decompose-row')];
      for (let i = 0; i < boxes.length; i++) {
        const row = rows[i];
        if (!row || row.classList.contains('done')) continue; // already handled individually
        const rowErr = row.querySelector('.ed-decompose-rowerr');
        try {
          // sequential, not parallel: erasing punches a hole into the SAME
          // underlying image/canvas each time (read-modify-write) — running
          // these concurrently would race and lose all but the last one
          await decomposeExtractPiece(srcCanvas, boxes[i], frame, 'transparent');
          await onErase(boxes[i]);
          row.classList.add('done');
          row.querySelectorAll('button').forEach((b) => { b.disabled = true; });
          const doneBadge = row.querySelector('.ed-decompose-donebadge');
          if (doneBadge) doneBadge.hidden = false;
        } catch (e) {
          console.error('[decompose] extract-all failed on', boxes[i], e);
          if (rowErr) { rowErr.textContent = ED.i18n.decomposeError || ''; rowErr.hidden = false; }
        }
      }
      allBtn.hidden = true;
    });
    container.appendChild(allBtn);

    boxes.forEach((b) => {
      const row = document.createElement('div');
      row.className = 'ed-decompose-row';

      const thumb = document.createElement('img');
      thumb.className = 'ed-decompose-thumb';
      thumb.alt = b.name;
      thumb.src = cropToDataUrl(srcCanvas, b.bx, b.by, b.bw, b.bh);
      row.appendChild(thumb);

      const info = document.createElement('div');
      info.className = 'ed-decompose-info';
      row.appendChild(info);

      const label = document.createElement('span');
      label.className = 'ed-decompose-label';
      label.textContent = b.name;
      info.appendChild(label);

      const modeLabel = document.createElement('span');
      modeLabel.className = 'ed-decompose-sublabel';
      modeLabel.textContent = ED.i18n.decomposeExtract || 'Extract';
      info.appendChild(modeLabel);

      const modeRow = document.createElement('div');
      modeRow.className = 'ed-btnrow ed-actions-row';
      info.appendChild(modeRow);

      const imageBtn = document.createElement('button');
      imageBtn.type = 'button';
      imageBtn.className = 'btn btn-ghost btn-sm ed-block';
      imageBtn.textContent = ED.i18n.removeBgImage || 'Custom image…';
      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = 'image/png,image/jpeg,image/webp';
      fileInput.hidden = true;

      const eraseBtn = document.createElement('button');
      eraseBtn.type = 'button';
      eraseBtn.className = 'btn btn-ghost btn-sm ed-block ed-decompose-erase';
      eraseBtn.textContent = ED.i18n.decomposeErase || 'Erase from photo';

      const err = document.createElement('p');
      err.className = 'ed-hint ed-decompose-rowerr';
      err.hidden = true;

      const done = document.createElement('span');
      done.className = 'ed-decompose-donebadge';
      done.textContent = ED.i18n.decomposeDone || 'Done';
      done.hidden = true;

      const allBtns = () => [...modeRow.querySelectorAll('button'), imageBtn, eraseBtn];
      function setBusy(v) { allBtns().forEach((btn) => (btn.disabled = v)); }
      function markDone() {
        row.classList.add('done');
        setBusy(true);
        done.hidden = false;
      }
      function showError(msg) {
        err.textContent = msg || '';
        err.hidden = false;
      }

      [
        ['crop', ED.i18n.removeBgNone || 'Crop only'],
        ['transparent', ED.i18n.removeBgTransparent || 'Transparent'],
        ['white', ED.i18n.removeBgWhite || 'White'],
      ].forEach(([mode, text]) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ed-wbtn';
        btn.textContent = text;
        btn.addEventListener('click', () => runExtract(mode));
        modeRow.appendChild(btn);
      });

      async function runExtract(mode, backdropEl) {
        err.hidden = true;
        setBusy(true);
        try {
          await decomposeExtractPiece(srcCanvas, b, frame, mode, backdropEl);
          markDone();
        } catch (e) {
          console.error('[decompose] extract failed', e);
          showError(ED.i18n.decomposeError);
          setBusy(false);
        }
      }

      imageBtn.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', () => {
        const file = fileInput.files[0];
        fileInput.value = '';
        if (!file) return;
        const url = URL.createObjectURL(file);
        const backdropImg = new Image();
        backdropImg.onload = () => { runExtract('image', backdropImg); URL.revokeObjectURL(url); };
        backdropImg.onerror = () => URL.revokeObjectURL(url);
        backdropImg.src = url;
      });
      info.appendChild(imageBtn);
      info.appendChild(fileInput);

      eraseBtn.addEventListener('click', async () => {
        err.hidden = true;
        setBusy(true);
        try {
          await onErase(b);
          markDone();
        } catch (e) {
          console.error('[decompose] erase failed', e);
          showError(ED.i18n.decomposeEraseError);
          setBusy(false);
        }
      });
      info.appendChild(eraseBtn);
      info.appendChild(err);
      info.appendChild(done);

      container.appendChild(row);
    });
  }

  ED.detectElements = detectElements;
  ED.decomposeExtractPiece = decomposeExtractPiece;
  ED.decomposeRenderResults = renderResults;

  // Runs detection on `img` (any already-placed fabric.Image — a regular
  // canvas object OR the non-selectable background image) and renders the
  // interactive results list into `results`. Shared by the image-properties
  // panel (acts on the selected image) and the Background panel (acts on
  // ED.getBgImage(), which can never become the "active object" since it's
  // deliberately selectable:false — this is the only way to decompose it
  // without re-uploading the same photo as a separate regular image first).
  async function runDecomposeOn(img, btn, hint, results) {
    if (!img || img.type !== 'image' || !img._element) return;
    btn.disabled = true;
    hint.textContent = ED.i18n.decomposeWorking || '…';
    results.hidden = true;
    try {
      const sw = img.width, sh = img.height;
      const src = document.createElement('canvas');
      src.width = sw; src.height = sh;
      src.getContext('2d').drawImage(img._element, img.cropX || 0, img.cropY || 0, sw, sh, 0, 0, sw, sh);

      const boxes = await detectElements(src);
      if (!boxes.length) {
        hint.textContent = ED.i18n.decomposeNone || '';
        return;
      }

      // Map boxes back into canvas space via the image's current (axis-aligned)
      // bounding rect — exact when the image isn't rotated, an acceptable
      // approximation when it is.
      const rect = img.getBoundingRect(true, true);
      const frame = {
        left: rect.left, top: rect.top,
        scaleX: rect.width / sw, scaleY: rect.height / sh,
      };

      // Erasing here punches a transparent hole directly into this same
      // placed image (the live fabric object), the same setSrc + reset-crop
      // pattern the Remove Background panel uses — so the piece actually
      // disappears from the photo instead of a duplicate layer just sitting
      // on top of untouched original content underneath it.
      async function eraseFromCanvasImage(b) {
        const full = document.createElement('canvas');
        full.width = sw; full.height = sh;
        full.getContext('2d').drawImage(img._element, img.cropX || 0, img.cropY || 0, sw, sh, 0, 0, sw, sh);
        full.getContext('2d').clearRect(b.bx, b.by, b.bw, b.bh);
        const dataUrl = full.toDataURL('image/png');
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

      hint.textContent = '';
      renderResults(results, src, boxes, frame, eraseFromCanvasImage);
    } catch (e) {
      console.error('[decompose]', e);
      hint.textContent = ED.i18n.decomposeError || 'Failed';
    } finally {
      btn.disabled = false;
    }
  }

  /* ---- image-properties-panel control (an image already placed on canvas) - */
  const btn = document.getElementById('decomposeBtn');
  const hint = document.getElementById('decomposeHint');
  const results = document.getElementById('decomposeResults');
  if (!btn) return;

  const bgBtn = document.getElementById('bgDecomposeBtn');
  const bgHint = document.getElementById('bgDecomposeHint');
  const bgResults = document.getElementById('bgDecomposeResults');

  if (!cfg.available) {
    btn.disabled = true;
    btn.title = ED.i18n.decomposeUnavailable || '';
    if (bgBtn) { bgBtn.disabled = true; bgBtn.title = ED.i18n.decomposeUnavailable || ''; }
    return;
  }

  btn.addEventListener('click', () => runDecomposeOn(canvas.getActiveObject(), btn, hint, results));

  /* ---- background-panel control (the design's own background image) ----- */
  if (bgBtn && bgHint && bgResults) {
    bgBtn.addEventListener('click', () => {
      const img = ED.getBgImage && ED.getBgImage();
      if (!img) { bgHint.textContent = ED.i18n.bgNoImage || ''; return; }
      runDecomposeOn(img, bgBtn, bgHint, bgResults);
    });
  }
})();
