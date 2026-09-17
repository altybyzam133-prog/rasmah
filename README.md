# رسمة / Rasmah

منصة تصميم جرافيك وصناعة محتوى مرئي شبيهة بـ Canva — عربية/إنجليزية بالكامل مع دعم RTL.
محرّر سحب وإفلات على canvas، قوالب جاهزة، رفع صور، طبقات، تراجع/إعادة، وتصدير PNG / JPG / PDF.

A Canva‑like graphic design platform — fully bilingual (Arabic/English) with RTL support.

## الميزات / Features

- محرّر سحب وإفلات (Fabric.js) — طبقات، تراجع/إعادة، صفحات متعددة، تصدير PNG/JPG/PDF/SVG/GIF/ZIP
- قوالب جاهزة + قوالب شخصية + **معرض تصاميم المجتمع** (المستخدمون ينشرون تصاميمهم للآخرين)
- عناصر/صور مخزّنة + بحث صور خارجي (Pexels) + توليد صور بالذكاء الاصطناعي (Pollinations)
- إزالة خلفية، تفكيك عناصر الصورة، تحديد حر، و**Magic Grab** (تحديد ذكي شبيه بكانفا عبر نموذج تجزئة محلي بالمتصفح)
- Brand Kit، خطوط مخصّصة، سحر الكتابة (نصوص بالذكاء الاصطناعي)، Bulk Create (دمج بريدي)، وضع العرض التقديمي
- سجل نسخ، لوحة أدمن، حسابات + إعادة تعيين كلمة المرور، PWA (يعمل دون إنترنت جزئيًا)
- محرّك اختبار شامل بدون متصفح (`npm run smoke`)

A drag‑and‑drop canvas editor (Fabric.js) with layers, undo/redo, multi‑page designs, and PNG/JPG/PDF/SVG/GIF/ZIP export;
ready‑made + personal + **community‑published templates**; stock photo search and AI image generation; background removal,
element decomposition, freehand select, and a Canva‑like **Magic Grab** (in‑browser segmentation model); brand kits,
custom fonts, AI copywriting, bulk create (mail‑merge), presentation mode, version history, an admin panel, accounts
with password reset, and a partial offline PWA — all verified by a from‑scratch, browser‑free smoke test suite.

> **جودة معروفة / Known caveat**: أداة *Magic Grab* اعتمدت على تحقق برمجي (اختبار Node على النموذج الحقيقي) وليس
> اختبارًا بصريًا حقيقيًا بمتصفح — جرّبها على صورك قبل الاعتماد عليها بالكامل.
> *Magic Grab* was verified programmatically (a real Node.js forward pass against the actual model), not yet by eye
> in a real browser — try it on your own photos before relying on it fully.

---

## التشغيل السريع / Quick start

الطريقة الأسهل: **انقر مرّتين على `ابدأ-الاستوديو.cmd`** — يثبّت الحزم، ينزّل مكتبات المحرّر، يزرع القوالب، ثم يشغّل الموقع ويفتح المتصفح.

يدويًا / manually:

```bash
npm install
npm run fetch-vendor    # ينزّل Fabric.js + jsPDF + الخطوط للاستخدام دون إنترنت (مرة واحدة)
npm run seed            # يزرع قوالب جاهزة (idempotent)
npm start               # http://127.0.0.1:3000
```

يتطلّب Node.js 18 أو أحدث (مُختبَر على v22). / Requires Node.js 18+ (tested on v22).

> `npm run fetch-vendor` اختياري لكنه موصى به: بدونه يحمّل المحرّر Fabric.js و jsPDF من CDN
> والخطوط من Google Fonts وقت التشغيل. مع تشغيله يعمل كل شيء دون إنترنت.

---

## البيئة / Environment (`.env`)

انسخ `.env.example` إلى `.env` وعدّل:

| المتغير | الافتراضي | الوصف |
|---|---|---|
| `PORT` | `3000` | منفذ الخادم |
| `HOST` | `127.0.0.1` | عنوان الاستماع |
| `SESSION_SECRET` | — | **غيّره** لقيمة عشوائية طويلة قبل النشر |
| `BRAND_NAME_AR` / `BRAND_NAME_EN` | رسمة / Rasmah | الاسم الظاهر في الواجهة |
| `MAX_UPLOAD_MB` | `8` | أقصى حجم لصورة مرفوعة |
| `NODE_ENV` | `development` | `production` يفعّل الكوكيز الآمنة |

---

## البنية / Structure

```
server.js              نقطة الدخول + الميدل‑وير
seed.js                زرع القوالب (spec → Fabric JSON + SVG thumbnail)
smoke-test.js          فحص شامل بلا متصفح (npm run smoke)
lib/    config db i18n session-store csrf auth
routes/ pages auth designs uploads templates
locales/ ar.json en.json
views/  EJS (partials + per-page + editor)
public/
  css/  style.css  editor.css
  js/   main dashboard  editor/{core,objects,props,io}.js
  vendor/ fabric.min.js jspdf.umd.min.js   (من fetch-vendor)
  fonts/  *.woff2 + fonts.css               (من fetch-vendor)
  uploads/                                  (صور المستخدمين)
data/app.db            SQLite (يُنشأ وقت التشغيل)
```

## الاختبار / Testing

```bash
npm run smoke
```

يشغّل خادمًا على قاعدة بيانات معزولة، يفحص كل المسارات و APIs (تسجيل، تصاميم، رفع،
قوالب، use‑template)، ثم يحمّل صفحة المحرّر داخل jsdom للتأكد من عدم وجود أخطاء في سكربتات المحرّر.

## حدود النسخة الحالية / Current limitations

- بدون تعاون لحظي (real‑time collaboration) أو تحرير فيديو — المشروع لسا فردي/قليل المستخدمين.
- تعبئة الخلفية بعد "Magic Grab" خوارزمية كلاسيكية (Telea inpainting)، مو ذكاء اصطناعي توليدي — لا يوجد بديل مجاني حقيقي.
- بدون رقابة/مراجعة على تصاميم المجتمع المنشورة (نشر فوري) — لا توجد أداة أدمن لإزالة محتوى غير لائق بعد.
- SMTP غير مُعدّ افتراضيًا: رموز إعادة تعيين كلمة المرور تُكتب بالسجلّ (`logs/server.log`) بدل إرسالها بريديًا حتى تضبط `SMTP_*` في `.env`.
- No real‑time collaboration or video editing — still a single/low‑traffic‑user project.
- Magic Grab's fill is classical (Telea) inpainting, not generative AI — no free generative alternative exists.
- Community‑published designs have no moderation/review step (instant publish) and no admin removal tool yet.
- SMTP isn't configured out of the box: password‑reset codes are logged instead of emailed until `SMTP_*` is set in `.env`.

## اختصارات المحرّر / Editor shortcuts

| | |
|---|---|
| حذف | `Delete` / `Backspace` |
| تراجع / إعادة | `Ctrl+Z` / `Ctrl+Shift+Z` أو `Ctrl+Y` |
| حفظ | `Ctrl+S` (وحفظ تلقائي) |
| تكرار | `Ctrl+D` — أو **`Alt` + سحب** العنصر |
| نسخ / لصق | `Ctrl+C` / `Ctrl+V` |
| تحديد الكل | `Ctrl+A` |
| تجميع / فك | `Ctrl+G` / `Ctrl+Shift+G` |
| تحريك دقيق | الأسهم (‏`Shift` = 10px) |
| تكبير / تصغير / 100% / ملء | `+` / `-` / `0` / `F` |
| تحريك العرض | مسافة + سحب، أو `Ctrl` + عجلة الفأرة للتكبير |

## الرخصة / License

MIT — انظر [LICENSE](LICENSE). / MIT — see [LICENSE](LICENSE).
