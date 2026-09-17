'use strict';

/* AI image generation + editing via Pollinations.ai — free, no API key, no
   billing account needed. Every call is rate-limited per user per day since
   the app is publicly reachable and signups are open, and calls to
   Pollinations itself are serialized with a minimum gap since its free tier
   is a shared, global rate limit (not per caller). */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const config = require('../lib/config');
const { db } = require('../lib/db');
const { requireUser } = require('../lib/auth');
const { translateIfArabic } = require('../lib/translate');
const { isExplicit } = require('../lib/safe-search');

const router = express.Router();
router.use(requireUser);

const UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const qCountToday = db.prepare(
  `SELECT COUNT(*) AS n FROM ai_generations WHERE user_id = ? AND created_at > datetime('now', '-1 day')`
);
const qLog = db.prepare('INSERT INTO ai_generations (user_id) VALUES (?)');
const qInsertUpload = db.prepare(
  `INSERT INTO uploads (user_id, url, original_name, mime, size) VALUES (@user_id, @url, @original_name, @mime, @size)`
);

const MAX_PROMPT = 600;

function checkQuota(req, res) {
  const n = qCountToday.get(res.locals.user.id).n;
  if (n >= config.aiDailyLimit) {
    res.status(429).json({ error: 'quota_exceeded', limit: config.aiDailyLimit });
    return false;
  }
  return true;
}

// Pollinations' free tier is a shared global rate limit (~1 request/15s for
// anonymous use), not per-caller — serialize our own calls to it so bursts
// from different users don't just start failing each other.
let queue = Promise.resolve();
const MIN_GAP_MS = 6000;
let lastCallAt = 0;

function throttled(fn) {
  const run = async () => {
    const wait = Math.max(0, lastCallAt + MIN_GAP_MS - Date.now());
    if (wait) await new Promise((r) => setTimeout(r, wait));
    lastCallAt = Date.now();
    return fn();
  };
  const result = queue.then(run, run);
  queue = result.catch(() => {});
  return result;
}

async function fetchImage(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`pollinations HTTP ${r.status}`);
  const mime = r.headers.get('content-type') || 'image/jpeg';
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length < 200) throw new Error('empty image response');
  return { buf, mime };
}

function saveImage(userId, buf, mime, label) {
  const ext = mime.includes('png') ? '.png' : '.jpg';
  const filename = `ai-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, filename), buf);
  const url = `/static/uploads/${filename}`;
  const info = qInsertUpload.run({
    user_id: userId, url, original_name: String(label || 'ai').slice(0, 200), mime, size: buf.length,
  });
  return { id: info.lastInsertRowid, url };
}

router.post('/generate', async (req, res) => {
  if (!checkQuota(req, res)) return;
  const prompt = String((req.body && req.body.prompt) || '').trim().slice(0, MAX_PROMPT);
  if (!prompt) return res.status(400).json({ error: 'bad_prompt' });
  if (isExplicit(prompt)) return res.status(400).json({ error: 'bad_prompt' });
  try {
    const genPrompt = await translateIfArabic(prompt);
    if (isExplicit(genPrompt)) return res.status(400).json({ error: 'bad_prompt' });
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(genPrompt)}?width=1024&height=1024&nologo=true`;
    const { buf, mime } = await throttled(() => fetchImage(url));
    qLog.run(res.locals.user.id);
    res.json(saveImage(res.locals.user.id, buf, mime, prompt)); // keep the user's original text as the saved label
  } catch (err) {
    res.status(502).json({ error: 'ai_failed', message: config.isProd ? undefined : err.message });
  }
});

// Magic Write — short on-design copy. Prefers Gemini (Google's free tier —
// confirmed reliable live) when GEMINI_API_KEY is set; falls back to
// Pollinations' free text model otherwise (same graceful-degrade convention
// as the mailer/Pexels config — a missing key degrades to a lesser path
// rather than disabling the feature). Deliberately does NOT run the prompt
// through translateIfArabic like /generate does: for image prompts,
// translating to English improves the diffusion model's relevance regardless
// of output (an image has no "language"), but here the whole point is
// bilingual copy — translating an Arabic prompt to English would make the
// model reply in English instead. Language matching is handled by
// instructing the model directly via a system prompt instead, for both providers.
const WRITE_TONES = {
  headline: 'a short, catchy headline, at most 8 words',
  tagline: 'a short, punchy tagline or slogan, at most 10 words',
  description: 'a short marketing description, 1-2 sentences, at most 30 words',
  general: 'a short piece of on-design text, at most 20 words',
};

// Pollinations' anonymous text tier returns HTTP 200 with a plain-text error
// message when its shared free-tier budget is exhausted (confirmed live, not
// assumed) — e.g. "The API key used for this request has reached its
// budget...". Left undetected, that string would get inserted onto a user's
// design as if it were real generated copy. Match its known shape instead of
// trusting any 200 response as real content.
function looksLikeApiError(text) {
  const t = text.trim();
  if (!t) return true;
  if (/reached its budget|enter\.pollinations\.ai/i.test(t)) return true;
  if (t.startsWith('{')) {
    try { if (JSON.parse(t).error) return true; } catch (e) { /* not JSON, fine */ }
  }
  return false;
}

async function generateViaGemini(prompt, system) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${config.geminiApiKey}`;
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    systemInstruction: { parts: [{ text: system }] },
    // this is short on-design copy, not a reasoning task — skip Gemini 2.5's
    // extended "thinking" pass (confirmed live it otherwise burns ~400 tokens
    // of hidden thinking for a 7-word output, adding pure latency for nothing)
    generationConfig: { thinkingConfig: { thinkingBudget: 0 } },
  };
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`gemini HTTP ${r.status}`);
  const j = await r.json();
  const text = j.candidates && j.candidates[0] && j.candidates[0].content &&
    j.candidates[0].content.parts && j.candidates[0].content.parts[0] && j.candidates[0].content.parts[0].text;
  if (!text) throw new Error('gemini returned no text');
  return text.trim();
}

async function generateViaPollinations(prompt, system) {
  const url = `https://text.pollinations.ai/${encodeURIComponent(prompt)}?model=openai&system=${encodeURIComponent(system)}`;
  const text = await throttled(async () => {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`pollinations HTTP ${r.status}`);
    return (await r.text()).trim();
  });
  if (looksLikeApiError(text)) throw new Error('pollinations returned an error payload');
  return text;
}

router.post('/write', async (req, res) => {
  if (!checkQuota(req, res)) return;
  const prompt = String((req.body && req.body.prompt) || '').trim().slice(0, MAX_PROMPT);
  if (!prompt) return res.status(400).json({ error: 'bad_prompt' });
  if (isExplicit(prompt)) return res.status(400).json({ error: 'bad_prompt' });
  const tone = WRITE_TONES[req.body && req.body.tone] ? req.body.tone : 'general';
  try {
    const system = 'You write short on-design marketing copy for a graphic design app. ' +
      'Reply with ONLY the text itself, no quotes, no explanation, no preamble. ' +
      "Reply in the same language the user's request is written in. " +
      'Write ' + WRITE_TONES[tone] + '.';
    const text = config.geminiApiKey
      ? await generateViaGemini(prompt, system)
      : await generateViaPollinations(prompt, system);
    if (isExplicit(text)) return res.status(400).json({ error: 'bad_output' });
    qLog.run(res.locals.user.id);
    res.json({ text: text.slice(0, 400) });
  } catch (err) {
    res.status(502).json({ error: 'ai_failed', message: config.isProd ? undefined : err.message });
  }
});

// Image editing (Pollinations' "kontext" model) now requires a separate signup
// at enter.pollinations.ai — confirmed via a live test, not assumed. Returning
// a clear "unavailable" here instead of silently failing against a dead path.
router.post('/edit', (req, res) => {
  res.status(503).json({ error: 'edit_unavailable' });
});

module.exports = router;
