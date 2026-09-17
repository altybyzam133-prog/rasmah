'use strict';

/* Seeds the templates table with a general mix of ready-made designs.
   Idempotent: only inserts when the table is empty (or run with --force).
   Each template is described once as a compact "spec" and rendered to both
   a Fabric.js canvas JSON (for the editor) and an SVG thumbnail (for gallery). */

const { db } = require('./lib/db');

const FORCE = process.argv.includes('--force');

/* ---- spec -> Fabric canvas JSON -------------------------------------------- */
function isArabicText(s) {
  return /[؀-ۿ]/.test(String(s || ''));
}

function toFabric(spec) {
  const objects = [
    {
      type: 'rect', version: '5.3.0', left: 0, top: 0,
      width: spec.w, height: spec.h, fill: spec.bg || '#ffffff',
      name: '__artboard', selectable: false, evented: false, hoverCursor: 'default',
    },
  ];
  for (const el of spec.els) {
    if (el.t === 'rect') {
      objects.push({
        type: 'rect', version: '5.3.0',
        left: el.x, top: el.y, width: el.w, height: el.h,
        fill: el.fill || '#7c5cff', rx: el.rx || 0, ry: el.rx || 0,
        stroke: el.stroke || null, strokeWidth: el.sw || 0,
        angle: el.angle || 0, opacity: el.opacity != null ? el.opacity : 1,
      });
    } else if (el.t === 'circle') {
      objects.push({
        type: 'circle', version: '5.3.0',
        left: el.cx - el.r, top: el.cy - el.r, radius: el.r,
        fill: el.fill || '#7c5cff', opacity: el.opacity != null ? el.opacity : 1,
      });
    } else if (el.t === 'text') {
      objects.push({
        type: 'textbox', version: '5.3.0',
        left: el.x, top: el.y, width: el.w,
        text: el.text, fontSize: el.size, fontFamily: el.font || 'Cairo',
        fontWeight: el.weight || '400', fontStyle: el.italic ? 'italic' : 'normal',
        fill: el.color || '#1b1830', textAlign: el.align || 'center',
        lineHeight: el.lh || 1.16,
        direction: isArabicText(el.text) ? 'rtl' : 'ltr',
        charSpacing: el.cs || 0,
      });
    }
  }
  return JSON.stringify({ version: '5.3.0', objects, background: '' });
}

/* ---- spec -> SVG thumbnail (data URI) ------------------------------------- */
function esc(s) {
  return String(s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
}
function toSvg(spec) {
  const parts = [`<rect width="${spec.w}" height="${spec.h}" fill="${spec.bg || '#ffffff'}"/>`];
  for (const el of spec.els) {
    if (el.t === 'rect') {
      const stroke = el.stroke ? ` stroke="${el.stroke}" stroke-width="${el.sw || 0}"` : '';
      parts.push(
        `<rect x="${el.x}" y="${el.y}" width="${el.w}" height="${el.h}" rx="${el.rx || 0}" fill="${el.fill === 'transparent' ? 'none' : (el.fill || '#7c5cff')}"${stroke} opacity="${el.opacity != null ? el.opacity : 1}" transform="rotate(${el.angle || 0} ${el.x + el.w / 2} ${el.y + el.h / 2})"/>`
      );
    } else if (el.t === 'circle') {
      parts.push(`<circle cx="${el.cx}" cy="${el.cy}" r="${el.r}" fill="${el.fill || '#7c5cff'}" opacity="${el.opacity != null ? el.opacity : 1}"/>`);
    } else if (el.t === 'text') {
      const anchor = el.align === 'left' ? 'start' : el.align === 'right' ? 'end' : 'middle';
      const tx = el.align === 'left' ? el.x : el.align === 'right' ? el.x + el.w : el.x + el.w / 2;
      const dir = isArabicText(el.text) ? ' direction="rtl"' : '';
      const lines = String(el.text).split('\n');
      lines.forEach((ln, i) => {
        parts.push(
          `<text x="${tx}" y="${el.y + el.size * (0.9 + i * (el.lh || 1.16))}" font-family="${el.font || 'Cairo'}, sans-serif" font-size="${el.size}" font-weight="${el.weight || 400}" fill="${el.color || '#1b1830'}" text-anchor="${anchor}"${dir}>${esc(ln)}</text>`
        );
      });
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${spec.w} ${spec.h}" width="${spec.w}" height="${spec.h}">${parts.join('')}</svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

/* ---- templates ---------------------------------------------------------------- */
const AR = 'Cairo';
const T = [];
let order = 0;
function tpl(o) { T.push({ ...o, sort_order: order++ }); }

/* social ------------------------------------------------------------------- */
tpl({
  slug: 'ig-post-quote', name_ar: 'منشور اقتباس', name_en: 'Quote post',
  category: 'social', w: 1080, h: 1080,
  spec: {
    w: 1080, h: 1080, bg: '#1b1830',
    els: [
      { t: 'rect', x: 90, y: 150, w: 120, h: 10, fill: '#7c5cff' },
      { t: 'text', x: 120, y: 360, w: 840, text: '"النجاح مجموع جهود صغيرة\nتتكرر كل يوم"', size: 92, weight: '800', color: '#ffffff', font: AR },
      { t: 'text', x: 120, y: 830, w: 840, text: 'اسم الحساب @', size: 34, weight: '600', color: '#7c5cff', font: AR },
    ],
  },
});
tpl({
  slug: 'ig-post-sale', name_ar: 'منشور عرض وخصم', name_en: 'Sale post',
  category: 'social', w: 1080, h: 1080,
  spec: {
    w: 1080, h: 1080, bg: '#ff5c8a',
    els: [
      { t: 'circle', cx: 900, cy: 180, r: 220, fill: '#ffd23f', opacity: 0.9 },
      { t: 'text', x: 90, y: 300, w: 900, text: 'خصم 50%', size: 200, weight: '800', color: '#ffffff', font: AR },
      { t: 'text', x: 90, y: 560, w: 900, text: 'على جميع المنتجات لفترة محدودة', size: 46, weight: '600', color: '#ffffff', font: AR },
      { t: 'rect', x: 340, y: 720, w: 400, h: 120, rx: 60, fill: '#1b1830' },
      { t: 'text', x: 340, y: 752, w: 400, text: 'تسوّق الآن', size: 46, weight: '700', color: '#ffffff', font: AR },
    ],
  },
});
tpl({
  slug: 'ig-story-promo', name_ar: 'ستوري ترويجي', name_en: 'Promo story',
  category: 'social', w: 1080, h: 1920,
  spec: {
    w: 1080, h: 1920, bg: '#7c5cff',
    els: [
      { t: 'rect', x: 0, y: 1180, w: 1080, h: 740, fill: '#ffffff' },
      { t: 'circle', cx: 540, cy: 620, r: 300, fill: '#ffd23f' },
      { t: 'text', x: 90, y: 1280, w: 900, text: 'جديدنا وصل', size: 120, weight: '800', color: '#1b1830', font: AR },
      { t: 'text', x: 90, y: 1470, w: 900, text: 'اكتشف المجموعة كاملة عبر الرابط في البايو', size: 44, weight: '500', color: '#6c6883', font: AR },
      { t: 'text', x: 90, y: 1720, w: 900, text: 'اسحب لأعلى ↑', size: 40, weight: '700', color: '#7c5cff', font: AR },
    ],
  },
});
tpl({
  slug: 'x-post-announce', name_ar: 'إعلان تويتر / X', name_en: 'X announcement',
  category: 'social', w: 1600, h: 900,
  spec: {
    w: 1600, h: 900, bg: '#0f172a',
    els: [
      { t: 'rect', x: 0, y: 0, w: 16, h: 900, fill: '#4cc9f0' },
      { t: 'text', x: 120, y: 300, w: 1360, text: 'أطلقنا ميزة جديدة 🎉', size: 110, weight: '800', color: '#ffffff', align: 'left', font: AR },
      { t: 'text', x: 120, y: 480, w: 1200, text: 'الآن يمكنك تصدير تصاميمك بدقة مضاعفة\nوبصيغة PDF بضغطة واحدة.', size: 44, weight: '500', color: '#94a3b8', align: 'left', font: AR },
    ],
  },
});
tpl({
  slug: 'yt-thumb', name_ar: 'صورة يوتيوب مصغّرة', name_en: 'YouTube thumbnail',
  category: 'social', w: 1280, h: 720,
  spec: {
    w: 1280, h: 720, bg: '#e5484d',
    els: [
      { t: 'rect', x: 0, y: 0, w: 720, h: 720, fill: '#1b1830' },
      { t: 'text', x: 700, y: 200, w: 540, text: 'كيف تصمّم\nبسرعة؟', size: 130, weight: '800', color: '#ffffff', align: 'left', font: AR },
      { t: 'rect', x: 700, y: 560, w: 320, h: 90, rx: 45, fill: '#ffd23f' },
      { t: 'text', x: 700, y: 578, w: 320, text: 'شرح كامل', size: 40, weight: '700', color: '#1b1830', font: AR },
    ],
  },
});
tpl({
  slug: 'fb-cover', name_ar: 'غلاف فيسبوك', name_en: 'Facebook cover',
  category: 'social', w: 1640, h: 624,
  spec: {
    w: 1640, h: 624, bg: '#7c5cff',
    els: [
      { t: 'circle', cx: 1400, cy: 320, r: 260, fill: '#ff5c8a', opacity: 0.85 },
      { t: 'circle', cx: 240, cy: 120, r: 160, fill: '#ffd23f', opacity: 0.85 },
      { t: 'text', x: 120, y: 230, w: 1000, text: 'مرحبًا بك في صفحتنا', size: 88, weight: '800', color: '#ffffff', align: 'left', font: AR },
      { t: 'text', x: 120, y: 380, w: 1000, text: 'محتوى يومي يهمّك — تابعنا', size: 40, weight: '500', color: '#efeaff', align: 'left', font: AR },
    ],
  },
});

/* presentation ----------------------------------------------------------------- */
tpl({
  slug: 'pres-title', name_ar: 'شريحة عنوان', name_en: 'Title slide',
  category: 'presentation', w: 1920, h: 1080,
  spec: {
    w: 1920, h: 1080, bg: '#ffffff',
    els: [
      { t: 'rect', x: 0, y: 0, w: 640, h: 1080, fill: '#7c5cff' },
      { t: 'text', x: 740, y: 380, w: 1080, text: 'عنوان العرض التقديمي', size: 100, weight: '800', color: '#1b1830', align: 'left', font: AR },
      { t: 'text', x: 740, y: 560, w: 1080, text: 'اسم المُقدّم — التاريخ', size: 44, weight: '500', color: '#6c6883', align: 'left', font: AR },
      { t: 'rect', x: 740, y: 520, w: 160, h: 8, fill: '#ff5c8a' },
    ],
  },
});
tpl({
  slug: 'pres-content', name_ar: 'شريحة محتوى', name_en: 'Content slide',
  category: 'presentation', w: 1920, h: 1080,
  spec: {
    w: 1920, h: 1080, bg: '#f6f5fb',
    els: [
      { t: 'text', x: 120, y: 110, w: 1680, text: 'العنوان الرئيسي للشريحة', size: 78, weight: '800', color: '#1b1830', align: 'right', font: AR },
      { t: 'rect', x: 1560, y: 240, w: 240, h: 8, fill: '#7c5cff' },
      { t: 'text', x: 120, y: 340, w: 1680, text: '• النقطة الأولى المهمة في العرض\n• النقطة الثانية مع تفاصيل مختصرة\n• النقطة الثالثة لإكمال الفكرة', size: 48, weight: '500', color: '#33304a', align: 'right', lh: 1.8, font: AR },
    ],
  },
});

/* business --------------------------------------------------------------------- */
tpl({
  slug: 'business-card', name_ar: 'بطاقة عمل', name_en: 'Business card',
  category: 'business', w: 1050, h: 600,
  spec: {
    w: 1050, h: 600, bg: '#1b1830',
    els: [
      { t: 'rect', x: 0, y: 0, w: 1050, h: 14, fill: '#7c5cff' },
      { t: 'text', x: 80, y: 150, w: 890, text: 'الاسم الكامل', size: 74, weight: '800', color: '#ffffff', align: 'right', font: AR },
      { t: 'text', x: 80, y: 260, w: 890, text: 'المسمّى الوظيفي', size: 38, weight: '500', color: '#a9a4c6', align: 'right', font: AR },
      { t: 'text', x: 80, y: 430, w: 890, text: '‪+966 5x xxx xxxx  ·  name@email.com', size: 32, weight: '500', color: '#efeaff', align: 'right', font: AR },
    ],
  },
});
tpl({
  slug: 'logo-badge', name_ar: 'شعار دائري', name_en: 'Round logo',
  category: 'business', w: 500, h: 500,
  spec: {
    w: 500, h: 500, bg: '#ffffff',
    els: [
      { t: 'circle', cx: 250, cy: 250, r: 210, fill: '#7c5cff' },
      { t: 'circle', cx: 250, cy: 250, r: 170, fill: '#ffffff' },
      { t: 'text', x: 60, y: 205, w: 380, text: 'اسمك', size: 96, weight: '800', color: '#1b1830', font: AR },
      { t: 'text', x: 60, y: 320, w: 380, text: 'EST. 2026', size: 26, weight: '700', color: '#7c5cff', font: 'Poppins', cs: 300 },
    ],
  },
});
tpl({
  slug: 'letterhead-a4', name_ar: 'ترويسة رسمية A4', name_en: 'Letterhead A4',
  category: 'business', w: 1240, h: 1754,
  spec: {
    w: 1240, h: 1754, bg: '#ffffff',
    els: [
      { t: 'rect', x: 0, y: 0, w: 1240, h: 200, fill: '#1b1830' },
      { t: 'text', x: 80, y: 70, w: 1080, text: 'اسم الشركة', size: 60, weight: '800', color: '#ffffff', align: 'right', font: AR },
      { t: 'text', x: 80, y: 320, w: 1080, text: 'التاريخ: __ / __ / ____', size: 32, weight: '500', color: '#6c6883', align: 'right', font: AR },
      { t: 'text', x: 80, y: 420, w: 1080, text: 'الموضوع: ................................', size: 34, weight: '700', color: '#1b1830', align: 'right', font: AR },
      { t: 'rect', x: 0, y: 1680, w: 1240, h: 74, fill: '#7c5cff' },
    ],
  },
});

/* marketing ------------------------------------------------------------------ */
tpl({
  slug: 'poster-event', name_ar: 'بوستر فعالية', name_en: 'Event poster',
  category: 'marketing', w: 1240, h: 1754,
  spec: {
    w: 1240, h: 1754, bg: '#7c5cff',
    els: [
      { t: 'circle', cx: 620, cy: 560, r: 380, fill: '#ffd23f' },
      { t: 'text', x: 120, y: 380, w: 1000, text: 'ملتقى\nالمبدعين', size: 180, weight: '800', color: '#1b1830', font: AR, lh: 1.05 },
      { t: 'text', x: 120, y: 1120, w: 1000, text: 'السبت · 8 مساءً · قاعة المؤتمرات', size: 46, weight: '600', color: '#ffffff', font: AR },
      { t: 'rect', x: 120, y: 1260, w: 1000, h: 6, fill: '#ffffff', opacity: 0.5 },
      { t: 'text', x: 120, y: 1320, w: 1000, text: 'الدخول مجاني — سجّل عبر الرابط', size: 40, weight: '500', color: '#efeaff', font: AR },
    ],
  },
});
tpl({
  slug: 'promo-square', name_ar: 'بطاقة ترويجية', name_en: 'Promo card',
  category: 'marketing', w: 1080, h: 1080,
  spec: {
    w: 1080, h: 1080, bg: '#22a06b',
    els: [
      { t: 'rect', x: 90, y: 90, w: 900, h: 900, rx: 40, fill: '#ffffff' },
      { t: 'text', x: 150, y: 220, w: 780, text: 'عرض اليوم', size: 72, weight: '700', color: '#22a06b', font: AR },
      { t: 'text', x: 150, y: 360, w: 780, text: 'اشترِ 1\nواحصل على 1', size: 110, weight: '800', color: '#1b1830', font: AR, lh: 1.1 },
      { t: 'rect', x: 150, y: 760, w: 780, h: 120, rx: 20, fill: '#22a06b' },
      { t: 'text', x: 150, y: 792, w: 780, text: 'استخدم كود: TODAY', size: 44, weight: '700', color: '#ffffff', font: AR },
    ],
  },
});
tpl({
  slug: 'flyer-service', name_ar: 'فلاير خدمات', name_en: 'Services flyer',
  category: 'marketing', w: 1240, h: 1754,
  spec: {
    w: 1240, h: 1754, bg: '#f6f5fb',
    els: [
      { t: 'rect', x: 0, y: 0, w: 1240, h: 520, fill: '#1b1830' },
      { t: 'text', x: 100, y: 180, w: 1040, text: 'خدماتنا', size: 130, weight: '800', color: '#ffffff', align: 'right', font: AR },
      { t: 'rect', x: 100, y: 620, w: 1040, h: 160, rx: 18, fill: '#ffffff' },
      { t: 'rect', x: 100, y: 820, w: 1040, h: 160, rx: 18, fill: '#ffffff' },
      { t: 'rect', x: 100, y: 1020, w: 1040, h: 160, rx: 18, fill: '#ffffff' },
      { t: 'text', x: 140, y: 660, w: 960, text: 'تصميم هوية بصرية متكاملة', size: 40, weight: '600', color: '#1b1830', align: 'right', font: AR },
      { t: 'text', x: 140, y: 860, w: 960, text: 'إدارة حسابات التواصل الاجتماعي', size: 40, weight: '600', color: '#1b1830', align: 'right', font: AR },
      { t: 'text', x: 140, y: 1060, w: 960, text: 'إنتاج فيديو موشن جرافيك', size: 40, weight: '600', color: '#1b1830', align: 'right', font: AR },
      { t: 'text', x: 100, y: 1500, w: 1040, text: 'تواصل: 05x xxx xxxx', size: 44, weight: '700', color: '#7c5cff', font: AR },
    ],
  },
});
tpl({
  slug: 'menu-cafe', name_ar: 'قائمة طعام', name_en: 'Cafe menu',
  category: 'marketing', w: 1080, h: 1350,
  spec: {
    w: 1080, h: 1350, bg: '#1b1830',
    els: [
      { t: 'text', x: 90, y: 110, w: 900, text: 'المشروبات', size: 90, weight: '800', color: '#ffd23f', font: AR },
      { t: 'rect', x: 90, y: 250, w: 900, h: 4, fill: '#4a4666' },
      { t: 'text', x: 90, y: 320, w: 900, text: 'قهوة مختصة ................... 18\nلاتيه ......................... 16\nموكا ......................... 17\nشاي أخضر .................... 12', size: 46, weight: '500', color: '#efeaff', align: 'right', lh: 2, font: AR },
    ],
  },
});

/* personal ------------------------------------------------------------------- */
tpl({
  slug: 'invitation', name_ar: 'دعوة مناسبة', name_en: 'Invitation',
  category: 'personal', w: 1080, h: 1350,
  spec: {
    w: 1080, h: 1350, bg: '#fce7f3',
    els: [
      { t: 'rect', x: 70, y: 70, w: 940, h: 1210, fill: 'transparent', stroke: '#ff5c8a', sw: 4 },
      { t: 'text', x: 140, y: 260, w: 800, text: 'يسرّنا دعوتكم', size: 56, weight: '500', color: '#9d174d', font: AR },
      { t: 'text', x: 140, y: 380, w: 800, text: 'حفل تخرّج', size: 150, weight: '800', color: '#1b1830', font: 'Lalezar' },
      { t: 'rect', x: 440, y: 640, w: 200, h: 4, fill: '#ff5c8a' },
      { t: 'text', x: 140, y: 720, w: 800, text: 'الخميس 20 يونيو — 7 مساءً\nقاعة الاحتفالات الكبرى', size: 42, weight: '500', color: '#33304a', lh: 1.7, font: AR },
    ],
  },
});
tpl({
  slug: 'certificate', name_ar: 'شهادة تقدير', name_en: 'Certificate',
  category: 'personal', w: 1754, h: 1240,
  spec: {
    w: 1754, h: 1240, bg: '#ffffff',
    els: [
      { t: 'rect', x: 40, y: 40, w: 1674, h: 1160, rx: 8, fill: 'transparent', stroke: '#7c5cff', sw: 3 },
      { t: 'rect', x: 40, y: 40, w: 1674, h: 20, fill: '#7c5cff' },
      { t: 'rect', x: 40, y: 1180, w: 1674, h: 20, fill: '#7c5cff' },
      { t: 'text', x: 200, y: 220, w: 1354, text: 'شهادة تقدير', size: 120, weight: '800', color: '#1b1830', font: AR },
      { t: 'text', x: 200, y: 480, w: 1354, text: 'تُمنح هذه الشهادة إلى', size: 40, weight: '500', color: '#6c6883', font: AR },
      { t: 'text', x: 200, y: 560, w: 1354, text: 'الاسم', size: 88, weight: '700', color: '#7c5cff', font: AR },
      { t: 'text', x: 200, y: 760, w: 1354, text: 'تقديرًا لجهوده المتميّزة وإسهاماته الفعّالة', size: 40, weight: '500', color: '#33304a', font: AR },
    ],
  },
});
tpl({
  slug: 'resume-header', name_ar: 'سيرة ذاتية كاملة', name_en: 'Complete resume',
  category: 'personal', w: 1240, h: 1754,
  spec: {
    w: 1240, h: 1754, bg: '#ffffff',
    els: [
      { t: 'rect', x: 0, y: 0, w: 1240, h: 380, fill: '#7c5cff' },
      { t: 'circle', cx: 200, cy: 190, r: 110, fill: '#ffffff' },
      { t: 'text', x: 360, y: 100, w: 800, text: 'الاسم الكامل', size: 68, weight: '800', color: '#ffffff', align: 'right', font: AR },
      { t: 'text', x: 360, y: 205, w: 800, text: 'مطوّر واجهات أمامية', size: 34, weight: '500', color: '#efeaff', align: 'right', font: AR },
      { t: 'text', x: 360, y: 270, w: 800, text: 'name@email.com  •  05xxxxxxxx  •  الرياض', size: 24, weight: '500', color: '#d9ceff', align: 'right', font: AR },

      { t: 'text', x: 80, y: 430, w: 1080, text: 'نبذة', size: 38, weight: '800', color: '#7c5cff', align: 'right', font: AR },
      { t: 'text', x: 80, y: 485, w: 1080, text: 'اكتب هنا نبذة مختصرة عن خبرتك ومهاراتك وأهدافك المهنية.', size: 28, weight: '500', color: '#33304a', align: 'right', lh: 1.6, font: AR },

      { t: 'text', x: 80, y: 610, w: 1080, text: 'المهارات', size: 38, weight: '800', color: '#7c5cff', align: 'right', font: AR },
      { t: 'rect', x: 80, y: 668, w: 250, h: 62, rx: 31, fill: '#efeaff' },
      { t: 'text', x: 80, y: 686, w: 250, text: 'إدارة الوقت', size: 26, weight: '700', color: '#4b3aa8', align: 'center', font: AR },
      { t: 'rect', x: 357, y: 668, w: 250, h: 62, rx: 31, fill: '#efeaff' },
      { t: 'text', x: 357, y: 686, w: 250, text: 'Illustrator', size: 26, weight: '700', color: '#4b3aa8', align: 'center', font: 'Poppins' },
      { t: 'rect', x: 634, y: 668, w: 250, h: 62, rx: 31, fill: '#efeaff' },
      { t: 'text', x: 634, y: 686, w: 250, text: 'Photoshop', size: 26, weight: '700', color: '#4b3aa8', align: 'center', font: 'Poppins' },
      { t: 'rect', x: 911, y: 668, w: 249, h: 62, rx: 31, fill: '#efeaff' },
      { t: 'text', x: 911, y: 686, w: 249, text: 'تصميم UI', size: 26, weight: '700', color: '#4b3aa8', align: 'center', font: AR },

      { t: 'text', x: 80, y: 790, w: 1080, text: 'الخبرة العملية', size: 38, weight: '800', color: '#7c5cff', align: 'right', font: AR },
      { t: 'text', x: 80, y: 850, w: 1080, text: 'مصمم جرافيك — اسم الشركة', size: 32, weight: '700', color: '#1b1830', align: 'right', font: AR },
      { t: 'text', x: 80, y: 895, w: 1080, text: '٢٠٢٢ — الآن', size: 24, weight: '500', color: '#6c6883', align: 'right', font: AR },
      { t: 'text', x: 80, y: 935, w: 1080, text: 'وصف مختصر عن المهام والإنجازات في هذا المنصب.', size: 26, weight: '500', color: '#33304a', align: 'right', lh: 1.6, font: AR },
      { t: 'text', x: 80, y: 1010, w: 1080, text: 'مصمم متدرّب — اسم شركة أخرى', size: 32, weight: '700', color: '#1b1830', align: 'right', font: AR },
      { t: 'text', x: 80, y: 1055, w: 1080, text: '٢٠٢٠ — ٢٠٢٢', size: 24, weight: '500', color: '#6c6883', align: 'right', font: AR },
      { t: 'text', x: 80, y: 1095, w: 1080, text: 'وصف مختصر عن المهام والإنجازات في هذا المنصب.', size: 26, weight: '500', color: '#33304a', align: 'right', lh: 1.6, font: AR },

      { t: 'text', x: 80, y: 1200, w: 1080, text: 'التعليم', size: 38, weight: '800', color: '#7c5cff', align: 'right', font: AR },
      { t: 'text', x: 80, y: 1260, w: 1080, text: 'بكالوريوس تصميم جرافيك — اسم الجامعة', size: 32, weight: '700', color: '#1b1830', align: 'right', font: AR },
      { t: 'text', x: 80, y: 1305, w: 1080, text: '٢٠١٦ — ٢٠٢٠', size: 24, weight: '500', color: '#6c6883', align: 'right', font: AR },

      { t: 'text', x: 80, y: 1400, w: 1080, text: 'اللغات', size: 38, weight: '800', color: '#7c5cff', align: 'right', font: AR },
      { t: 'text', x: 80, y: 1460, w: 1080, text: 'العربية — اللغة الأم        الإنجليزية — متقدّم', size: 28, weight: '500', color: '#33304a', align: 'right', font: AR },
    ],
  },
});
tpl({
  slug: 'daily-quote', name_ar: 'بطاقة اقتباس يومي', name_en: 'Daily quote',
  category: 'personal', w: 1080, h: 1080,
  spec: {
    w: 1080, h: 1080, bg: '#0f172a',
    els: [
      { t: 'text', x: 120, y: 200, w: 840, text: '“', size: 260, weight: '800', color: '#7c5cff', font: 'Playfair Display' },
      { t: 'text', x: 120, y: 430, w: 840, text: 'كن أنت التغيير الذي\nتريد أن تراه في العالم', size: 76, weight: '700', color: '#ffffff', lh: 1.35, font: AR },
      { t: 'text', x: 120, y: 830, w: 840, text: '— مهاتما غاندي', size: 36, weight: '500', color: '#94a3b8', font: AR },
    ],
  },
});

/* ===== extended set ==================================================== */

/* -- social -- */
tpl({ slug: 'ig-carousel-cover', name_ar: 'غلاف كاروسيل', name_en: 'Carousel cover', category: 'social', w: 1080, h: 1080,
  spec: { w: 1080, h: 1080, bg: '#7c5cff', els: [
    { t: 'text', x: 90, y: 250, w: 900, text: '٥ نصائح\nلتصميم أسرع', size: 130, weight: '800', color: '#ffffff', lh: 1.1, font: AR },
    { t: 'rect', x: 90, y: 640, w: 160, h: 10, fill: '#ffd23f' },
    { t: 'text', x: 90, y: 900, w: 900, text: 'اسحب →', size: 40, weight: '700', color: '#efeaff', font: AR },
  ] } });
tpl({ slug: 'ig-carousel-slide', name_ar: 'شريحة كاروسيل', name_en: 'Carousel slide', category: 'social', w: 1080, h: 1080,
  spec: { w: 1080, h: 1080, bg: '#ffffff', els: [
    { t: 'text', x: 90, y: 120, w: 900, text: '01', size: 90, weight: '800', color: '#7c5cff', font: 'Poppins' },
    { t: 'text', x: 90, y: 300, w: 900, text: 'ابدأ من قالب', size: 96, weight: '800', color: '#1b1830', font: AR },
    { t: 'text', x: 90, y: 470, w: 900, text: 'لا تبدأ من صفحة فارغة — اختر قالبًا قريبًا من فكرتك وعدّله.', size: 40, weight: '500', color: '#33304a', lh: 1.7, font: AR },
  ] } });
tpl({ slug: 'ig-testimonial', name_ar: 'رأي عميل', name_en: 'Testimonial', category: 'social', w: 1080, h: 1080,
  spec: { w: 1080, h: 1080, bg: '#f6f5fb', els: [
    { t: 'text', x: 100, y: 120, w: 880, text: '“', size: 200, weight: '800', color: '#7c5cff', font: 'Playfair Display' },
    { t: 'text', x: 100, y: 360, w: 880, text: 'خدمة ممتازة وسرعة في التنفيذ، أنصح بالتعامل معهم بشدّة.', size: 52, weight: '600', color: '#1b1830', lh: 1.5, font: AR },
    { t: 'circle', cx: 150, cy: 830, r: 44, fill: '#7c5cff' },
    { t: 'text', x: 230, y: 800, w: 700, text: 'سارة العتيبي', size: 38, weight: '700', color: '#1b1830', align: 'right', font: AR },
    { t: 'text', x: 230, y: 856, w: 700, text: 'صاحبة متجر', size: 30, weight: '500', color: '#6c6883', align: 'right', font: AR },
  ] } });
tpl({ slug: 'linkedin-post', name_ar: 'منشور لينكدإن', name_en: 'LinkedIn post', category: 'social', w: 1200, h: 1200,
  spec: { w: 1200, h: 1200, bg: '#0f172a', els: [
    { t: 'rect', x: 0, y: 0, w: 12, h: 1200, fill: '#0a66c2' },
    { t: 'text', x: 100, y: 300, w: 1000, text: 'وظّف الشخص المناسب', size: 100, weight: '800', color: '#ffffff', align: 'right', font: AR },
    { t: 'text', x: 100, y: 480, w: 1000, text: '٣ أسئلة تكشف المرشّح الجاد من غيره في أول ٥ دقائق.', size: 42, weight: '500', color: '#94a3b8', align: 'right', lh: 1.7, font: AR },
  ] } });
tpl({ slug: 'linkedin-banner', name_ar: 'غلاف لينكدإن', name_en: 'LinkedIn banner', category: 'social', w: 1584, h: 396,
  spec: { w: 1584, h: 396, bg: '#7c5cff', els: [
    { t: 'circle', cx: 1350, cy: 200, r: 220, fill: '#5b3df5', opacity: 0.6 },
    { t: 'text', x: 100, y: 130, w: 1100, text: 'اسمك — مسمّاك المهني', size: 62, weight: '800', color: '#ffffff', align: 'right', font: AR },
    { t: 'text', x: 100, y: 230, w: 1100, text: 'أساعد الشركات على النمو عبر التصميم والمحتوى', size: 32, weight: '500', color: '#efeaff', align: 'right', font: AR },
  ] } });
tpl({ slug: 'podcast-cover', name_ar: 'غلاف بودكاست', name_en: 'Podcast cover', category: 'social', w: 1400, h: 1400,
  spec: { w: 1400, h: 1400, bg: '#1b1830', els: [
    { t: 'circle', cx: 700, cy: 560, r: 300, fill: '#7c5cff' },
    { t: 'text', x: 100, y: 480, w: 1200, text: '🎙', size: 260, weight: '400', color: '#ffffff', font: 'Poppins' },
    { t: 'text', x: 100, y: 940, w: 1200, text: 'اسم البودكاست', size: 130, weight: '800', color: '#ffffff', font: AR },
    { t: 'text', x: 100, y: 1130, w: 1200, text: 'حلقة أسبوعية عن ريادة الأعمال', size: 40, weight: '500', color: '#a9a4c6', font: AR },
  ] } });
tpl({ slug: 'pinterest-pin', name_ar: 'بين بنترست', name_en: 'Pinterest pin', category: 'social', w: 1000, h: 1500,
  spec: { w: 1000, h: 1500, bg: '#fce7f3', els: [
    { t: 'rect', x: 0, y: 1050, w: 1000, h: 450, fill: '#ffffff' },
    { t: 'text', x: 80, y: 200, w: 840, text: '١٠ أفكار\nديكور بسيطة', size: 130, weight: '800', color: '#9d174d', lh: 1.1, font: AR },
    { t: 'text', x: 80, y: 1140, w: 840, text: 'اضغط لقراءة المقال كاملًا', size: 40, weight: '600', color: '#6c6883', font: AR },
  ] } });
tpl({ slug: 'yt-channel-banner', name_ar: 'غلاف قناة يوتيوب', name_en: 'YouTube channel banner', category: 'social', w: 2560, h: 1440,
  spec: { w: 2560, h: 1440, bg: '#1b1830', els: [
    { t: 'circle', cx: 250, cy: 180, r: 340, fill: '#7c5cff', opacity: 0.22 },
    { t: 'circle', cx: 2350, cy: 1280, r: 380, fill: '#ff5c8a', opacity: 0.18 },
    { t: 'text', x: 530, y: 540, w: 1500, text: 'اسم القناة', size: 130, weight: '800', color: '#ffffff', align: 'center', font: AR },
    { t: 'text', x: 530, y: 700, w: 1500, text: 'محتوى مميز كل أسبوع', size: 44, weight: '500', color: '#c9c3e6', align: 'center', font: AR },
    { t: 'rect', x: 1160, y: 800, w: 240, h: 84, rx: 42, fill: '#ff5c8a' },
    { t: 'text', x: 1160, y: 823, w: 240, text: 'اشترك الآن', size: 32, weight: '700', color: '#ffffff', align: 'center', font: AR },
  ] } });
tpl({ slug: 'story-poll', name_ar: 'ستوري تصويت', name_en: 'Poll story', category: 'social', w: 1080, h: 1920,
  spec: { w: 1080, h: 1920, bg: '#4cc9f0', els: [
    { t: 'text', x: 90, y: 620, w: 900, text: 'أيهما تفضّل؟', size: 110, weight: '800', color: '#0f172a', font: AR },
    { t: 'rect', x: 120, y: 900, w: 840, h: 160, rx: 20, fill: '#ffffff' },
    { t: 'rect', x: 120, y: 1120, w: 840, h: 160, rx: 20, fill: '#0f172a' },
    { t: 'text', x: 120, y: 935, w: 840, text: 'الخيار الأول', size: 48, weight: '700', color: '#0f172a', font: AR },
    { t: 'text', x: 120, y: 1155, w: 840, text: 'الخيار الثاني', size: 48, weight: '700', color: '#ffffff', font: AR },
  ] } });

/* -- presentation -- */
tpl({ slug: 'pres-divider', name_ar: 'شريحة فاصلة', name_en: 'Section divider', category: 'presentation', w: 1920, h: 1080,
  spec: { w: 1920, h: 1080, bg: '#7c5cff', els: [
    { t: 'text', x: 200, y: 420, w: 1520, text: '٠٢', size: 90, weight: '800', color: '#ffd23f', font: 'Poppins' },
    { t: 'text', x: 200, y: 520, w: 1520, text: 'النتائج والتوصيات', size: 110, weight: '800', color: '#ffffff', align: 'right', font: AR },
  ] } });
tpl({ slug: 'pres-stats', name_ar: 'شريحة أرقام', name_en: 'Stats slide', category: 'presentation', w: 1920, h: 1080,
  spec: { w: 1920, h: 1080, bg: '#ffffff', els: [
    { t: 'text', x: 120, y: 120, w: 1680, text: 'أرقام تهمّك', size: 70, weight: '800', color: '#1b1830', align: 'right', font: AR },
    { t: 'text', x: 120, y: 360, w: 520, text: '٨٥٪', size: 160, weight: '800', color: '#7c5cff', font: 'Poppins' },
    { t: 'text', x: 700, y: 360, w: 520, text: '٣×', size: 160, weight: '800', color: '#ff5c8a', font: 'Poppins' },
    { t: 'text', x: 1280, y: 360, w: 520, text: '١٢ك', size: 160, weight: '800', color: '#22a06b', font: 'Poppins' },
    { t: 'text', x: 120, y: 580, w: 520, text: 'رضا العملاء', size: 34, weight: '500', color: '#6c6883', font: AR },
    { t: 'text', x: 700, y: 580, w: 520, text: 'نموّ المبيعات', size: 34, weight: '500', color: '#6c6883', font: AR },
    { t: 'text', x: 1280, y: 580, w: 520, text: 'مستخدم جديد', size: 34, weight: '500', color: '#6c6883', font: AR },
  ] } });
tpl({ slug: 'pres-thanks', name_ar: 'شريحة شكرًا', name_en: 'Thank you slide', category: 'presentation', w: 1920, h: 1080,
  spec: { w: 1920, h: 1080, bg: '#0f172a', els: [
    { t: 'text', x: 200, y: 420, w: 1520, text: 'شكرًا لكم', size: 180, weight: '800', color: '#ffffff', font: AR },
    { t: 'text', x: 200, y: 660, w: 1520, text: 'أسئلتكم واستفساراتكم', size: 44, weight: '500', color: '#94a3b8', font: AR },
  ] } });
tpl({ slug: 'pres-team', name_ar: 'شريحة فريق العمل', name_en: 'Team slide', category: 'presentation', w: 1920, h: 1080,
  spec: { w: 1920, h: 1080, bg: '#ffffff', els: [
    { t: 'text', x: 160, y: 110, w: 1600, text: 'فريق العمل', size: 70, weight: '800', color: '#1b1830', align: 'right', font: AR },
    { t: 'rect', x: 160, y: 260, w: 1600, h: 4, fill: '#e6e3f0' },
    { t: 'circle', cx: 340, cy: 520, r: 110, fill: '#efeaff' },
    { t: 'text', x: 190, y: 660, w: 300, text: 'اسم الموظف', size: 40, weight: '700', color: '#1b1830', align: 'center', font: AR },
    { t: 'text', x: 190, y: 710, w: 300, text: 'المسمّى الوظيفي', size: 28, weight: '500', color: '#6c6883', align: 'center', font: AR },
    { t: 'circle', cx: 960, cy: 520, r: 110, fill: '#ffe9f0' },
    { t: 'text', x: 810, y: 660, w: 300, text: 'اسم الموظف', size: 40, weight: '700', color: '#1b1830', align: 'center', font: AR },
    { t: 'text', x: 810, y: 710, w: 300, text: 'المسمّى الوظيفي', size: 28, weight: '500', color: '#6c6883', align: 'center', font: AR },
    { t: 'circle', cx: 1580, cy: 520, r: 110, fill: '#e0f7ff' },
    { t: 'text', x: 1430, y: 660, w: 300, text: 'اسم الموظف', size: 40, weight: '700', color: '#1b1830', align: 'center', font: AR },
    { t: 'text', x: 1430, y: 710, w: 300, text: 'المسمّى الوظيفي', size: 28, weight: '500', color: '#6c6883', align: 'center', font: AR },
  ] } });
tpl({ slug: 'pres-agenda', name_ar: 'شريحة جدول الأعمال', name_en: 'Agenda slide', category: 'presentation', w: 1920, h: 1080,
  spec: { w: 1920, h: 1080, bg: '#ffffff', els: [
    { t: 'text', x: 160, y: 120, w: 1600, text: 'جدول الأعمال', size: 70, weight: '800', color: '#1b1830', align: 'right', font: AR },
    { t: 'rect', x: 160, y: 260, w: 1600, h: 4, fill: '#e6e3f0' },
    { t: 'text', x: 160, y: 340, w: 1600, text: '01', size: 56, weight: '800', color: '#7c5cff', font: 'Poppins' },
    { t: 'text', x: 320, y: 348, w: 1440, text: 'المقدّمة', size: 46, weight: '700', color: '#1b1830', align: 'right', font: AR },
    { t: 'text', x: 160, y: 500, w: 1600, text: '02', size: 56, weight: '800', color: '#7c5cff', font: 'Poppins' },
    { t: 'text', x: 320, y: 508, w: 1440, text: 'التحليل والنتائج', size: 46, weight: '700', color: '#1b1830', align: 'right', font: AR },
    { t: 'text', x: 160, y: 660, w: 1600, text: '03', size: 56, weight: '800', color: '#7c5cff', font: 'Poppins' },
    { t: 'text', x: 320, y: 668, w: 1440, text: 'الخطوات القادمة', size: 46, weight: '700', color: '#1b1830', align: 'right', font: AR },
  ] } });
tpl({ slug: 'pres-quote', name_ar: 'شريحة اقتباس', name_en: 'Quote slide', category: 'presentation', w: 1920, h: 1080,
  spec: { w: 1920, h: 1080, bg: '#7c5cff', els: [
    { t: 'text', x: 200, y: 220, w: 200, text: '"', size: 220, weight: '800', color: '#ffd23f', font: 'Poppins' },
    { t: 'text', x: 260, y: 420, w: 1400, text: 'التصميم الجيد بسيط،\nوواضح، ويُترجم إلى نتائج', size: 78, weight: '700', color: '#ffffff', align: 'right', lh: 1.25, font: AR },
    { t: 'text', x: 260, y: 780, w: 1400, text: '— اسم المتحدّث، المنصب', size: 38, weight: '500', color: '#e0d9ff', align: 'right', font: AR },
  ] } });
tpl({ slug: 'pres-pricing', name_ar: 'شريحة خطط الأسعار', name_en: 'Pricing plans slide', category: 'presentation', w: 1920, h: 1080,
  spec: { w: 1920, h: 1080, bg: '#ffffff', els: [
    { t: 'text', x: 160, y: 110, w: 1600, text: 'خطط الأسعار', size: 70, weight: '800', color: '#1b1830', align: 'right', font: AR },
    { t: 'rect', x: 160, y: 260, w: 1600, h: 4, fill: '#e6e3f0' },

    { t: 'rect', x: 160, y: 320, w: 500, h: 620, rx: 24, fill: '#f6f5fb', stroke: '#e6e3f0', sw: 2 },
    { t: 'text', x: 160, y: 380, w: 500, text: 'أساسية', size: 44, weight: '800', color: '#1b1830', align: 'center', font: AR },
    { t: 'text', x: 160, y: 470, w: 500, text: '99 ر.س', size: 68, weight: '800', color: '#1b1830', align: 'center', font: AR },
    { t: 'text', x: 160, y: 560, w: 500, text: '/شهريًا', size: 28, weight: '500', color: '#6c6883', align: 'center', font: AR },
    { t: 'rect', x: 210, y: 620, w: 400, h: 3, fill: '#e6e3f0' },
    { t: 'text', x: 210, y: 660, w: 400, text: '• ميزة أولى\n• ميزة ثانية\n• دعم عبر البريد', size: 30, weight: '500', color: '#33304a', align: 'right', lh: 1.9, font: AR },

    { t: 'rect', x: 710, y: 280, w: 500, h: 680, rx: 24, fill: '#7c5cff' },
    { t: 'rect', x: 860, y: 250, w: 200, h: 54, rx: 27, fill: '#ffd23f' },
    { t: 'text', x: 860, y: 267, w: 200, text: 'الأكثر طلبًا', size: 24, weight: '700', color: '#1b1830', align: 'center', font: AR },
    { t: 'text', x: 710, y: 360, w: 500, text: 'احترافية', size: 44, weight: '800', color: '#ffffff', align: 'center', font: AR },
    { t: 'text', x: 710, y: 450, w: 500, text: '199 ر.س', size: 68, weight: '800', color: '#ffffff', align: 'center', font: AR },
    { t: 'text', x: 710, y: 540, w: 500, text: '/شهريًا', size: 28, weight: '500', color: '#e0d9ff', align: 'center', font: AR },
    { t: 'rect', x: 760, y: 600, w: 400, h: 3, fill: '#9b85ff' },
    { t: 'text', x: 760, y: 640, w: 400, text: '• كل ميزات الباقة الأساسية\n• مستخدمون غير محدودين\n• دعم فوري على مدار الساعة\n• تقارير تفصيلية', size: 30, weight: '500', color: '#f3f0ff', align: 'right', lh: 1.7, font: AR },

    { t: 'rect', x: 1260, y: 320, w: 500, h: 620, rx: 24, fill: '#f6f5fb', stroke: '#e6e3f0', sw: 2 },
    { t: 'text', x: 1260, y: 380, w: 500, text: 'المؤسسات', size: 44, weight: '800', color: '#1b1830', align: 'center', font: AR },
    { t: 'text', x: 1260, y: 470, w: 500, text: 'اتصل بنا', size: 56, weight: '800', color: '#1b1830', align: 'center', font: AR },
    { t: 'text', x: 1260, y: 560, w: 500, text: 'حسب الاحتياج', size: 28, weight: '500', color: '#6c6883', align: 'center', font: AR },
    { t: 'rect', x: 1310, y: 620, w: 400, h: 3, fill: '#e6e3f0' },
    { t: 'text', x: 1310, y: 660, w: 400, text: '• حلول مخصّصة بالكامل\n• مدير حساب مخصّص\n• تكامل مع أنظمتكم\n• اتفاقية مستوى خدمة (SLA)', size: 30, weight: '500', color: '#33304a', align: 'right', lh: 1.7, font: AR },
  ] } });

/* -- business -- */
tpl({ slug: 'business-card-light', name_ar: 'بطاقة عمل فاتحة', name_en: 'Business card (light)', category: 'business', w: 1050, h: 600,
  spec: { w: 1050, h: 600, bg: '#ffffff', els: [
    { t: 'rect', x: 0, y: 0, w: 18, h: 600, fill: '#7c5cff' },
    { t: 'text', x: 90, y: 150, w: 870, text: 'الاسم الكامل', size: 66, weight: '800', color: '#1b1830', align: 'right', font: AR },
    { t: 'text', x: 90, y: 250, w: 870, text: 'المسمّى الوظيفي', size: 34, weight: '500', color: '#6c6883', align: 'right', font: AR },
    { t: 'text', x: 90, y: 440, w: 870, text: '05x xxx xxxx  ·  name@email.com', size: 30, weight: '500', color: '#33304a', align: 'right', font: AR },
  ] } });
tpl({ slug: 'price-list', name_ar: 'قائمة أسعار', name_en: 'Price list', category: 'business', w: 1080, h: 1350,
  spec: { w: 1080, h: 1350, bg: '#ffffff', els: [
    { t: 'rect', x: 0, y: 0, w: 1080, h: 260, fill: '#7c5cff' },
    { t: 'text', x: 90, y: 90, w: 900, text: 'قائمة الأسعار', size: 80, weight: '800', color: '#ffffff', align: 'right', font: AR },
    { t: 'text', x: 90, y: 360, w: 900, text: 'الباقة الأساسية ............ 199 ر.س\nالباقة المتقدّمة ........... 349 ر.س\nالباقة الاحترافية ......... 599 ر.س', size: 44, weight: '500', color: '#1b1830', align: 'right', lh: 2.2, font: AR },
  ] } });
tpl({ slug: 'invoice-header', name_ar: 'ترويسة فاتورة', name_en: 'Invoice header', category: 'business', w: 1240, h: 1754,
  spec: { w: 1240, h: 1754, bg: '#ffffff', els: [
    { t: 'text', x: 80, y: 80, w: 1080, text: 'فاتورة', size: 90, weight: '800', color: '#1b1830', align: 'right', font: AR },
    { t: 'text', x: 80, y: 220, w: 1080, text: 'رقم: 0001    التاريخ: __/__/____', size: 32, weight: '500', color: '#6c6883', align: 'right', font: AR },
    { t: 'rect', x: 80, y: 320, w: 1080, h: 3, fill: '#e6e3f0' },
    { t: 'rect', x: 80, y: 380, w: 1080, h: 70, fill: '#7c5cff' },
    { t: 'text', x: 110, y: 395, w: 1020, text: 'الوصف                              الكمية     السعر', size: 30, weight: '700', color: '#ffffff', align: 'right', font: AR },
  ] } });
tpl({ slug: 'email-signature', name_ar: 'توقيع بريد', name_en: 'Email signature', category: 'business', w: 800, h: 300,
  spec: { w: 800, h: 300, bg: '#ffffff', els: [
    { t: 'rect', x: 0, y: 0, w: 8, h: 300, fill: '#7c5cff' },
    { t: 'text', x: 50, y: 60, w: 700, text: 'الاسم الكامل', size: 44, weight: '800', color: '#1b1830', align: 'right', font: AR },
    { t: 'text', x: 50, y: 130, w: 700, text: 'المسمّى · اسم الشركة', size: 26, weight: '500', color: '#6c6883', align: 'right', font: AR },
    { t: 'text', x: 50, y: 190, w: 700, text: '05x xxx xxxx · name@company.com', size: 24, weight: '500', color: '#7c5cff', align: 'right', font: AR },
  ] } });
tpl({ slug: 'profile-cover', name_ar: 'غلاف ملف تعريفي', name_en: 'Company profile cover', category: 'business', w: 1240, h: 1754,
  spec: { w: 1240, h: 1754, bg: '#7c5cff', els: [
    { t: 'rect', x: 0, y: 1200, w: 1240, h: 554, fill: '#ffffff' },
    { t: 'circle', cx: 620, cy: 620, r: 260, fill: '#ffd23f' },
    { t: 'text', x: 120, y: 1300, w: 1000, text: 'الملف التعريفي', size: 110, weight: '800', color: '#1b1830', align: 'right', font: AR },
    { t: 'text', x: 120, y: 1480, w: 1000, text: 'اسم الشركة — 2026', size: 40, weight: '500', color: '#6c6883', align: 'right', font: AR },
  ] } });

/* -- marketing -- */
tpl({ slug: 'coupon', name_ar: 'كوبون خصم', name_en: 'Discount coupon', category: 'marketing', w: 1080, h: 540,
  spec: { w: 1080, h: 540, bg: '#ff5c8a', els: [
    { t: 'rect', x: 40, y: 40, w: 1000, h: 460, rx: 24, fill: '#ffffff' },
    { t: 'text', x: 90, y: 120, w: 900, text: 'خصم 25%', size: 120, weight: '800', color: '#ff5c8a', font: AR },
    { t: 'text', x: 90, y: 300, w: 900, text: 'استخدم الكود عند الدفع', size: 36, weight: '500', color: '#6c6883', font: AR },
    { t: 'rect', x: 90, y: 370, w: 900, h: 90, rx: 12, fill: '#1b1830' },
    { t: 'text', x: 90, y: 388, w: 900, text: 'SAVE25', size: 44, weight: '800', color: '#ffffff', font: 'Poppins', cs: 200 },
  ] } });
tpl({ slug: 'webinar-promo', name_ar: 'إعلان ويبينار', name_en: 'Webinar promo', category: 'marketing', w: 1200, h: 1200,
  spec: { w: 1200, h: 1200, bg: '#0f172a', els: [
    { t: 'text', x: 100, y: 160, w: 1000, text: 'ورشة مجانية', size: 48, weight: '700', color: '#4cc9f0', align: 'right', font: AR },
    { t: 'text', x: 100, y: 280, w: 1000, text: 'كيف تبني هويتك\nالبصرية بنفسك', size: 100, weight: '800', color: '#ffffff', align: 'right', lh: 1.15, font: AR },
    { t: 'rect', x: 100, y: 760, w: 1000, h: 4, fill: '#334155' },
    { t: 'text', x: 100, y: 830, w: 1000, text: 'الأربعاء · 8 مساءً · عبر زوم', size: 40, weight: '600', color: '#94a3b8', align: 'right', font: AR },
    { t: 'rect', x: 380, y: 960, w: 440, h: 120, rx: 60, fill: '#4cc9f0' },
    { t: 'text', x: 380, y: 992, w: 440, text: 'سجّل الآن', size: 46, weight: '800', color: '#0f172a', font: AR },
  ] } });
tpl({ slug: 'product-launch', name_ar: 'إطلاق منتج', name_en: 'Product launch', category: 'marketing', w: 1080, h: 1080,
  spec: { w: 1080, h: 1080, bg: '#ffffff', els: [
    { t: 'circle', cx: 540, cy: 540, r: 380, fill: '#efeaff' },
    { t: 'text', x: 90, y: 150, w: 900, text: 'جديد', size: 52, weight: '800', color: '#7c5cff', font: AR },
    { t: 'text', x: 90, y: 760, w: 900, text: 'اسم المنتج', size: 96, weight: '800', color: '#1b1830', font: AR },
    { t: 'text', x: 90, y: 910, w: 900, text: 'متوفّر الآن — اطلبه عبر المتجر', size: 38, weight: '500', color: '#6c6883', font: AR },
  ] } });
tpl({ slug: 'hiring-post', name_ar: 'إعلان توظيف', name_en: 'We are hiring', category: 'marketing', w: 1080, h: 1080,
  spec: { w: 1080, h: 1080, bg: '#22a06b', els: [
    { t: 'text', x: 90, y: 200, w: 900, text: 'نبحث عن', size: 60, weight: '600', color: '#c9f2df', font: AR },
    { t: 'text', x: 90, y: 320, w: 900, text: 'مصمّم جرافيك', size: 120, weight: '800', color: '#ffffff', font: AR },
    { t: 'text', x: 90, y: 560, w: 900, text: '• خبرة سنتين فأكثر\n• إتقان أدوات التصميم\n• دوام كامل — عن بُعد', size: 40, weight: '500', color: '#eafaf2', lh: 1.9, align: 'right', font: AR },
    { t: 'text', x: 90, y: 900, w: 900, text: 'أرسل أعمالك: jobs@company.com', size: 34, weight: '700', color: '#ffffff', font: AR },
  ] } });
tpl({ slug: 'realestate-listing', name_ar: 'إعلان عقار', name_en: 'Real estate listing', category: 'marketing', w: 1080, h: 1350,
  spec: { w: 1080, h: 1350, bg: '#ffffff', els: [
    { t: 'rect', x: 0, y: 0, w: 1080, h: 760, fill: '#e0e7ff' },
    { t: 'text', x: 60, y: 300, w: 960, text: '🏠', size: 200, weight: '400', color: '#7c5cff', font: 'Poppins' },
    { t: 'text', x: 60, y: 830, w: 960, text: 'شقة للإيجار — حي الياسمين', size: 56, weight: '800', color: '#1b1830', align: 'right', font: AR },
    { t: 'text', x: 60, y: 930, w: 960, text: '٣ غرف · ٢ حمام · ١٢٠م²', size: 36, weight: '500', color: '#6c6883', align: 'right', font: AR },
    { t: 'text', x: 60, y: 1050, w: 960, text: '٣٢,٠٠٠ ر.س / سنويًا', size: 56, weight: '800', color: '#7c5cff', align: 'right', font: AR },
    { t: 'text', x: 60, y: 1180, w: 960, text: 'للتواصل: 05x xxx xxxx', size: 34, weight: '600', color: '#33304a', align: 'right', font: AR },
  ] } });
tpl({ slug: 'open-now', name_ar: 'لافتة مفتوح', name_en: 'Open now sign', category: 'marketing', w: 1080, h: 1080,
  spec: { w: 1080, h: 1080, bg: '#1b1830', els: [
    { t: 'circle', cx: 540, cy: 540, r: 360, fill: 'transparent', stroke: '#22a06b', sw: 20 },
    { t: 'text', x: 140, y: 400, w: 800, text: 'مفتوح\nالآن', size: 180, weight: '800', color: '#ffffff', lh: 1.05, font: AR },
    { t: 'text', x: 140, y: 780, w: 800, text: 'يوميًا 9 ص – 11 م', size: 40, weight: '600', color: '#22a06b', font: AR },
  ] } });

/* -- personal -- */
tpl({ slug: 'birthday-card', name_ar: 'بطاقة عيد ميلاد', name_en: 'Birthday card', category: 'personal', w: 1080, h: 1350,
  spec: { w: 1080, h: 1350, bg: '#ffd23f', els: [
    { t: 'text', x: 90, y: 300, w: 900, text: 'كل عام\nوأنت بخير', size: 150, weight: '800', color: '#1b1830', lh: 1.05, font: 'Lalezar' },
    { t: 'text', x: 90, y: 800, w: 900, text: '🎉🎂🎈', size: 120, weight: '400', color: '#1b1830', font: 'Poppins' },
    { t: 'text', x: 90, y: 1050, w: 900, text: 'من كل القلب', size: 44, weight: '500', color: '#7a5c00', font: AR },
  ] } });
tpl({ slug: 'save-the-date', name_ar: 'احفظ الموعد', name_en: 'Save the date', category: 'personal', w: 1080, h: 1350,
  spec: { w: 1080, h: 1350, bg: '#0f172a', els: [
    { t: 'text', x: 90, y: 300, w: 900, text: 'احفظوا الموعد', size: 44, weight: '500', color: '#94a3b8', font: AR },
    { t: 'text', x: 90, y: 400, w: 900, text: '2026 / 06 / 20', size: 140, weight: '800', color: '#ffffff', font: 'Poppins' },
    { t: 'rect', x: 440, y: 640, w: 200, h: 4, fill: '#7c5cff' },
    { t: 'text', x: 90, y: 720, w: 900, text: 'تفاصيل الدعوة تصلكم قريبًا', size: 40, weight: '500', color: '#a9a4c6', font: AR },
  ] } });
tpl({ slug: 'thank-you-card', name_ar: 'بطاقة شكر', name_en: 'Thank you card', category: 'personal', w: 1080, h: 1080,
  spec: { w: 1080, h: 1080, bg: '#fce7f3', els: [
    { t: 'text', x: 90, y: 380, w: 900, text: 'شكرًا لك', size: 170, weight: '800', color: '#9d174d', font: 'Lalezar' },
    { t: 'text', x: 90, y: 680, w: 900, text: 'ممتنّون لوجودك ودعمك الدائم', size: 42, weight: '500', color: '#7a2748', font: AR },
  ] } });
tpl({ slug: 'weekly-planner', name_ar: 'مخطط أسبوعي', name_en: 'Weekly planner', category: 'personal', w: 1080, h: 1350,
  spec: { w: 1080, h: 1350, bg: '#ffffff', els: [
    { t: 'rect', x: 0, y: 0, w: 1080, h: 180, fill: '#7c5cff' },
    { t: 'text', x: 90, y: 55, w: 900, text: 'خطة الأسبوع', size: 64, weight: '800', color: '#ffffff', align: 'right', font: AR },
    { t: 'text', x: 90, y: 280, w: 900, text: 'الأحد\nالاثنين\nالثلاثاء\nالأربعاء\nالخميس', size: 46, weight: '700', color: '#1b1830', align: 'right', lh: 2.4, font: AR },
    { t: 'rect', x: 90, y: 300, w: 900, h: 3, fill: '#e6e3f0' },
    { t: 'rect', x: 90, y: 430, w: 900, h: 3, fill: '#e6e3f0' },
    { t: 'rect', x: 90, y: 560, w: 900, h: 3, fill: '#e6e3f0' },
    { t: 'rect', x: 90, y: 690, w: 900, h: 3, fill: '#e6e3f0' },
  ] } });
tpl({ slug: 'recipe-card', name_ar: 'بطاقة وصفة', name_en: 'Recipe card', category: 'personal', w: 1080, h: 1350,
  spec: { w: 1080, h: 1350, bg: '#ffffff', els: [
    { t: 'rect', x: 0, y: 0, w: 1080, h: 520, fill: '#22a06b' },
    { t: 'text', x: 60, y: 180, w: 960, text: 'سلطة الكينوا', size: 90, weight: '800', color: '#ffffff', align: 'right', font: AR },
    { t: 'text', x: 60, y: 320, w: 960, text: '٤ حصص · ١٥ دقيقة', size: 34, weight: '500', color: '#d7f5e6', align: 'right', font: AR },
    { t: 'text', x: 60, y: 600, w: 960, text: 'المكوّنات:', size: 44, weight: '800', color: '#22a06b', align: 'right', font: AR },
    { t: 'text', x: 60, y: 700, w: 960, text: '• كوب كينوا مطبوخة\n• خيار وطماطم مكعبات\n• بقدونس ونعناع\n• عصير ليمون وزيت زيتون', size: 36, weight: '500', color: '#33304a', align: 'right', lh: 1.9, font: AR },
  ] } });
tpl({ slug: 'travel-postcard', name_ar: 'بطاقة سفر', name_en: 'Travel postcard', category: 'personal', w: 1350, h: 1080,
  spec: { w: 1350, h: 1080, bg: '#4cc9f0', els: [
    { t: 'rect', x: 60, y: 60, w: 1230, h: 960, fill: 'transparent', stroke: '#ffffff', sw: 8 },
    { t: 'text', x: 120, y: 380, w: 1110, text: 'تحياتي من\nالطائف', size: 150, weight: '800', color: '#ffffff', lh: 1.05, font: 'Lalezar' },
    { t: 'text', x: 120, y: 800, w: 1110, text: 'أجواء رائعة ومناظر خلابة 🌿', size: 42, weight: '500', color: '#eaf9ff', font: AR },
  ] } });
tpl({ slug: 'gym-schedule', name_ar: 'جدول تمارين', name_en: 'Workout schedule', category: 'personal', w: 1080, h: 1350,
  spec: { w: 1080, h: 1350, bg: '#0f172a', els: [
    { t: 'text', x: 90, y: 110, w: 900, text: 'جدول التمارين', size: 80, weight: '800', color: '#ffd23f', align: 'right', font: AR },
    { t: 'rect', x: 90, y: 260, w: 900, h: 4, fill: '#334155' },
    { t: 'text', x: 90, y: 340, w: 900, text: 'السبت — صدر وترايسبس\nالاثنين — ظهر وبايسبس\nالأربعاء — أرجل وكتف\nالخميس — كارديو', size: 44, weight: '600', color: '#e2e8f0', align: 'right', lh: 2.1, font: AR },
  ] } });

/* ---- write ---------------------------------------------------------------- */
const count = db.prepare('SELECT COUNT(*) c FROM templates').get().c;
if (count > 0 && !FORCE) {
  console.log(`templates table already has ${count} rows — nothing to do (use --force to reseed).`);
  process.exit(0);
}
if (FORCE) db.prepare('DELETE FROM templates').run();

const insert = db.prepare(
  `INSERT INTO templates (slug, name_ar, name_en, category, width, height, thumbnail, data_json, sort_order, active)
   VALUES (@slug, @name_ar, @name_en, @category, @width, @height, @thumbnail, @data_json, @sort_order, 1)
   ON CONFLICT(slug) DO UPDATE SET
     name_ar=excluded.name_ar, name_en=excluded.name_en, category=excluded.category,
     width=excluded.width, height=excluded.height, thumbnail=excluded.thumbnail,
     data_json=excluded.data_json, sort_order=excluded.sort_order, active=1`
);

const tx = db.transaction((rows) => {
  for (const r of rows) {
    insert.run({
      slug: r.slug,
      name_ar: r.name_ar,
      name_en: r.name_en,
      category: r.category,
      width: r.w,
      height: r.h,
      thumbnail: toSvg(r.spec),
      data_json: toFabric(r.spec),
      sort_order: r.sort_order,
    });
  }
});
tx(T);

console.log(`Seeded ${T.length} templates.`);
process.exit(0);
