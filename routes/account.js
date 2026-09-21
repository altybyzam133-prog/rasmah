'use strict';

const express = require('express');
const crypto = require('crypto');
const { db, updateProfile, setUserPassword, setUserLang, verifyUserById, deleteUser, setEmailVerifyCode } = require('../lib/db');
const { sendMail } = require('../lib/mailer');
const { requireUser } = require('../lib/auth');

const router = express.Router();
router.use(requireUser);

const qCounts = db.prepare(
  `SELECT
     (SELECT COUNT(*) FROM designs WHERE user_id = @id) AS designs,
     (SELECT COUNT(*) FROM uploads WHERE user_id = @id) AS uploads,
     (SELECT COALESCE(SUM(size),0) FROM uploads WHERE user_id = @id) AS storage`
);

function render(req, res, extra = {}) {
  res.render('account', {
    pageTitle: res.locals.t('acc_title'),
    counts: qCounts.get({ id: res.locals.user.id }),
    ok: null,
    error: null,
    ...extra,
  });
}

router.get('/', (req, res) => render(req, res));

router.post('/profile', (req, res) => {
  try {
    const prevEmailLower = res.locals.user.email_lower;
    const u = updateProfile(res.locals.user.id, { name: req.body.name, email: req.body.email });
    res.locals.user = u;
    if (u.email_lower !== prevEmailLower) {
      // updateProfile already reset email_verified to 0 for us — send a
      // fresh code for the new address so requireUser's verify gate (which
      // now applies again) has something to check against.
      const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
      setEmailVerifyCode(u.id, code);
      sendMail({
        to: u.email,
        subject: res.locals.t('mail_verify_subject'),
        text: res.locals.t('mail_verify_body', { code }),
      });
      req.session.postVerifyNext = '/account';
      req.session.flash = { type: 'ok', msg: res.locals.t('acc_email_changed_verify') };
      return res.redirect('/verify-email');
    }
    render(req, res, { ok: res.locals.t('acc_saved') });
  } catch (err) {
    const map = { BAD_NAME: 'auth_err_bad_name', BAD_EMAIL: 'auth_err_bad_email', EMAIL_TAKEN: 'auth_err_email_taken' };
    if (!map[err.code]) throw err;
    res.status(400);
    render(req, res, { error: res.locals.t(map[err.code]) });
  }
});

router.post('/password', (req, res) => {
  if (!verifyUserById(res.locals.user.id, req.body.current)) {
    res.status(400);
    return render(req, res, { error: res.locals.t('acc_err_current') });
  }
  try {
    setUserPassword(res.locals.user.id, req.body.next);
    render(req, res, { ok: res.locals.t('acc_saved') });
  } catch (err) {
    if (err.code !== 'SHORT_PASSWORD') throw err;
    res.status(400);
    render(req, res, { error: res.locals.t('auth_err_short_password') });
  }
});

router.post('/language', (req, res) => {
  const lang = ['ar', 'en'].includes(req.body.lang) ? req.body.lang : 'ar';
  setUserLang(res.locals.user.id, lang);
  res.cookie('lang', lang, { maxAge: 1000 * 60 * 60 * 24 * 365, httpOnly: false, sameSite: 'lax' });
  res.redirect('/account');
});

router.post('/delete', (req, res) => {
  if (!verifyUserById(res.locals.user.id, req.body.password)) {
    res.status(400);
    return render(req, res, { error: res.locals.t('acc_err_current') });
  }
  deleteUser(res.locals.user.id);
  req.session.destroy(() => res.redirect('/'));
});

module.exports = router;
