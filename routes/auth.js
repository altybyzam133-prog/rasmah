'use strict';

const express = require('express');
const crypto = require('crypto');
const {
  createUser, verifyUser, setUserLang,
  getUserByEmail, setResetCode, verifyResetCode, clearResetCode, setUserPassword,
  setEmailVerifyCode, verifyEmailCode, markEmailVerified,
} = require('../lib/db');
const { sendMail, available: mailerAvailable } = require('../lib/mailer');
const { requireSession } = require('../lib/auth');
const {
  loginLimiter, registerLimiter, forgotPasswordLimiter, resetPasswordLimiter, verifyEmailLimiter,
} = require('../lib/rate-limit');

const router = express.Router();

function cleanNext(n) {
  n = String(n || '');
  return n.startsWith('/') && !n.startsWith('//') ? n : '/dashboard';
}

function sixDigitCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}
function sendVerifyMail(res, user) {
  const code = sixDigitCode();
  setEmailVerifyCode(user.id, code);
  sendMail({
    to: user.email,
    subject: res.locals.t('mail_verify_subject'),
    text: res.locals.t('mail_verify_body', { code }),
  });
}

router.post('/register', registerLimiter, (req, res) => {
  const next = cleanNext(req.body.next);
  const values = { name: req.body.name, email: req.body.email };
  try {
    const user = createUser({
      name: req.body.name,
      email: req.body.email,
      password: req.body.password,
    });
    if (['ar', 'en'].includes(res.locals.lang)) setUserLang(user.id, res.locals.lang);
    req.session.userId = user.id;
    if (!mailerAvailable) {
      // No working mail sender configured — a code would never arrive, so
      // don't strand the user on /verify-email waiting for one.
      // requireUser's own self-heal covers this too, but handling it here
      // skips the pointless detour instead of relying on the next request.
      markEmailVerified(user.id);
      return res.redirect(next);
    }
    req.session.postVerifyNext = next;
    sendVerifyMail(res, user);
    return res.redirect('/verify-email');
  } catch (err) {
    const map = {
      BAD_NAME: 'auth_err_bad_name',
      BAD_EMAIL: 'auth_err_bad_email',
      SHORT_PASSWORD: 'auth_err_short_password',
      EMAIL_TAKEN: 'auth_err_email_taken',
    };
    const key = map[err.code];
    if (!key) throw err;
    return res.status(400).render('register', {
      pageTitle: res.locals.t('auth_register_title'),
      next,
      values,
      error: res.locals.t(key),
    });
  }
});

router.post('/login', loginLimiter, (req, res) => {
  const next = cleanNext(req.body.next);
  const user = verifyUser(req.body.email, req.body.password);
  if (!user) {
    return res.status(401).render('login', {
      pageTitle: res.locals.t('auth_login_title'),
      next,
      values: { email: req.body.email },
      error: res.locals.t('auth_err_invalid'),
    });
  }
  req.session.userId = user.id;
  if (!user.email_verified) {
    if (!mailerAvailable) markEmailVerified(user.id);
    // requireUser bounces an unverified user to /verify-email regardless of
    // `next` — stash it so a successful verification can still land them
    // where they were originally headed instead of always /dashboard.
    else req.session.postVerifyNext = next;
  }
  return res.redirect(next);
});

router.post('/logout', (req, res) => {
  req.session.userId = null;
  req.session.flash = { type: 'ok', msg: res.locals.t('auth_logged_out') };
  res.redirect('/');
});

router.get('/verify-email', requireSession, (req, res) => {
  if (res.locals.user.email_verified) return res.redirect('/dashboard');
  res.render('verify-email', {
    pageTitle: res.locals.t('auth_verify_title'),
    email: res.locals.user.email,
    error: null,
  });
});

router.post('/verify-email', requireSession, (req, res) => {
  if (res.locals.user.email_verified) return res.redirect('/dashboard');
  const code = String(req.body.code || '').trim();
  if (!verifyEmailCode(res.locals.user.id, code)) {
    res.status(400);
    return res.render('verify-email', {
      pageTitle: res.locals.t('auth_verify_title'),
      email: res.locals.user.email,
      error: res.locals.t('auth_err_bad_code'),
    });
  }
  markEmailVerified(res.locals.user.id);
  const dest = cleanNext(req.session.postVerifyNext);
  delete req.session.postVerifyNext;
  req.session.flash = { type: 'ok', msg: res.locals.t('auth_verify_done') };
  res.redirect(dest);
});

router.post('/verify-email/resend', verifyEmailLimiter, requireSession, (req, res) => {
  if (res.locals.user.email_verified) return res.redirect('/dashboard');
  sendVerifyMail(res, res.locals.user);
  req.session.flash = { type: 'ok', msg: res.locals.t('auth_verify_resent') };
  res.redirect('/verify-email');
});

function renderForgot(req, res, extra = {}) {
  res.render('forgot-password', {
    pageTitle: res.locals.t('auth_forgot_title'),
    sent: false,
    error: null,
    values: {},
    ...extra,
  });
}

router.post('/forgot-password', forgotPasswordLimiter, (req, res) => {
  const email = String(req.body.email || '').trim();
  const user = getUserByEmail(email);
  if (user) {
    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    setResetCode(user.id, code);
    sendMail({
      to: user.email,
      subject: res.locals.t('mail_reset_subject'),
      text: res.locals.t('mail_reset_body', { code, minutes: 15 }),
    });
  }
  // Same response whether or not the address is registered, so this can't be
  // used to find out which emails have accounts.
  renderForgot(req, res, { sent: true, values: { email } });
});

router.post('/reset-password', resetPasswordLimiter, (req, res) => {
  const email = String(req.body.email || '').trim();
  const code = String(req.body.code || '').trim();
  const { password, password2 } = req.body;

  const fail = (msg) => {
    res.status(400);
    renderForgot(req, res, { sent: true, values: { email }, error: msg });
  };

  if (password !== password2) return fail(res.locals.t('auth_err_password_mismatch'));

  const user = getUserByEmail(email);
  if (!user || !verifyResetCode(user.id, code)) {
    return fail(res.locals.t('auth_err_bad_code'));
  }

  try {
    setUserPassword(user.id, password);
  } catch (err) {
    if (err.code !== 'SHORT_PASSWORD') throw err;
    return fail(res.locals.t('auth_err_short_password'));
  }
  clearResetCode(user.id);
  req.session.flash = { type: 'ok', msg: res.locals.t('auth_reset_done') };
  res.redirect('/login');
});

module.exports = router;
