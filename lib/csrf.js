'use strict';

const crypto = require('crypto');

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

/* Synchronizer-token CSRF guard. Mount on routers that use the session.
   Exposes res.locals.csrfToken for form fields and <meta> tags.
   Accepts the token from a `_csrf` field/query or an `x-csrf-token` header. */
function csrf(req, res, next) {
  if (!req.session) return next();

  if (!req.session.csrf) {
    req.session.csrf = crypto.randomBytes(24).toString('hex');
  }
  res.locals.csrfToken = req.session.csrf;

  if (SAFE.has(req.method)) return next();

  const sent =
    (req.body && req.body._csrf) ||
    (req.query && req.query._csrf) ||
    req.get('x-csrf-token') ||
    req.get('x-xsrf-token') ||
    '';

  const a = Buffer.from(String(sent));
  const b = Buffer.from(String(req.session.csrf));
  if (a.length === b.length && crypto.timingSafeEqual(a, b)) return next();

  res.status(403);
  if (req.path.startsWith('/api') || req.get('accept') === 'application/json') {
    return res.json({ error: 'bad_csrf' });
  }
  return res.render('error', {
    message:
      'انتهت الجلسة أو الطلب غير صالح — حدّث الصفحة وحاول مرة ثانية. / Session expired or invalid request — refresh and try again.',
  });
}

module.exports = csrf;
