'use strict';

const { getUserById } = require('./db');

/* Loads the signed-in user onto res.locals.user for every request. */
function loadUser(req, res, next) {
  res.locals.user = null;
  if (req.session && req.session.userId) {
    const u = getUserById(req.session.userId);
    if (u) res.locals.user = u;
    else req.session.userId = null;
  }
  next();
}

/* Gate for pages/APIs that only require a signed-in session, verified or
   not — used by /verify-email itself (obviously can't require verification
   to reach the page that performs it) and /logout. */
function requireSession(req, res, next) {
  if (res.locals.user) return next();
  if (req.path.startsWith('/api') || req.get('accept') === 'application/json') {
    return res.status(401).json({ error: 'auth_required' });
  }
  const next_ = encodeURIComponent(req.originalUrl || '/dashboard');
  return res.redirect(`/login?next=${next_}`);
}

/* Gate for pages/APIs that require a signed-in AND email-verified user.
   A signed-in-but-unverified user is bounced to /verify-email rather than
   /login — they don't need to log in again, just confirm their address. */
function requireUser(req, res, next) {
  if (res.locals.user && res.locals.user.email_verified) return next();
  if (res.locals.user) {
    if (req.path.startsWith('/api') || req.get('accept') === 'application/json') {
      return res.status(401).json({ error: 'email_not_verified' });
    }
    return res.redirect('/verify-email');
  }
  if (req.path.startsWith('/api') || req.get('accept') === 'application/json') {
    return res.status(401).json({ error: 'auth_required' });
  }
  const next_ = encodeURIComponent(req.originalUrl || '/dashboard');
  return res.redirect(`/login?next=${next_}`);
}

module.exports = { loadUser, requireUser, requireSession };
