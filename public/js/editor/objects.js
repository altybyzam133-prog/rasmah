'use strict';

/* ============================================================================
   Left panel: tabs, add text / shapes, fonts, uploads, background, templates
   ========================================================================== */

(function () {
  const ED = window.ED;
  const canvas = ED.canvas;
  const CSRF = document.querySelector('meta[name="csrf-token"]').content;

  const FONTS = [
    { family: 'Cairo', label: 'Cairo · العربية' },
    { family: 'Tajawal', label: 'Tajawal · العربية' },
    { family: 'Almarai', label: 'Almarai · العربية' },
    { family: 'Reem Kufi', label: 'Reem Kufi · العربية' },
    { family: 'Amiri', label: 'Amiri · العربية' },
    { family: 'Lalezar', label: 'Lalezar · العربية' },
    { family: 'Poppins', label: 'Poppins' },
    { family: 'Montserrat', label: 'Montserrat' },
    { family: 'Oswald', label: 'Oswald' },
    { family: 'Playfair Display', label: 'Playfair Display' },
    { family: 'Lobster', label: 'Lobster' },
  ];
  ED.FONTS = FONTS;
  const DEFAULT_FONT = ED.lang === 'ar' ? 'Cairo' : 'Poppins';

  ED.ensureFont = function (family) {
    if (!document.fonts) return Promise.resolve();
    // A stalled font-load (flaky network, a slow first fetch, a browser quirk) must
    // never leave the caller hanging forever — race it against a timeout so clicking
    // a font always eventually applies it, even if the actual glyph swap lags behind.
    const loaded = Promise.all([
      document.fonts.load(`16px "${family}"`),
      document.fonts.load(`700 16px "${family}"`),
    ]).catch(() => {});
    const timeout = new Promise((resolve) => setTimeout(resolve, 1500));
    return Promise.race([loaded, timeout]).then(() => canvas.requestRenderAll());
  };
  // warm the default so first text renders correctly
  ED.ensureFont(DEFAULT_FONT);

  /* ---- add object at artboard centre ----------------------------------- */
  ED.addObject = function (obj, opts) {
    opts = opts || {};
    if (opts.center !== false) {
      const w = obj.getScaledWidth ? obj.getScaledWidth() : (obj.width || 0);
      const h = obj.getScaledHeight ? obj.getScaledHeight() : (obj.height || 0);
      obj.set({ left: Math.round(ED.W / 2 - w / 2), top: Math.round(ED.H / 2 - h / 2) });
      obj.setCoords();
    }
    canvas.add(obj);
    canvas.setActiveObject(obj);
    canvas.requestRenderAll();
    ED.record();
    return obj;
  };

  // Images already placed on the canvas, rendered to their own small PNG
  // data URL (captures any crop/filters already applied to that object) —
  // lets standalone upload-first tools (the Remove Background / Decompose
  // tabs) offer "use a photo you've already placed" instead of forcing a
  // fresh re-upload of the exact same picture. Excludes the background image
  // by default (Brand's "extract colors from photo" picker uses this default
  // — a plain photo backdrop isn't what that tool is about); pass
  // includeBg:true to also list it first (used by the Decompose/Remove
  // Background tabs, whose own "icon" the user expects to work on whatever
  // photo is already in the design, background included).
  ED.canvasImages = function (includeBg) {
    const objs = canvas.getObjects().filter((o) => o.type === 'image' && o.name !== ED.BGIMAGE);
    const bg = includeBg && ED.getBgImage && ED.getBgImage();
    const list = bg ? [bg, ...objs] : objs;
    return list
      .map((o, i) => {
        let url = '';
        try { url = o.toDataURL({ format: 'png' }); } catch (e) { /* unrenderable (e.g. tainted) — skip */ }
        return { id: 'ci' + i, url };
      })
      .filter((x) => x.url);
  };

  /* ---- text ------------------------------------------------------------- */
  const TEXT_PRESETS = {
    heading: { fontSize: Math.round(ED.H * 0.08) || 84, fontWeight: '800' },
    subheading: { fontSize: Math.round(ED.H * 0.045) || 46, fontWeight: '600' },
    body: { fontSize: Math.round(ED.H * 0.026) || 26, fontWeight: '400' },
  };

  function addText(kind, initialText) {
    const preset = TEXT_PRESETS[kind] || TEXT_PRESETS.body;
    const label = initialText || ED.i18n[kind] || ED.i18n.body;
    const rtl = ED.lang === 'ar';
    const tb = new fabric.Textbox(label, {
      width: Math.min(ED.W * 0.7, ED.W - 40),
      fontFamily: DEFAULT_FONT,
      fontSize: preset.fontSize,
      fontWeight: preset.fontWeight,
      fill: '#1b1830',
      textAlign: 'center',
      direction: rtl ? 'rtl' : 'ltr',
      lineHeight: 1.15,
      editable: true,
    });
    ED.ensureFont(DEFAULT_FONT).then(() => canvas.requestRenderAll());
    ED.addObject(tb);
    tb.enterEditing();
    tb.selectAll();
    return tb;
  }
  ED.addText = addText;

  document.querySelectorAll('[data-text]').forEach((b) =>
    b.addEventListener('click', () => addText(b.dataset.text))
  );

  /* ---- fonts list (adds text or restyles selection) -------------------
     Rebuildable (not just built once at load) so a font uploaded later
     (ED.registerCustomFont, brand.js) can be appended without a page
     reload — every FONTS.forEach() list in the app (this one, props.js's
     pFont select, brand.js's heading/body selects) registers itself into
     ED._fontRefreshers and ED.rebuildFontUI() re-runs all of them. */
  const fontList = document.getElementById('fontList');
  function populateFontList() {
    fontList.innerHTML = '';
    FONTS.forEach((f) => {
      const btn = document.createElement('button');
      btn.textContent = f.label;
      btn.style.fontFamily = `"${f.family}", sans-serif`;
      btn.addEventListener('click', () => {
        // capture the active object synchronously (at click time), not inside the
        // .then() below — by the time the font finishes loading, selection may have
        // already shifted (e.g. a just-created textbox exiting edit-mode on blur).
        const act = canvas.getActiveObject();
        ED.ensureFont(f.family).then(() => {
          if (act && (act.type === 'textbox' || act.type === 'i-text' || act.type === 'text')) {
            act.set('fontFamily', f.family);
            canvas.requestRenderAll();
            ED.record();
            if (window.ED_syncProps) window.ED_syncProps();
          } else {
            const rtl = ED.lang === 'ar';
            const tb = new fabric.Textbox(ED.i18n.body, {
              width: Math.min(ED.W * 0.7, ED.W - 40),
              fontFamily: f.family, fontSize: TEXT_PRESETS.subheading.fontSize,
              fill: '#1b1830', textAlign: 'center', direction: rtl ? 'rtl' : 'ltr',
            });
            ED.addObject(tb);
          }
        });
      });
      fontList.appendChild(btn);
    });
  }
  ED._fontRefreshers = ED._fontRefreshers || [];
  ED._fontRefreshers.push(populateFontList);
  ED.rebuildFontUI = function () { ED._fontRefreshers.forEach((fn) => fn()); };
  populateFontList();

  /* ---- shapes --------------------------------------------------------------- */
  const FILL = '#7c5cff';
  function makeShape(kind) {
    const u = Math.min(ED.W, ED.H);
    switch (kind) {
      case 'rect': return new fabric.Rect({ width: u * 0.5, height: u * 0.32, fill: FILL });
      case 'rounded': return new fabric.Rect({ width: u * 0.5, height: u * 0.32, rx: 28, ry: 28, fill: FILL });
      case 'circle': return new fabric.Circle({ radius: u * 0.2, fill: FILL });
      case 'ellipse': return new fabric.Ellipse({ rx: u * 0.26, ry: u * 0.17, fill: FILL });
      case 'triangle': return new fabric.Triangle({ width: u * 0.42, height: u * 0.4, fill: FILL });
      case 'line': return new fabric.Line([0, 0, u * 0.5, 0], { stroke: '#1b1830', strokeWidth: Math.max(4, u * 0.012) });
      case 'arrow': {
        const s = u * 0.5;
        return new fabric.Path(
          `M 0 0 L ${s} 0 M ${s - s * 0.12} ${-s * 0.09} L ${s} 0 L ${s - s * 0.12} ${s * 0.09}`,
          { stroke: '#1b1830', strokeWidth: Math.max(5, u * 0.014), fill: '', strokeLineCap: 'round', strokeLineJoin: 'round' }
        );
      }
      case 'star': {
        const spikes = 5, outer = u * 0.22, inner = outer * 0.42, pts = [];
        for (let i = 0; i < spikes * 2; i++) {
          const r = i % 2 === 0 ? outer : inner;
          const a = (Math.PI / spikes) * i - Math.PI / 2;
          pts.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
        }
        return new fabric.Polygon(pts, { fill: FILL });
      }
      default: return new fabric.Rect({ width: 200, height: 200, fill: FILL });
    }
  }
  document.querySelectorAll('[data-shape]').forEach((b) =>
    b.addEventListener('click', () => ED.addObject(makeShape(b.dataset.shape)))
  );

  /* ---- elements library (SVG) ------------------------------------------- */
  const elGrid = document.getElementById('elGrid');
  const elFilters = document.getElementById('elFilters');
  const elSearch = document.getElementById('elSearch');
  const EL_CATS = (ED.i18n && ED.i18n.elCats) || { all: 'All' };
  const NO_RESULTS = (ED.i18n && ED.i18n.noResults) || '—';
  let elData = null;
  let elCat = 'all';
  let elQuery = '';

  function renderElements() {
    if (!elData) return;
    const cats = ['all', ...elData.categories];
    elFilters.innerHTML = cats.map((c) =>
      `<button class="ed-el-chip${c === elCat ? ' active' : ''}" data-cat="${c}">${EL_CATS[c] || c}</button>`
    ).join('');
    const items = elData.items.filter((it) =>
      (elCat === 'all' || it.cat === elCat) && (!elQuery || it.id.toLowerCase().includes(elQuery))
    );
    elGrid.innerHTML = items.length
      ? items.map((it) => `<button class="ed-el-item" data-id="${it.id}" title="${it.id}">${it.svg}</button>`).join('')
      : `<p class="ed-hint">${NO_RESULTS}</p>`;
  }
  // unified search: typing in either the Templates or Elements search box
  // mirrors into the other, so switching tabs shows matching results
  // immediately instead of having to retype the same query — each side's
  // renderX() already no-ops until its own data is lazy-loaded, so this is
  // safe to call before the other tab has ever been opened.
  elSearch.addEventListener('input', () => {
    elQuery = elSearch.value.trim().toLowerCase();
    renderElements();
    if (tplSearch.value !== elSearch.value) { tplSearch.value = elSearch.value; tplQuery = elQuery; renderTemplates(); }
  });

  async function loadElements() {
    if (elData) return;
    try {
      const res = await fetch('/static/data/elements.json');
      elData = await res.json();
      renderElements();
    } catch (e) {
      elGrid.innerHTML = '<p class="ed-hint">—</p>';
    }
  }

  elFilters.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-cat]');
    if (!chip) return;
    elCat = chip.dataset.cat;
    renderElements();
  });
  elGrid.addEventListener('click', (e) => {
    const btn = e.target.closest('.ed-el-item');
    if (!btn || !elData) return;
    const item = elData.items.find((it) => it.id === btn.dataset.id);
    if (!item) return;
    fabric.loadSVGFromString(item.svg, (objs, opts) => {
      const obj = objs.length === 1 ? objs[0] : fabric.util.groupSVGElements(objs, opts);
      const w = obj.width || 100;
      const target = ED.W * (item.cat === 'lines' || item.cat === 'decor' ? 0.5 : 0.32);
      const s = target / w;
      obj.set({ scaleX: s, scaleY: s });
      ED.addObject(obj);
    });
  });

  /* ---- uploads ------------------------------------------------------------- */
  let uploadsCache = null;
  const uploadGrid = document.getElementById('uploadGrid');
  const bgImageGrid = document.getElementById('bgImageGrid');
  const uploadInput = document.getElementById('uploadInput');
  const uploadDrop = document.getElementById('uploadDrop');
  const uploadSearch = document.getElementById('uploadSearch');
  const EMPTY_HINT = (ED.i18n && ED.i18n.uploadsEmpty) || '—';
  const NO_RESULTS_HINT = (ED.i18n && ED.i18n.noResults) || '—';

  function uploadThumbHtml(u, showUseBg) {
    return `<div class="ed-upload-thumb" draggable="true" data-id="${u.id}" data-url="${u.url}">
      <img src="${u.url}" alt="" loading="lazy">
      ${showUseBg ? `<button class="ed-upload-usebg" data-usebg="${u.id}" title="${ED.i18n.useAsBackground || ''}">⬚</button>` : ''}
      <button class="ed-upload-del" data-del="${u.id}" title="✕">✕</button></div>`;
  }

  function renderUploads() {
    if (!uploadsCache || !uploadsCache.length) {
      const empty = `<p class="ed-hint">${EMPTY_HINT}</p>`;
      uploadGrid.innerHTML = empty;
      bgImageGrid.innerHTML = empty;
      uploadSearch.hidden = true;
      return;
    }
    // only worth showing once there's enough to actually search through
    uploadSearch.hidden = uploadsCache.length < 6;
    const q = uploadSearch.value.trim().toLowerCase();
    const filtered = q ? uploadsCache.filter((u) => (u.original_name || '').toLowerCase().includes(q)) : uploadsCache;
    // the general Uploads grid also gets a "use as background" button per
    // thumbnail — swaps out whatever background is there (including the
    // plain default one) for this photo, without having to find the
    // separate Background panel first. (Search only narrows this grid, not
    // the Background panel's own image picker below — that one stays the
    // full list regardless of what's typed here.)
    uploadGrid.innerHTML = filtered.length
      ? filtered.map((u) => uploadThumbHtml(u, true)).join('')
      : `<p class="ed-hint">${NO_RESULTS_HINT}</p>`;
    bgImageGrid.innerHTML = uploadsCache.map((u) => uploadThumbHtml(u, false)).join('');
  }
  uploadSearch.addEventListener('input', renderUploads);

  async function loadUploads(force) {
    if (uploadsCache && !force) return;
    try {
      const res = await fetch('/api/uploads', { headers: { 'x-csrf-token': CSRF } });
      const j = await res.json();
      uploadsCache = j.uploads || [];
      renderUploads();
    } catch (e) { /* ignore */ }
  }
  ED.loadUploads = loadUploads;

  async function doUpload(file) {
    if (!file) return false;
    const fd = new FormData();
    fd.append('image', file);
    try {
      const res = await fetch('/api/uploads', {
        method: 'POST', headers: { 'x-csrf-token': CSRF }, body: fd,
      });
      const j = await res.json();
      if (!j.url) return false;
      uploadsCache = [{ id: j.id, url: j.url, original_name: file.name }, ...(uploadsCache || [])];
      renderUploads();
      return true;
    } catch (e) {
      return false;
    }
  }

  // Uploads run sequentially (not Promise.all) so the grid fills in one at a
  // time as each finishes, and one bad file can't race/clobber uploadsCache
  // against another's concurrent read-modify-write — a single combined alert
  // covers any failures instead of one popup per bad file in the batch.
  async function doUploadMany(files) {
    const list = [...(files || [])];
    if (!list.length) return;
    uploadDrop.classList.add('drag');
    let failed = 0;
    for (const file of list) {
      const ok = await doUpload(file);
      if (!ok) failed++;
    }
    uploadDrop.classList.remove('drag');
    if (failed) alert(ED.lang === 'ar' ? `تعذّر رفع ${failed} من الصور` : `${failed} photo(s) failed to upload`);
  }

  uploadInput.addEventListener('change', () => { doUploadMany(uploadInput.files); uploadInput.value = ''; });
  ['dragover', 'dragenter'].forEach((ev) =>
    uploadDrop.addEventListener(ev, (e) => { e.preventDefault(); uploadDrop.classList.add('drag'); })
  );
  ['dragleave', 'drop'].forEach((ev) =>
    uploadDrop.addEventListener(ev, (e) => { e.preventDefault(); if (ev === 'dragleave') uploadDrop.classList.remove('drag'); })
  );
  uploadDrop.addEventListener('drop', (e) => { doUploadMany(e.dataTransfer.files); });

  function addImageToCanvas(url) {
    fabric.Image.fromURL(url, (img) => {
      if (!img || !img.width) return;
      const target = ED.W * 0.6;
      const scale = Math.min(1, target / img.width);
      img.set({ scaleX: scale, scaleY: scale });
      ED.addObject(img);
    });
  }

  uploadGrid.addEventListener('click', (e) => {
    const del = e.target.closest('[data-del]');
    if (del) {
      e.stopPropagation();
      const id = del.dataset.del;
      fetch('/api/uploads/' + id, { method: 'DELETE', headers: { 'x-csrf-token': CSRF } });
      uploadsCache = (uploadsCache || []).filter((u) => String(u.id) !== String(id));
      renderUploads();
      return;
    }
    const useBg = e.target.closest('[data-usebg]');
    if (useBg) {
      e.stopPropagation();
      ED.setBackgroundImage(useBg.closest('.ed-upload-thumb').dataset.url);
      return;
    }
    const thumb = e.target.closest('.ed-upload-thumb');
    if (thumb) addImageToCanvas(thumb.dataset.url);
  });

  bgImageGrid.addEventListener('click', (e) => {
    if (e.target.closest('[data-del]')) return;
    const thumb = e.target.closest('.ed-upload-thumb');
    if (thumb) ED.setBackgroundImage(thumb.dataset.url);
  });

  /* ---- background ------------------------------------------------------- */
  const PALETTE = [
    '#ffffff', '#f6f5fb', '#1b1830', '#000000', '#7c5cff', '#5b3df5',
    '#ff5c8a', '#ff8f3f', '#ffd23f', '#22a06b', '#4cc9f0', '#e5484d',
    '#fce7f3', '#e0e7ff', '#dcfce7', '#fef9c3', '#0f172a', '#334155',
  ];
  const bgSwatches = document.getElementById('bgSwatches');
  PALETTE.forEach((hex) => {
    const b = document.createElement('button');
    b.style.background = hex;
    b.title = hex;
    b.addEventListener('click', () => {
      ED.setBackgroundColor(hex);
      document.getElementById('bgColorPick').value = /^#[0-9a-f]{6}$/i.test(hex) ? hex : '#ffffff';
    });
    bgSwatches.appendChild(b);
  });
  document.getElementById('bgColorPick').addEventListener('input', (e) => ED.setBackgroundColor(e.target.value));
  document.getElementById('bgClear').addEventListener('click', () => ED.clearBackground());

  /* ---- templates ------------------------------------------------------------ */
  const tplList = document.getElementById('tplList');
  const tplFilters = document.getElementById('tplFilters');
  const tplSearch = document.getElementById('tplSearch');
  const TPL_CATS = (ED.i18n && ED.i18n.tplCats) || { all: 'All' };
  let tplData = null;
  let tplCat = 'all';
  let tplQuery = '';

  function renderTemplates() {
    if (!tplData) return;
    const cats = ['all', ...tplData.categories];
    tplFilters.innerHTML = cats.map((c) =>
      `<button class="ed-el-chip${c === tplCat ? ' active' : ''}" data-cat="${c}">${TPL_CATS[c] || c}</button>`
    ).join('');
    const items = tplData.items.filter((t) => {
      if (tplCat !== 'all' && t.category !== tplCat) return false;
      if (!tplQuery) return true;
      return t.name_ar.toLowerCase().includes(tplQuery) || t.name_en.toLowerCase().includes(tplQuery);
    });
    tplList.innerHTML = items.length ? items.map((t) => {
      const name = ED.lang === 'ar' ? t.name_ar : t.name_en;
      return `<div class="ed-tpl-item" data-id="${t.id}" title="${name}">
        ${t.thumbnail ? `<img src="${t.thumbnail}" alt="${name}">` : ''}
        ${t.category === 'mine' ? `<button class="ed-upload-del" data-del-tpl="${t.id}" title="✕">✕</button>` : ''}
        <span class="ed-tpl-name">${name}</span></div>`;
    }).join('') : `<p class="ed-hint">${NO_RESULTS}</p>`;
  }
  window.ED_invalidateTemplatesCache = () => { tplData = null; loadTemplates(); };
  tplSearch.addEventListener('input', () => {
    tplQuery = tplSearch.value.trim().toLowerCase();
    renderTemplates();
    if (elSearch.value !== tplSearch.value) { elSearch.value = tplSearch.value; elQuery = tplQuery; renderElements(); }
  });

  async function loadTemplates() {
    if (tplData) { renderTemplates(); return; }
    try {
      const res = await fetch('/api/templates', { headers: { 'x-csrf-token': CSRF } });
      const j = await res.json();
      const items = j.templates || [];
      if (!items.length) { tplList.innerHTML = `<p class="ed-hint">—</p>`; return; }
      tplData = { items, categories: [...new Set(items.map((t) => t.category))] };
      renderTemplates();
    } catch (e) {
      tplList.innerHTML = `<p class="ed-hint">—</p>`;
    }
  }

  tplFilters.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-cat]');
    if (!chip) return;
    tplCat = chip.dataset.cat;
    renderTemplates();
  });

  tplList.addEventListener('click', async (e) => {
    const del = e.target.closest('[data-del-tpl]');
    if (del) {
      e.stopPropagation();
      if (!confirm(ED.i18n.deleteTplConfirm)) return;
      const id = del.dataset.delTpl;
      await fetch('/api/templates/' + id, { method: 'DELETE', headers: { 'x-csrf-token': CSRF } });
      tplData.items = tplData.items.filter((t) => String(t.id) !== String(id));
      renderTemplates();
      return;
    }
    const item = e.target.closest('.ed-tpl-item');
    if (!item) return;
    if (!confirm(ED.i18n.replaceTplConfirm)) return;
    try {
      const res = await fetch('/api/templates/' + item.dataset.id, { headers: { 'x-csrf-token': CSRF } });
      const j = await res.json();
      const tpl = j.template;
      if (!tpl || !tpl.data_json) return;
      ED._suspendHistory = true;
      canvas.loadFromJSON(tpl.data_json, () => {
        ED.restoreArtboardFlags();
        ED.resizeArtboard(tpl.width, tpl.height);
        ED._suspendHistory = false;
        canvas.requestRenderAll();
        ED.record();
        if (window.ED_syncProps) window.ED_syncProps();
        if (window.ED_renderPageStrip) window.ED_renderPageStrip();
      });
    } catch (err) { /* ignore */ }
  });

  /* ---- layers panel ------------------------------------------------------- */
  const NAMES = (ED.i18n && ED.i18n.names) || {};
  const LAYERS_EMPTY = (ED.i18n && ED.i18n.layersEmpty) || '—';
  const layersList = document.getElementById('layersList');
  let uidSeq = 0;

  function typeKey(o) {
    const m = {
      textbox: 'text', 'i-text': 'text', text: 'text',
      rect: 'rect', circle: 'circle', ellipse: 'ellipse', triangle: 'triangle',
      line: 'line', path: 'path', polygon: 'polygon', image: 'image',
      group: 'group', activeselection: 'group',
    };
    return m[o.type] || 'path';
  }
  function displayName(o) {
    if (o.name && o.name !== ED.ARTBOARD && o.name !== ED.BGIMAGE) return o.name;
    if (o.type === 'textbox' || o.type === 'i-text' || o.type === 'text') {
      return (o.text || '').trim().slice(0, 24) || NAMES.text || 'Text';
    }
    return NAMES[typeKey(o)] || o.type;
  }
  function uidOf(o) {
    if (!o.__uid) o.__uid = 'ly' + ++uidSeq;
    return o.__uid;
  }
  function objByUid(uid) {
    return canvas.getObjects().find((o) => o.__uid === uid);
  }

  const ICONS = {
    eye: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>',
    eyeoff: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.9 4.2A9.5 9.5 0 0 1 12 4c6.5 0 10 8 10 8a18 18 0 0 1-2.3 3.3M6.7 6.7A18 18 0 0 0 2 12s3.5 8 10 8a9.5 9.5 0 0 0 4.2-1M3 3l18 18"/></svg>',
    lock: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>',
    unlock: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 7.5-2"/></svg>',
    grip: '<svg class="ic" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="9" cy="18" r="1.4"/><circle cx="15" cy="6" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="15" cy="18" r="1.4"/></svg>',
    trash: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>',
  };

  let layersRAF = null;
  function syncLayers() {
    if (layersRAF) return;
    layersRAF = requestAnimationFrame(() => {
      layersRAF = null;
      buildLayers();
    });
  }
  window.ED_syncLayers = syncLayers;

  function buildLayers() {
    const objs = canvas.getObjects().filter((o) => o.name !== ED.ARTBOARD && o.name !== ED.BGIMAGE);
    const active = canvas.getActiveObject();
    if (!objs.length) {
      layersList.innerHTML = `<p class="ed-hint">${LAYERS_EMPTY}</p>`;
      return;
    }
    // front-most first
    const rows = objs.slice().reverse().map((o) => {
      const uid = uidOf(o);
      const isActive = o === active || (active && active._objects && active._objects.includes(o));
      const thumb = o.type === 'image' && o._element && o._element.src
        ? `<img src="${o._element.src}" alt="">`
        : glyphFor(o);
      return `<div class="ed-layer-row${isActive ? ' active' : ''}${o.visible === false ? ' is-hidden' : ''}"
        data-id="${uid}" draggable="true">
        <span class="ed-layer-grip" data-grip>${ICONS.grip}</span>
        <span class="ed-layer-ic">${thumb}</span>
        <input class="ed-layer-name" value="${escapeAttr(displayName(o))}" readonly title="${(ED.i18n && ED.i18n.bg) ? '' : ''}">
        <button class="ed-layer-tgl" data-act="vis">${o.visible === false ? ICONS.eyeoff : ICONS.eye}</button>
        <button class="ed-layer-tgl" data-act="lock">${o.lockMovementX ? ICONS.lock : ICONS.unlock}</button>
      </div>`;
    });
    layersList.innerHTML = rows.join('');
  }

  function glyphFor(o) {
    const g = { text: 'T', rect: '▭', circle: '◯', ellipse: '◯', triangle: '△', line: '╱', polygon: '★', path: '✦', group: '▦' };
    return g[typeKey(o)] || '▩';
  }
  function escapeAttr(s) {
    return String(s).replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  layersList.addEventListener('click', (e) => {
    const row = e.target.closest('.ed-layer-row');
    if (!row) return;
    const o = objByUid(row.dataset.id);
    if (!o) return;
    const tgl = e.target.closest('[data-act]');
    if (tgl) {
      if (tgl.dataset.act === 'vis') {
        o.visible = o.visible === false ? true : false;
        if (o.visible === false && canvas.getActiveObject() === o) canvas.discardActiveObject();
      } else {
        const lock = !o.lockMovementX;
        o.set({ lockMovementX: lock, lockMovementY: lock, lockScalingX: lock, lockScalingY: lock, lockRotation: lock, hasControls: !lock });
      }
      canvas.requestRenderAll();
      ED.record();
      buildLayers();
      return;
    }
    canvas.setActiveObject(o);
    canvas.requestRenderAll();
    if (window.ED_syncProps) window.ED_syncProps();
  });

  layersList.addEventListener('dblclick', (e) => {
    const input = e.target.closest('.ed-layer-name');
    if (!input) return;
    input.removeAttribute('readonly');
    input.focus();
    input.select();
  });
  layersList.addEventListener('keydown', (e) => {
    if (e.target.classList.contains('ed-layer-name') && e.key === 'Enter') e.target.blur();
  });
  layersList.addEventListener('blur', (e) => {
    const input = e.target.closest && e.target.closest('.ed-layer-name');
    if (!input || input.hasAttribute('readonly')) return;
    input.setAttribute('readonly', '');
    const row = input.closest('.ed-layer-row');
    const o = objByUid(row.dataset.id);
    if (o) {
      const v = input.value.trim();
      o.name = v || null;
      input.value = displayName(o);
      ED.record();
    }
  }, true);

  // drag reorder (mouse: native HTML5 DnD below; touch: bindTouchReorder near the page-strip code)
  function applyLayerReorder(dragUid, targetUid) {
    if (!dragUid || !targetUid || dragUid === targetUid) return;
    const targetRow = layersList.querySelector(`[data-id="${targetUid}"]`);
    const dragged = objByUid(dragUid);
    const target = objByUid(targetUid);
    if (!targetRow || !dragged || !target) return;
    // DOM order is front->back; move dragged just in front of target
    const domRows = [...layersList.querySelectorAll('.ed-layer-row')];
    domRows.splice(domRows.indexOf(layersList.querySelector(`[data-id="${dragUid}"]`)), 1);
    const ti = domRows.indexOf(targetRow);
    domRows.splice(ti, 0, null); // placeholder where dragged goes (in front of target)
    // rebuild stacking: back->front = reverse of DOM
    const order = domRows.map((r) => (r ? objByUid(r.dataset.id) : dragged)).filter(Boolean).reverse();
    const base = 1 + (canvas.getObjects().some((o) => o.name === ED.BGIMAGE) ? 1 : 0);
    order.forEach((o, i) => canvas.moveTo(o, base + i));
    ED.restoreArtboardFlags();
    canvas.requestRenderAll();
    ED.record();
    buildLayers();
  }
  let dragUid = null;
  layersList.addEventListener('dragstart', (e) => {
    const row = e.target.closest('.ed-layer-row');
    if (!row) return;
    dragUid = row.dataset.id;
    row.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });
  layersList.addEventListener('dragend', () => {
    dragUid = null;
    layersList.querySelectorAll('.ed-layer-row').forEach((r) => r.classList.remove('dragging', 'dragover'));
  });
  layersList.addEventListener('dragover', (e) => {
    e.preventDefault();
    const row = e.target.closest('.ed-layer-row');
    layersList.querySelectorAll('.dragover').forEach((r) => r.classList.remove('dragover'));
    if (row && row.dataset.id !== dragUid) row.classList.add('dragover');
  });
  layersList.addEventListener('drop', (e) => {
    e.preventDefault();
    const targetRow = e.target.closest('.ed-layer-row');
    if (targetRow) applyLayerReorder(dragUid, targetRow.dataset.id);
  });

  ['object:added', 'object:removed', 'object:modified'].forEach((ev) => canvas.on(ev, syncLayers));
  canvas.on('selection:created', syncLayers);
  canvas.on('selection:updated', syncLayers);
  canvas.on('selection:cleared', syncLayers);

  /* ---- page strip ----------------------------------------------------------- */
  const pageStripList = document.getElementById('pageStripList');
  const pageAddBtn = document.getElementById('pageAddBtn');
  const dlAllPagesRow = document.getElementById('dlAllPagesRow');

  function renderPageStrip() {
    if (dlAllPagesRow) dlAllPagesRow.hidden = ED.pages.length <= 1;
    pageStripList.innerHTML = ED.pages.map((p, i) => {
      const thumb = i === ED.activePage ? ED.makeThumbnail() : (p.thumb || '');
      const delBtn = ED.pages.length > 1
        ? `<button class="ed-page-del" data-del="${i}" title="${ED.i18n.pageDelete}" aria-label="${ED.i18n.pageDelete}">${ICONS.trash}</button>`
        : '';
      return `<div class="ed-page-tile${i === ED.activePage ? ' active' : ''}" data-idx="${i}" draggable="true" title="${i + 1}">
        ${thumb ? `<img src="${thumb}" alt="">` : ''}
        <span class="ed-page-num">${i + 1}</span>
        ${delBtn}
      </div>`;
    }).join('');
  }
  window.ED_renderPageStrip = renderPageStrip;

  pageStripList.addEventListener('click', (e) => {
    const del = e.target.closest('[data-del]');
    if (del) {
      e.stopPropagation();
      if (confirm(ED.i18n.pageDeleteConfirm)) ED.deletePage(Number(del.dataset.del));
      return;
    }
    const tile = e.target.closest('.ed-page-tile');
    if (tile) ED.switchPage(Number(tile.dataset.idx));
  });
  pageAddBtn.addEventListener('click', () => ED.addPage());

  let dragPageIdx = null;
  pageStripList.addEventListener('dragstart', (e) => {
    const tile = e.target.closest('.ed-page-tile');
    if (!tile) return;
    dragPageIdx = Number(tile.dataset.idx);
    tile.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });
  pageStripList.addEventListener('dragend', () => {
    dragPageIdx = null;
    pageStripList.querySelectorAll('.ed-page-tile').forEach((t) => t.classList.remove('dragging', 'dragover'));
  });
  pageStripList.addEventListener('dragover', (e) => {
    e.preventDefault();
    const tile = e.target.closest('.ed-page-tile');
    pageStripList.querySelectorAll('.dragover').forEach((t) => t.classList.remove('dragover'));
    if (tile && Number(tile.dataset.idx) !== dragPageIdx) tile.classList.add('dragover');
  });
  pageStripList.addEventListener('drop', (e) => {
    e.preventDefault();
    const tile = e.target.closest('.ed-page-tile');
    if (!tile || dragPageIdx == null) return;
    const to = Number(tile.dataset.idx);
    if (to !== dragPageIdx) ED.reorderPage(dragPageIdx, to);
    dragPageIdx = null;
  });

  /* ---- touch drag-reorder ---------------------------------------------------
     Native HTML5 drag-and-drop (above) has no touch equivalent at all — on a
     phone/tablet, pressing and dragging a layer row or page tile does
     nothing. This adds a parallel, touch-only long-press-to-drag gesture
     (mouse/pen keep using the native DnD above unchanged) that reuses the
     exact same reorder math via `onDrop`. A long press (not an instant grab)
     is required so a quick touch still reaches the normal tap handler (select
     a layer / switch page) and a swipe still scrolls the list — only a
     press that stays still past LONG_PRESS_MS commits to dragging, at which
     point the gesture is still stationary so no native scroll has started
     yet and preventDefault() on the next move reliably suppresses it. */
  function bindTouchReorder(container, itemSel, getId, onDrop) {
    const LONG_PRESS_MS = 260;
    const MOVE_CANCEL_PX = 10;
    let pending = null; // { id, el, x, y, timer }
    let armed = null; // { id, el }

    function clear() {
      if (pending) clearTimeout(pending.timer);
      pending = null;
      if (armed) armed.el.classList.remove('dragging');
      armed = null;
      container.querySelectorAll('.dragover').forEach((n) => n.classList.remove('dragover'));
    }

    container.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
      if (e.target.closest('button,input')) return;
      const el = e.target.closest(itemSel);
      if (!el) return;
      clear();
      const id = getId(el);
      pending = {
        id, el, x: e.clientX, y: e.clientY,
        timer: setTimeout(() => {
          if (!pending) return;
          armed = { id: pending.id, el: pending.el };
          armed.el.classList.add('dragging');
          pending = null;
        }, LONG_PRESS_MS),
      };
    }, { passive: true });

    container.addEventListener('pointermove', (e) => {
      if (pending && Math.hypot(e.clientX - pending.x, e.clientY - pending.y) > MOVE_CANCEL_PX) {
        clear(); // moved before the long-press fired: a scroll or a tap-drag, not a reorder
        return;
      }
      if (!armed) return;
      e.preventDefault();
      const under = document.elementFromPoint(e.clientX, e.clientY);
      const targetEl = under && under.closest(itemSel);
      container.querySelectorAll('.dragover').forEach((n) => n.classList.remove('dragover'));
      if (targetEl && targetEl !== armed.el) targetEl.classList.add('dragover');
    }, { passive: false });

    function finish(e) {
      if (!armed) { clear(); return; }
      const under = document.elementFromPoint(e.clientX, e.clientY);
      const targetEl = under && under.closest(itemSel);
      const draggedId = armed.id;
      clear();
      if (targetEl && getId(targetEl) !== draggedId) onDrop(draggedId, getId(targetEl));
    }
    container.addEventListener('pointerup', finish);
    container.addEventListener('pointercancel', clear);
  }

  bindTouchReorder(layersList, '.ed-layer-row', (el) => el.dataset.id, applyLayerReorder);
  bindTouchReorder(pageStripList, '.ed-page-tile', (el) => Number(el.dataset.idx), (from, to) => ED.reorderPage(from, to));

  /* ---- tab switching ------------------------------------------------------- */
  const left = document.querySelector('.ed-left');
  document.querySelectorAll('.ed-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      const name = tab.dataset.tab;
      document.querySelectorAll('.ed-tab').forEach((t) => t.classList.toggle('active', t === tab));
      document.querySelectorAll('.ed-panel').forEach((p) =>
        p.classList.toggle('active', p.dataset.panel === name)
      );
      left.classList.add('open');
      document.getElementById('rightPanel').classList.remove('open', 'user-opened'); // mobile: only one overlay open at a time
      if (name === 'uploads' || name === 'background') loadUploads();
      if (name === 'layers') buildLayers();
      if (name === 'elements') loadElements();
      if (name === 'brand' && ED.loadBrand) ED.loadBrand();
    });
  });
  // close the slide-over panel when clicking the workspace (small screens)
  document.getElementById('workspace').addEventListener('pointerdown', () => left.classList.remove('open'));
  document.getElementById('closeLeftPanel')?.addEventListener('click', () => left.classList.remove('open'));
  document.getElementById('closeRightPanel')?.addEventListener('click', () => {
    document.getElementById('rightPanel').classList.remove('open', 'user-opened');
    canvas.discardActiveObject();
    canvas.requestRenderAll();
  });

  /* ---- initial data ------------------------------------------------------- */
  window.ED_afterBoot = function () {
    loadTemplates();
    buildLayers();
    renderPageStrip();
  };
})();
