'use strict';

/* ============================================================================
   Brand Kit: saved colours, fonts and logo (persisted per user via /api/brand)
   ========================================================================== */

(function () {
  const ED = window.ED;
  const canvas = ED.canvas;
  const CSRF = document.querySelector('meta[name="csrf-token"]').content;

  const elColors = document.getElementById('brandColors');
  const elAddColor = document.getElementById('brandAddColor');
  const elFontH = document.getElementById('brandFontH');
  const elFontB = document.getElementById('brandFontB');
  const elLogoInput = document.getElementById('brandLogoInput');
  const elLogoPrev = document.getElementById('brandLogoPreview');
  const elLogoImg = document.getElementById('brandLogoImg');
  const elLogoAdd = document.getElementById('brandLogoAdd');

  let brand = { colors: [], fontHeading: '', fontBody: '', logoUrl: '' };
  let loaded = false;
  let saveT = null;

  /* ---- populate heading/body font selects (rebuildable — see ED.rebuildFontUI in objects.js) */
  function populateBrandFontSelects() {
    [elFontH, elFontB].forEach((sel) => {
      const current = sel.value;
      sel.innerHTML = '';
      sel.insertAdjacentHTML('afterbegin', '<option value="">—</option>');
      (ED.FONTS || []).forEach((f) => {
        const o = document.createElement('option');
        o.value = f.family; o.textContent = f.label; o.style.fontFamily = `"${f.family}"`;
        sel.appendChild(o);
      });
      sel.value = current;
    });
  }
  ED._fontRefreshers = ED._fontRefreshers || [];
  ED._fontRefreshers.push(populateBrandFontSelects);
  populateBrandFontSelects();

  function hex(c) {
    try { return '#' + new fabric.Color(c || '#000').toHex().slice(0, 6).toLowerCase(); }
    catch (e) { return '#000000'; }
  }

  function scheduleSave() {
    clearTimeout(saveT);
    saveT = setTimeout(save, 700);
  }
  async function save() {
    try {
      await fetch('/api/brand', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': CSRF },
        body: JSON.stringify(brand),
      });
    } catch (e) { /* ignore */ }
  }

  function renderColors() {
    elColors.innerHTML = brand.colors.map((c, i) =>
      `<button class="ed-brand-sw" data-i="${i}" style="background:${c}" title="${c}"><span class="ed-brand-x" data-x="${i}">✕</span></button>`
    ).join('') || `<p class="ed-hint" style="grid-column:1/-1">—</p>`;
  }

  elColors.addEventListener('click', (e) => {
    const x = e.target.closest('[data-x]');
    if (x) {
      brand.colors.splice(+x.dataset.x, 1);
      renderColors();
      scheduleSave();
      return;
    }
    const sw = e.target.closest('[data-i]');
    if (!sw) return;
    const col = brand.colors[+sw.dataset.i];
    const o = canvas.getActiveObject();
    if (o) {
      if (['textbox', 'i-text', 'text'].includes(o.type) || typeof o.fill === 'string') o.set('fill', col);
      else o.set('fill', col);
      canvas.requestRenderAll();
      ED.record();
      if (window.ED_syncProps) window.ED_syncProps();
    }
  });

  elAddColor.addEventListener('click', () => {
    const o = canvas.getActiveObject();
    let c = o && typeof o.fill === 'string' ? o.fill : '#7c5cff';
    c = hex(c);
    if (!brand.colors.includes(c) && brand.colors.length < 12) {
      brand.colors.push(c);
      renderColors();
      scheduleSave();
    }
  });

  /* ---- extract a palette from a photo -------------------------------------
     Downscales to 100x100, buckets pixels into coarse RGB cells, and ranks
     buckets by frequency — preferring saturated colors first so a photo
     dominated by white/gray background doesn't just yield five near-white
     swatches, then filling any remaining slots from the neutral buckets. */
  function extractPalette(imgEl, count) {
    const size = 100;
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    const ctx = c.getContext('2d');
    ctx.drawImage(imgEl, 0, 0, size, size);
    const data = ctx.getImageData(0, 0, size, size).data;
    const buckets = new Map();
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 128) continue; // skip transparent pixels
      const r = Math.round(data[i] / 24) * 24;
      const g = Math.round(data[i + 1] / 24) * 24;
      const b = Math.round(data[i + 2] / 24) * 24;
      const key = r + ',' + g + ',' + b;
      buckets.set(key, (buckets.get(key) || 0) + 1);
    }
    const entries = [...buckets.entries()].map(([key, n]) => {
      const [r, g, b] = key.split(',').map(Number);
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      return { r, g, b, n, sat: max === 0 ? 0 : (max - min) / max };
    });
    const vivid = entries.filter((e) => e.sat >= 0.12).sort((a, b) => b.n - a.n);
    const neutral = entries.filter((e) => e.sat < 0.12).sort((a, b) => b.n - a.n);
    return [...vivid, ...neutral].slice(0, count).map((e) =>
      '#' + [e.r, e.g, e.b].map((v) => Math.min(255, v).toString(16).padStart(2, '0')).join('')
    );
  }
  ED.extractPalette = extractPalette;

  function applyExtractedPalette(img) {
    extractPalette(img, 5).forEach((c) => {
      if (!brand.colors.includes(c) && brand.colors.length < 12) brand.colors.push(c);
    });
    renderColors();
    scheduleSave();
  }

  const elExtractBtn = document.getElementById('brandExtractBtn');
  const elExtractInput = document.getElementById('brandExtractInput');
  elExtractBtn.addEventListener('click', () => elExtractInput.click());
  elExtractInput.addEventListener('change', () => {
    const file = elExtractInput.files[0];
    elExtractInput.value = '';
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { applyExtractedPalette(img); URL.revokeObjectURL(url); };
    img.onerror = () => URL.revokeObjectURL(url);
    img.src = url;
  });

  // "or use a photo already in your design" — see ED.canvasImages in objects.js
  const extractCanvasPick = document.getElementById('brandExtractCanvasPick');
  const extractCanvasGrid = document.getElementById('brandExtractCanvasGrid');
  let extractCanvasImages = [];
  function renderExtractCanvasPick() {
    if (!extractCanvasPick || !extractCanvasGrid) return;
    extractCanvasImages = ED.canvasImages ? ED.canvasImages() : [];
    extractCanvasPick.hidden = extractCanvasImages.length === 0;
    extractCanvasGrid.innerHTML = extractCanvasImages
      .map((it, i) => `<div class="ed-upload-thumb" data-i="${i}"><img src="${it.url}" alt=""></div>`)
      .join('');
  }
  document.querySelector('.ed-tab[data-tab="brand"]')?.addEventListener('click', renderExtractCanvasPick);
  renderExtractCanvasPick();
  extractCanvasGrid?.addEventListener('click', (e) => {
    const thumb = e.target.closest('.ed-upload-thumb');
    if (!thumb) return;
    const src = extractCanvasImages[Number(thumb.dataset.i)];
    if (!src) return;
    const img = new Image();
    img.onload = () => applyExtractedPalette(img);
    img.src = src.url;
  });

  elFontH.addEventListener('change', () => { brand.fontHeading = elFontH.value; applyFont(elFontH.value, true); scheduleSave(); });
  elFontB.addEventListener('change', () => { brand.fontBody = elFontB.value; applyFont(elFontB.value, false); scheduleSave(); });

  function applyFont(fam, heading) {
    if (!fam) return;
    const o = canvas.getActiveObject();
    if (o && ['textbox', 'i-text', 'text'].includes(o.type)) {
      (ED.ensureFont ? ED.ensureFont(fam) : Promise.resolve()).then(() => {
        o.set('fontFamily', fam);
        canvas.requestRenderAll();
        ED.record();
        if (window.ED_syncProps) window.ED_syncProps();
      });
    }
  }

  elLogoInput.addEventListener('change', async () => {
    const file = elLogoInput.files[0];
    elLogoInput.value = '';
    if (!file) return;
    const fd = new FormData();
    fd.append('image', file);
    try {
      const res = await fetch('/api/uploads', { method: 'POST', headers: { 'x-csrf-token': CSRF }, body: fd });
      const j = await res.json();
      if (j.url) {
        brand.logoUrl = j.url;
        showLogo();
        scheduleSave();
        if (ED.loadUploads) ED.loadUploads(true);
      }
    } catch (e) { /* ignore */ }
  });

  function showLogo() {
    if (brand.logoUrl) {
      elLogoImg.src = brand.logoUrl;
      elLogoPrev.hidden = false;
    } else {
      elLogoPrev.hidden = true;
    }
  }

  elLogoAdd.addEventListener('click', () => {
    if (!brand.logoUrl) return;
    fabric.Image.fromURL(brand.logoUrl, (img) => {
      if (!img || !img.width) return;
      const s = Math.min(1, (ED.W * 0.35) / img.width);
      img.set({ scaleX: s, scaleY: s, name: 'logo' });
      ED.addObject(img);
    });
  });

  /* ---- apply brand kit to the current page ---------------------------------
     Colors: every distinct fill/stroke color currently used (walked
     recursively into groups) is remapped ONCE to its nearest brand palette
     color by RGB distance — so the design's original color relationships are
     preserved, not just cycled onto arbitrary shapes. The artboard's own fill
     is included (a plain background color IS "just another shape's fill"
     here) but the background *image*, if any, is left alone (a photo has no
     meaningful "nearest color"). Fonts: text objects are split into
     heading/body by size relative to the biggest text on the page (60%
     threshold) rather than a fixed px cutoff, since that scales with the
     design's own canvas size instead of assuming a fixed layout scale. */
  function flatten(objs, out) {
    objs.forEach((o) => {
      if (o.type === 'group' && o._objects) flatten(o._objects, out);
      else out.push(o);
    });
  }
  function nearestBrandColor(hexColor, palette) {
    let c;
    try { c = new fabric.Color(hexColor).getSource(); } catch (e) { return null; }
    let best = null, bestDist = Infinity;
    palette.forEach((hx) => {
      const p = new fabric.Color(hx).getSource();
      const d = (c[0] - p[0]) ** 2 + (c[1] - p[1]) ** 2 + (c[2] - p[2]) ** 2;
      if (d < bestDist) { bestDist = d; best = hx; }
    });
    return best;
  }
  const TEXT_TYPES = ['textbox', 'i-text', 'text'];

  ED.applyBrandKit = async function () {
    const palette = (brand.colors || []).slice();
    const hasColors = palette.length > 0;
    const hasFonts = !!(brand.fontHeading || brand.fontBody);
    if (!hasColors && !hasFonts) return { empty: true };

    const ab = ED.getArtboard ? ED.getArtboard() : null;
    const bi = ED.getBgImage ? ED.getBgImage() : null;
    const top = canvas.getObjects().filter((o) => o !== bi);
    const targets = [];
    flatten(top, targets);

    if (hasFonts) {
      await Promise.all([
        brand.fontHeading ? ED.ensureFont(brand.fontHeading) : null,
        brand.fontBody ? ED.ensureFont(brand.fontBody) : null,
      ].filter(Boolean));
    }

    ED._suspendHistory = true;

    if (hasColors) {
      const remap = new Map();
      targets.forEach((o) => {
        ['fill', 'stroke'].forEach((key) => {
          const v = o[key];
          if (typeof v === 'string' && v && !remap.has(v)) {
            const mapped = nearestBrandColor(v, palette);
            if (mapped) remap.set(v, mapped);
          }
        });
      });
      targets.forEach((o) => {
        ['fill', 'stroke'].forEach((key) => {
          const v = o[key];
          if (typeof v === 'string' && remap.has(v)) o.set(key, remap.get(v));
        });
      });
    }

    if (hasFonts) {
      const textObjs = targets.filter((o) => TEXT_TYPES.includes(o.type));
      const maxSize = textObjs.reduce((m, o) => Math.max(m, o.fontSize || 0), 0);
      const threshold = maxSize * 0.6;
      textObjs.forEach((o) => {
        const heading = (o.fontSize || 0) >= threshold;
        if (heading && brand.fontHeading) o.set('fontFamily', brand.fontHeading);
        else if (!heading && brand.fontBody) o.set('fontFamily', brand.fontBody);
      });
    }

    ED._suspendHistory = false;
    canvas.requestRenderAll();
    ED.record();
    return { empty: false };
  };

  const elApplyBtn = document.getElementById('brandApplyBtn');
  const elApplyHint = document.getElementById('brandApplyHint');
  if (elApplyBtn) {
    elApplyBtn.addEventListener('click', async () => {
      elApplyBtn.disabled = true;
      elApplyHint.textContent = ED.i18n.brandApplyWorking || '';
      try {
        const r = await ED.applyBrandKit();
        elApplyHint.textContent = r.empty ? (ED.i18n.brandApplyEmpty || '') : (ED.i18n.brandApplyDone || '');
      } finally {
        elApplyBtn.disabled = false;
      }
    });
  }

  /* ---- custom fonts (upload your own .ttf/.otf/.woff/.woff2) ---------------
     Unlike the built-in FONTS list (self-hosted @font-face rules already
     declared in fonts.css — ED.ensureFont just has to trigger their load), a
     custom font has no pre-existing @font-face at all, so it's registered at
     runtime via the FontFace API instead. Loaded eagerly at script load (not
     lazily behind opening the Brand tab, unlike colors/logo below) since the
     font needs to already be usable from the Text tab / properties panel
     the moment the editor boots, not just once Brand is opened. */
  const elFontUploadDrop = document.getElementById('fontUploadDrop');
  const elFontUploadInput = document.getElementById('fontUploadInput');
  const elCustomFontsList = document.getElementById('customFontsList');
  let customFonts = [];

  function loadFontFace(family, url) {
    if (!window.FontFace) return Promise.resolve();
    try {
      return new FontFace(family, `url(${JSON.stringify(url)})`).load()
        .then((f) => { document.fonts.add(f); })
        .catch(() => {});
    } catch (e) { return Promise.resolve(); }
  }

  function renderCustomFontsList() {
    if (!elCustomFontsList) return;
    elCustomFontsList.innerHTML = customFonts.map((f) =>
      `<div class="ed-custom-font-row"><span style="font-family:'${f.family}'">${f.family}</span><button data-del-font="${f.id}" title="✕">✕</button></div>`
    ).join('');
  }

  function addCustomFontToPickers(f) {
    if (ED.FONTS.some((x) => x.family === f.family)) return;
    ED.FONTS.push({ family: f.family, label: f.family, custom: true });
  }

  async function loadCustomFonts() {
    try {
      const res = await fetch('/api/fonts', { headers: { 'x-csrf-token': CSRF } });
      const j = await res.json();
      customFonts = j.fonts || [];
      await Promise.all(customFonts.map((f) => loadFontFace(f.family, f.url)));
      customFonts.forEach(addCustomFontToPickers);
      if (ED.rebuildFontUI) ED.rebuildFontUI();
      renderCustomFontsList();
    } catch (e) { /* ignore — built-in fonts still work fine */ }
  }
  loadCustomFonts();

  if (elFontUploadDrop && elFontUploadInput) {
    elFontUploadDrop.addEventListener('click', (e) => { e.preventDefault(); elFontUploadInput.click(); });
    elFontUploadInput.addEventListener('change', async () => {
      const file = elFontUploadInput.files[0];
      elFontUploadInput.value = '';
      if (!file) return;
      elFontUploadDrop.classList.add('disabled');
      const small = elFontUploadDrop.querySelector('small');
      const prevHint = small ? small.textContent : '';
      if (small) small.textContent = ED.i18n.brandFontUploading || '';
      try {
        const fd = new FormData();
        fd.append('font', file);
        const res = await fetch('/api/fonts', { method: 'POST', headers: { 'x-csrf-token': CSRF }, body: fd });
        if (!res.ok) throw new Error('upload failed');
        const f = await res.json();
        await loadFontFace(f.family, f.url);
        customFonts.unshift(f);
        addCustomFontToPickers(f);
        if (ED.rebuildFontUI) ED.rebuildFontUI();
        renderCustomFontsList();
      } catch (e) {
        alert(ED.i18n.brandFontError || '');
      } finally {
        elFontUploadDrop.classList.remove('disabled');
        if (small) small.textContent = prevHint;
      }
    });
  }

  elCustomFontsList?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-del-font]');
    if (!btn) return;
    const id = btn.dataset.delFont;
    await fetch('/api/fonts/' + id, { method: 'DELETE', headers: { 'x-csrf-token': CSRF } });
    customFonts = customFonts.filter((f) => String(f.id) !== String(id));
    renderCustomFontsList();
    // deliberately NOT removed from ED.FONTS / the pickers for the rest of
    // this session — text already set to it should keep rendering correctly
    // (the FontFace stays registered), only future new uploads are affected
  });

  ED.loadBrand = async function () {
    if (loaded) return;
    loaded = true;
    try {
      const res = await fetch('/api/brand', { headers: { 'x-csrf-token': CSRF } });
      const j = await res.json();
      brand = Object.assign({ colors: [], fontHeading: '', fontBody: '', logoUrl: '' }, j.brand || {});
    } catch (e) { /* keep defaults */ }
    renderColors();
    elFontH.value = brand.fontHeading || '';
    elFontB.value = brand.fontBody || '';
    showLogo();
  };
})();
