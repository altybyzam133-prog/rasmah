'use strict';

/* Read-only public viewer for a shared design (supports multi-page designs). */
(function () {
  const d = JSON.parse(document.getElementById('vData').textContent);
  const W = d.w, H = d.h;

  const canvas = new fabric.StaticCanvas('vc', { width: W, height: H, backgroundColor: '#fff' });

  let pages = [{ width: W, height: H, json: null }];
  let cur = 0;

  const start = (d.data || '').trim();
  if (start) {
    let parsed = null;
    try { parsed = JSON.parse(start); } catch (e) {}
    if (parsed && parsed.version === 2 && Array.isArray(parsed.pages) && parsed.pages.length) {
      pages = parsed.pages;
    } else {
      pages = [{ width: W, height: H, json: start }];
    }
  }

  function fit(w, h) {
    const stage = document.querySelector('.viewer-stage');
    const maxW = stage.clientWidth - 40;
    const maxH = window.innerHeight - 58 - 60 - 80;
    const scale = Math.min(1, maxW / w, maxH / h);
    const el = canvas.lowerCanvasEl;
    el.style.width = Math.round(w * scale) + 'px';
    el.style.height = Math.round(h * scale) + 'px';
  }

  function updatePager() {
    const pager = document.getElementById('viewerPager');
    if (!pager) return;
    pager.hidden = pages.length <= 1;
    const info = document.getElementById('vPageInfo');
    if (info) {
      const tmpl = (d.i18n && d.i18n.pageOf) || 'Page {n} of {total}';
      info.textContent = tmpl.replace('{n}', cur + 1).replace('{total}', pages.length);
    }
    const prev = document.getElementById('vPrev');
    const next = document.getElementById('vNext');
    if (prev) prev.disabled = cur === 0;
    if (next) next.disabled = cur === pages.length - 1;
  }

  function renderPage(i) {
    cur = Math.max(0, Math.min(i, pages.length - 1));
    const p = pages[cur];
    const w = p.width || W, h = p.height || H;
    canvas.setDimensions({ width: w, height: h });
    const json = p.json || null;
    if (json) {
      canvas.loadFromJSON(json, () => {
        canvas.renderAll();
        fit(w, h);
        updatePager();
      });
    } else {
      canvas.clear();
      fit(w, h);
      updatePager();
    }
  }

  renderPage(0);
  window.addEventListener('resize', () => fit(pages[cur].width || W, pages[cur].height || H));

  const vPrev = document.getElementById('vPrev');
  const vNext = document.getElementById('vNext');
  if (vPrev) vPrev.addEventListener('click', () => renderPage(cur - 1));
  if (vNext) vNext.addEventListener('click', () => renderPage(cur + 1));

  function fname(ext) {
    return (String(d.title || 'design').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60) || 'design') + '.' + ext;
  }
  function toURL(mult) {
    const w = pages[cur].width || W, h = pages[cur].height || H;
    return canvas.toDataURL({ format: 'png', multiplier: mult, left: 0, top: 0, width: w, height: h });
  }

  document.getElementById('vPng').addEventListener('click', () => {
    const a = document.createElement('a');
    a.href = toURL(2); a.download = fname('png');
    document.body.appendChild(a); a.click(); a.remove();
  });
  document.getElementById('vPdf').addEventListener('click', () => {
    const JsPDF = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF;
    if (!JsPDF) return;
    const w = pages[cur].width || W, h = pages[cur].height || H;
    const doc = new JsPDF({ orientation: w >= h ? 'landscape' : 'portrait', unit: 'px', format: [w, h], hotfixes: ['px_scaling'] });
    doc.addImage(toURL(2), 'PNG', 0, 0, w, h);
    doc.save(fname('pdf'));
  });
})();
