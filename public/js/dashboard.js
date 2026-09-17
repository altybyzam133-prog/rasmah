'use strict';

(function () {
  const CSRF = document.querySelector('meta[name="csrf-token"]').content;

  async function api(url, opts = {}) {
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': CSRF },
      ...opts,
    });
    if (!res.ok) throw new Error('request_failed');
    return res.status === 204 ? null : res.json();
  }

  /* ---- new-design modal ------------------------------------------------- */
  const modal = document.getElementById('newDesignModal');
  const stepSize = document.getElementById('ndStepSize');
  const stepStart = document.getElementById('ndStepStart');
  const ndAr = document.documentElement.lang === 'ar';

  const open = () => {
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
    stepStart.hidden = true;
    stepSize.hidden = false;
  };
  const close = () => { modal.hidden = true; document.body.style.overflow = ''; };

  document.getElementById('newDesignBtn')?.addEventListener('click', open);
  document.getElementById('newDesignBtn2')?.addEventListener('click', open);
  modal.querySelectorAll('[data-close]').forEach((el) => el.addEventListener('click', close));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modal.hidden) close(); });

  async function createDesign(width, height, bgUrl) {
    modal.querySelectorAll('button').forEach((b) => (b.disabled = true));
    try {
      const { id } = await api('/api/designs', {
        method: 'POST',
        body: JSON.stringify({ width, height }),
      });
      window.location.href = '/editor/' + id + (bgUrl ? '?bgUrl=' + encodeURIComponent(bgUrl) : '');
    } catch {
      alert(ndAr ? 'تعذّر الإنشاء' : 'Could not create');
      modal.querySelectorAll('button').forEach((b) => (b.disabled = false));
    }
  }

  /* choosing a size doesn't create the design right away — it asks next
     whether to start blank or from the user's own photo, fit to that size */
  let pendingW = 0, pendingH = 0;
  function goToStartStep(w, h) {
    pendingW = w; pendingH = h;
    document.getElementById('ndStartSize').textContent = w + '×' + h;
    stepSize.hidden = true;
    stepStart.hidden = false;
  }

  modal.querySelectorAll('.size-tile').forEach((tile) => {
    tile.addEventListener('click', () =>
      goToStartStep(Number(tile.dataset.w), Number(tile.dataset.h))
    );
  });
  document.getElementById('customSizeForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const w = Number(document.getElementById('cw').value);
    const h = Number(document.getElementById('ch').value);
    if (w >= 16 && h >= 16) goToStartStep(w, h);
  });

  document.getElementById('ndBack').addEventListener('click', () => {
    stepStart.hidden = true;
    stepSize.hidden = false;
  });
  document.getElementById('ndStartBlank').addEventListener('click', () => createDesign(pendingW, pendingH));

  const ndStartPhotoInput = document.getElementById('ndStartPhotoInput');
  const ndStartHint = document.getElementById('ndStartHint');
  ndStartPhotoInput.addEventListener('change', async () => {
    const file = ndStartPhotoInput.files[0];
    ndStartPhotoInput.value = '';
    if (!file) return;
    ndStartHint.textContent = ndAr ? 'جارٍ الرفع…' : 'Uploading…';
    modal.querySelectorAll('button').forEach((b) => (b.disabled = true));
    try {
      const fd = new FormData();
      fd.append('image', file);
      const upRes = await fetch('/api/uploads', { method: 'POST', headers: { 'x-csrf-token': CSRF }, body: fd });
      const up = await upRes.json();
      if (!up.url) throw new Error('upload_failed');
      await createDesign(pendingW, pendingH, up.url);
    } catch {
      ndStartHint.textContent = ndAr ? 'تعذّر رفع الصورة' : 'Could not upload the photo';
      modal.querySelectorAll('button').forEach((b) => (b.disabled = false));
    }
  });

  /* ---- start from a photo: upload it, size the canvas to match, apply as bg - */
  const fromPhotoDrop = document.getElementById('fromPhotoDrop');
  const fromPhotoInput = document.getElementById('fromPhotoInput');
  const MAX_START_DIM = 2000;
  const ar = document.documentElement.lang === 'ar';
  const workingText = fromPhotoDrop?.dataset.working || (ar ? 'جارٍ التجهيز…' : 'Setting up…');

  fromPhotoInput?.addEventListener('change', async () => {
    const file = fromPhotoInput.files[0];
    fromPhotoInput.value = '';
    if (!file) return;
    const hint = fromPhotoDrop.querySelector('small');
    const hintOriginal = hint.textContent;
    fromPhotoDrop.classList.add('busy');
    hint.textContent = workingText;
    try {
      const dims = await new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => { resolve({ w: img.naturalWidth, h: img.naturalHeight }); URL.revokeObjectURL(url); };
        img.onerror = () => { reject(new Error('bad_image')); URL.revokeObjectURL(url); };
        img.src = url;
      });
      const scale = Math.min(1, MAX_START_DIM / Math.max(dims.w, dims.h));
      const width = Math.round(dims.w * scale);
      const height = Math.round(dims.h * scale);

      const fd = new FormData();
      fd.append('image', file);
      const upRes = await fetch('/api/uploads', { method: 'POST', headers: { 'x-csrf-token': CSRF }, body: fd });
      const up = await upRes.json();
      if (!up.url) throw new Error('upload_failed');

      const { id } = await api('/api/designs', { method: 'POST', body: JSON.stringify({ width, height }) });
      window.location.href = '/editor/' + id + '?bgUrl=' + encodeURIComponent(up.url);
    } catch (e) {
      alert(ar ? 'تعذّر رفع الصورة' : 'Could not upload the photo');
      fromPhotoDrop.classList.remove('busy');
      hint.textContent = hintOriginal;
    }
  });

  /* ---- search + sort + folder filter ------------------------------------ */
  const grid = document.querySelector('.design-grid');
  const search = document.getElementById('dashSearch');
  const sortSel = document.getElementById('dashSort');
  const noResults = document.getElementById('dashNoResults');
  const dashFolders = document.getElementById('dashFolders');
  let activeFolder = '';

  function applyFilter() {
    if (!grid) return;
    const q = (search.value || '').trim().toLowerCase();
    const cards = [...grid.querySelectorAll('.design-card')];
    let visible = 0;
    cards.forEach((c) => {
      const matchesQ = !q || (c.dataset.title || '').includes(q) || String(c.dataset.id) === q;
      const folder = c.dataset.folder || '';
      const matchesFolder =
        !activeFolder || (activeFolder === '__none__' ? !folder : folder === activeFolder);
      const hit = matchesQ && matchesFolder;
      c.hidden = !hit;
      if (hit) visible++;
    });
    const mode = sortSel.value;
    cards.sort((a, b) => {
      if (mode === 'name') return (a.dataset.title || '').localeCompare(b.dataset.title || '', undefined, { sensitivity: 'base' });
      const av = a.dataset.updated || a.dataset.created || '';
      const bv = b.dataset.updated || b.dataset.created || '';
      return mode === 'oldest' ? av.localeCompare(bv) : bv.localeCompare(av);
    });
    cards.forEach((c) => grid.appendChild(c));
    if (noResults) noResults.hidden = visible !== 0;
  }
  search?.addEventListener('input', applyFilter);
  sortSel?.addEventListener('change', applyFilter);
  dashFolders?.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-folder]');
    if (!chip) return;
    activeFolder = chip.dataset.folder;
    dashFolders.querySelectorAll('.dash-folder-chip').forEach((b) => b.classList.toggle('active', b === chip));
    applyFilter();
  });

  /* ---- card actions -------------------------------------------------------- */
  document.querySelector('.design-grid')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const card = btn.closest('.design-card');
    const id = card.dataset.id;
    const act = btn.dataset.act;
    const ar = document.documentElement.lang === 'ar';

    if (act === 'publish') {
      const nowPublic = card.dataset.public === '1';
      const confirmMsg = nowPublic
        ? (ar ? 'إلغاء نشر هذا التصميم من المجتمع؟' : 'Unpublish this design from the community?')
        : (ar ? 'نشر هذا التصميم بمعرض المجتمع؟ راح يقدر أي مستخدم مسجّل يشوفه ويستخدمه كنقطة بداية.'
               : 'Publish this design to the community gallery? Any logged-in user will be able to see and use it as a starting point.');
      if (!confirm(confirmMsg)) return;
      await api('/api/designs/' + id + '/publish', { method: nowPublic ? 'DELETE' : 'POST' });
      window.location.reload();
    } else if (act === 'folder') {
      const promptText = document.querySelector('.dash')?.dataset.folderPrompt
        || (ar ? 'اسم المجلد' : 'Folder name');
      const name = prompt(promptText, card.dataset.folder || '');
      if (name == null) return;
      const folder = name.trim();
      await api('/api/designs/' + id, { method: 'PUT', body: JSON.stringify({ folder }) });
      window.location.reload();
    } else if (act === 'rename') {
      const cur = card.querySelector('.design-title').textContent.trim();
      const name = prompt(ar ? 'اسم التصميم' : 'Design name', cur);
      if (name == null) return;
      await api('/api/designs/' + id, { method: 'PUT', body: JSON.stringify({ title: name }) });
      card.querySelector('.design-title').textContent = name || (ar ? 'تصميم بدون عنوان' : 'Untitled design');
    } else if (act === 'duplicate') {
      const { id: newId } = await api('/api/designs/' + id + '/duplicate', { method: 'POST' });
      if (newId) window.location.reload();
    } else if (act === 'delete') {
      if (!confirm(card.dataset.confirm || (ar ? 'حذف هذا التصميم نهائيًا؟' : 'Delete this design permanently?'))) return;
      await api('/api/designs/' + id, { method: 'DELETE' });
      card.remove();
      if (!document.querySelector('.design-card')) window.location.reload();
    }
  });
})();
