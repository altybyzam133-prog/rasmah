'use strict';

const fs = require('fs');
const path = require('path');

const localesDir = path.join(__dirname, '..', 'locales');
const strings = {
  ar: JSON.parse(fs.readFileSync(path.join(localesDir, 'ar.json'), 'utf8')),
  en: JSON.parse(fs.readFileSync(path.join(localesDir, 'en.json'), 'utf8')),
};

const SUPPORTED = ['ar', 'en'];
const DEFAULT = 'ar';

function pick(req) {
  const q = (req.query.lang || '').toLowerCase();
  if (SUPPORTED.includes(q)) return q;
  const c = (req.cookies && req.cookies.lang) || '';
  if (SUPPORTED.includes(c)) return c;
  const header = (req.headers['accept-language'] || '').toLowerCase();
  if (header.startsWith('en')) return 'en';
  if (header.startsWith('ar')) return 'ar';
  return DEFAULT;
}

module.exports = function i18n(req, res, next) {
  const lang = pick(req);

  // persist an explicit ?lang choice for a year
  if ((req.query.lang || '').toLowerCase() === lang) {
    res.cookie('lang', lang, {
      maxAge: 1000 * 60 * 60 * 24 * 365,
      httpOnly: false,
      sameSite: 'lax',
    });
  }

  const table = strings[lang] || strings[DEFAULT];
  const other = lang === 'ar' ? 'en' : 'ar';

  res.locals.lang = lang;
  res.locals.otherLang = other;
  res.locals.otherLangName = strings[other].lang_name;
  res.locals.dir = table.dir || (lang === 'ar' ? 'rtl' : 'ltr');
  res.locals.isRTL = res.locals.dir === 'rtl';

  // current URL with ?lang=<other> merged in (keeps path + other query params)
  const params = new URLSearchParams(req.query);
  params.set('lang', other);
  res.locals.switchLangUrl = `${req.path}?${params.toString()}`;

  res.locals.t = (key, vars) => {
    let s = table[key];
    if (s == null) s = strings[DEFAULT][key];
    if (s == null) return key;
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        s = s.replace(new RegExp('\\{' + k + '\\}', 'g'), String(v));
      }
    }
    return s;
  };

  // localized DB field helper: field(row, 'name') -> row.name_ar / row.name_en
  res.locals.field = (row, base) => {
    if (!row) return '';
    return row[`${base}_${lang}`] || row[`${base}_ar`] || row[`${base}_en`] || '';
  };

  next();
};

module.exports.strings = strings;
module.exports.SUPPORTED = SUPPORTED;
module.exports.DEFAULT = DEFAULT;
