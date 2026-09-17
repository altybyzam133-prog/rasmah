'use strict';

/* ============================================================================
   Stock photos (Pexels search) — editor "Photos" panel
   ========================================================================== */

(function () {
  const ED = window.ED;
  const canvas = ED.canvas;
  const CSRF = document.querySelector('meta[name="csrf-token"]').content;

  const search = document.getElementById('stockSearch');
  const grid = document.getElementById('stockGrid');
  const moreBtn = document.getElementById('stockMoreBtn');
  if (!search || !grid) return; // panel shows only the "not set up" hint (no PEXELS_API_KEY)

  const I = ED.i18n || {};
  let query = '';
  let page = 1;
  let hasMore = false;
  let items = [];
  let loading = false;
  let searchT = null;

  function esc(s) {
    return String(s || '').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  function renderGrid() {
    grid.innerHTML = items.length
      ? items.map((p) =>
          `<div class="ed-upload-thumb" data-id="${p.id}">
            <img src="${p.thumb}" alt="${esc(p.alt)}" loading="lazy">
          </div>`
        ).join('')
      : `<p class="ed-hint">${I.stockNoResults || '—'}</p>`;
    moreBtn.hidden = !hasMore;
  }

  async function runSearch(reset) {
    if (loading) return;
    if (reset) { page = 1; items = []; }
    if (!query) {
      items = []; hasMore = false;
      grid.innerHTML = `<p class="ed-hint">${I.stockHint || '—'}</p>`;
      moreBtn.hidden = true;
      return;
    }
    loading = true;
    if (reset) grid.innerHTML = `<p class="ed-hint">${I.stockLoading || '…'}</p>`;
    moreBtn.disabled = true;
    try {
      const res = await fetch(`/api/stock/search?q=${encodeURIComponent(query)}&page=${page}`, {
        headers: { 'x-csrf-token': CSRF },
      });
      const j = await res.json();
      if (!j.available) {
        grid.innerHTML = `<p class="ed-hint">${I.stockError || '—'}</p>`;
        moreBtn.hidden = true;
        return;
      }
      items = reset ? (j.results || []) : items.concat(j.results || []);
      hasMore = !!j.hasMore;
      renderGrid();
    } catch (e) {
      grid.innerHTML = `<p class="ed-hint">${I.stockError || '—'}</p>`;
      moreBtn.hidden = true;
    } finally {
      loading = false;
      moreBtn.disabled = false;
    }
  }

  search.addEventListener('input', () => {
    clearTimeout(searchT);
    query = search.value.trim();
    searchT = setTimeout(() => runSearch(true), 400);
  });

  moreBtn.addEventListener('click', () => { page += 1; runSearch(false); });

  grid.addEventListener('click', async (e) => {
    const thumb = e.target.closest('.ed-upload-thumb');
    if (!thumb || thumb.classList.contains('ed-loading')) return;
    const item = items.find((p) => String(p.id) === thumb.dataset.id);
    if (!item) return;
    thumb.classList.add('ed-loading');
    const prevTitle = thumb.title;
    thumb.title = I.stockImporting || '';
    try {
      const res = await fetch('/api/stock/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': CSRF },
        body: JSON.stringify({ url: item.full, label: item.alt || 'stock photo' }),
      });
      const j = await res.json();
      if (!j.url) throw new Error('import failed');
      fabric.Image.fromURL(j.url, (img) => {
        if (!img || !img.width) return;
        const target = ED.W * 0.6;
        const scale = Math.min(1, target / img.width);
        img.set({ scaleX: scale, scaleY: scale });
        ED.addObject(img);
      });
    } catch (err) {
      alert(I.stockError || 'Error');
    } finally {
      thumb.classList.remove('ed-loading');
      thumb.title = prevTitle;
    }
  });
})();
