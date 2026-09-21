'use strict';

require('dotenv').config();

const bool = (v, d = false) =>
  v == null ? d : ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
const int = (v, d) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : d;
};

const isProd = process.env.NODE_ENV === 'production';
const isTest = process.env.NODE_ENV === 'test';

const config = {
  isProd,
  isTest,
  port: int(process.env.PORT, 3000),
  host: process.env.HOST || '127.0.0.1',

  sessionSecret:
    process.env.SESSION_SECRET || 'dev-only-insecure-secret-change-me',

  adminPassword: process.env.ADMIN_PASSWORD || '',
  adminLocalOnly: bool(process.env.ADMIN_LOCAL_ONLY, true),

  brandNameAr: process.env.BRAND_NAME_AR || 'رسمة',
  brandNameEn: process.env.BRAND_NAME_EN || 'Rasmah',

  maxUploadMb: int(process.env.MAX_UPLOAD_MB, 8),

  dbFile: process.env.DB_FILE || 'app.db',

  // AI image generation/editing (Pollinations.ai — free, no key needed).
  aiDailyLimit: int(process.env.AI_DAILY_LIMIT, 20),

  // SMTP for password-reset codes. Left blank -> the code is only logged to
  // the server console/log file instead of emailed (fine for local dev).
  mailer: {
    host: process.env.SMTP_HOST || '',
    port: int(process.env.SMTP_PORT, 587),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || process.env.SMTP_USER || '',
    get available() {
      return !!(this.host && this.user && this.pass);
    },
  },

  // Stock photo search (Pexels — free, instant signup at pexels.com/api).
  // Left blank -> the Stock panel shows a "not set up" hint instead of a
  // search box, same graceful-degrade pattern as the mailer above.
  pexelsApiKey: process.env.PEXELS_API_KEY || '',

  // Magic Write text generation (Gemini — free tier, more reliable than
  // Pollinations' anonymous text tier). Left blank -> falls back to Pollinations.
  geminiApiKey: process.env.GEMINI_API_KEY || '',
};

module.exports = config;
