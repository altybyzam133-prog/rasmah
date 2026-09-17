'use strict';

/* ============================================================================
   First-visit welcome modal — a quick, layout-agnostic overview of the
   editor's main tools (a centered modal rather than a coordinate-anchored
   spotlight tour, deliberately: this app has genuinely different layouts on
   desktop vs. the mobile bottom-tab-bar tier, and anchoring tooltips to
   specific elements would mean maintaining two separate positioning schemes).
   Shown once per browser (localStorage), replayable later from the "?"
   shortcuts dropdown.
   ========================================================================== */

(function () {
  const backdrop = document.getElementById('onboardBackdrop');
  const startBtn = document.getElementById('onboardStart');
  const replayBtn = document.getElementById('onboardReplay');
  if (!backdrop || !startBtn) return;

  const KEY = 'rasmah_onboarded';

  function show() { backdrop.hidden = false; }
  function hide() {
    backdrop.hidden = true;
    try { localStorage.setItem(KEY, '1'); } catch (e) { /* ignore */ }
  }

  // if storage is blocked (private-mode edge cases), default to NOT showing —
  // nagging on every single reload is worse than a new user missing the tour once
  let seen = true;
  try { seen = localStorage.getItem(KEY) === '1'; } catch (e) { /* keep default */ }
  if (!seen) show();

  startBtn.addEventListener('click', hide);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) hide(); });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !backdrop.hidden) hide(); });

  replayBtn?.addEventListener('click', () => {
    replayBtn.closest('.ed-dropdown-menu')?.setAttribute('hidden', '');
    show();
  });
})();
