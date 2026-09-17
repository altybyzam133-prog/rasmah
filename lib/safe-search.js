'use strict';

/* Keyword-based content guard, shared by routes/stock.js (Pexels search —
   checked against the query AND each result's own alt-text description, as
   defense-in-depth) and routes/ai.js (image-generation prompt). Pexels' own
   content policy already prohibits explicit/adult material site-wide and
   Pollinations has its own filtering too, so this is a second layer, not
   the only one.

   Two tiers, both blocked the same way:
   - EXPLICIT_TERMS: unambiguous pornographic/adult-content terms.
   - INTIMATE_TERMS: this platform's own content policy also excludes
     romantic/intimate imagery generally (kissing, embracing couples, etc.)
     — reported after a plain search for "kiss" returned exactly that, none
     of it "explicit" by international/EXPLICIT_TERMS standards, but not
     content this platform wants either. Applied uniformly to ANY such
     imagery regardless of who's depicted — this is not a proxy for
     filtering any particular group's representation (a request to do that
     specifically was raised and declined separately; this list has no
     terms naming any orientation, identity, or group).

   NOT blocking plain anatomical words like "breast"/"nipple" on purpose:
   those have completely ordinary uses (breastfeeding photos, medical/
   educational content, "chicken breast" recipes) and a false block on
   those would just be a different problem. Word-boundary matched so a
   match inside an unrelated word (e.g. "ass" inside "class") doesn't
   false-positive. */
const EXPLICIT_TERMS = [
  'porn', 'pornographic', 'pornography', 'xxx',
  'nude', 'nudity', 'naked', 'nsfw',
  'erotic', 'erotica', 'fetish', 'hentai',
  'stripper', 'strip club', 'escort service', 'prostitut',
  'masturbat', 'orgasm', 'blowjob', 'handjob', 'threesome', 'gangbang', 'bdsm',
  'penis', 'vagina', 'genitalia', 'sex tape',
];

const INTIMATE_TERMS = [
  'kiss', 'kissing', 'make out', 'making out',
  'romance', 'romantic', 'intimate', 'intimacy',
  'lovers', 'seductive', 'sensual',
];

const ALL_TERMS = [...EXPLICIT_TERMS, ...INTIMATE_TERMS];

const RE = new RegExp(
  '\\b(' + ALL_TERMS.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')',
  'i'
);

function isExplicit(text) {
  return RE.test(String(text || ''));
}

module.exports = { isExplicit };
