'use strict';

/* ============================================================================
   Present mode — fullscreen, page-by-page slideshow of the current design.
   Renders on a dedicated fabric.StaticCanvas built once and reused, entirely
   separate from the live editing canvas — presenting never touches ED.pages,
   the undo stack, or the active page, so it can't corrupt an in-progress edit.
   ========================================================================== */

(function () {
  const ED = window.ED;
  const btn = document.getElementById('btnPresent');
  if (!btn) return;
  const I = ED.i18n || {};

  let overlay = null;
  let presentCanvas = null;
  let pageIndex = 0;

  function buildOverlay() {
    overlay = document.createElement('div');
    overlay.className = 'ed-present-overlay';
    overlay.hidden = true;
    overlay.innerHTML = `
      <canvas class="ed-present-canvas"></canvas>
      <button class="ed-present-close" title="${I.presentClose || ''}" aria-label="${I.presentClose || ''}">&times;</button>
      <button class="ed-present-nav ed-present-prev" title="${I.presentPrev || ''}" aria-label="${I.presentPrev || ''}">&#8249;</button>
      <button class="ed-present-nav ed-present-next" title="${I.presentNext || ''}" aria-label="${I.presentNext || ''}">&#8250;</button>
      <div class="ed-present-counter"></div>
    `;
    document.body.appendChild(overlay);
    presentCanvas = new fabric.StaticCanvas(overlay.querySelector('.ed-present-canvas'));

    overlay.querySelector('.ed-present-close').addEventListener('click', close);
    overlay.querySelector('.ed-present-prev').addEventListener('click', (e) => { e.stopPropagation(); go(-1); });
    overlay.querySelector('.ed-present-next').addEventListener('click', (e) => { e.stopPropagation(); go(1); });
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay || e.target.classList.contains('ed-present-canvas')) go(1);
    });
  }

  function renderPage(i) {
    pageIndex = Math.max(0, Math.min(ED.pages.length - 1, i));
    const p = ED.pages[pageIndex];
    const scale = Math.min(window.innerWidth / p.width, window.innerHeight / p.height);
    presentCanvas.setWidth(Math.round(p.width * scale));
    presentCanvas.setHeight(Math.round(p.height * scale));
    presentCanvas.setZoom(scale);
    presentCanvas.loadFromJSON(p.json, () => {
      presentCanvas.renderAll();
    });
    overlay.querySelector('.ed-present-counter').textContent = (pageIndex + 1) + ' / ' + ED.pages.length;
    overlay.querySelector('.ed-present-prev').hidden = ED.pages.length <= 1;
    overlay.querySelector('.ed-present-next').hidden = ED.pages.length <= 1;
  }

  function go(delta) { renderPage(pageIndex + delta); }

  function onKey(e) {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowRight' || e.key === ' ') go(1);
    else if (e.key === 'ArrowLeft') go(-1);
  }
  function onResize() { if (overlay && !overlay.hidden) renderPage(pageIndex); }
  function onFullscreenChange() {
    if (!document.fullscreenElement && overlay && !overlay.hidden) close();
  }

  function open() {
    if (ED.captureActivePage) ED.captureActivePage();
    if (!overlay) buildOverlay();
    overlay.hidden = false;
    if (overlay.requestFullscreen) overlay.requestFullscreen().catch(() => {});
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    renderPage(ED.activePage);
  }
  function close() {
    if (!overlay || overlay.hidden) return;
    overlay.hidden = true;
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', onResize);
    document.removeEventListener('fullscreenchange', onFullscreenChange);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }

  btn.addEventListener('click', open);

  // exposed for the smoke test — presenting has no server round-trip to
  // exercise, so the jsdom check drives it through this API directly
  ED.presentOpen = open;
  ED.presentGo = go;
  ED.presentClose = close;
})();
