'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');
const session = require('express-session');

const config = require('./lib/config');
const i18n = require('./lib/i18n');
const csrf = require('./lib/csrf');
const makeStore = require('./lib/session-store');
const { loadUser } = require('./lib/auth');

const pageRoutes = require('./routes/pages');
const authRoutes = require('./routes/auth');
const accountRoutes = require('./routes/account');
const designRoutes = require('./routes/designs');
const uploadRoutes = require('./routes/uploads');
const templateRoutes = require('./routes/templates');
const brandRoutes = require('./routes/brand');
const aiRoutes = require('./routes/ai');
const stockRoutes = require('./routes/stock');
const qrcodeRoutes = require('./routes/qrcode');
const fontRoutes = require('./routes/fonts');
const adminRoutes = require('./routes/admin');

// make sure runtime folders exist. Guarded on existsSync first, not just a
// bare recursive mkdirSync: on a cloud deploy with a mounted volume, `data`/
// `public/uploads` are symlinks to that volume (see
// scripts/link-persistent-dir.js) by the time this runs, and a plain
// `mkdirSync(existingSymlinkToDir, {recursive:true})` throws ENOENT instead
// of the silent no-op a real directory would get — confirmed this exact
// crash on a real Railway deploy before adding the guard, not theorized.
for (const d of ['data', 'public/uploads', 'public/vendor', 'public/fonts']) {
  const full = path.join(__dirname, d);
  if (!fs.existsSync(full)) fs.mkdirSync(full, { recursive: true });
}

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1);
app.disable('x-powered-by');

// tiny cookie parser (only the `lang` cookie is read here; sessions parse their own)
app.use((req, _res, next) => {
  req.cookies = {};
  const raw = req.headers.cookie;
  if (raw) {
    for (const part of raw.split(';')) {
      const i = part.indexOf('=');
      if (i > -1) {
        req.cookies[part.slice(0, i).trim()] = decodeURIComponent(
          part.slice(i + 1).trim()
        );
      }
    }
  }
  next();
});

app.use(express.json({ limit: '12mb' })); // design JSON + data-URL thumbnails
app.use(express.urlencoded({ extended: true, limit: '256kb' }));

// short-lived cache for now while the app is under active iteration — a 7-day
// cache (the normal isProd value) means real users can sit on stale CSS/JS for
// a week after every fix. Bump this back up once things stabilize.
app.use('/static', express.static(path.join(__dirname, 'public'), {
  maxAge: config.isProd ? '5m' : 0,
}));

// served at the root (not under /static) so its default scope covers the
// whole site — a service worker's max scope is the directory it's served
// from unless Service-Worker-Allowed says otherwise.
app.get('/sw.js', (req, res) => {
  res.set('Service-Worker-Allowed', '/');
  res.set('Cache-Control', 'no-cache');
  res.type('application/javascript');
  res.sendFile(path.join(__dirname, 'public', 'sw.js'));
});

app.use(
  session({
    name: 'dsid',
    secret: config.sessionSecret,
    store: makeStore(session),
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      // 'auto' (not a hardcoded config.isProd) marks the cookie Secure only on
      // requests that are actually HTTPS (via the trusted X-Forwarded-Proto from
      // ngrok) — hardcoding true here silently dropped the Set-Cookie header
      // entirely on any plain-HTTP access (LAN IP, localhost), since a Secure
      // cookie can't be set over an insecure connection: no session ever
      // persisted, so login/register/every write action failed with a bad_csrf
      // 403 for anyone not going through the public HTTPS tunnel.
      secure: 'auto',
      maxAge: 1000 * 60 * 60 * 24 * 14,
    },
  })
);

app.use(i18n);
app.use(loadUser);

// shared template locals (must run before csrf so its rejection page can render)
app.use((req, res, next) => {
  const lang = res.locals.lang;
  res.locals.config = config;
  res.locals.currentPath = req.path;
  res.locals.year = new Date().getFullYear();
  res.locals.brandName = lang === 'ar' ? config.brandNameAr : config.brandNameEn;
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  const th = req.cookies && req.cookies.theme;
  res.locals.theme = th === 'dark' || th === 'light' ? th : '';
  next();
});

app.use(csrf);

app.use('/', pageRoutes);
app.use('/', authRoutes);
app.use('/account', accountRoutes);
app.use('/admin', adminRoutes);
app.use('/api/designs', designRoutes);
app.use('/api/uploads', uploadRoutes);
app.use('/api/templates', templateRoutes);
app.use('/api/brand', brandRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/stock', stockRoutes);
app.use('/api/qrcode', qrcodeRoutes);
app.use('/api/fonts', fontRoutes);

app.use((req, res) => {
  res.status(404).render('404');
});

app.use((err, req, res, _next) => {
  console.error(err);
  const isSize =
    err && (err.code === 'LIMIT_FILE_SIZE' || err.type === 'entity.too.large');
  res.status(isSize ? 413 : err.status || 500);
  const msg = isSize
    ? 'الملف أكبر من الحد المسموح / File exceeds the allowed size'
    : config.isProd
    ? 'خطأ في الخادم / Server error'
    : err.stack || String(err);
  if (req.path.startsWith('/api')) return res.json({ error: 'server_error', message: config.isProd ? undefined : msg });
  res.render('error', { message: msg });
});

app.listen(config.port, config.host, () => {
  const shown =
    config.host === '0.0.0.0' || config.host === '::' ? 'localhost' : config.host;
  console.log(`\n  ${config.brandNameAr} / ${config.brandNameEn}`);
  console.log(`  يعمل الآن / running:  http://${shown}:${config.port}`);
  if (config.sessionSecret === 'dev-only-insecure-secret-change-me') {
    console.log('  ⚠  عيّن SESSION_SECRET في ملف .env / set SESSION_SECRET in .env');
  }
  console.log('  إيقاف / stop: Ctrl + C\n');
});
