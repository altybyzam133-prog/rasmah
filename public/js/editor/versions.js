'use strict';

/* ============================================================================
   Version history — "History" topbar dropdown. Lists auto-checkpoints the
   server already took (see lib/db.js snapshotDesignVersion, throttled server-
   side) and restores one on request. A restore is applied entirely server-
   side then the page reloads, rather than trying to splice restored pages/
   undo-state into the live editor in place — simpler and guaranteed
   consistent with what actually got saved.
   ========================================================================== */

(function () {
  const ED = window.ED;
  const dd = document.getElementById('historyDropdown');
  if (!dd) return;
  const CSRF = document.querySelector('meta[name="csrf-token"]').content;
  const menu = dd.querySelector('.ed-dropdown-menu');
  const list = document.getElementById('historyList');
  const I = ED.i18n || {};

  function fmtTime(sqliteUtc) {
    // sqlite's datetime('now') has no timezone marker but is UTC — append one
    // so this parses as UTC instead of (incorrectly) local time.
    const d = new Date(sqliteUtc.replace(' ', 'T') + 'Z');
    return d.toLocaleString(ED.data.lang === 'ar' ? 'ar' : 'en', { dateStyle: 'medium', timeStyle: 'short' });
  }

  function render(versions) {
    if (!versions.length) {
      list.innerHTML = '<p class="ed-hint">' + (I.historyEmpty || '') + '</p>';
      return;
    }
    list.innerHTML = versions.map((v) => `
      <div class="ed-history-row">
        <div class="ed-history-thumb">${v.thumbnail ? `<img src="${v.thumbnail}" alt="">` : ''}</div>
        <span class="ed-history-time">${fmtTime(v.created_at)}</span>
        <button class="btn btn-ghost btn-sm" data-restore="${v.id}">${I.historyRestore || ''}</button>
      </div>
    `).join('');
  }

  async function loadList() {
    list.innerHTML = '<p class="ed-hint">' + (I.historyLoading || '') + '</p>';
    try {
      const r = await fetch('/api/designs/' + ED.data.id + '/versions');
      const j = await r.json();
      render(j.versions || []);
    } catch (err) {
      list.innerHTML = '<p class="ed-hint">' + (I.historyError || '') + '</p>';
    }
  }

  document.getElementById('btnHistory').addEventListener('click', (e) => {
    e.stopPropagation();
    const opening = menu.hidden;
    menu.hidden = !menu.hidden;
    if (opening) loadList();
  });
  document.addEventListener('click', (e) => { if (!dd.contains(e.target)) menu.hidden = true; });

  list.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-restore]');
    if (!btn) return;
    if (!confirm(I.historyRestoreConfirm || '')) return;
    btn.disabled = true;
    try {
      const r = await fetch('/api/designs/' + ED.data.id + '/versions/' + btn.dataset.restore + '/restore', {
        method: 'POST',
        headers: { 'x-csrf-token': CSRF },
      });
      const j = await r.json();
      if (!j.ok) throw new Error('restore failed');
      location.reload();
    } catch (err) {
      alert(I.historyError || '');
      btn.disabled = false;
    }
  });
})();
