'use strict';

/* ============================================================================
   رسمة / Rasmah editor — core: canvas, zoom/pan, background, history, autosave
   Exposes a global `ED` used by objects.js / props.js / io.js
   ========================================================================== */

window.ED = (function () {
  const raw = document.getElementById('edData').textContent;
  const data = JSON.parse(raw);

  const MIN_ZOOM = 0.02;
  const MAX_ZOOM = 8;
  const EXTRA_PROPS = [
    'name', 'selectable', 'evented', 'hasControls', 'hasBorders',
    'lockMovementX', 'lockMovementY', 'lockScalingX', 'lockScalingY',
    'lockRotation', 'editable', 'direction', 'id', 'curveAmount',
    'isFrame', 'frameShape', 'gradientAngle', 'chartType', 'chartRaw',
  ];
  const ARTBOARD = '__artboard';
  const BGIMAGE = '__bgimage';

  const workspace = document.getElementById('workspace');
  const canvasArea = document.getElementById('canvasArea');
  const canvasEl = document.getElementById('c');

  const canvas = new fabric.Canvas('c', {
    preserveObjectStacking: true,
    selection: true,
    controlsAboveOverlay: true,
    backgroundColor: '',
  });
  fabric.Object.prototype.set({
    cornerColor: '#7c5cff',
    cornerStyle: 'circle',
    cornerSize: 10,
    // Fabric hit-tests corner controls against this (not cornerSize) when the
    // pointer is a touch — the visible dot stays 10px (desktop-sized, doesn't
    // look bulky), but a finger gets a much more forgiving ~44px grab area
    // around it (Apple/Google's minimum comfortable touch target — same
    // guidance already used for the mobile panel-close buttons elsewhere).
    // Fabric's own default here is only 24, still below that.
    touchCornerSize: 44,
    transparentCorners: false,
    borderColor: '#7c5cff',
    borderScaleFactor: 1.5,
    padding: 0,
  });

  const ED = {
    data,
    canvas,
    W: data.width,
    H: data.height,
    zoom: 1,
    i18n: data.i18n,
    lang: data.lang,
    dirty: false,
    _suspendHistory: false,
    EXTRA_PROPS,
  };

  /* ---- recently used colors / fonts -----------------------------------
     A per-browser convenience (localStorage, not synced to the account —
     there's nowhere server-side this naturally belongs, and it doesn't need
     to be) so repeating a color/font you just used doesn't mean re-opening
     the full picker/list every time. */
  const RECENT_CAP = 8;
  function loadRecent(key) {
    try { return JSON.parse(localStorage.getItem(key)) || []; } catch (e) { return []; }
  }
  function pushRecent(key, value) {
    if (!value) return loadRecent(key);
    const list = [value, ...loadRecent(key).filter((v) => v !== value)].slice(0, RECENT_CAP);
    try { localStorage.setItem(key, JSON.stringify(list)); } catch (e) { /* storage full/blocked — the app still works, just without this convenience */ }
    return list;
  }
  ED.trackRecentColor = (hex) => pushRecent('rasmah_recent_colors', hex);
  ED.trackRecentFont = (family) => pushRecent('rasmah_recent_fonts', family);
  ED.recentColors = () => loadRecent('rasmah_recent_colors');
  ED.recentFonts = () => loadRecent('rasmah_recent_fonts');

  // Curved text (props.js) stores only a plain `curveAmount` number — the
  // fabric.Path it renders against is rebuilt fresh here every time a JSON
  // snapshot loads (undo/redo, page switch, template load, initial boot),
  // rather than trusting the Path object itself to round-trip through
  // canvas.toJSON()/loadFromJSON, which every one of those call sites uses.
  const _loadFromJSON = canvas.loadFromJSON.bind(canvas);
  canvas.loadFromJSON = function (json, callback, reviver) {
    return _loadFromJSON(json, function () {
      canvas.getObjects().forEach((o) => {
        if (o.curveAmount && ED.applyTextCurve) ED.applyTextCurve(o, o.curveAmount);
      });
      if (callback) callback();
    }, reviver);
  };

  /* ---- sizing / zoom / pan ------------------------------------------------- */
  function resizeCanvasToViewport() {
    const r = canvasArea.getBoundingClientRect();
    canvas.setWidth(r.width);
    canvas.setHeight(r.height);
    canvas.calcOffset();
    canvas.requestRenderAll();
  }
  // keep Fabric's pointer offset correct if anything shifts layout
  window.addEventListener('scroll', () => canvas.calcOffset(), true);

  function clampZoom(z) {
    return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
  }

  function updateZoomLabel() {
    document.getElementById('zoomVal').textContent = Math.round(ED.zoom * 100) + '%';
  }

  ED.setZoom = function (z, point) {
    z = clampZoom(z);
    if (point) {
      canvas.zoomToPoint(point, z);
    } else {
      const c = new fabric.Point(canvas.getWidth() / 2, canvas.getHeight() / 2);
      canvas.zoomToPoint(c, z);
    }
    ED.zoom = z;
    updateZoomLabel();
    canvas.requestRenderAll();
  };

  ED.zoomBy = function (factor) {
    ED.setZoom(ED.zoom * factor);
  };

  ED.fit = function () {
    const pad = 90;
    const vw = canvas.getWidth();
    const vh = canvas.getHeight();
    const z = clampZoom(Math.min((vw - pad) / ED.W, (vh - pad) / ED.H));
    canvas.setZoom(z);
    const vpt = canvas.viewportTransform.slice();
    vpt[4] = (vw - ED.W * z) / 2;
    vpt[5] = (vh - ED.H * z) / 2;
    canvas.setViewportTransform(vpt);
    ED.zoom = z;
    updateZoomLabel();
    canvas.requestRenderAll();
  };

  // pan with space-drag or middle mouse
  let spaceDown = false;
  let panning = false;
  let lastPan = null;

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !isTyping(e)) {
      spaceDown = true;
      workspace.classList.add('panning');
      e.preventDefault();
    }
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') {
      spaceDown = false;
      workspace.classList.remove('panning', 'active');
    }
  });

  canvas.on('mouse:down', (opt) => {
    const e = opt.e;
    if (spaceDown || e.button === 1) {
      panning = true;
      lastPan = new fabric.Point(e.clientX, e.clientY);
      workspace.classList.add('active');
      canvas.selection = false;
      canvas.discardActiveObject();
      opt.e.preventDefault();
    }
  });
  canvas.on('mouse:move', (opt) => {
    if (!panning) return;
    const e = opt.e;
    const p = new fabric.Point(e.clientX, e.clientY);
    canvas.relativePan(new fabric.Point(p.x - lastPan.x, p.y - lastPan.y));
    lastPan = p;
  });
  canvas.on('mouse:up', () => {
    if (panning) {
      panning = false;
      canvas.selection = true;
      workspace.classList.remove('active');
    }
  });

  // Shared "is Fabric currently mid drag/scale/rotate of an object" flag —
  // read by the pinch-zoom gate below (so a second finger landing mid-drag
  // doesn't hijack into a canvas-zoom gesture and abandon the object
  // transform, previously the "pinch zoom fights with moving an object" bug)
  // and by io.js's floatbar (hidden while this is true, matching Canva's
  // own behavior of the toolbar disappearing during an active manipulation).
  ED._transforming = false;
  ['object:moving', 'object:scaling', 'object:rotating'].forEach((ev) =>
    canvas.on(ev, () => { ED._transforming = true; })
  );
  // object:modified fires once a transform actually completes; mouse:up is a
  // safety net for the rare case a transform starts but ends with no net
  // change (so object:modified never fires) — both are harmless to double-set.
  canvas.on('object:modified', () => { ED._transforming = false; });
  canvas.on('mouse:up', () => { ED._transforming = false; });

  // hold Shift while rotating to snap to 15° steps (0, 15, 30, ...) — free
  // rotation otherwise, same convention as Illustrator/Figma
  const ROTATE_SNAP_DEG = 15;
  canvas.on('object:rotating', (opt) => {
    if (opt.e && opt.e.shiftKey) {
      opt.target.angle = Math.round(opt.target.angle / ROTATE_SNAP_DEG) * ROTATE_SNAP_DEG;
    }
  });

  canvas.on('mouse:wheel', (opt) => {
    const e = opt.e;
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      e.stopPropagation();
      const delta = e.deltaY;
      const factor = delta > 0 ? 0.92 : 1.08;
      ED.setZoom(ED.zoom * factor, new fabric.Point(e.offsetX, e.offsetY));
    } else {
      e.preventDefault();
      const vpt = canvas.viewportTransform.slice();
      if (e.shiftKey) vpt[4] -= e.deltaY;
      else {
        vpt[4] -= e.deltaX;
        vpt[5] -= e.deltaY;
      }
      canvas.setViewportTransform(vpt);
    }
  });

  /* ---- touch: two-finger pinch-zoom + pan --------------------------------
     Fabric only wires up single-touch (translated internally into its usual
     mouse:* events, which is why one-finger dragging of objects already
     works) — it has no multi-touch gesture support at all, so on a phone
     there was previously no way to zoom/pan the canvas except the tiny +/-
     buttons. Listened on canvasArea (an ANCESTOR of Fabric's own canvas
     element) with capture:true so this runs during the capture pass, before
     the event ever reaches Fabric's target-phase listeners — stopping
     propagation here fully hides the 2-finger gesture from Fabric, while a
     single finger is left untouched and still reaches Fabric normally.

     Guarded on ED._transforming: without it, a second finger landing while
     the first is already mid-drag of an object got hijacked into a pinch
     gesture — Fabric's own transform kept "running" internally with no more
     move events feeding it (this handler was now swallowing them) while
     discardActiveObject() below also ripped away its selection, so the
     object would visibly glitch/stick. Only a fresh 2-finger touch that
     lands with nothing already being dragged starts a pinch now. */
  (function () {
    function dist(a, b) { return Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY); }
    function mid(a, b) { return { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 }; }
    let pinch = null;
    canvasArea.addEventListener('touchstart', (e) => {
      if (e.touches.length < 2 || ED._transforming || ED._lassoing || ED._magicGrabbing) return;
      e.preventDefault();
      e.stopPropagation();
      canvas.discardActiveObject();
      canvas.selection = false;
      canvas.requestRenderAll();
      pinch = { startDist: dist(e.touches[0], e.touches[1]), startZoom: ED.zoom, lastMid: mid(e.touches[0], e.touches[1]) };
    }, { capture: true, passive: false });
    canvasArea.addEventListener('touchmove', (e) => {
      if (!pinch || e.touches.length < 2) return;
      e.preventDefault();
      e.stopPropagation();
      const d = dist(e.touches[0], e.touches[1]);
      const m = mid(e.touches[0], e.touches[1]);
      const rect = canvasArea.getBoundingClientRect();
      ED.setZoom(pinch.startZoom * (d / pinch.startDist), new fabric.Point(m.x - rect.left, m.y - rect.top));
      canvas.relativePan(new fabric.Point(m.x - pinch.lastMid.x, m.y - pinch.lastMid.y));
      pinch.lastMid = m;
    }, { capture: true, passive: false });
    function endPinch(e) {
      if (!pinch) return;
      if (e.touches.length >= 2) return;
      pinch = null;
      canvas.selection = true;
    }
    canvasArea.addEventListener('touchend', endPinch, { capture: true });
    canvasArea.addEventListener('touchcancel', endPinch, { capture: true });
  })();

  /* ---- touch: keyboard-aware bottom UI + hide the tab bar while editing text
     Editing text opens the on-screen keyboard, which on a phone covers
     roughly the bottom half of the screen — the bottom-pinned floatbar (its
     text-formatting controls: bold, color, ...) would otherwise sit BEHIND
     it, since `position:fixed` by default tracks the layout viewport, not
     the visual one the keyboard shrinks. window.visualViewport is the
     standard fix: its height shrinking by exactly the keyboard's height is
     the signal, exposed here as a --kb-inset CSS var the mobile stylesheet
     adds into the floatbar's `bottom` offset. */
  if (window.visualViewport) {
    const vv = window.visualViewport;
    function updateKeyboardInset() {
      const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      document.documentElement.style.setProperty('--kb-inset', inset + 'px');
    }
    vv.addEventListener('resize', updateKeyboardInset);
    vv.addEventListener('scroll', updateKeyboardInset);
  }
  // the main bottom tab bar only gets in the way while typing — Canva's own
  // mobile editor swaps it out for just the text-formatting toolbar (the
  // floatbar) the moment text editing starts.
  const tabsEl = document.querySelector('.ed-tabs');
  canvas.on('text:editing:entered', () => { if (tabsEl) tabsEl.classList.add('ed-typing'); });
  canvas.on('text:editing:exited', () => { if (tabsEl) tabsEl.classList.remove('ed-typing'); });

  /* ---- artboard + background -------------------------------------------- */
  function getArtboard() {
    return canvas.getObjects().find((o) => o.name === ARTBOARD);
  }
  function getBgImage() {
    return canvas.getObjects().find((o) => o.name === BGIMAGE);
  }

  function ensureArtboard(fill) {
    let ab = getArtboard();
    if (!ab) {
      ab = new fabric.Rect({
        name: ARTBOARD,
        left: 0, top: 0,
        width: ED.W, height: ED.H,
        fill: fill || '#ffffff',
        selectable: false,
        evented: false,
        hoverCursor: 'default',
        excludeFromExport: false,
      });
      canvas.add(ab);
    }
    canvas.sendToBack(ab);
    return ab;
  }

  function applyClip() {
    canvas.clipPath = new fabric.Rect({
      left: 0, top: 0, width: ED.W, height: ED.H, absolutePositioned: true,
    });
  }

  ED.setBackgroundColor = function (color) {
    ensureArtboard().set('fill', color);
    canvas.requestRenderAll();
    ED.record();
  };

  ED.setBackgroundImage = function (url) {
    fabric.Image.fromURL(url, (img) => {
      if (!img) return;
      const old = getBgImage();
      if (old) canvas.remove(old);
      const scale = Math.max(ED.W / img.width, ED.H / img.height);
      img.set({
        name: BGIMAGE,
        left: ED.W / 2, top: ED.H / 2,
        originX: 'center', originY: 'center',
        scaleX: scale, scaleY: scale,
        selectable: false, evented: false, hoverCursor: 'default',
      });
      canvas.add(img);
      const ab = getArtboard();
      if (ab) img.moveTo(canvas.getObjects().indexOf(ab) + 1);
      canvas.requestRenderAll();
      ED.record();
    });
  };

  ED.clearBackground = function () {
    const old = getBgImage();
    if (old) canvas.remove(old);
    ensureArtboard().set('fill', '#ffffff');
    canvas.requestRenderAll();
    ED.record();
  };

  ED.getArtboard = getArtboard;
  ED.getBgImage = getBgImage;
  ED.ARTBOARD = ARTBOARD;
  ED.BGIMAGE = BGIMAGE;

  ED.resizeArtboard = function (w, h) {
    ED.W = w; ED.H = h;
    const ab = getArtboard();
    if (ab) ab.set({ width: w, height: h });
    applyClip();
    ED.fit();
  };
  ED.applyClip = applyClip;

  /* ---- magic resize --------------------------------------------------------
     Converts every page of the design to a new width/height: content is scaled
     uniformly (no distortion) and centred, the artboard is set to the new size,
     and any full-bleed background image is re-fitted to cover it. -------------- */
  ED.magicResize = function (newW, newH) {
    newW = Math.round(newW); newH = Math.round(newH);
    if (!newW || !newH) return;
    if (newW === ED.W && newH === ED.H && ED.pages.length === 1) return;
    captureActivePage();

    ED.pages.forEach((p) => {
      const oldW = p.width, oldH = p.height;
      if (oldW !== newW || oldH !== newH) {
        const scale = Math.min(newW / oldW, newH / oldH);
        const offX = (newW - oldW * scale) / 2;
        const offY = (newH - oldH * scale) / 2;
        const objs = (p.json.objects || []).map((o) => {
          const c = Object.assign({}, o);
          if (c.name === ARTBOARD) {
            return Object.assign(c, { left: 0, top: 0, width: newW, height: newH });
          }
          if (c.name === BGIMAGE) {
            const iw = c.width || 1, ih = c.height || 1;
            const cover = Math.max(newW / iw, newH / ih);
            return Object.assign(c, { left: newW / 2, top: newH / 2, scaleX: cover, scaleY: cover });
          }
          return Object.assign(c, {
            left: offX + (c.left || 0) * scale,
            top: offY + (c.top || 0) * scale,
            scaleX: (c.scaleX == null ? 1 : c.scaleX) * scale,
            scaleY: (c.scaleY == null ? 1 : c.scaleY) * scale,
          });
        });
        p.json = Object.assign({}, p.json, { objects: objs });
        p.width = newW;
        p.height = newH;
      }
      p.undo = [JSON.stringify(p.json)];
      p.redo = [];
      p.thumb = '';
    });

    activatePage(ED.activePage);
    ED.dirty = true;
    setSaveState('unsaved');
    scheduleAutosave();
  };

  /* ---- draw a subtle frame around the artboard ------------------------- */
  canvas.on('after:render', () => {
    const ctx = canvas.getContext();
    const vpt = canvas.viewportTransform;
    const x = vpt[4], y = vpt[5], w = ED.W * ED.zoom, h = ED.H * ED.zoom;
    ctx.save();
    ctx.strokeStyle = 'rgba(20,16,50,.14)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w, h);
    ctx.restore();
    if (window.ED_drawGuides) window.ED_drawGuides(ctx);
  });

  /* ---- history (per-page: swapped on page switch, see "pages" below) ---- */
  let undoStack = [];
  let redoStack = [];
  const CAP = 40;
  let recordTimer = null;

  function snapshot() {
    return JSON.stringify(canvas.toJSON(EXTRA_PROPS));
  }

  ED.serialize = snapshot;

  ED.record = function () {
    if (ED._suspendHistory) return;
    ED.dirty = true;
    setSaveState('unsaved');
    clearTimeout(recordTimer);
    recordTimer = setTimeout(() => {
      const snap = snapshot();
      if (undoStack.length && undoStack[undoStack.length - 1] === snap) return;
      undoStack.push(snap);
      if (undoStack.length > CAP) undoStack.shift();
      redoStack.length = 0;
      refreshUndoButtons();
      scheduleAutosave();
    }, 260);
  };

  function loadSnap(snap, done) {
    ED._suspendHistory = true;
    canvas.loadFromJSON(snap, () => {
      restoreArtboardFlags();
      applyClip();
      canvas.requestRenderAll();
      ED._suspendHistory = false;
      if (done) done();
    });
  }

  function afterHistoryNav() {
    refreshUndoButtons();
    scheduleAutosave();
    if (window.ED_syncProps) window.ED_syncProps();
    if (window.ED_syncLayers) window.ED_syncLayers();
    if (window.ED_positionFloatbar) window.ED_positionFloatbar();
  }

  ED.undo = function () {
    if (undoStack.length < 2) return;
    const cur = undoStack.pop();
    redoStack.push(cur);
    loadSnap(undoStack[undoStack.length - 1], afterHistoryNav);
  };

  ED.redo = function () {
    if (!redoStack.length) return;
    const snap = redoStack.pop();
    undoStack.push(snap);
    loadSnap(snap, afterHistoryNav);
  };

  function refreshUndoButtons() {
    document.getElementById('btnUndo').disabled = undoStack.length < 2;
    document.getElementById('btnRedo').disabled = redoStack.length === 0;
  }

  function restoreArtboardFlags() {
    canvas.getObjects().forEach((o) => {
      if (o.name === ARTBOARD || o.name === BGIMAGE) {
        o.set({ selectable: false, evented: false, hoverCursor: 'default' });
      }
    });
    const ab = getArtboard();
    if (ab) canvas.sendToBack(ab);
    const bi = getBgImage();
    if (bi && ab) bi.moveTo(canvas.getObjects().indexOf(ab) + 1);
  }
  ED.restoreArtboardFlags = restoreArtboardFlags;

  /* ---- pages -------------------------------------------------------------
     A design is an ordered list of pages, each its own Fabric doc + own
     width/height + own undo/redo stack. Only the active page's contents ever
     live on the shared `canvas`; the rest sit as plain JSON in ED.pages[i].json
     until switched to. ------------------------------------------------------ */
  ED.pages = [];
  ED.activePage = 0;

  function captureActivePage() {
    const p = ED.pages[ED.activePage];
    if (!p) return;
    p.width = ED.W;
    p.height = ED.H;
    p.json = canvas.toJSON(EXTRA_PROPS);
  }
  ED.captureActivePage = captureActivePage;
  function captureActivePageWithThumb() {
    captureActivePage();
    const p = ED.pages[ED.activePage];
    if (p) p.thumb = ED.makeThumbnail();
  }

  function activatePage(index) {
    const p = ED.pages[index];
    if (!p.undo) { p.undo = [JSON.stringify(p.json)]; p.redo = []; }
    ED.activePage = index;
    ED._suspendHistory = true;
    ED.W = p.width;
    ED.H = p.height;
    canvas.loadFromJSON(p.json, () => {
      restoreArtboardFlags();
      applyClip();
      ED.fit();
      ED._suspendHistory = false;
      undoStack = p.undo;
      redoStack = p.redo;
      refreshUndoButtons();
      if (window.ED_renderPageStrip) window.ED_renderPageStrip();
      if (window.ED_syncProps) window.ED_syncProps();
      if (window.ED_syncLayers) window.ED_syncLayers();
    });
  }

  ED.switchPage = function (index) {
    if (index === ED.activePage || index < 0 || index >= ED.pages.length) return;
    captureActivePageWithThumb();
    activatePage(index);
  };

  ED.addPage = function () {
    captureActivePageWithThumb();
    const w = ED.pages[ED.activePage].width;
    const h = ED.pages[ED.activePage].height;
    const blankJson = {
      version: '5.3.0',
      objects: [{
        type: 'rect', version: '5.3.0', name: ARTBOARD,
        left: 0, top: 0, width: w, height: h, fill: '#ffffff',
        selectable: false, evented: false, hoverCursor: 'default', excludeFromExport: false,
      }],
      background: '',
    };
    const insertAt = ED.activePage + 1;
    ED.pages.splice(insertAt, 0, {
      width: w, height: h, json: blankJson,
      undo: [JSON.stringify(blankJson)], redo: [],
    });
    activatePage(insertAt);
    scheduleAutosave();
  };

  ED.duplicatePage = function (index) {
    if (index === ED.activePage) captureActivePageWithThumb();
    const src = ED.pages[index];
    const jsonCopy = JSON.parse(JSON.stringify(src.json));
    ED.pages.splice(index + 1, 0, {
      width: src.width, height: src.height, json: jsonCopy,
      undo: [JSON.stringify(jsonCopy)], redo: [], thumb: src.thumb,
    });
    activatePage(index + 1);
    scheduleAutosave();
  };

  ED.deletePage = function (index) {
    if (ED.pages.length <= 1) return;
    const wasActive = index === ED.activePage;
    ED.pages.splice(index, 1);
    if (ED.activePage > index) ED.activePage--;
    if (wasActive) {
      activatePage(Math.min(index, ED.pages.length - 1));
    } else if (window.ED_renderPageStrip) {
      window.ED_renderPageStrip();
    }
    scheduleAutosave();
  };

  ED.reorderPage = function (from, to) {
    if (from === to || from < 0 || to < 0 || from >= ED.pages.length || to >= ED.pages.length) return;
    captureActivePage();
    const [moved] = ED.pages.splice(from, 1);
    ED.pages.splice(to, 0, moved);
    if (ED.activePage === from) ED.activePage = to;
    else if (from < ED.activePage && to >= ED.activePage) ED.activePage--;
    else if (from > ED.activePage && to <= ED.activePage) ED.activePage++;
    if (window.ED_renderPageStrip) window.ED_renderPageStrip();
    scheduleAutosave();
  };

  /* ---- autosave ------------------------------------------------------------- */
  const CSRF = document.querySelector('meta[name="csrf-token"]').content;
  let saveTimer = null;
  let saving = false;
  let saveAgain = false;

  function setSaveState(state) {
    const pill = document.getElementById('savePill');
    pill.classList.remove('saving', 'unsaved', 'error');
    if (state === 'saved') pill.textContent = pill.dataset.tSaved;
    else if (state === 'saving') { pill.classList.add('saving'); pill.textContent = pill.dataset.tSaving; }
    else if (state === 'unsaved') { pill.classList.add('unsaved'); pill.textContent = pill.dataset.tUnsaved; }
    else if (state === 'error') { pill.classList.add('error'); pill.textContent = pill.dataset.tError; }
  }
  ED.setSaveState = setSaveState;

  function scheduleAutosave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(ED.save, 1200);
  }
  ED.scheduleAutosave = scheduleAutosave;

  ED.makeThumbnail = function () {
    try {
      const vpt = canvas.viewportTransform.slice();
      const zoom = canvas.getZoom();
      canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
      const scale = Math.min(1, 420 / Math.max(ED.W, ED.H));
      const url = canvas.toDataURL({
        format: 'jpeg', quality: 0.6, multiplier: scale,
        left: 0, top: 0, width: ED.W, height: ED.H,
      });
      canvas.setViewportTransform(vpt);
      canvas.setZoom(zoom);
      return url;
    } catch (e) {
      return '';
    }
  };

  ED.save = async function () {
    if (saving) { saveAgain = true; return; }
    saving = true;
    setSaveState('saving');
    captureActivePage();
    try {
      const body = {
        data_json: JSON.stringify({
          version: 2,
          pages: ED.pages.map((p) => ({ width: p.width, height: p.height, json: p.json })),
        }),
        pages: ED.pages.length,
        width: ED.pages[0].width,
        height: ED.pages[0].height,
        title: document.getElementById('edTitle').value,
      };
      // only overwrite the dashboard cover when page 1 is the one being saved —
      // otherwise omit it so the server keeps whatever page 1 last rendered as.
      if (ED.activePage === 0) body.thumbnail = ED.makeThumbnail();
      const res = await fetch('/api/designs/' + data.id, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': CSRF },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('save_failed');
      ED.dirty = false;
      setSaveState('saved');
    } catch (e) {
      setSaveState('error');
    } finally {
      saving = false;
      if (saveAgain) { saveAgain = false; scheduleAutosave(); }
    }
  };

  // saves the current page only (templates are single-page) as a new
  // personal template — reuses whatever the page's undo/thumbnail machinery
  // already produces rather than building a separate export path.
  ED.saveAsTemplate = async function (name) {
    captureActivePageWithThumb();
    const p = ED.pages[ED.activePage];
    const res = await fetch('/api/templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': CSRF },
      body: JSON.stringify({
        name,
        width: p.width,
        height: p.height,
        data_json: JSON.stringify(p.json),
        thumbnail: p.thumb || '',
      }),
    });
    if (!res.ok) throw new Error('save_template_failed');
    const j = await res.json();
    if (window.ED_invalidateTemplatesCache) window.ED_invalidateTemplatesCache();
    return j.template;
  };

  window.addEventListener('beforeunload', (e) => {
    if (ED.dirty) { e.preventDefault(); e.returnValue = ''; }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && ED.dirty) ED.save();
  });
  // save before leaving via the back button so nothing is lost
  const backLink = document.querySelector('a.ed-icon-btn[href="/dashboard"]');
  if (backLink) {
    backLink.addEventListener('click', (e) => {
      if (!ED.dirty) return;
      e.preventDefault();
      Promise.resolve(ED.save()).finally(() => { window.location.href = '/dashboard'; });
    });
  }

  /* ---- title ------------------------------------------------------------- */
  const titleInput = document.getElementById('edTitle');
  titleInput.addEventListener('change', () => { ED.dirty = true; scheduleAutosave(); });
  titleInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') titleInput.blur(); });

  /* ---- top-bar buttons ------------------------------------------------------- */
  document.getElementById('btnUndo').addEventListener('click', ED.undo);
  document.getElementById('btnRedo').addEventListener('click', ED.redo);
  document.getElementById('btnZoomIn').addEventListener('click', () => ED.zoomBy(1.15));
  document.getElementById('btnZoomOut').addEventListener('click', () => ED.zoomBy(0.87));
  document.getElementById('btnFit').addEventListener('click', ED.fit);
  document.getElementById('zoomVal').addEventListener('click', () => ED.setZoom(1));

  /* ---- change tracking ------------------------------------------------------- */
  ['object:added', 'object:removed', 'object:modified'].forEach((ev) =>
    canvas.on(ev, (opt) => {
      const t = opt && opt.target;
      if (t && (t.name === ARTBOARD || t.name === BGIMAGE) && ev !== 'object:modified') return;
      ED.record();
    })
  );

  /* ---- boot ------------------------------------------------------------------ */
  function finishBoot() {
    refreshUndoButtons();
    setSaveState('saved');
    if (window.ED_afterBoot) window.ED_afterBoot();

    // "start from a photo" (dashboard) hands off the uploaded image via a query
    // param so it lands as the new design's background as soon as the editor opens.
    const bgUrl = new URLSearchParams(location.search).get('bgUrl');
    if (bgUrl) {
      ED.setBackgroundImage(decodeURIComponent(bgUrl));
      const url = new URL(location.href);
      url.searchParams.delete('bgUrl');
      history.replaceState(null, '', url);
    }
  }

  function boot() {
    resizeCanvasToViewport();
    // re-measure once layout + fonts have settled so pointer mapping is exact
    requestAnimationFrame(() => { resizeCanvasToViewport(); ED.fit(); });
    setTimeout(() => { resizeCanvasToViewport(); }, 400);

    const start = (ED.data.data || '').trim();
    let parsed = null;
    if (start) { try { parsed = JSON.parse(start); } catch (e) { /* legacy plain Fabric doc */ } }

    if (parsed && parsed.version === 2 && Array.isArray(parsed.pages) && parsed.pages.length) {
      // multi-page design
      ED.pages = parsed.pages.map((p) => ({
        width: p.width || ED.data.width,
        height: p.height || ED.data.height,
        json: p.json || p,
      }));
      const p0 = ED.pages[0];
      p0.undo = [JSON.stringify(p0.json)];
      p0.redo = [];
      ED.activePage = 0;
      ED.W = p0.width; ED.H = p0.height;
      ED._suspendHistory = true;
      canvas.loadFromJSON(p0.json, () => {
        restoreArtboardFlags();
        applyClip();
        ED.fit();
        ED._suspendHistory = false;
        undoStack = p0.undo;
        redoStack = p0.redo;
        finishBoot();
      });
    } else if (start) {
      // legacy shape (a plain Fabric doc, pre-dating multi-page) = implicit single page
      loadSnap(start, () => {
        const ab = ensureArtboard();
        ED.W = ab.width * (ab.scaleX || 1);
        ED.H = ab.height * (ab.scaleY || 1);
        if (ab.scaleX !== 1 || ab.scaleY !== 1) {
          ab.set({ width: ED.W, height: ED.H, scaleX: 1, scaleY: 1 });
        }
        applyClip();
        ED.fit();
        const snap = snapshot();
        undoStack.push(snap);
        ED.pages = [{ width: ED.W, height: ED.H, json: JSON.parse(snap), undo: undoStack, redo: redoStack }];
        ED.activePage = 0;
        finishBoot();
      });
    } else {
      ensureArtboard('#ffffff');
      applyClip();
      ED.fit();
      const snap = snapshot();
      undoStack.push(snap);
      ED.pages = [{ width: ED.W, height: ED.H, json: JSON.parse(snap), undo: undoStack, redo: redoStack }];
      ED.activePage = 0;
      finishBoot();
    }
  }

  let resizeT = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(() => {
      const before = ED.zoom;
      resizeCanvasToViewport();
      ED.setZoom(before);
    }, 150);
  });

  function isTyping(e) {
    const el = e.target;
    return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
  }
  ED.isTyping = isTyping;

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(boot, 0);
  } else {
    window.addEventListener('DOMContentLoaded', boot);
  }

  return ED;
})();
