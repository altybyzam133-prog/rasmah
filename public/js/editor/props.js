'use strict';

/* ============================================================================
   Right panel: properties of the current selection, layers, alignment
   ========================================================================== */

(function () {
  const ED = window.ED;
  const canvas = ED.canvas;
  const CSRF = document.querySelector('meta[name="csrf-token"]').content;

  const $ = (id) => document.getElementById(id);
  const propsEmpty = $('propsEmpty');
  const props = $('props');
  const grpText = $('grpText');
  const grpFill = $('grpFill');
  const grpRadius = $('grpRadius');
  const grpImage = $('grpImage');
  const rightPanel = $('rightPanel');
  const distributeRow = $('distributeRow');

  const TEXT_TYPES = ['textbox', 'i-text', 'text'];
  const isText = (o) => o && TEXT_TYPES.includes(o.type);
  const isImage = (o) => o && o.type === 'image';
  const isGroup = (o) => o && (o.type === 'group' || o.type === 'activeSelection');

  let syncing = false;

  function hex(c) {
    if (!c || typeof c !== 'string') return '#000000';
    try { return '#' + new fabric.Color(c).toHex().slice(0, 6).toLowerCase(); }
    catch (e) { return '#000000'; }
  }

  function commit() {
    canvas.requestRenderAll();
    ED.record();
  }

  /* ---- recently used colors / fonts (ED.trackRecentColor/Font in core.js) - */
  const recentColorsText = $('recentColorsText');
  const recentColorsFill = $('recentColorsFill');
  function renderRecentColors() {
    const colors = ED.recentColors();
    const html = colors.map((c) => `<button data-recent-color="${c}" style="background:${c}" title="${c}"></button>`).join('');
    [recentColorsText, recentColorsFill].forEach((el) => {
      el.innerHTML = html;
      el.hidden = colors.length === 0;
    });
  }
  [recentColorsText, recentColorsFill].forEach((el) => {
    el.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-recent-color]');
      const o = canvas.getActiveObject();
      if (!btn || !o) return;
      o.set('fill', btn.dataset.recentColor);
      if (isText(o)) $('pTextColor').value = btn.dataset.recentColor; else $('pFill').value = btn.dataset.recentColor;
      commit();
    });
  });

  const recentFontsText = $('recentFontsText');
  function renderRecentFonts() {
    const fonts = ED.recentFonts();
    recentFontsText.innerHTML = fonts.map((f) => `<button data-recent-font="${f}" style="font-family:'${f}'">${f}</button>`).join('');
    recentFontsText.hidden = fonts.length === 0;
  }
  recentFontsText.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-recent-font]');
    const o = canvas.getActiveObject();
    if (!btn || !o || !isText(o)) return;
    const fam = btn.dataset.recentFont;
    (ED.ensureFont ? ED.ensureFont(fam) : Promise.resolve()).then(() => {
      o.set('fontFamily', fam);
      pFont.value = fam;
      commit();
    });
  });
  renderRecentColors();
  renderRecentFonts();

  /* ---- curved text --------------------------------------------------------
     Fabric natively renders Text/Textbox glyphs along a `path` (see its
     pathAlign/pathSide/pathStartOffset). Only the plain `curveAmount` number
     is persisted (see EXTRA_PROPS in core.js) — the Path itself is rebuilt
     from it here, both on slider input and after every JSON load (core.js
     wraps loadFromJSON for that), so it always matches the text's current
     width instead of relying on a stale or oddly-reserialized Path. */
  ED.applyTextCurve = function (o, amount) {
    o.set('curveAmount', amount);
    if (!amount) {
      o.set('path', null);
    } else {
      const w = o.width || 1;
      const path = new fabric.Path(`M 0 0 Q ${w / 2} ${-2 * amount} ${w} 0`, { visible: false });
      o.set({ path, pathStartOffset: 0, pathSide: 'left', pathAlign: 'baseline' });
    }
    o.setCoords();
  };

  /* ---- gradient fills ------------------------------------------------------
     Fabric serializes fabric.Gradient fills/strokes natively (unlike the
     curved-text Path above, this doesn't need EXTRA_PROPS or a load-time
     rebuild) — only the angle is a custom add-on, since a Gradient's own
     `coords` don't round-trip back into "degrees" on their own. */
  const fillTypeRow = $('fillTypeRow');
  const solidFillRow = $('solidFillRow');
  const gradientFillRow = $('gradientFillRow');
  const gradientAngleRow = $('gradientAngleRow');
  function isGradientFill(o) {
    return !!(o && o.fill && typeof o.fill === 'object' && o.fill.type === 'linear');
  }
  function setFillTypeUI(isGrad) {
    solidFillRow.hidden = isGrad;
    gradientFillRow.hidden = !isGrad;
    gradientAngleRow.hidden = !isGrad;
    [...fillTypeRow.querySelectorAll('button')].forEach((b) =>
      toggleBtn(b, (b.dataset.filltype === 'gradient') === isGrad)
    );
  }
  function buildGradient(o, startColor, endColor, angleDeg) {
    const w = o.width || 1, h = o.height || 1;
    const rad = (angleDeg * Math.PI) / 180;
    const cx = w / 2, cy = h / 2;
    const len = Math.sqrt(w * w + h * h) / 2;
    const dx = Math.cos(rad) * len, dy = Math.sin(rad) * len;
    return new fabric.Gradient({
      type: 'linear',
      coords: { x1: cx - dx, y1: cy - dy, x2: cx + dx, y2: cy + dy },
      colorStops: [{ offset: 0, color: startColor }, { offset: 1, color: endColor }],
    });
  }
  function applyGradient(o) {
    const angle = +$('pGradAngle').value;
    o.set({ fill: buildGradient(o, $('pGradStart').value, $('pGradEnd').value, angle), gradientAngle: angle });
    $('pGradAngleOut').value = angle;
  }
  fillTypeRow.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-filltype]');
    const o = canvas.getActiveObject();
    if (!btn || !o) return;
    const isGrad = btn.dataset.filltype === 'gradient';
    setFillTypeUI(isGrad);
    if (isGrad) applyGradient(o);
    else o.set('fill', $('pFill').value);
    commit();
  });
  ['pGradStart', 'pGradEnd', 'pGradAngle'].forEach((id) => {
    $(id).addEventListener('input', () => {
      if (syncing) return;
      const o = canvas.getActiveObject();
      if (!o || !isGradientFill(o)) return;
      applyGradient(o);
      commit();
    });
  });

  /* ---- populate font select (rebuildable — see ED.rebuildFontUI in objects.js) */
  const pFont = $('pFont');
  function populatePFont() {
    const current = pFont.value;
    pFont.innerHTML = '';
    (ED.FONTS || []).forEach((f) => {
      const o = document.createElement('option');
      o.value = f.family; o.textContent = f.label; o.style.fontFamily = `"${f.family}"`;
      pFont.appendChild(o);
    });
    if (current) pFont.value = current;
  }
  ED._fontRefreshers = ED._fontRefreshers || [];
  ED._fontRefreshers.push(populatePFont);
  populatePFont();

  /* ---- sync ----------------------------------------------------------------- */
  function sync() {
    const o = canvas.getActiveObject();
    if (!o) {
      props.hidden = true;
      propsEmpty.hidden = false;
      rightPanel.classList.remove('open', 'user-opened'); // mobile: no-op on desktop, closes the overlay there
      return;
    }
    propsEmpty.hidden = true;
    props.hidden = false;
    // mobile: surface the panel as soon as something's selected — and close the
    // left one first, since both overlays open at once just cover each other
    document.querySelector('.ed-left')?.classList.remove('open');
    rightPanel.classList.add('open');
    syncing = true;

    grpText.hidden = !isText(o);
    grpFill.hidden = isText(o) || isImage(o) || isGroup(o);
    grpRadius.hidden = o.type !== 'rect';
    grpImage.hidden = !isImage(o);
    // distribute needs at least 3 objects — with 2, there's no "middle" gap to equalize
    if (distributeRow) distributeRow.hidden = !(o.type === 'activeSelection' && o._objects && o._objects.length >= 3);
    renderRecentColors();
    renderRecentFonts();

    if (isText(o)) {
      pFont.value = o.fontFamily || 'Cairo';
      $('pFontSize').value = Math.round(o.fontSize || 0);
      $('pTextColor').value = hex(o.fill);
      toggleBtn($('pBold'), o.fontWeight === 'bold' || Number(o.fontWeight) >= 600);
      toggleBtn($('pItalic'), o.fontStyle === 'italic');
      toggleBtn($('pUnderline'), !!o.underline);
      document.querySelectorAll('[data-align]').forEach((b) =>
        toggleBtn(b, b.dataset.align === (o.textAlign || 'left'))
      );
      $('pLineHeight').value = o.lineHeight != null ? o.lineHeight : 1.16;
      $('pCharSpacing').value = o.charSpacing || 0;
      $('pCurve').value = o.curveAmount || 0;
      $('pCurveOut').value = o.curveAmount || 0;
      // text effects
      $('fxShadow').checked = !!o.shadow;
      if (o.shadow) {
        $('fxShadowColor').value = hex(o.shadow.color || '#000000');
        $('fxShadowBlur').value = o.shadow.blur || 6;
        $('fxShadowBlurOut').value = o.shadow.blur || 6;
      }
      $('fxOutline').checked = !!(o.stroke && o.strokeWidth);
      if (o.stroke) { $('fxOutlineColor').value = hex(o.stroke); }
      $('fxOutlineW').value = o.strokeWidth || 2;
      $('fxOutlineWOut').value = o.strokeWidth || 2;
      $('fxHighlight').checked = !!o.textBackgroundColor;
      if (o.textBackgroundColor) $('fxHighlightColor').value = hex(o.textBackgroundColor);
    }

    if (isImage(o)) {
      const f = filterMap(o);
      $('imgBright').value = f.brightness || 0;
      $('imgContrast').value = f.contrast || 0;
      $('imgSat').value = f.saturation || 0;
      $('imgBlur').value = f.blur || 0;
      $('imgGray').checked = !!f.grayscale;
      markPreset(null);
    }

    if (!grpFill.hidden) {
      const grad = isGradientFill(o);
      setFillTypeUI(grad);
      if (grad) {
        $('pGradStart').value = hex(o.fill.colorStops[0].color);
        $('pGradEnd').value = hex(o.fill.colorStops[1].color);
        $('pGradAngle').value = o.gradientAngle || 90;
        $('pGradAngleOut').value = o.gradientAngle || 90;
      } else {
        $('pFill').value = hex(o.fill);
      }
      $('pStroke').value = hex(o.stroke || '#000000');
      $('pStrokeW').value = o.strokeWidth || 0;
      $('pStrokeWOut').value = o.strokeWidth || 0;
    }
    if (!grpRadius.hidden) {
      $('pRadius').value = o.rx || 0;
      $('pRadiusOut').value = o.rx || 0;
    }

    $('pOpacity').value = o.opacity != null ? o.opacity : 1;
    $('pOpacityOut').value = (o.opacity != null ? o.opacity : 1).toFixed(2);
    $('pX').value = Math.round(o.left);
    $('pY').value = Math.round(o.top);
    $('pW').value = Math.round(o.getScaledWidth());
    $('pH').value = Math.round(o.getScaledHeight());
    $('pH').disabled = isText(o); // textbox height is automatic
    $('pAngle').value = Math.round(o.angle || 0);
    $('pLock').textContent = o.lockMovementX ? '🔒' : '🔓';
    toggleBtn($('pFlipH'), !!o.flipX);
    toggleBtn($('pFlipV'), !!o.flipY);

    syncing = false;
  }
  window.ED_syncProps = sync;

  function toggleBtn(btn, on) { if (btn) btn.classList.toggle('on', !!on); }

  /* bake a corner-resize of a text box into fontSize/width so glyphs stay crisp */
  canvas.on('object:modified', (opt) => {
    const o = opt && opt.target;
    if (!o || !isText(o)) return;
    if (Math.abs(o.scaleX - 1) < 0.001 && Math.abs(o.scaleY - 1) < 0.001) return;
    const s = o.scaleY || 1;
    o.set({
      fontSize: Math.max(2, Math.round((o.fontSize || 20) * s)),
      width: Math.max(20, o.width * (o.scaleX || 1)),
      scaleX: 1,
      scaleY: 1,
    });
    if (o.curveAmount) ED.applyTextCurve(o, o.curveAmount);
    o.setCoords();
    canvas.requestRenderAll();
  });

  /* ---- generic setter wiring ----------------------------------------------- */
  function onInput(el, fn) {
    el.addEventListener('input', () => {
      if (syncing) return;
      const o = canvas.getActiveObject();
      if (!o) return;
      fn(o, el.value);
      o.setCoords();
      commit();
    });
  }

  onInput($('pFontSize'), (o, v) => o.set('fontSize', Math.max(1, +v)));
  onInput($('pTextColor'), (o, v) => o.set('fill', v));
  // tracked on 'change' (fires once, on commit) rather than piggybacking the
  // 'input' above (fires continuously while dragging inside the native
  // color picker — would spam near-duplicate localStorage writes)
  $('pTextColor').addEventListener('change', () => { ED.trackRecentColor($('pTextColor').value); renderRecentColors(); });
  $('pFill').addEventListener('change', () => { ED.trackRecentColor($('pFill').value); renderRecentColors(); });
  onInput($('pLineHeight'), (o, v) => o.set('lineHeight', +v));
  onInput($('pCharSpacing'), (o, v) => o.set('charSpacing', +v));
  onInput($('pCurve'), (o, v) => { $('pCurveOut').value = v; if (isText(o)) ED.applyTextCurve(o, +v); });
  onInput($('pFill'), (o, v) => o.set('fill', v));
  onInput($('pStroke'), (o, v) => o.set('stroke', v));
  onInput($('pStrokeW'), (o, v) => { o.set('strokeWidth', +v); $('pStrokeWOut').value = v; });
  onInput($('pRadius'), (o, v) => { o.set({ rx: +v, ry: +v }); $('pRadiusOut').value = v; });
  onInput($('pOpacity'), (o, v) => { o.set('opacity', +v); $('pOpacityOut').value = (+v).toFixed(2); });
  onInput($('pX'), (o, v) => o.set('left', +v));
  onInput($('pY'), (o, v) => o.set('top', +v));
  onInput($('pAngle'), (o, v) => o.rotate(+v));
  onInput($('pW'), (o, v) => {
    v = Math.max(1, +v);
    if (isText(o)) {
      o.set('width', v);
      if (o.curveAmount) ED.applyTextCurve(o, o.curveAmount);
    } else {
      o.set('scaleX', v / o.width);
    }
  });
  onInput($('pH'), (o, v) => {
    v = Math.max(1, +v);
    if (isText(o)) return; // textbox height is auto
    o.set('scaleY', v / o.height);
  });

  pFont.addEventListener('change', () => {
    if (syncing) return;
    const o = canvas.getActiveObject();
    if (!o) return;
    const fam = pFont.value;
    (ED.ensureFont ? ED.ensureFont(fam) : Promise.resolve()).then(() => {
      o.set('fontFamily', fam);
      commit();
      ED.trackRecentFont(fam);
      renderRecentFonts();
    });
  });

  /* ---- text effects ------------------------------------------------------- */
  function applyTextFx() {
    if (syncing) return;
    const o = canvas.getActiveObject();
    if (!o || !isText(o)) return;
    if ($('fxShadow').checked) {
      o.set('shadow', new fabric.Shadow({
        color: $('fxShadowColor').value,
        blur: +$('fxShadowBlur').value,
        offsetX: Math.round(+$('fxShadowBlur').value / 2),
        offsetY: Math.round(+$('fxShadowBlur').value / 2),
      }));
    } else {
      o.set('shadow', null);
    }
    if ($('fxOutline').checked) {
      o.set({ stroke: $('fxOutlineColor').value, strokeWidth: +$('fxOutlineW').value, paintFirst: 'stroke', strokeLineJoin: 'round' });
    } else {
      o.set({ stroke: null, strokeWidth: 0 });
    }
    o.set('textBackgroundColor', $('fxHighlight').checked ? $('fxHighlightColor').value : '');
    $('fxShadowBlurOut').value = $('fxShadowBlur').value;
    $('fxOutlineWOut').value = $('fxOutlineW').value;
    commit();
  }
  ['fxShadow', 'fxShadowColor', 'fxShadowBlur', 'fxOutline', 'fxOutlineColor', 'fxOutlineW', 'fxHighlight', 'fxHighlightColor']
    .forEach((id) => { $(id).addEventListener('input', applyTextFx); $(id).addEventListener('change', applyTextFx); });

  /* ---- image filters ---------------------------------------------------------- */
  function filterMap(o) {
    const m = {};
    (o.filters || []).forEach((fl) => {
      if (!fl) return;
      if ('brightness' in fl) m.brightness = fl.brightness;
      else if ('contrast' in fl) m.contrast = fl.contrast;
      else if ('saturation' in fl) m.saturation = fl.saturation;
      else if ('blur' in fl) m.blur = fl.blur;
      else if (fl.type === 'Grayscale' || fl.mode === 'average') m.grayscale = true;
    });
    return m;
  }
  let filterRAF = null;
  function applyImageFilters() {
    if (syncing) return;
    const o = canvas.getActiveObject();
    if (!o || !isImage(o) || !fabric.Image.filters) return;
    const F = fabric.Image.filters;
    const list = [];
    const b = +$('imgBright').value; if (b) list.push(new F.Brightness({ brightness: b }));
    const c = +$('imgContrast').value; if (c) list.push(new F.Contrast({ contrast: c }));
    const s = +$('imgSat').value; if (s) list.push(new F.Saturation({ saturation: s }));
    const bl = +$('imgBlur').value; if (bl) list.push(new F.Blur({ blur: bl }));
    if ($('imgGray').checked) list.push(new F.Grayscale());
    o.filters = list;
    if (filterRAF) cancelAnimationFrame(filterRAF);
    filterRAF = requestAnimationFrame(() => {
      filterRAF = null;
      o.applyFilters();
      canvas.requestRenderAll();
    });
    ED.record();
  }
  ['imgBright', 'imgContrast', 'imgSat', 'imgBlur', 'imgGray'].forEach((id) => {
    $(id).addEventListener('input', applyImageFilters);
    $(id).addEventListener('change', applyImageFilters);
  });
  $('imgReset').addEventListener('click', () => {
    const o = canvas.getActiveObject();
    if (!o || !isImage(o)) return;
    o.filters = [];
    o.applyFilters();
    if (o._element && o._element.naturalWidth) {
      o.set({ cropX: 0, cropY: 0, width: o._element.naturalWidth, height: o._element.naturalHeight });
    }
    canvas.requestRenderAll();
    markPreset(null);
    commit();
    sync();
  });

  /* ---- one-click filter presets -------------------------------------------
     Built from the same fabric.Image.filters the manual sliders use, plus
     BlendColor (tint) and Vibrance for the warm/cool/vintage looks a plain
     brightness/contrast/saturation mix can't reach. Picking a preset replaces
     the filter stack outright; touching a slider afterwards rebuilds it from
     the sliders alone (see applyImageFilters), which drops the tint/vibrance
     component — an accepted trade-off so the two controls don't need shared
     state. */
  const FILTER_PRESETS = {
    none: [],
    bw: [{ grayscale: true }],
    vivid: [{ saturation: 0.4 }, { contrast: 0.15 }, { vibrance: 0.25 }],
    warm: [{ tint: { color: '#ff9d42', alpha: 0.14 } }, { saturation: 0.05 }],
    cool: [{ tint: { color: '#3d7bff', alpha: 0.12 } }],
    fade: [{ contrast: -0.2 }, { brightness: 0.08 }, { saturation: -0.2 }],
    vintage: [{ tint: { color: '#8a5a2b', alpha: 0.18 } }, { saturation: -0.3 }, { contrast: -0.05 }],
    dramatic: [{ contrast: 0.35 }, { brightness: -0.05 }, { saturation: 0.1 }],
  };
  function buildPresetFilters(recipe) {
    const F = fabric.Image.filters;
    return recipe.map((r) => {
      if ('grayscale' in r) return new F.Grayscale();
      if ('tint' in r) return new F.BlendColor({ color: r.tint.color, mode: 'tint', alpha: r.tint.alpha });
      if ('brightness' in r) return new F.Brightness({ brightness: r.brightness });
      if ('contrast' in r) return new F.Contrast({ contrast: r.contrast });
      if ('saturation' in r) return new F.Saturation({ saturation: r.saturation });
      if ('vibrance' in r) return new F.Vibrance({ vibrance: r.vibrance });
      return null;
    }).filter(Boolean);
  }
  const presetRow = $('imgFilterPresets');
  function markPreset(name) {
    [...presetRow.querySelectorAll('button')].forEach((b) => b.classList.toggle('on', b.dataset.preset === name));
  }
  presetRow.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-preset]');
    if (!btn) return;
    const o = canvas.getActiveObject();
    if (!o || !isImage(o) || !fabric.Image.filters) return;
    const recipe = FILTER_PRESETS[btn.dataset.preset] || [];
    o.filters = buildPresetFilters(recipe);
    o.applyFilters();
    canvas.requestRenderAll();
    markPreset(btn.dataset.preset);
    // reflect whatever of the preset the plain sliders can represent, so a
    // later slider tweak starts from a sensible baseline
    const m = {};
    recipe.forEach((r) => Object.assign(m, r));
    $('imgBright').value = m.brightness || 0;
    $('imgContrast').value = m.contrast || 0;
    $('imgSat').value = m.saturation || 0;
    $('imgBlur').value = 0;
    $('imgGray').checked = !!m.grayscale;
    commit();
  });
  $('imgCrop').addEventListener('click', () => {
    const o = canvas.getActiveObject();
    if (o && isImage(o) && ED.startCrop) ED.startCrop(o);
  });

  $('pBold').addEventListener('click', () => tglText('fontWeight', 'bold', 'normal', (o) => o.fontWeight === 'bold' || Number(o.fontWeight) >= 600));
  $('pItalic').addEventListener('click', () => tglText('fontStyle', 'italic', 'normal', (o) => o.fontStyle === 'italic'));
  $('pUnderline').addEventListener('click', () => tglText('underline', true, false, (o) => !!o.underline));

  function tglText(prop, on, off, isOn) {
    const o = canvas.getActiveObject();
    if (!o || !isText(o)) return;
    o.set(prop, isOn(o) ? off : on);
    commit();
    sync();
  }

  document.querySelectorAll('[data-align]').forEach((b) =>
    b.addEventListener('click', () => {
      const o = canvas.getActiveObject();
      if (!o || !isText(o)) return;
      o.set('textAlign', b.dataset.align);
      commit();
      sync();
    })
  );

  $('pDir').addEventListener('click', () => {
    const o = canvas.getActiveObject();
    if (!o || !isText(o)) return;
    const next = o.direction === 'rtl' ? 'ltr' : 'rtl';
    o.set('direction', next);
    if (o.textAlign === 'left' || o.textAlign === 'right') {
      o.set('textAlign', next === 'rtl' ? 'right' : 'left');
    }
    commit();
    sync();
  });

  $('pFlipH').addEventListener('click', () => { const o = canvas.getActiveObject(); if (!o) return; o.set('flipX', !o.flipX); commit(); sync(); });
  $('pFlipV').addEventListener('click', () => { const o = canvas.getActiveObject(); if (!o) return; o.set('flipY', !o.flipY); commit(); sync(); });

  $('pLock').addEventListener('click', () => {
    const o = canvas.getActiveObject();
    if (!o) return;
    const lock = !o.lockMovementX;
    o.set({
      lockMovementX: lock, lockMovementY: lock,
      lockScalingX: lock, lockScalingY: lock,
      lockRotation: lock, hasControls: !lock,
    });
    commit();
    sync();
  });

  /* ---- layers ---------------------------------------------------------------- */
  document.querySelectorAll('[data-layer]').forEach((b) =>
    b.addEventListener('click', () => {
      const o = canvas.getActiveObject();
      if (!o) return;
      const a = b.dataset.layer;
      if (a === 'front') canvas.bringToFront(o);
      else if (a === 'forward') canvas.bringForward(o);
      else if (a === 'backward') canvas.sendBackwards(o);
      else if (a === 'back') canvas.sendToBack(o);
      ED.restoreArtboardFlags();
      commit();
    })
  );

  /* ---- align: to the artboard normally, to each other for a multi-selection -
     A fabric.ActiveSelection (2+ objects picked together) positions its
     children in the SELECTION's own local coordinate system, centred on the
     selection's own middle — not the canvas. For a left/top-origin child (the
     only origin this app's shape/text/image creation code ever uses), that
     child's own .left/.top value directly IS the offset of its own
     left/top edge from the selection's centre, which makes "line every
     child's left edge up with the selection's own left edge" as simple as
     setting every child's .left to -selection.width/2 — no per-child origin
     math needed. Verified against real fabric.js (not just assumed) via a
     smoke-test.js check that builds a real ActiveSelection and asserts the
     resulting absolute positions. */
  function alignToCanvas(o, mode) {
    const w = o.getScaledWidth(), h = o.getScaledHeight();
    switch (mode) {
      case 'left': o.set('left', 0); break;
      case 'centerH': o.set('left', (ED.W - w) / 2); break;
      case 'right': o.set('left', ED.W - w); break;
      case 'top': o.set('top', 0); break;
      case 'middle': o.set('top', (ED.H - h) / 2); break;
      case 'bottom': o.set('top', ED.H - h); break;
    }
    o.setCoords();
  }
  function alignWithinSelection(sel, mode) {
    const w = sel.width, h = sel.height; // unscaled bounding size of the selection itself
    sel._objects.forEach((o) => {
      const ow = o.getScaledWidth(), oh = o.getScaledHeight();
      switch (mode) {
        case 'left': o.set('left', -w / 2); break;
        case 'centerH': o.set('left', -ow / 2); break;
        case 'right': o.set('left', w / 2 - ow); break;
        case 'top': o.set('top', -h / 2); break;
        case 'middle': o.set('top', -oh / 2); break;
        case 'bottom': o.set('top', h / 2 - oh); break;
      }
      o.setCoords();
    });
    sel.setCoords();
  }
  document.querySelectorAll('[data-canvasalign]').forEach((b) =>
    b.addEventListener('click', () => {
      const o = canvas.getActiveObject();
      if (!o) return;
      if (o.type === 'activeSelection' && o._objects && o._objects.length > 1) alignWithinSelection(o, b.dataset.canvasalign);
      else alignToCanvas(o, b.dataset.canvasalign);
      commit();
      sync();
    })
  );

  /* ---- distribute (equal spacing) — keeps the two extreme objects put and
     spaces everything between them evenly, same convention as Figma/Canva */
  function distribute(sel, axis) {
    const prop = axis === 'h' ? 'left' : 'top';
    const size = axis === 'h' ? 'getScaledWidth' : 'getScaledHeight';
    const sorted = [...sel._objects].sort((a, b) => a[prop] - b[prop]);
    const first = sorted[0], last = sorted[sorted.length - 1];
    const span = (last[prop] + last[size]()) - first[prop];
    const totalSize = sorted.reduce((s, o) => s + o[size](), 0);
    const gap = (span - totalSize) / (sorted.length - 1);
    let cursor = first[prop];
    sorted.forEach((o) => {
      o.set(prop, cursor);
      o.setCoords();
      cursor += o[size]() + gap;
    });
    sel.setCoords();
  }
  document.getElementById('pDistH')?.addEventListener('click', () => {
    const o = canvas.getActiveObject();
    if (o && o.type === 'activeSelection' && o._objects.length >= 3) { distribute(o, 'h'); commit(); sync(); }
  });
  document.getElementById('pDistV')?.addEventListener('click', () => {
    const o = canvas.getActiveObject();
    if (o && o.type === 'activeSelection' && o._objects.length >= 3) { distribute(o, 'v'); commit(); sync(); }
  });

  /* ---- duplicate / delete --------------------------------------------------- */
  ED.duplicateActive = function () {
    const o = canvas.getActiveObject();
    if (!o) return;
    o.clone((c) => {
      c.set({ left: o.left + 24, top: o.top + 24 });
      c.setCoords();
      canvas.add(c);
      canvas.setActiveObject(c);
      commit();
    }, ['name', 'direction', 'id', 'selectable', 'evented']);
  };
  ED.deleteActive = function () {
    const objs = canvas.getActiveObjects();
    if (!objs.length) return;
    objs.forEach((o) => { if (o.name !== ED.ARTBOARD && o.name !== ED.BGIMAGE) canvas.remove(o); });
    canvas.discardActiveObject();
    commit();
  };
  $('pDuplicate').addEventListener('click', ED.duplicateActive);
  $('pDelete').addEventListener('click', ED.deleteActive);

  /* ---- save selection as a reusable "sticker" -------------------------------
     Flattens whatever's selected (one object, or several via an
     ActiveSelection — object.toDataURL()/ActiveSelection.toDataURL() both
     render just that object's own bounding box with a transparent backdrop,
     the same per-object export ED.canvasImages() in objects.js already
     relies on) to a transparent PNG and uploads it through the EXISTING
     /api/uploads endpoint — deliberately not a new "stickers" table/route:
     a saved sticker is just an image, so it shows up in the normal Uploads
     grid (searchable via ed_upload_search) and is reused the exact same way
     any other upload already is. */
  const saveStickerBtn = $('pSaveSticker');
  const saveStickerHint = $('saveStickerHint');
  saveStickerBtn.addEventListener('click', async () => {
    const o = canvas.getActiveObject();
    if (!o) return;
    saveStickerBtn.disabled = true;
    saveStickerHint.textContent = ED.i18n.saveStickerWorking || '';
    try {
      const dataUrl = o.toDataURL({ format: 'png' });
      const blob = await (await fetch(dataUrl)).blob();
      const fd = new FormData();
      fd.append('image', blob, 'sticker.png');
      const res = await fetch('/api/uploads', { method: 'POST', headers: { 'x-csrf-token': CSRF }, body: fd });
      if (!res.ok) throw new Error('upload failed');
      if (ED.loadUploads) ED.loadUploads(true);
      saveStickerHint.textContent = ED.i18n.saveStickerDone || '';
    } catch (e) {
      saveStickerHint.textContent = ED.i18n.saveStickerError || '';
    } finally {
      saveStickerBtn.disabled = false;
    }
  });

  /* ---- selection + live updates ------------------------------------------- */
  canvas.on('selection:created', sync);
  canvas.on('selection:updated', sync);
  canvas.on('selection:cleared', sync);
  let liveT = null;
  ['object:moving', 'object:scaling', 'object:rotating', 'object:modified'].forEach((ev) =>
    canvas.on(ev, () => {
      if (liveT) return;
      liveT = requestAnimationFrame(() => { liveT = null; if (!syncing) sync(); });
    })
  );
})();
