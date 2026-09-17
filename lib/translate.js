'use strict';

/* Shared with routes/ai.js and routes/stock.js: both send a user's free-text
   query to an English-only third party (Pollinations' image model, Pexels'
   search) that either mishandles Arabic outright (the image model
   pattern-matches on the script and returns generic "Middle Eastern"-themed
   results regardless of what the words actually say — confirmed with real
   prompts, e.g. "قطة برتقالية" produced a building, not a cat) or simply
   returns nothing relevant for a non-English query (Pexels search). */
const ARABIC_RE = /[؀-ۿ]/;

async function translateIfArabic(text) {
  if (!ARABIC_RE.test(text)) return text;
  try {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=ar|en`;
    const r = await fetch(url);
    const j = await r.json();
    const translated = j && j.responseData && j.responseData.translatedText;
    return translated ? String(translated) : text;
  } catch {
    return text; // fall back to the original text if translation is unreachable
  }
}

module.exports = { translateIfArabic, ARABIC_RE };
