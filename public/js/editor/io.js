'use strict';

/* ============================================================================
   Shortcuts, context menu, snapping guides, export (PNG / JPG / PDF)
   ========================================================================== */

(function () {
  const ED = window.ED;
  const canvas = ED.canvas;

  const editingText = () => {
    const o = canvas.getActiveObject();
    return o && o.isEditing;
  };

  /* ---- clipboard ------------------------------------------------------------ */
  let clip = null;
  function copy() {
    const o = canvas.getActiveObject();
    if (!o) return;
    o.clone((c) => { clip = c; }, ['name', 'direction', 'id']);
  }
  function paste() {
    if (!clip) return;
    clip.clone((c) => {
      c.set({ left: (clip.left || 0) + 24, top: (clip.top || 0) + 24, evented: true });
      if (c.type === 'activeSelection') {
        c.canvas = canvas;
        c.forEachObject((o) => canvas.add(o));
        c.setCoords();
      } else {
        canvas.add(c);
      }
      canvas.setActiveObject(c);
      canvas.requestRenderAll();
      ED.record();
    }, ['name', 'direction', 'id']);
  }

  /* ---- keyboard ----------------------------------------------------------- */
  window.addEventListener('keydown', (e) => {
    if (ED.isTyping(e) || editingText()) {
      if (e.key === 'Escape') canvas.discardActiveObject().requestRenderAll();
      return;
    }
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (ED._cropping) {
      if (k === 'escape') document.getElementById('cropCancel').click();
      if (k === 'enter') document.getElementById('cropApply').click();
      return;
    }
    if (ED._lassoing) {
      if (k === 'escape') document.getElementById('lassoDone').click();
      return;
    }

    if (mod && k === 's') { e.preventDefault(); ED.save(); return; }
    if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? ED.redo() : ED.undo(); return; }
    if (mod && (k === 'y')) { e.preventDefault(); ED.redo(); return; }
    if (mod && k === 'd') { e.preventDefault(); ED.duplicateActive(); return; }
    if (mod && k === 'c') { e.preventDefault(); copy(); return; }
    if (mod && k === 'v') { e.preventDefault(); paste(); return; }
    if (mod && k === 'a') {
      e.preventDefault();
      const objs = canvas.getObjects().filter((o) => o.name !== ED.ARTBOARD && o.name !== ED.BGIMAGE && o.selectable !== false);
      if (objs.length) {
        const sel = new fabric.ActiveSelection(objs, { canvas });
        canvas.setActiveObject(sel).requestRenderAll();
      }
      return;
    }
    if (mod && k === 'g') {
      e.preventDefault();
      const o = canvas.getActiveObject();
      if (o && o.type === 'activeSelection' && !e.shiftKey) { o.toGroup(); ED.record(); canvas.requestRenderAll(); }
      else if (o && o.type === 'group' && e.shiftKey) { o.toActiveSelection(); ED.record(); canvas.requestRenderAll(); }
      return;
    }
    if (k === 'delete' || k === 'backspace') { e.preventDefault(); ED.deleteActive(); return; }
    if (k === 'escape') { canvas.discardActiveObject().requestRenderAll(); hideCtx(); return; }

    if (k === '=' || k === '+') { e.preventDefault(); ED.zoomBy(1.15); return; }
    if (k === '-' || k === '_') { e.preventDefault(); ED.zoomBy(0.87); return; }
    if (k === '0') { e.preventDefault(); ED.setZoom(1); return; }
    if (k === 'f') { e.preventDefault(); ED.fit(); return; }

    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
      const o = canvas.getActiveObject();
      if (!o) return;
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      if (k === 'arrowup') o.top -= step;
      if (k === 'arrowdown') o.top += step;
      if (k === 'arrowleft') o.left -= step;
      if (k === 'arrowright') o.left += step;
      o.setCoords();
      canvas.requestRenderAll();
      ED.record();
      if (window.ED_syncProps) window.ED_syncProps();
    }
  });

  /* ---- context menu ------------------------------------------------------- */
  const ctx = document.getElementById('ctxMenu');
  function hideCtx() { ctx.hidden = true; }
  canvas.upperCanvasEl.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const target = canvas.findTarget(e, false);
    if (target && target.name !== ED.ARTBOARD && target.name !== ED.BGIMAGE) {
      canvas.setActiveObject(target);
      canvas.requestRenderAll();
    } else if (!target || target.name === ED.ARTBOARD) {
      canvas.discardActiveObject();
      canvas.requestRenderAll();
      return;
    }
    ctx.style.left = e.clientX + 'px';
    ctx.style.top = e.clientY + 'px';
    ctx.hidden = false;
  });
  document.addEventListener('click', hideCtx);
  document.addEventListener('scroll', hideCtx, true);
  ctx.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const o = canvas.getActiveObject();
    if (!o) return;
    switch (b.dataset.ctx) {
      case 'duplicate': ED.duplicateActive(); break;
      case 'front': canvas.bringToFront(o); ED.restoreArtboardFlags(); break;
      case 'back': canvas.sendToBack(o); ED.restoreArtboardFlags(); break;
      case 'lock':
        o.set({
          lockMovementX: !o.lockMovementX, lockMovementY: !o.lockMovementY,
          lockScalingX: !o.lockScalingX, lockScalingY: !o.lockScalingY,
          lockRotation: !o.lockRotation, hasControls: !!o.lockMovementX,
        });
        break;
      case 'delete': ED.deleteActive(); break;
    }
    canvas.requestRenderAll();
    ED.record();
    if (window.ED_syncProps) window.ED_syncProps();
  });

  /* ---- snapping guides --------------------------------------------------- */
  let guides = [];
  const THRESH = 7;

  // The other objects' snap-target edges were previously recomputed from
  // scratch (a getBoundingRect() per other object) on EVERY single move
  // tick of a drag — on a busy template (20-50+ objects) that's real,
  // continuous work during exactly the interaction that most needs to feel
  // smooth, and on mobile CPUs it was noticeable. Those other objects don't
  // move while THIS one is being dragged, so build the list once per drag
  // (cached until the next mouse:down starts a new one) instead of once per
  // frame — the O(objects) cost now happens once, not dozens of times.
  let targetCache = null;
  canvas.on('mouse:down', () => { targetCache = null; });

  canvas.on('object:moving', (opt) => {
    const o = opt.target;
    if (!o) return;
    guides = [];
    const t = THRESH / ED.zoom;
    if (!targetCache) {
      const targetsX = [0, ED.W / 2, ED.W];
      const targetsY = [0, ED.H / 2, ED.H];
      canvas.getObjects().forEach((other) => {
        if (other === o || other.name === ED.ARTBOARD || other.name === ED.BGIMAGE) return;
        const ob = other.getBoundingRect(true, true);
        targetsX.push(ob.left, ob.left + ob.width / 2, ob.left + ob.width);
        targetsY.push(ob.top, ob.top + ob.height / 2, ob.top + ob.height);
      });
      targetCache = { x: targetsX, y: targetsY };
    }
    const b = o.getBoundingRect(true, true);
    const edgesX = [b.left, b.left + b.width / 2, b.left + b.width];
    for (const tx of targetCache.x) {
      for (let i = 0; i < edgesX.length; i++) {
        if (Math.abs(edgesX[i] - tx) <= t) {
          o.left += tx - edgesX[i];
          guides.push({ x: tx });
          break;
        }
      }
    }
    const edgesY = [b.top, b.top + b.height / 2, b.top + b.height];
    for (const ty of targetCache.y) {
      for (let i = 0; i < edgesY.length; i++) {
        if (Math.abs(edgesY[i] - ty) <= t) {
          o.top += ty - edgesY[i];
          guides.push({ y: ty });
          break;
        }
      }
    }
    o.setCoords();
  });
  canvas.on('object:modified', () => { guides = []; targetCache = null; canvas.requestRenderAll(); });
  canvas.on('mouse:up', () => { if (guides.length) { guides = []; canvas.requestRenderAll(); } });

  window.ED_drawGuides = function (c) {
    if (!guides.length) return;
    const vpt = canvas.viewportTransform;
    c.save();
    c.strokeStyle = '#ff3d8b';
    c.lineWidth = 1;
    c.setLineDash([4, 4]);
    guides.forEach((g) => {
      c.beginPath();
      if (g.x != null) {
        const sx = g.x * ED.zoom + vpt[4];
        c.moveTo(sx, 0); c.lineTo(sx, canvas.getHeight());
      } else {
        const sy = g.y * ED.zoom + vpt[5];
        c.moveTo(0, sy); c.lineTo(canvas.getWidth(), sy);
      }
      c.stroke();
    });
    c.restore();
  };

  /* ---- export ------------------------------------------------------------- */
  function baseFilename() {
    const t = (document.getElementById('edTitle').value || 'design').trim().replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60);
    return t || 'design';
  }
  function filename(ext) {
    return baseFilename() + '.' + ext;
  }

  ED.exportDesign = function (fmt, opts) {
    opts = opts || {};
    const scale = Number(opts.scale) || 2;
    const transparent = !!opts.transparent && fmt === 'png';

    const vpt = canvas.viewportTransform.slice();
    const zoom = canvas.getZoom();
    const ab = ED.getArtboard();
    const bi = canvas.getObjects().find((o) => o.name === ED.BGIMAGE);
    const abVis = ab && ab.visible;
    const biVis = bi && bi.visible;

    if (transparent) {
      if (ab) ab.visible = false;
      if (bi) bi.visible = false;
    }
    canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);

    const url = canvas.toDataURL({
      format: fmt === 'jpg' ? 'jpeg' : 'png',
      quality: 0.92,
      multiplier: scale,
      left: 0, top: 0, width: ED.W, height: ED.H,
    });

    canvas.setViewportTransform(vpt);
    canvas.setZoom(zoom);
    if (transparent) {
      if (ab) ab.visible = abVis;
      if (bi) bi.visible = biVis;
    }
    canvas.requestRenderAll();

    if (fmt === 'pdf') {
      const JsPDF = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF;
      if (!JsPDF) { alert('PDF unavailable'); return; }
      const doc = new JsPDF({
        orientation: ED.W >= ED.H ? 'landscape' : 'portrait',
        unit: 'px',
        format: [ED.W, ED.H],
        hotfixes: ['px_scaling'],
      });
      doc.addImage(url, 'PNG', 0, 0, ED.W, ED.H);
      doc.save(filename('pdf'));
      return;
    }

    const a = document.createElement('a');
    a.href = url;
    a.download = filename(fmt === 'jpg' ? 'jpg' : 'png');
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  // Vector export of the current page only (SVG has no per-frame/per-page
  // concept the way PDF's "all pages" does, so this mirrors exportDesign's
  // single-page scope, not exportAllPagesPDF's). Object positions in Fabric's
  // toSVG output come from each object's own left/top/scale, not the canvas's
  // viewportTransform (that's a pan/zoom concept for on-screen rendering
  // only) — so unlike exportDesign, there's no vpt reset needed here.
  // Known limitation: custom/Google fonts used on canvas are NOT embedded in
  // the SVG (this fabric build has no fontFaces option) — text renders fine
  // in-app but falls back to a default font if the file is opened elsewhere
  // without that font installed. Flagged to the user rather than silently
  // shipping a file that looks different once it leaves the browser.
  ED.exportSVG = function (opts) {
    opts = opts || {};
    const transparent = !!opts.transparent;
    const ab = ED.getArtboard();
    const bi = canvas.getObjects().find((o) => o.name === ED.BGIMAGE);
    const abVis = ab && ab.visible;
    const biVis = bi && bi.visible;
    if (transparent) {
      if (ab) ab.visible = false;
      if (bi) bi.visible = false;
    }

    const svg = canvas.toSVG({
      width: ED.W,
      height: ED.H,
      viewBox: { x: 0, y: 0, width: ED.W, height: ED.H },
    });

    if (transparent) {
      if (ab) ab.visible = abVis;
      if (bi) bi.visible = biVis;
      canvas.requestRenderAll();
    }

    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename('svg');
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  // exports every page as its own page of one PDF, then restores whatever page was live
  ED.exportAllPagesPDF = function (opts) {
    opts = opts || {};
    const JsPDF = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF;
    if (!JsPDF) { alert('PDF unavailable'); return; }
    const scale = Number(opts.scale) || 2;
    const originalIndex = ED.activePage;
    const originalPage = ED.pages[originalIndex];
    const originalJson = JSON.parse(ED.serialize());
    let doc = null;

    function renderPage(i) {
      return new Promise((resolve) => {
        const p = ED.pages[i];
        ED._suspendHistory = true;
        ED.W = p.width; ED.H = p.height;
        canvas.loadFromJSON(p.json, () => {
          ED.restoreArtboardFlags();
          canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
          const url = canvas.toDataURL({
            format: 'png', quality: 0.92, multiplier: scale,
            left: 0, top: 0, width: ED.W, height: ED.H,
          });
          const orient = ED.W >= ED.H ? 'landscape' : 'portrait';
          if (!doc) doc = new JsPDF({ orientation: orient, unit: 'px', format: [ED.W, ED.H], hotfixes: ['px_scaling'] });
          else doc.addPage([ED.W, ED.H], orient);
          doc.addImage(url, 'PNG', 0, 0, ED.W, ED.H);
          resolve();
        });
      });
    }

    (async () => {
      for (let i = 0; i < ED.pages.length; i++) await renderPage(i);
      ED.W = originalPage.width; ED.H = originalPage.height;
      canvas.loadFromJSON(originalJson, () => {
        ED.restoreArtboardFlags();
        ED.applyClip();
        ED.fit();
        ED._suspendHistory = false;
        canvas.requestRenderAll();
      });
      doc.save(filename('pdf'));
    })();
  };

  // Exports every page as its own PNG/JPG file bundled into one ZIP — the
  // "all pages" checkbox's PNG/JPG counterpart to exportAllPagesPDF above
  // (same sequential loadFromJSON->render->restore skeleton, different output
  // container). Each page keeps its own transparent-background handling,
  // mirroring exportDesign's single-page transparent logic.
  ED.exportAllPagesZip = function (fmt, opts) {
    opts = opts || {};
    if (!window.JSZip) { alert(ED.i18n.zipUnavailable || 'ZIP unavailable'); return; }
    const scale = Number(opts.scale) || 2;
    const transparent = !!opts.transparent && fmt === 'png';
    const originalIndex = ED.activePage;
    const originalPage = ED.pages[originalIndex];
    const originalJson = JSON.parse(ED.serialize());
    const zip = new JSZip();
    const base = baseFilename();
    const ext = fmt === 'jpg' ? 'jpg' : 'png';

    function renderPage(i) {
      return new Promise((resolve) => {
        const p = ED.pages[i];
        ED._suspendHistory = true;
        ED.W = p.width; ED.H = p.height;
        canvas.loadFromJSON(p.json, () => {
          ED.restoreArtboardFlags();
          const ab = ED.getArtboard();
          const bi = canvas.getObjects().find((o) => o.name === ED.BGIMAGE);
          const abVis = ab && ab.visible;
          const biVis = bi && bi.visible;
          if (transparent) { if (ab) ab.visible = false; if (bi) bi.visible = false; }
          canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
          const url = canvas.toDataURL({
            format: fmt === 'jpg' ? 'jpeg' : 'png', quality: 0.92, multiplier: scale,
            left: 0, top: 0, width: ED.W, height: ED.H,
          });
          if (transparent) { if (ab) ab.visible = abVis; if (bi) bi.visible = biVis; }
          zip.file(`${base}-${i + 1}.${ext}`, url.split(',')[1], { base64: true });
          resolve();
        });
      });
    }

    return (async () => {
      for (let i = 0; i < ED.pages.length; i++) await renderPage(i);
      ED.W = originalPage.width; ED.H = originalPage.height;
      canvas.loadFromJSON(originalJson, () => {
        ED.restoreArtboardFlags();
        ED.applyClip();
        ED.fit();
        ED._suspendHistory = false;
        canvas.requestRenderAll();
      });
      const blob = await zip.generateAsync({ type: 'blob' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename('zip');
      document.body.appendChild(a);
      a.click();
      a.remove();
    })();
  };

  // Exports every page as one frame of an animated GIF (a single-page design
  // just yields a 1-frame GIF — still a valid file, not worth special-casing).
  // Frames must share one canvas size (the GIF format has no per-frame size),
  // so every page is composited onto an offscreen canvas sized to the
  // LARGEST page, centered on a white backdrop — mirrors exportAllPagesPDF's
  // load-each-page-by-JSON-then-restore approach.
  ED.exportGIF = function (opts) {
    opts = opts || {};
    if (!window.GIF) { alert(ED.i18n.gifError || 'GIF unavailable'); return; }
    const delayMs = Number(opts.delay) || 1400;
    const scale = Number(opts.scale) || 1;
    const originalIndex = ED.activePage;
    const originalPage = ED.pages[originalIndex];
    const originalJson = JSON.parse(ED.serialize());

    const outW = Math.round(Math.max(...ED.pages.map((p) => p.width)) * scale);
    const outH = Math.round(Math.max(...ED.pages.map((p) => p.height)) * scale);
    const gif = new GIF({
      workers: 2,
      quality: 10,
      width: outW,
      height: outH,
      workerScript: (ED.data.gif && ED.data.gif.workerUrl) || '/static/vendor/gif.worker.js',
    });

    function renderPage(i) {
      return new Promise((resolve) => {
        const p = ED.pages[i];
        ED._suspendHistory = true;
        ED.W = p.width; ED.H = p.height;
        canvas.loadFromJSON(p.json, () => {
          ED.restoreArtboardFlags();
          canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
          const url = canvas.toDataURL({
            format: 'png', quality: 0.92, multiplier: scale,
            left: 0, top: 0, width: ED.W, height: ED.H,
          });
          const img = new Image();
          img.onload = () => {
            const off = document.createElement('canvas');
            off.width = outW; off.height = outH;
            const ctx = off.getContext('2d');
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, outW, outH);
            ctx.drawImage(img, Math.round((outW - img.width) / 2), Math.round((outH - img.height) / 2));
            gif.addFrame(off, { delay: delayMs, copy: true });
            resolve();
          };
          img.src = url;
        });
      });
    }

    return (async () => {
      for (let i = 0; i < ED.pages.length; i++) await renderPage(i);
      ED.W = originalPage.width; ED.H = originalPage.height;
      canvas.loadFromJSON(originalJson, () => {
        ED.restoreArtboardFlags();
        ED.applyClip();
        ED.fit();
        ED._suspendHistory = false;
        canvas.requestRenderAll();
      });
      await new Promise((resolve) => {
        gif.on('finished', (blob) => {
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = filename('gif');
          document.body.appendChild(a);
          a.click();
          a.remove();
          resolve();
        });
        gif.render();
      });
    })();
  };

  /* ---- download dropdown --------------------------------------------------- */
  const dd = document.getElementById('dlDropdown');
  const ddMenu = dd.querySelector('.ed-dropdown-menu');
  const dlAllPagesRow = document.getElementById('dlAllPagesRow');
  const dlGifHint = document.getElementById('dlGifHint');
  document.getElementById('btnDownload').addEventListener('click', (e) => {
    e.stopPropagation();
    if (dlAllPagesRow) dlAllPagesRow.hidden = ED.pages.length <= 1;
    if (dlGifHint) dlGifHint.hidden = ED.pages.length <= 1;
    ddMenu.hidden = !ddMenu.hidden;
  });
  document.addEventListener('click', (e) => { if (!dd.contains(e.target)) ddMenu.hidden = true; });
  ddMenu.querySelectorAll('[data-fmt]').forEach((b) =>
    b.addEventListener('click', () => {
      if (b.disabled) return;
      const fmt = b.dataset.fmt;
      const opts = {
        transparent: document.getElementById('dlTransparent').checked,
        scale: document.getElementById('dlScale').value,
      };
      const dlAllPages = document.getElementById('dlAllPages');
      if (fmt === 'pdf' && ED.pages.length > 1 && dlAllPages && dlAllPages.checked) {
        ED.exportAllPagesPDF(opts);
      } else if (fmt === 'gif') {
        const original = b.textContent;
        b.disabled = true;
        b.textContent = ED.i18n.gifWorking || original;
        Promise.resolve(ED.exportGIF(opts)).catch(() => alert(ED.i18n.gifError || 'Error')).finally(() => {
          b.disabled = false;
          b.textContent = original;
        });
      } else if (fmt === 'svg') {
        ED.exportSVG(opts);
      } else if ((fmt === 'png' || fmt === 'jpg') && ED.pages.length > 1 && dlAllPages && dlAllPages.checked) {
        const original = b.textContent;
        b.disabled = true;
        b.textContent = ED.i18n.zipWorking || original;
        Promise.resolve(ED.exportAllPagesZip(fmt, opts)).catch(() => alert(ED.i18n.zipError || 'Error')).finally(() => {
          b.disabled = false;
          b.textContent = original;
        });
      } else {
        ED.exportDesign(fmt, opts);
      }
      ddMenu.hidden = true;
    })
  );

  /* ---- resize dropdown (magic resize) -------------------------------------- */
  const SIZES = [
    { id: 'ig-square', w: 1080, h: 1080, cat: 'social', ar: 'منشور إنستغرام', en: 'Instagram Post' },
    { id: 'ig-portrait', w: 1080, h: 1350, cat: 'social', ar: 'منشور إنستغرام عمودي', en: 'Instagram Portrait' },
    { id: 'story', w: 1080, h: 1920, cat: 'social', ar: 'ستوري / ريلز', en: 'Story / Reel' },
    { id: 'fb-post', w: 1200, h: 630, cat: 'social', ar: 'منشور فيسبوك', en: 'Facebook Post' },
    { id: 'fb-cover', w: 820, h: 312, cat: 'social', ar: 'غلاف فيسبوك', en: 'Facebook Cover' },
    { id: 'x-post', w: 1600, h: 900, cat: 'social', ar: 'منشور X (تويتر)', en: 'X (Twitter) Post' },
    { id: 'linkedin-post', w: 1200, h: 1200, cat: 'social', ar: 'منشور لينكدإن', en: 'LinkedIn Post' },
    { id: 'yt-thumb', w: 1280, h: 720, cat: 'social', ar: 'صورة مصغّرة يوتيوب', en: 'YouTube Thumbnail' },
    { id: 'slide-16-9', w: 1920, h: 1080, cat: 'presentation', ar: 'شريحة عرض 16:9', en: 'Slide 16:9' },
    { id: 'slide-4-3', w: 1024, h: 768, cat: 'presentation', ar: 'شريحة عرض 4:3', en: 'Slide 4:3' },
    { id: 'a4-portrait', w: 2480, h: 3508, cat: 'print', ar: 'A4 عمودي', en: 'A4 Portrait' },
    { id: 'a4-landscape', w: 3508, h: 2480, cat: 'print', ar: 'A4 أفقي', en: 'A4 Landscape' },
    { id: 'poster', w: 1500, h: 2100, cat: 'print', ar: 'ملصق', en: 'Poster' },
  ];
  const RESIZE_CAT_ORDER = ['social', 'presentation', 'print'];
  const resizeDd = document.getElementById('resizeDropdown');
  const resizeMenu = resizeDd.querySelector('.ed-dropdown-menu');
  const resizeGroups = document.getElementById('resizeGroups');
  const resizeWInput = document.getElementById('resizeW');
  const resizeHInput = document.getElementById('resizeH');
  const RESIZE_CATS = (ED.i18n && ED.i18n.resizeCats) || {};

  resizeGroups.innerHTML = RESIZE_CAT_ORDER.map((cat) => {
    const items = SIZES.filter((s) => s.cat === cat);
    if (!items.length) return '';
    const rows = items.map((s) => {
      const name = ED.lang === 'ar' ? s.ar : s.en;
      return `<button type="button" class="ed-resize-item" data-w="${s.w}" data-h="${s.h}">
        <span>${name}</span><small>${s.w}×${s.h}</small></button>`;
    }).join('');
    return `<div class="ed-resize-group-title">${RESIZE_CATS[cat] || cat}</div>${rows}`;
  }).join('');

  function closeResizeMenu() { resizeMenu.hidden = true; }
  document.getElementById('btnResize').addEventListener('click', (e) => {
    e.stopPropagation();
    resizeWInput.value = ED.W;
    resizeHInput.value = ED.H;
    resizeMenu.hidden = !resizeMenu.hidden;
  });
  document.addEventListener('click', (e) => { if (!resizeDd.contains(e.target)) closeResizeMenu(); });

  resizeGroups.addEventListener('click', (e) => {
    const btn = e.target.closest('.ed-resize-item');
    if (!btn) return;
    ED.magicResize(Number(btn.dataset.w), Number(btn.dataset.h));
    closeResizeMenu();
  });

  document.getElementById('resizeApply').addEventListener('click', () => {
    const w = Math.min(8000, Math.max(16, Math.round(Number(resizeWInput.value) || ED.W)));
    const h = Math.min(8000, Math.max(16, Math.round(Number(resizeHInput.value) || ED.H)));
    ED.magicResize(w, h);
    closeResizeMenu();
  });

  /* ---- save current page as a personal template -------------------------- */
  const saveTplDd = document.getElementById('saveTplDropdown');
  const saveTplMenu = saveTplDd.querySelector('.ed-dropdown-menu');
  const saveTplName = document.getElementById('saveTplName');
  const saveTplApply = document.getElementById('saveTplApply');
  const saveTplHint = document.getElementById('saveTplHint');
  document.getElementById('btnSaveTpl').addEventListener('click', (e) => {
    e.stopPropagation();
    if (!saveTplMenu.hidden) { saveTplMenu.hidden = true; return; }
    saveTplName.value = document.getElementById('edTitle').value || '';
    saveTplHint.textContent = '';
    saveTplMenu.hidden = false;
    saveTplName.focus();
  });
  document.addEventListener('click', (e) => { if (!saveTplDd.contains(e.target)) saveTplMenu.hidden = true; });
  saveTplApply.addEventListener('click', async () => {
    saveTplApply.disabled = true;
    saveTplHint.textContent = ED.i18n.saveTplWorking || '…';
    try {
      await ED.saveAsTemplate(saveTplName.value);
      saveTplHint.textContent = ED.i18n.saveTplDone || '';
      setTimeout(() => { saveTplMenu.hidden = true; }, 900);
    } catch (e) {
      saveTplHint.textContent = ED.i18n.saveTplError || '';
    } finally {
      saveTplApply.disabled = false;
    }
  });

  /* ---- share link -------------------------------------------------------- */
  const CSRF2 = document.querySelector('meta[name="csrf-token"]').content;
  const shareDd = document.getElementById('shareDropdown');
  const shareMenu = shareDd.querySelector('.ed-dropdown-menu');
  const shareUrl = document.getElementById('shareUrl');
  const shareCreate = document.getElementById('shareCreate');
  const shareDisable = document.getElementById('shareDisable');
  const shareCopy = document.getElementById('shareCopy');

  function setShareUI(token) {
    if (token) {
      shareUrl.value = location.origin + '/d/' + token;
      shareCreate.hidden = true;
      shareDisable.hidden = false;
      shareCopy.disabled = false;
    } else {
      shareUrl.value = '';
      shareCreate.hidden = false;
      shareDisable.hidden = true;
      shareCopy.disabled = true;
    }
  }
  setShareUI(ED.data.shareToken || null);

  document.getElementById('btnShare').addEventListener('click', (e) => {
    e.stopPropagation();
    shareMenu.hidden = !shareMenu.hidden;
  });
  document.addEventListener('click', (e) => { if (!shareDd.contains(e.target)) shareMenu.hidden = true; });

  shareCreate.addEventListener('click', async () => {
    try {
      const r = await fetch('/api/designs/' + ED.data.id + '/share', { method: 'POST', headers: { 'x-csrf-token': CSRF2 } });
      const j = await r.json();
      if (j.token) { ED.data.shareToken = j.token; setShareUI(j.token); }
    } catch (e) {}
  });
  shareDisable.addEventListener('click', async () => {
    try {
      await fetch('/api/designs/' + ED.data.id + '/share', { method: 'DELETE', headers: { 'x-csrf-token': CSRF2 } });
      ED.data.shareToken = null;
      setShareUI(null);
    } catch (e) {}
  });
  shareCopy.addEventListener('click', () => {
    if (!shareUrl.value) return;
    shareUrl.select();
    navigator.clipboard && navigator.clipboard.writeText(shareUrl.value);
    const old = shareCopy.textContent;
    shareCopy.textContent = ED.i18n.shareCopied || 'Copied';
    setTimeout(() => { shareCopy.textContent = old; }, 1500);
  });

  /* ---- keyboard shortcuts help dropdown ---------------------------------- */
  const scDd = document.getElementById('shortcutsDropdown');
  const scMenu = scDd.querySelector('.ed-dropdown-menu');
  document.getElementById('btnShortcuts').addEventListener('click', (e) => {
    e.stopPropagation();
    scMenu.hidden = !scMenu.hidden;
  });
  document.addEventListener('click', (e) => { if (!scDd.contains(e.target)) scMenu.hidden = true; });

  /* ---- alt/ctrl-drag to duplicate --------------------------------------- */
  let altPending = null;
  canvas.on('mouse:down', (opt) => {
    const t = opt.target;
    if ((opt.e.altKey) && t && t.selectable !== false && t.name !== ED.ARTBOARD) {
      altPending = { obj: t, left: t.left, top: t.top };
    } else {
      altPending = null;
    }
  });
  canvas.on('object:moving', (opt) => {
    if (!altPending || altPending.obj !== opt.target) return;
    const src = altPending.obj;
    const at = { left: altPending.left, top: altPending.top };
    altPending = null;
    src.clone((c) => {
      c.set({ left: at.left, top: at.top, evented: true });
      canvas.add(c);
      c.moveTo(canvas.getObjects().indexOf(src));
      canvas.requestRenderAll();
      ED.record();
      if (window.ED_syncLayers) window.ED_syncLayers();
    }, ['name', 'direction', 'id']);
  });
  canvas.on('mouse:up', () => { altPending = null; });

  /* ---- floating selection toolbar ------------------------------------------- */
  const floatbar = document.getElementById('floatbar');
  const fbBold = document.getElementById('fbBold');
  const fbColor = document.getElementById('fbColor');
  const TEXT_T = ['textbox', 'i-text', 'text'];

  // matchMedia isn't implemented in every test/embed environment (e.g. jsdom) — fall back to "not mobile"
  const MOBILE_MQ = typeof window.matchMedia === 'function' ? window.matchMedia('(max-width: 640px)') : { matches: false };

  function positionFloatbar() {
    const o = canvas.getActiveObject();
    // hidden during an active drag/scale/rotate too (ED._transforming, set in
    // core.js) — both because there's nothing useful to click mid-gesture and
    // because it lets a phone skip this function's real cost (below) on
    // every single move tick of the gesture, not just every render.
    if (!o || o.isEditing || ED._cropping || ED._transforming || ED._lassoing) { floatbar.hidden = true; return; }
    floatbar.hidden = false;
    fbBold.hidden = !TEXT_T.includes(o.type);
    // reflect colour
    const col = TEXT_T.includes(o.type) ? o.fill : (typeof o.fill === 'string' ? o.fill : o.stroke);
    try { fbColor.value = '#' + new fabric.Color(col || '#000').toHex().slice(0, 6); } catch (e) {}

    // On a phone the toolbar is pinned by CSS (see editor.css's @media
    // max-width:640px, !important bottom/left) — this geometry below is
    // purely for desktop's near-the-selection floating placement, and was
    // previously still computed (getBoundingRect + style writes) on every
    // render/move tick on mobile for zero visual effect, wasted CPU during
    // exactly the moment (an active drag) it matters most for smoothness.
    if (MOBILE_MQ.matches) return;

    const r = o.getBoundingRect(false, true); // screen space (post-viewport), recalculated
    const rect = canvas.upperCanvasEl.getBoundingClientRect();
    const bw = floatbar.offsetWidth || 220;
    let x = rect.left + r.left + r.width / 2 - bw / 2;
    let y = rect.top + r.top - floatbar.offsetHeight - 10;
    x = Math.max(rect.left + 6, Math.min(x, rect.right - bw - 6));
    if (y < rect.top + 6) y = rect.top + r.top + r.height + 10;
    floatbar.style.left = Math.round(x) + 'px';
    floatbar.style.top = Math.round(y) + 'px';
  }
  window.ED_positionFloatbar = positionFloatbar;

  ['selection:created', 'selection:updated', 'object:moving', 'object:scaling', 'object:rotating', 'object:modified', 'mouse:up']
    .forEach((ev) => canvas.on(ev, positionFloatbar));
  canvas.on('selection:cleared', () => { floatbar.hidden = true; });
  canvas.on('after:render', () => {
    if (canvas.getActiveObject() && !floatbar.hidden) positionFloatbar();
  });

  fbColor.addEventListener('input', () => {
    const o = canvas.getActiveObject();
    if (!o) return;
    if (TEXT_T.includes(o.type) || typeof o.fill === 'string') o.set('fill', fbColor.value);
    else o.set('stroke', fbColor.value);
    canvas.requestRenderAll();
    ED.record();
    if (window.ED_syncProps) window.ED_syncProps();
  });
  // tracked separately on 'change' (fires once, on commit) — 'input' above
  // fires continuously while dragging inside the native color picker
  fbColor.addEventListener('change', () => ED.trackRecentColor(fbColor.value));
  fbBold.addEventListener('click', () => {
    const o = canvas.getActiveObject();
    if (!o || !TEXT_T.includes(o.type)) return;
    const on = o.fontWeight === 'bold' || Number(o.fontWeight) >= 600;
    o.set('fontWeight', on ? 'normal' : 'bold');
    canvas.requestRenderAll(); ED.record();
    if (window.ED_syncProps) window.ED_syncProps();
  });
  document.getElementById('fbForward').addEventListener('click', () => { const o = canvas.getActiveObject(); if (o) { canvas.bringForward(o); ED.restoreArtboardFlags(); canvas.requestRenderAll(); ED.record(); if (window.ED_syncLayers) window.ED_syncLayers(); } });
  document.getElementById('fbBackward').addEventListener('click', () => { const o = canvas.getActiveObject(); if (o) { canvas.sendBackwards(o); ED.restoreArtboardFlags(); canvas.requestRenderAll(); ED.record(); if (window.ED_syncLayers) window.ED_syncLayers(); } });
  document.getElementById('fbDup').addEventListener('click', () => ED.duplicateActive && ED.duplicateActive());
  document.getElementById('fbDelete').addEventListener('click', () => ED.deleteActive && ED.deleteActive());
  document.getElementById('fbLock').addEventListener('click', () => {
    const o = canvas.getActiveObject();
    if (!o) return;
    const lock = !o.lockMovementX;
    o.set({ lockMovementX: lock, lockMovementY: lock, lockScalingX: lock, lockScalingY: lock, lockRotation: lock, hasControls: !lock });
    canvas.requestRenderAll(); ED.record();
    if (window.ED_syncLayers) window.ED_syncLayers();
  });
  // mobile-only (see editor.css): the properties sheet no longer auto-opens on
  // selection there — this is the explicit way to reach it, mirroring Canva's "…"
  document.getElementById('fbMore').addEventListener('click', () => {
    document.querySelector('.ed-left')?.classList.remove('open', 'user-opened');
    document.getElementById('rightPanel').classList.add('open', 'user-opened');
  });

  /* ---- image crop ------------------------------------------------------------ */
  const cropbar = document.getElementById('cropbar');
  let cropImg = null;
  let cropBox = null;

  ED.startCrop = function (img) {
    if (!img || cropImg) return;
    cropImg = img;
    ED._cropping = true;
    floatbar.hidden = true;
    img.rotate(0);
    const r = img.getBoundingRect(true, true);
    cropBox = new fabric.Rect({
      left: r.left, top: r.top, width: r.width, height: r.height,
      fill: 'rgba(124,92,255,0.12)', stroke: '#7c5cff', strokeDashArray: [6, 4], strokeWidth: 2,
      lockRotation: true, name: '__cropbox', cornerColor: '#7c5cff', transparentCorners: false,
      excludeFromExport: true,
    });
    cropBox.setControlsVisibility({ mtr: false });
    canvas.add(cropBox);
    canvas.setActiveObject(cropBox);
    canvas.requestRenderAll();
    cropbar.hidden = false;
  };

  function endCrop() {
    if (cropBox) { canvas.remove(cropBox); cropBox = null; }
    cropbar.hidden = true;
    ED._cropping = false;
    if (cropImg) { canvas.setActiveObject(cropImg); }
    cropImg = null;
    canvas.requestRenderAll();
    if (window.ED_syncProps) window.ED_syncProps();
  }

  document.getElementById('cropCancel').addEventListener('click', endCrop);
  document.getElementById('cropReset').addEventListener('click', () => {
    if (cropImg && cropImg._element && cropImg._element.naturalWidth) {
      cropImg.set({ cropX: 0, cropY: 0, width: cropImg._element.naturalWidth, height: cropImg._element.naturalHeight });
      canvas.requestRenderAll();
      ED.record();
    }
    endCrop();
  });
  document.getElementById('cropApply').addEventListener('click', () => {
    if (!cropImg || !cropBox) return;
    const img = cropImg;
    const cb = cropBox.getBoundingRect(true, true);
    const nat = { w: (img._element && img._element.naturalWidth) || img.width, h: (img._element && img._element.naturalHeight) || img.height };
    let relX = (cb.left - img.left) / img.scaleX + (img.cropX || 0);
    let relY = (cb.top - img.top) / img.scaleY + (img.cropY || 0);
    let relW = cb.width / img.scaleX;
    let relH = cb.height / img.scaleY;
    relX = Math.max(0, Math.min(relX, nat.w - 1));
    relY = Math.max(0, Math.min(relY, nat.h - 1));
    relW = Math.max(1, Math.min(relW, nat.w - relX));
    relH = Math.max(1, Math.min(relH, nat.h - relY));
    img.set({ cropX: relX, cropY: relY, width: relW, height: relH, left: cb.left, top: cb.top });
    img.setCoords();
    canvas.requestRenderAll();
    ED.record();
    endCrop();
  });
})();
