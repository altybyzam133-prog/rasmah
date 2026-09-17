'use strict';

/* Community gallery page — the only interactive bit here: a user's own
   published designs show a "remove from community" button instead of "use"
   (see views/community.ejs). "Use" itself is a plain link, no JS needed. */
(function () {
  const CSRF = document.querySelector('meta[name="csrf-token"]').content;
  const ar = document.documentElement.lang === 'ar';

  document.querySelectorAll('[data-act="remove-publish"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const confirmMsg = ar
        ? 'حذف هذا التصميم من المجتمع؟ يرجع خاصًا بك فقط، ولا يتأثر أي شخص استخدمه قبل كذا.'
        : "Remove this design from the community? It goes back to private — anyone who already used it keeps their own copy.";
      if (!confirm(confirmMsg)) return;
      btn.disabled = true;
      try {
        const res = await fetch('/api/designs/' + btn.dataset.id + '/publish', {
          method: 'DELETE',
          headers: { 'x-csrf-token': CSRF },
        });
        if (!res.ok) throw new Error('request_failed');
        btn.closest('.tpl-card').remove();
        if (!document.querySelector('.tpl-card')) window.location.reload();
      } catch (e) {
        btn.disabled = false;
        alert(ar ? 'تعذّر الحذف، حاول مرة ثانية' : 'Could not remove it, try again');
      }
    });
  });
})();
