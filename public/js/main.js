'use strict';

// auto-dismiss the flash toast
document.querySelectorAll('.toast').forEach((el) => {
  setTimeout(() => el.remove(), 4200);
});

// PWA install + offline shell
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
  });
}
