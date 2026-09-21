'use strict';

const rateLimit = require('express-rate-limit');

// Renders the same branded error page the global error handler uses instead
// of express-rate-limit's plain-text default, so a throttled user sees a
// normal page in their own language.
function handler(req, res) {
  res.status(429).render('error', { message: res.locals.t('rate_limited') });
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler,
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  handler,
});

// Requesting a reset code sends an email — keep this tighter than login so a
// third party can't use someone else's address as an email bomb.
const forgotPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler,
});

// A 6-digit code only has ~1M combinations; this bounds brute-forcing it
// alongside the code's own short expiry (see lib/db.js setResetCode).
const resetPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler,
});

// Resending an email-verification code sends mail, same reasoning as
// forgotPasswordLimiter above.
const verifyEmailLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler,
});

// JSON-response variant for /api/* routes — the handler above renders the
// HTML error page, which would break a `fetch().then(r => r.json())` caller.
function jsonHandler(req, res) {
  res.status(429).json({ error: 'rate_limited' });
}

// Stock search proxies to Pexels' own API (shared per-key quota) — bounds how
// fast one user can burn through it via rapid typing.
const stockLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonHandler,
});

// QR generation is local CPU only (no third-party quota at risk), but still
// worth a light ceiling like every other new API surface here.
const qrLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonHandler,
});

module.exports = {
  loginLimiter, registerLimiter, forgotPasswordLimiter, resetPasswordLimiter,
  verifyEmailLimiter, stockLimiter, qrLimiter,
};
