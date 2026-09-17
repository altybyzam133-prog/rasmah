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

/* Gate for pages/APIs that require a signed-in user. */
function requireUser(req, res, next) {
  if (res.locals.user) return next();
  if (req.path.startsWith('/api') || req.get('accept') === 'application/json') {
    return res.status(401).json({ error: 'auth_required' });
  }
  const next_ = encodeURIComponent(req.originalUrl || '/dashboard');
  return res.redirect(`/login?next=${next_}`);
}

module.exports = { loadUser, requireUser };
