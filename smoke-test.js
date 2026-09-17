'use strict';

/* Headless smoke test for رسمة / Rasmah.
   Boots the server on an isolated DB + port, exercises the HTTP surface and
   the design/upload/template APIs, then loads the editor page in jsdom (with a
   stubbed canvas) to catch client wiring errors. Run: npm run smoke */

const { spawnSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

const PORT = 3931;
const BASE = `http://127.0.0.1:${PORT}`;
const DB_FILE = 'smoke.db';
const ENV = {
  ...process.env, PORT: String(PORT), HOST: '127.0.0.1', NODE_ENV: 'test', SESSION_SECRET: 'smoke-secret', DB_FILE,
  // force the AI-unavailable and stock-unavailable paths regardless of
  // whatever's in the ambient shell env or the real .env (which now has a
  // real PEXELS_API_KEY for production) — the "not configured" tests below
  // need this deterministically blank.
  GEMINI_API_KEY: '',
  PEXELS_API_KEY: '',
};

let pass = 0;
let fail = 0;
const failures = [];
function ok(name) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
function bad(name, err) { fail++; failures.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${err ? ' — ' + err : ''}`); }
function assert(cond, name, err) { cond ? ok(name) : bad(name, err); }

/* ---- tiny fetch with cookie jar ---------------------------------------- */
const jar = {};
function cookieHeader() {
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
}
function req(method, url, { body, headers = {}, json } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = json !== undefined ? JSON.stringify(json) : body;
    const h = { ...headers };
    if (json !== undefined) h['Content-Type'] = 'application/json';
    if (data) h['Content-Length'] = Buffer.byteLength(data);
    if (cookieHeader()) h['Cookie'] = cookieHeader();
    const r = http.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method, headers: h }, (res) => {
      let chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        (res.headers['set-cookie'] || []).forEach((c) => {
          const [kv] = c.split(';');
          const i = kv.indexOf('=');
          jar[kv.slice(0, i)] = kv.slice(i + 1);
        });
        resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') });
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}
const csrfFrom = (html) => (html.match(/csrf-token" content="([^"]+)"/) || [])[1];

async function waitForServer(tries = 50) {
  for (let i = 0; i < tries; i++) {
    try { await req('GET', BASE + '/'); return true; } catch { await new Promise((r) => setTimeout(r, 200)); }
  }
  return false;
}

/* ---- main ------------------------------------------------------------------ */
(async () => {
  // clean isolated DB + seed
  for (const f of [DB_FILE, DB_FILE + '-wal', DB_FILE + '-shm']) {
    try { fs.unlinkSync(path.join(__dirname, 'data', f)); } catch {}
  }
  const seed = spawnSync('node', ['seed.js'], { env: ENV, cwd: __dirname, encoding: 'utf8' });
  assert(/Seeded \d+ templates/.test(seed.stdout || ''), 'seed.js runs and inserts templates', (seed.stderr || '').slice(0, 200));

  const srv = spawn('node', ['server.js'], { env: ENV, cwd: __dirname, stdio: ['ignore', 'pipe', 'pipe'] });
  let srvErr = '';
  let srvOut = '';
  srv.stderr.on('data', (d) => (srvErr += d));
  srv.stdout.on('data', (d) => (srvOut += d));

  try {
    assert(await waitForServer(), 'server boots and answers');

    // ---- public pages ----
    let r = await req('GET', BASE + '/');
    assert(r.status === 200 && /Rasmah|رسمة/.test(r.body), 'GET / (landing) 200');
    assert(/tpl-mini/.test(r.body), 'landing shows template strip');

    r = await req('GET', BASE + '/templates');
    assert(r.status === 200 && /tpl-card/.test(r.body), 'GET /templates gallery 200');
    r = await req('GET', BASE + '/templates?category=social');
    assert(r.status === 200, 'GET /templates?category=social 200');

    r = await req('GET', BASE + '/login');
    assert(r.status === 200, 'GET /login 200');
    r = await req('GET', BASE + '/register');
    const regCsrf = csrfFrom(r.body);
    assert(r.status === 200 && !!regCsrf, 'GET /register 200 + csrf token present');

    r = await req('GET', BASE + '/nope-nope');
    assert(r.status === 404, 'unknown route -> 404');

    // ---- PWA: manifest + service worker + offline fallback ----
    r = await req('GET', BASE + '/manifest.webmanifest');
    let manifest = null;
    try { manifest = JSON.parse(r.body); } catch {}
    assert(r.status === 200 && /manifest\+json/.test(r.headers['content-type'] || ''), 'GET /manifest.webmanifest 200 + correct content-type');
    assert(!!manifest && Array.isArray(manifest.icons) && manifest.icons.length === 2, 'manifest lists both icon sizes', JSON.stringify(manifest));
    assert(!!manifest && manifest.start_url === '/dashboard' && manifest.display === 'standalone', 'manifest has start_url + standalone display');

    r = await req('GET', BASE + '/sw.js');
    assert(r.status === 200 && /javascript/.test(r.headers['content-type'] || ''), 'GET /sw.js 200 + js content-type');
    assert(r.headers['service-worker-allowed'] === '/', 'GET /sw.js sets Service-Worker-Allowed: / (so its scope covers the whole site, not just its own path)');
    assert(/OFFLINE_URL/.test(r.body) && /addEventListener\('fetch'/.test(r.body), 'sw.js has the expected fetch handler');

    r = await req('GET', BASE + '/offline');
    assert(r.status === 200, 'GET /offline (cached fallback page) 200');

    r = await req('GET', BASE + '/dashboard');
    assert(r.status === 302 && /\/login/.test(r.headers.location || ''), 'GET /dashboard unauth -> 302 login');

    // ---- static assets ----
    for (const [p, name] of [
      ['/static/css/style.css', 'style.css'],
      ['/static/css/editor.css', 'editor.css'],
      ['/static/js/editor/core.js', 'editor/core.js'],
      ['/static/vendor/fabric.min.js', 'vendor/fabric.min.js'],
      ['/static/vendor/mediapipe/vision_bundle.mjs', 'vendor/mediapipe/vision_bundle.mjs'],
      ['/static/vendor/mediapipe/vision_wasm_internal.wasm', 'vendor/mediapipe/vision_wasm_internal.wasm'],
      ['/static/vendor/mediapipe/selfie_segmenter.tflite', 'vendor/mediapipe/selfie_segmenter.tflite'],
      ['/static/fonts/fonts.css', 'fonts.css'],
      ['/static/img/logo.svg', 'logo.svg'],
      ['/static/img/icon-192.png', 'icon-192.png'],
      ['/static/img/icon-512.png', 'icon-512.png'],
    ]) {
      const s = await req('GET', BASE + p);
      assert(s.status === 200, `static ${name} 200`);
    }

    // ---- CSRF rejection ----
    r = await req('POST', BASE + '/register', { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'name=x&email=x@y.com&password=abcdefgh&_csrf=wrong' });
    assert(r.status === 403, 'POST /register with bad csrf -> 403');

    // ---- register ----
    const form = (obj) => Object.entries(obj).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
    const smokeEmail = `smoke${Date.now()}@test.dev`;
    r = await req('POST', BASE + '/register', {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form({ _csrf: regCsrf, name: 'Smoke User', email: smokeEmail, password: 'smoke-pass-123', next: '/dashboard' }),
    });
    assert(r.status === 302 && /\/dashboard/.test(r.headers.location || ''), 'POST /register -> 302 dashboard');

    r = await req('GET', BASE + '/dashboard');
    const dashCsrf = csrfFrom(r.body);
    assert(r.status === 200 && !!dashCsrf, 'GET /dashboard authed 200');
    assert(/id="fromPhotoDrop"/.test(r.body) && /id="fromPhotoInput"/.test(r.body), '"start from a photo" control present on dashboard');
    assert(/id="ndStepStart"/.test(r.body) && /id="ndStartBlank"/.test(r.body) && /id="ndStartPhotoInput"/.test(r.body),
      'new-design modal has a blank-vs-photo step after a size is picked');
    assert(/href="\/templates"/.test(r.body), 'dashboard links to "browse ready-made designs" (/templates) as a separate entry point');

    // ---- forgot / reset password (no SMTP configured in this env, so the
    // code is only logged to the child process's stdout — capture it from there) ----
    r = await req('GET', BASE + '/forgot-password');
    assert(r.status === 200 && /name="email"/.test(r.body), 'GET /forgot-password 200');

    // an unknown email must get the exact same response as a real one (no user enumeration)
    let outMark = srvOut.length;
    r = await req('POST', BASE + '/forgot-password', {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form({ _csrf: dashCsrf, email: 'no-such-user@test.dev' }),
    });
    assert(r.status === 200 && /name="code"/.test(r.body), 'POST /forgot-password (unknown email) still shows the code-entry step');
    await new Promise((res) => setTimeout(res, 150));
    assert(!/\[mail\]/.test(srvOut.slice(outMark)), 'POST /forgot-password (unknown email) sends no mail');

    outMark = srvOut.length;
    r = await req('POST', BASE + '/forgot-password', {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form({ _csrf: dashCsrf, email: smokeEmail }),
    });
    assert(r.status === 200 && /name="code"/.test(r.body), 'POST /forgot-password (real email) shows the code-entry step');
    await new Promise((res) => setTimeout(res, 150));
    const mailChunk = srvOut.slice(outMark);
    assert(/\[mail\]/.test(mailChunk), 'POST /forgot-password (real email) logs the fallback "email" (no SMTP configured)');
    // anchored on the ": " right before the code — a plain \d{6} scan would
    // also match inside the smoke test's own smoke<Date.now()>@test.dev address
    const code = (mailChunk.match(/:\s*(\d{6})(?!\d)/) || [])[1];
    assert(!!code, 'a 6-digit reset code was captured from the logged mail', mailChunk.slice(0, 200));

    r = await req('POST', BASE + '/reset-password', {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form({ _csrf: dashCsrf, email: smokeEmail, code: '000000', password: 'new-pass-1234', password2: 'new-pass-1234' }),
    });
    assert(r.status === 400 && /name="code"/.test(r.body), 'POST /reset-password with a wrong code -> 400, stays on the code step');

    r = await req('POST', BASE + '/reset-password', {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form({ _csrf: dashCsrf, email: smokeEmail, code, password: 'new-pass-1234', password2: 'different-1234' }),
    });
    assert(r.status === 400, 'POST /reset-password with mismatched passwords -> 400');

    r = await req('POST', BASE + '/reset-password', {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form({ _csrf: dashCsrf, email: smokeEmail, code, password: 'new-pass-1234', password2: 'new-pass-1234' }),
    });
    assert(r.status === 302 && /\/login/.test(r.headers.location || ''), 'POST /reset-password with the right code -> 302 /login');

    r = await req('POST', BASE + '/login', {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form({ _csrf: dashCsrf, email: smokeEmail, password: 'smoke-pass-123', next: '/dashboard' }),
    });
    assert(r.status === 401, 'old password no longer works after a reset');

    r = await req('POST', BASE + '/login', {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form({ _csrf: dashCsrf, email: smokeEmail, password: 'new-pass-1234', next: '/dashboard' }),
    });
    assert(r.status === 302 && /\/dashboard/.test(r.headers.location || ''), 'new password works after a reset');

    // ---- designs API ----
    r = await req('POST', BASE + '/api/designs', { headers: { 'x-csrf-token': dashCsrf }, json: { width: 1080, height: 1350 } });
    const designId = JSON.parse(r.body).id;
    assert(r.status === 200 && designId > 0, 'POST /api/designs creates a design');

    r = await req('GET', BASE + `/api/designs/${designId}`, { headers: { 'x-csrf-token': dashCsrf } });
    const dj = JSON.parse(r.body).design;
    assert(r.status === 200 && dj.width === 1080 && dj.height === 1350, 'GET /api/designs/:id returns it');
    assert(dj.folder === '', 'a new design starts with no folder');

    // ---- folders (metadata-only PUT, doesn't touch data_json/thumbnail) ----
    r = await req('PUT', BASE + `/api/designs/${designId}`, { headers: { 'x-csrf-token': dashCsrf }, json: { folder: 'Client Work' } });
    assert(r.status === 200 && JSON.parse(r.body).ok, 'PUT /api/designs/:id with only folder -> 200');
    r = await req('GET', BASE + `/api/designs/${designId}`, { headers: { 'x-csrf-token': dashCsrf } });
    assert(JSON.parse(r.body).design.folder === 'Client Work', 'folder persists after a metadata-only save');

    r = await req('GET', BASE + '/dashboard');
    assert(/data-folder="Client Work"/.test(r.body), 'dashboard card carries the folder in a data attribute');
    assert(/dash-folder-chip"[^>]*data-folder="Client Work"/.test(r.body) || /data-folder="Client Work">Client Work</.test(r.body),
      'dashboard renders a filter chip for the folder');
    assert(/design-folder-badge/.test(r.body), 'dashboard shows a folder badge on the card');

    const fakeCanvasJson = JSON.stringify({ version: '5.3.0', objects: [{ type: 'rect', left: 0, top: 0, width: 1080, height: 1350, fill: '#fff', name: '__artboard' }, { type: 'textbox', text: 'hi', left: 100, top: 100, width: 300, fontSize: 40 }], background: '' });
    r = await req('PUT', BASE + `/api/designs/${designId}`, { headers: { 'x-csrf-token': dashCsrf }, json: { data_json: fakeCanvasJson, thumbnail: 'data:image/jpeg;base64,AAAA', title: 'Saved Smoke' } });
    assert(r.status === 200 && JSON.parse(r.body).ok, 'PUT /api/designs/:id saves');

    r = await req('GET', BASE + `/api/designs/${designId}`, { headers: { 'x-csrf-token': dashCsrf } });
    assert(JSON.parse(r.body).design.data_json === fakeCanvasJson, 'saved data_json round-trips');
    assert(JSON.parse(r.body).design.title === 'Saved Smoke', 'saved title round-trips');

    r = await req('GET', BASE + '/api/designs', { headers: { 'x-csrf-token': dashCsrf } });
    assert(r.status === 200 && JSON.parse(r.body).designs.length >= 1, 'GET /api/designs lists designs');

    r = await req('POST', BASE + `/api/designs/${designId}/duplicate`, { headers: { 'x-csrf-token': dashCsrf } });
    const dupId = JSON.parse(r.body).id;
    assert(r.status === 200 && dupId && dupId !== designId, 'POST /api/designs/:id/duplicate');

    r = await req('GET', BASE + `/api/designs/${dupId}`, { headers: { 'x-csrf-token': dashCsrf } });
    assert(JSON.parse(r.body).design.folder === 'Client Work', 'a duplicate inherits the original design\'s folder');

    r = await req('DELETE', BASE + `/api/designs/${dupId}`, { headers: { 'x-csrf-token': dashCsrf } });
    assert(r.status === 200, 'DELETE /api/designs/:id');

    // ---- multi-page save round-trip ----
    const page1Json = { version: '5.3.0', objects: [{ type: 'rect', left: 0, top: 0, width: 1080, height: 1350, fill: '#fff', name: '__artboard' }], background: '' };
    const page2Json = { version: '5.3.0', objects: [{ type: 'rect', left: 0, top: 0, width: 1080, height: 1920, fill: '#eee', name: '__artboard' }], background: '' };
    const v2Blob = JSON.stringify({ version: 2, pages: [
      { width: 1080, height: 1350, json: page1Json },
      { width: 1080, height: 1920, json: page2Json },
    ] });
    r = await req('PUT', BASE + `/api/designs/${designId}`, { headers: { 'x-csrf-token': dashCsrf }, json: { data_json: v2Blob, pages: 2, title: 'Multi Page' } });
    assert(r.status === 200 && JSON.parse(r.body).ok, 'PUT saves a version:2 multi-page blob');

    r = await req('GET', BASE + `/api/designs/${designId}`, { headers: { 'x-csrf-token': dashCsrf } });
    const mpDesign = JSON.parse(r.body).design;
    assert(mpDesign.pages === 2, 'pages count persists and round-trips');
    assert(JSON.parse(mpDesign.data_json).pages.length === 2, 'saved data_json has 2 pages');

    // width/height (used for the dashboard thumbnail's aspect-ratio box) follow page 1's
    // size on every save — this is how a magic-resize in the editor reaches the dashboard.
    r = await req('PUT', BASE + `/api/designs/${designId}`, { headers: { 'x-csrf-token': dashCsrf }, json: { data_json: v2Blob, pages: 2, width: 1080, height: 1350, title: 'Multi Page' } });
    assert(r.status === 200 && JSON.parse(r.body).ok, 'PUT with width/height saves');
    r = await req('GET', BASE + `/api/designs/${designId}`, { headers: { 'x-csrf-token': dashCsrf } });
    const resizedDesign = JSON.parse(r.body).design;
    assert(resizedDesign.width === 1080 && resizedDesign.height === 1350, 'design width/height columns round-trip from a save');

    r = await req('GET', BASE + '/dashboard');
    assert(/design-pages-badge/.test(r.body), 'dashboard renders N-pages badge for multi-page design');

    // ---- share view exposes the multi-page blob + pager markup ----
    r = await req('POST', BASE + `/api/designs/${designId}/share`, { headers: { 'x-csrf-token': dashCsrf } });
    assert(r.status === 200 && JSON.parse(r.body).token, 'POST /api/designs/:id/share creates a token');
    const shareToken = JSON.parse(r.body).token;
    r = await req('GET', BASE + `/d/${shareToken}`);
    assert(r.status === 200 && /id="viewerPager"/.test(r.body), 'share view renders pager markup');
    assert(/pages/.test(r.body) && /version/.test(r.body), 'share view embeds the multi-page data blob');
    r = await req('DELETE', BASE + `/api/designs/${designId}/share`, { headers: { 'x-csrf-token': dashCsrf } });
    assert(r.status === 200, 'DELETE /api/designs/:id/share disables the link');

    // ---- version history: 3 content-saves already happened above (line ~249,
    // ~276, ~286) in quick succession — the throttle (one checkpoint per
    // design per 10 minutes) means only the first of those should have landed.
    r = await req('GET', BASE + `/api/designs/${designId}/versions`, { headers: { 'x-csrf-token': dashCsrf } });
    let versions = JSON.parse(r.body).versions;
    assert(r.status === 200 && versions.length === 1,
      'GET /api/designs/:id/versions — 3 quick content-saves above produced exactly 1 throttled checkpoint', `got ${versions.length}`);
    let v1Id = versions[0].id;

    r = await req('POST', BASE + `/api/designs/${designId}/versions/${v1Id}/restore`, { headers: { 'x-csrf-token': dashCsrf } });
    assert(r.status === 200 && JSON.parse(r.body).ok, 'POST /api/designs/:id/versions/:id/restore -> 200');

    r = await req('GET', BASE + `/api/designs/${designId}`, { headers: { 'x-csrf-token': dashCsrf } });
    const restored = JSON.parse(r.body).design;
    assert(restored.data_json === fakeCanvasJson && restored.pages === 1 && restored.width === 1080 && restored.height === 1350,
      'restoring a version reverts data_json/pages/width/height to that snapshot');
    assert(restored.title === 'Multi Page', 'restore leaves the current title/folder alone — only content is reverted');

    r = await req('GET', BASE + `/api/designs/${designId}/versions`, { headers: { 'x-csrf-token': dashCsrf } });
    versions = JSON.parse(r.body).versions;
    assert(versions.length === 2, 'restore force-snapshots the pre-restore state first, so nothing is lost', `got ${versions.length}`);

    r = await req('GET', BASE + '/api/designs/999999/versions', { headers: { 'x-csrf-token': dashCsrf } });
    assert(r.status === 404, 'GET /api/designs/<not mine>/versions -> 404');

    // cross-user isolation
    r = await req('GET', BASE + '/api/designs/999999', { headers: { 'x-csrf-token': dashCsrf } });
    assert(r.status === 404, 'GET /api/designs/<not mine> -> 404');

    // ---- templates API ----
    r = await req('GET', BASE + '/api/templates', { headers: { 'x-csrf-token': dashCsrf } });
    const tpls = JSON.parse(r.body).templates;
    assert(r.status === 200 && tpls.length >= 15, `GET /api/templates -> ${tpls.length} templates`);
    r = await req('GET', BASE + `/api/templates/${tpls[0].id}`, { headers: { 'x-csrf-token': dashCsrf } });
    const t0 = JSON.parse(r.body).template;
    assert(r.status === 200 && t0.data_json && JSON.parse(t0.data_json).objects.length > 1, 'GET /api/templates/:id has usable data_json');

    // ---- personal templates ("save current page as my own template") ----
    r = await req('POST', BASE + '/api/templates', {
      headers: { 'x-csrf-token': dashCsrf },
      json: { name: 'My Smoke Template', width: 1080, height: 1350, data_json: fakeCanvasJson, thumbnail: '' },
    });
    const myTpl = JSON.parse(r.body).template;
    assert(r.status === 200 && myTpl && myTpl.id && myTpl.category === 'mine', 'POST /api/templates saves a personal template with category "mine"');

    r = await req('GET', BASE + '/api/templates', { headers: { 'x-csrf-token': dashCsrf } });
    const withMine = JSON.parse(r.body).templates;
    assert(withMine.some((t) => t.id === myTpl.id), 'the personal template shows up in this user\'s own template list');
    assert(withMine.length === tpls.length + 1, 'personal template is additive to the global list, not a replacement');

    r = await req('GET', BASE + `/api/templates/${myTpl.id}`, { headers: { 'x-csrf-token': dashCsrf } });
    assert(r.status === 200 && JSON.parse(r.body).template.data_json === fakeCanvasJson, 'GET /api/templates/:id on my own personal template returns its data_json');

    r = await req('GET', BASE + '/templates');
    assert(!new RegExp(myTpl.slug).test(r.body), 'personal templates never leak into the public gallery');

    // cross-user isolation: a second, unrelated user must not see or touch it.
    // Swap the session cookie out for a fresh registration, then swap it back.
    const savedDsid = jar.dsid;
    delete jar.dsid;
    r = await req('GET', BASE + '/register');
    const reg2Csrf = csrfFrom(r.body);
    r = await req('POST', BASE + '/register', {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form({ _csrf: reg2Csrf, name: 'Smoke User 2', email: `smoke2${Date.now()}@test.dev`, password: 'smoke-pass-456', next: '/dashboard' }),
    });
    assert(r.status === 302, 'second smoke user registers into a separate session');
    r = await req('GET', BASE + '/dashboard');
    const user2Csrf = csrfFrom(r.body);

    r = await req('GET', BASE + `/api/templates/${myTpl.id}`, { headers: { 'x-csrf-token': user2Csrf } });
    assert(r.status === 404, 'a different user cannot fetch someone else\'s personal template by id');
    r = await req('GET', BASE + '/api/templates', { headers: { 'x-csrf-token': user2Csrf } });
    assert(!JSON.parse(r.body).templates.some((t) => t.id === myTpl.id), 'a different user\'s template list omits it entirely');
    r = await req('DELETE', BASE + `/api/templates/${myTpl.id}`, { headers: { 'x-csrf-token': user2Csrf } });
    assert(r.status === 404, 'a different user cannot delete someone else\'s personal template');

    r = await req('GET', BASE + `/api/designs/${designId}/versions`, { headers: { 'x-csrf-token': user2Csrf } });
    assert(r.status === 404, 'a different user cannot list version history of a design they don\'t own');
    r = await req('POST', BASE + `/api/designs/${designId}/versions/${v1Id}/restore`, { headers: { 'x-csrf-token': user2Csrf } });
    assert(r.status === 404, 'a different user cannot restore a version of a design they don\'t own');

    jar.dsid = savedDsid; // back to the original smoke user

    r = await req('DELETE', BASE + `/api/templates/${myTpl.id}`, { headers: { 'x-csrf-token': dashCsrf } });
    assert(r.status === 200 && JSON.parse(r.body).ok, 'the owner can delete their own personal template');
    r = await req('GET', BASE + `/api/templates/${myTpl.id}`, { headers: { 'x-csrf-token': dashCsrf } });
    assert(r.status === 404, 'the deleted personal template is really gone');

    // ---- uploads API (1x1 png) ----
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    const boundary = '----smoke' + Date.now();
    const parts = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="d.png"\r\nContent-Type: image/png\r\n\r\n`),
      png,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    r = await req('POST', BASE + '/api/uploads', { headers: { 'x-csrf-token': dashCsrf, 'Content-Type': `multipart/form-data; boundary=${boundary}` }, body: parts });
    const up = JSON.parse(r.body);
    assert(r.status === 200 && /^\/static\/uploads\//.test(up.url || ''), 'POST /api/uploads stores an image');
    const upFile = path.join(__dirname, 'public', up.url.replace('/static/', ''));
    assert(fs.existsSync(upFile), 'uploaded file exists on disk');
    r = await req('GET', BASE + '/api/uploads', { headers: { 'x-csrf-token': dashCsrf } });
    assert(JSON.parse(r.body).uploads.length >= 1, 'GET /api/uploads lists it');
    r = await req('DELETE', BASE + `/api/uploads/${up.id}`, { headers: { 'x-csrf-token': dashCsrf } });
    assert(r.status === 200 && !fs.existsSync(upFile), 'DELETE /api/uploads/:id removes row + file');

    // ---- AI routes: safe-by-default with no GEMINI_API_KEY configured ----
    // validation happens before any call out to Pollinations, so these stay offline
    r = await req('POST', BASE + '/api/ai/generate', { headers: { 'x-csrf-token': dashCsrf }, json: { prompt: '  ' } });
    assert(r.status === 400 && JSON.parse(r.body).error === 'bad_prompt', 'POST /api/ai/generate with blank prompt -> 400 bad_prompt');
    r = await req('POST', BASE + '/api/ai/generate', { headers: { 'x-csrf-token': dashCsrf }, json: { prompt: 'explicit porn video' } });
    assert(r.status === 400 && JSON.parse(r.body).error === 'bad_prompt', 'POST /api/ai/generate rejects an explicit prompt -> 400 bad_prompt');
    // image editing isn't available (Pollinations gated its edit model behind a separate
    // signup product) — the route says so plainly instead of trying and failing
    r = await req('POST', BASE + '/api/ai/edit', { headers: { 'x-csrf-token': dashCsrf }, json: { prompt: 'x' } });
    assert(r.status === 503 && JSON.parse(r.body).error === 'edit_unavailable', 'POST /api/ai/edit -> 503 edit_unavailable');
    r = await req('POST', BASE + '/api/ai/generate', { json: { prompt: 'x' } }); // no cookie jar reset needed — just no csrf header
    assert(r.status === 403, 'POST /api/ai/generate without csrf -> 403');

    // ---- Magic Write (POST /api/ai/write): same "validation happens before any
    // real network call" convention as /api/ai/generate above — the real
    // Pollinations text call is not exercised here (it's an external, rate-
    // limited free API not worth depending on for a deterministic suite).
    r = await req('POST', BASE + '/api/ai/write', { headers: { 'x-csrf-token': dashCsrf }, json: { prompt: '  ' } });
    assert(r.status === 400 && JSON.parse(r.body).error === 'bad_prompt', 'POST /api/ai/write with blank prompt -> 400 bad_prompt');
    r = await req('POST', BASE + '/api/ai/write', { headers: { 'x-csrf-token': dashCsrf }, json: { prompt: 'explicit porn video' } });
    assert(r.status === 400 && JSON.parse(r.body).error === 'bad_prompt', 'POST /api/ai/write rejects an explicit prompt -> 400 bad_prompt');
    r = await req('POST', BASE + '/api/ai/write', { json: { prompt: 'x' } });
    assert(r.status === 403, 'POST /api/ai/write without csrf -> 403');

    // ---- QR code route ----
    r = await req('POST', BASE + '/api/qrcode', { headers: { 'x-csrf-token': dashCsrf }, json: { text: 'https://example.com' } });
    const qrBody = JSON.parse(r.body);
    assert(r.status === 200 && /^data:image\/png;base64,/.test(qrBody.url || ''), 'POST /api/qrcode returns a PNG data URL');
    r = await req('POST', BASE + '/api/qrcode', { headers: { 'x-csrf-token': dashCsrf }, json: { text: '  ' } });
    assert(r.status === 400 && JSON.parse(r.body).error === 'bad_text', 'POST /api/qrcode with blank text -> 400 bad_text');

    // ---- stock photo routes: PEXELS_API_KEY is blank in this test env ----
    r = await req('GET', BASE + '/api/stock/search?q=cat', { headers: { 'x-csrf-token': dashCsrf } });
    assert(r.status === 200 && JSON.parse(r.body).available === false, 'GET /api/stock/search -> available:false with no PEXELS_API_KEY');
    // (the stock route's own explicit-query short-circuit is unreachable in
    // this test env — PEXELS_API_KEY is forced blank above, and that check
    // runs first — so the underlying filter is verified directly instead)
    {
      const { isExplicit } = require('./lib/safe-search');
      assert(isExplicit('porn video') === true, 'lib/safe-search: flags an explicit term');
      assert(isExplicit('a cat photo') === false, 'lib/safe-search: does not flag ordinary text');
      assert(isExplicit('breastfeeding mother') === false && isExplicit('chicken breast recipe') === false,
        'lib/safe-search: does not false-positive on ordinary anatomical/food words');
      assert(isExplicit('grass and class') === false, 'lib/safe-search: word-boundary match avoids substrings inside unrelated words');
      assert(isExplicit('kiss') === true, 'lib/safe-search: flags romantic/intimate terms too, not just explicit ones (reported: "kiss" returned romantic couple photos)');
      assert(isExplicit('A couple shares a tender kiss outdoors, embracing love and warmth.') === true,
        'lib/safe-search: flags a real romantic-couple alt-text description');
    }
    r = await req('POST', BASE + '/api/stock/import', { headers: { 'x-csrf-token': dashCsrf }, json: { url: 'https://images.pexels.com/x.jpg' } });
    assert(r.status === 503, 'POST /api/stock/import -> 503 with no PEXELS_API_KEY');
    r = await req('POST', BASE + '/api/stock/import', { headers: { 'x-csrf-token': dashCsrf }, json: { url: 'https://evil.example.com/x.jpg' } });
    assert(r.status === 400 || r.status === 503, 'POST /api/stock/import rejects a non-Pexels URL (SSRF guard, or unavailable first)');

    // ---- custom fonts API ----
    {
      const fakeFont = Buffer.from('not a real font, just needs a .ttf name for the extension check');
      const boundary = '----smokefont' + Date.now();
      const parts = Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="font"; filename="My Cool Font!.ttf"\r\nContent-Type: font/ttf\r\n\r\n`),
        fakeFont,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]);
      r = await req('POST', BASE + '/api/fonts', { headers: { 'x-csrf-token': dashCsrf, 'Content-Type': `multipart/form-data; boundary=${boundary}` }, body: parts });
      const font = JSON.parse(r.body);
      assert(r.status === 200 && /^\/static\/uploads\/fonts\//.test(font.url || ''), 'POST /api/fonts stores a font file', r.body);
      assert(font.family === 'My Cool Font' && !font.family.includes('!'),
        'POST /api/fonts derives + sanitizes a family name from the filename', font.family);
      const fontFile = path.join(__dirname, 'public', font.url.replace('/static/', ''));
      assert(fs.existsSync(fontFile), 'uploaded font file exists on disk');

      r = await req('GET', BASE + '/api/fonts', { headers: { 'x-csrf-token': dashCsrf } });
      assert(JSON.parse(r.body).fonts.some((f) => f.id === font.id), 'GET /api/fonts lists it');

      const badBoundary = '----smokefontbad' + Date.now();
      const badParts = Buffer.concat([
        Buffer.from(`--${badBoundary}\r\nContent-Disposition: form-data; name="font"; filename="virus.exe"\r\nContent-Type: application/octet-stream\r\n\r\n`),
        Buffer.from('nope'),
        Buffer.from(`\r\n--${badBoundary}--\r\n`),
      ]);
      r = await req('POST', BASE + '/api/fonts', { headers: { 'x-csrf-token': dashCsrf, 'Content-Type': `multipart/form-data; boundary=${badBoundary}` }, body: badParts });
      assert(r.status === 400, 'POST /api/fonts rejects a non-font extension', String(r.status));

      r = await req('DELETE', BASE + `/api/fonts/${font.id}`, { headers: { 'x-csrf-token': dashCsrf } });
      assert(r.status === 200 && !fs.existsSync(fontFile), 'DELETE /api/fonts/:id removes the row + file');
    }

    // ---- use-template -> editor ----
    r = await req('GET', BASE + `/use-template/${tpls[0].id}`);
    const edLoc = r.headers.location || '';
    assert(r.status === 302 && /\/editor\/\d+/.test(edLoc), 'GET /use-template/:id -> 302 /editor/:id');
    const edId = edLoc.match(/\/editor\/(\d+)/)[1];

    r = await req('GET', BASE + `/editor/${edId}`);
    assert(r.status === 200 && /id="edData"/.test(r.body) && /fabric(\.min)?\.js/.test(r.body), 'GET /editor/:id renders (edData + fabric)');
    const editorHtml = r.body;

    // "start from a photo" hands off via ?bgUrl= — the route itself is agnostic to
    // query params (core.js reads it client-side), just confirm it still renders fine
    r = await req('GET', BASE + `/editor/${edId}?bgUrl=${encodeURIComponent('/static/uploads/x.jpg')}`);
    assert(r.status === 200 && /id="edData"/.test(r.body), 'GET /editor/:id?bgUrl=... still renders fine');

    // ---- community gallery: a user can publish one of their own real
    // designs (not a template) so others can browse and clone it. Separate
    // feature from personal templates above; same immediate-no-review scope
    // that was explicitly agreed rather than assumed.
    r = await req('GET', BASE + '/community');
    assert(r.status === 200 && !r.body.includes(`/use-community/${designId}`),
      'GET /community does not list a design before it is published');

    r = await req('POST', BASE + `/api/designs/${designId}/publish`, { headers: { 'x-csrf-token': dashCsrf } });
    assert(r.status === 200 && JSON.parse(r.body).ok === true, 'POST /api/designs/:id/publish -> 200');

    r = await req('GET', BASE + '/community');
    // the viewer here IS the owner, so their own card shows a "remove" button
    // instead of a "use" link (checked precisely just below) — this first
    // check accepts either form as evidence the design is listed at all
    assert(r.status === 200 && r.body.includes('Smoke User') &&
      (r.body.includes(`/use-community/${designId}`) || new RegExp(`data-act="remove-publish" data-id="${designId}"`).test(r.body)),
      "GET /community lists the design once published, with its author's name");
    assert(new RegExp(`data-act="remove-publish" data-id="${designId}"`).test(r.body),
      "the owner's own view of /community shows a remove-from-community button, not a use-community link, on their own item");

    // real cross-user check (not just a same-session round-trip): a third,
    // unrelated user can see it and clone their own independent copy —
    // reuses the same cookie-swap technique the personal-templates
    // isolation test above established
    const savedDsid3 = jar.dsid;
    delete jar.dsid;
    r = await req('GET', BASE + '/register');
    const reg3Csrf = csrfFrom(r.body);
    r = await req('POST', BASE + '/register', {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form({ _csrf: reg3Csrf, name: 'Smoke User 3', email: `smoke3${Date.now()}@test.dev`, password: 'smoke-pass-789', next: '/dashboard' }),
    });
    assert(r.status === 302, 'third smoke user registers into a separate session');
    r = await req('GET', BASE + '/dashboard');
    const user3Csrf = csrfFrom(r.body);

    r = await req('GET', BASE + '/community');
    assert(r.status === 200 && r.body.includes(`/use-community/${designId}`), 'a different, unrelated user also sees the published design');
    assert(!new RegExp(`data-act="remove-publish" data-id="${designId}"`).test(r.body),
      "a different user's view of /community shows a use-community link for someone else's item, never a remove button");

    r = await req('GET', BASE + `/use-community/${designId}`, { headers: { 'x-csrf-token': user3Csrf } });
    const cloneLoc = r.headers.location || '';
    assert(r.status === 302 && /\/editor\/\d+/.test(cloneLoc), 'GET /use-community/:id -> 302 /editor/:id (clones into a new design)');
    const clonedId = cloneLoc.match(/\/editor\/(\d+)/)[1];

    r = await req('GET', BASE + `/api/designs/${clonedId}`, { headers: { 'x-csrf-token': user3Csrf } });
    const clonedDesign = JSON.parse(r.body).design;
    assert(clonedDesign.data_json === fakeCanvasJson && clonedDesign.title === 'Multi Page',
      "using a community design clones the real content into the cloning user's own, independent design");

    r = await req('GET', BASE + '/community');
    assert(!r.body.includes(`/use-community/${clonedId}`), 'the cloned copy is not itself auto-published');

    r = await req('POST', BASE + `/api/designs/${designId}/publish`, { headers: { 'x-csrf-token': user3Csrf } });
    assert(r.status === 404, "a different user can't publish a design they don't own");
    r = await req('DELETE', BASE + `/api/designs/${designId}/publish`, { headers: { 'x-csrf-token': user3Csrf } });
    assert(r.status === 404, "a different user can't unpublish a design they don't own");

    jar.dsid = savedDsid3; // back to the original smoke user

    r = await req('DELETE', BASE + `/api/designs/${designId}/publish`, { headers: { 'x-csrf-token': dashCsrf } });
    assert(r.status === 200 && JSON.parse(r.body).ok === true, 'DELETE /api/designs/:id/publish (unpublish) -> 200');
    r = await req('GET', BASE + '/community');
    assert(!r.body.includes(`/use-community/${designId}`), 'unpublishing removes the design from /community again');

    r = await req('GET', BASE + `/use-community/${designId}`);
    assert(r.status === 404, 'GET /use-community/:id on an unpublished design -> 404');

    // ---- jsdom editor wiring check ----
    await jsdomEditorCheck(editorHtml);

  } catch (err) {
    bad('unexpected exception', err && err.stack ? err.stack.split('\n').slice(0, 3).join(' | ') : String(err));
  } finally {
    srv.kill();
    for (const f of [DB_FILE, DB_FILE + '-wal', DB_FILE + '-shm']) {
      try { fs.unlinkSync(path.join(__dirname, 'data', f)); } catch {}
    }
  }

  if (srvErr.trim()) {
    console.log('\n  server stderr:\n' + srvErr.split('\n').map((l) => '    ' + l).join('\n'));
  }
  console.log(`\n  ${pass} passed, ${fail} failed`);
  if (fail) { console.log('  failed: ' + failures.join(', ')); process.exit(1); }
  console.log('  \x1b[32mall green\x1b[0m\n');
})();

/* ---- jsdom check --------------------------------------------------------- */
async function jsdomEditorCheck(html) {
  let JSDOM;
  try { ({ JSDOM } = require('jsdom')); }
  catch { console.log('  \x1b[33m•\x1b[0m jsdom not installed — skipping editor wiring check'); return; }

  // stub 2d canvas context + toDataURL before any script runs
  const stub = `<script>
    (function(){
      var noop=function(){return undefined};
      var mk=function(el){
        var o={ canvas:el, measureText:function(){return {width:8}},
                getImageData:function(){return {data:new Uint8ClampedArray(4),width:1,height:1}},
                createLinearGradient:function(){return {addColorStop:noop}},
                createRadialGradient:function(){return {addColorStop:noop}},
                createPattern:function(){return {}},
                putImageData:noop, drawImage:noop, getContextAttributes:function(){return {}},
                fillStyle:'#000', strokeStyle:'#000', globalAlpha:1, font:'10px sans-serif',
                textAlign:'left', textBaseline:'alphabetic', lineWidth:1 };
        return new Proxy(o,{ get:function(t,p){ return (p in t)?t[p]:noop }, set:function(t,p,v){ t[p]=v; return true } });
      };
      HTMLCanvasElement.prototype.getContext=function(){ return mk(this) };
      HTMLCanvasElement.prototype.toDataURL=function(){ return 'data:image/png;base64,iVBORw0KGgo=' };
      window.__errs=[];
      window.addEventListener('error',function(e){ window.__errs.push(String(e.message||e.error)) });
      window.addEventListener('unhandledrejection',function(e){ window.__errs.push('promise: '+String(e.reason)) });
    })();
  </script>`;
  const injected = html.replace(/<head>/i, '<head>' + stub);

  const dom = new JSDOM(injected, {
    url: BASE + '/editor/1',
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
  });

  // jsdom has no fetch of its own — proxy the editor's fetch() calls (templates,
  // elements library, uploads) to the real smoke server, carrying the session cookie.
  if (typeof fetch === 'function') {
    dom.window.fetch = (input, opts = {}) => {
      const headers = { ...(opts.headers || {}) };
      if (cookieHeader()) headers['Cookie'] = cookieHeader();
      return fetch(new URL(String(input), BASE).href, { ...opts, headers });
    };
  }

  await new Promise((res) => {
    if (dom.window.document.readyState === 'complete') return res();
    dom.window.addEventListener('load', res);
    setTimeout(res, 6000);
  });
  await new Promise((r) => setTimeout(r, 800)); // let deferred boot() + fabric settle

  const w = dom.window;
  assert(typeof w.fabric === 'object', 'jsdom: fabric.min.js loaded');
  assert(w.ED && typeof w.ED === 'object', 'jsdom: window.ED constructed');
  if (w.ED) {
    assert(w.ED.W === 1080, 'jsdom: ED.W matches template width', 'got ' + (w.ED && w.ED.W));
    assert(typeof w.ED.undo === 'function' && typeof w.ED.exportDesign === 'function', 'jsdom: ED api methods present');
    assert(typeof w.ED_syncProps === 'function', 'jsdom: props.js wired (ED_syncProps)');
    assert(typeof w.ED_drawGuides === 'function', 'jsdom: io.js wired (ED_drawGuides)');
    assert(typeof w.ED_syncLayers === 'function', 'jsdom: layers panel wired (ED_syncLayers)');
    assert(typeof w.ED_positionFloatbar === 'function' && typeof w.ED.startCrop === 'function', 'jsdom: floatbar + crop wired');
    const doc = w.document;
    assert(!!doc.querySelector('.ed-tab[data-tab="layers"]') && !!doc.getElementById('layersList'), 'jsdom: layers tab + list in DOM');
    assert(!!doc.getElementById('floatbar') && !!doc.getElementById('grpImage') && !!doc.getElementById('fxShadow'), 'jsdom: floatbar + image group + text-fx controls in DOM');
    assert(!!doc.getElementById('fbMore'), 'jsdom: floatbar "more" button in DOM (mobile: opens the properties sheet explicitly instead of it auto-covering the canvas on every selection)');
    assert(!!doc.getElementById('rightPanel') && !!doc.getElementById('pageStripList'), 'jsdom: right panel + page strip present (touch drag-reorder targets)');
    assert(w.fabric.Object.prototype.touchCornerSize === 44, 'jsdom: touch corner hit-area widened to 44px (visible dot stays 10px)');
    assert(w.ED._transforming === false, 'jsdom: ED._transforming starts false');
    {
      // the bottom tab bar hides while editing text (keyboard would just
      // cover it) — core.js toggles .ed-typing on canvas text:editing:entered/exited
      const tabsEl = doc.querySelector('.ed-tabs');
      const txt = new w.fabric.Textbox('hi', { left: 10, top: 10 });
      w.ED.canvas.add(txt);
      w.ED.canvas.fire('text:editing:entered', { target: txt });
      assert(tabsEl.classList.contains('ed-typing'), 'jsdom: entering text edit hides the bottom tab bar (.ed-typing added)');
      w.ED.canvas.fire('text:editing:exited', { target: txt });
      assert(!tabsEl.classList.contains('ed-typing'), 'jsdom: exiting text edit restores the bottom tab bar (.ed-typing removed)');
      w.ED.canvas.remove(txt);
    }
    {
      // the object:moving snapping-guide refactor caches OTHER objects'
      // edges once per drag instead of rebuilding the list on every single
      // move tick — verify the cache is actually reused (not the exact
      // snapped pixel outcome, which depends on Fabric's own
      // absolute-vs-viewport bounding-rect internals and is unchanged,
      // pre-existing logic this refactor never touched): spy on
      // canvas.getObjects() across 2 ticks of one simulated drag and expect
      // exactly 1 call, not 2.
      const mover = new w.fabric.Rect({ left: 10, top: 10, width: 40, height: 40, fill: '#000' });
      w.ED.canvas.add(mover);
      w.ED.canvas.fire('mouse:down', { target: mover, e: {} }); // starts a new drag -> resets the cache
      const realGetObjects = w.ED.canvas.getObjects.bind(w.ED.canvas);
      let calls = 0;
      w.ED.canvas.getObjects = function (...args) { calls++; return realGetObjects(...args); };
      w.ED.canvas.fire('object:moving', { target: mover });
      w.ED.canvas.fire('object:moving', { target: mover });
      w.ED.canvas.getObjects = realGetObjects;
      assert(calls === 1, 'jsdom: snapping-guide target list is cached across move ticks of one drag (built once, not per tick)', calls + ' calls for 2 ticks');
      w.ED.canvas.remove(mover);
    }
    const removeBgOpts = [...doc.querySelectorAll('#removeBgRow [data-mode]')];
    const removeBgImageBtn = doc.getElementById('removeBgImageBtn');
    assert(removeBgOpts.length === 2 && removeBgOpts.every((b) => !b.disabled) && !!removeBgImageBtn && !removeBgImageBtn.disabled,
      'jsdom: remove-background options (transparent/white/image) present + enabled (vendor files found)');
    assert(!!doc.querySelector('.ed-tab[data-tab="removebg"]') && !!doc.getElementById('removeBgTabDrop') && !!doc.getElementById('removeBgTabInput'),
      'jsdom: standalone remove-background tab (own upload) present in DOM');
    assert(typeof w.ED.removeBackground === 'function' && w.ED.bgRemovalAvailable === true,
      'jsdom: ED.removeBackground core exposed for reuse by the standalone tab');
    assert(typeof w.ED.getBgImage === 'function', 'jsdom: ED.getBgImage exposed (background image has no "active object" path)');
    const bgRemoveBgOpts = [...doc.querySelectorAll('#bgRemoveBgRow [data-mode]')];
    assert(bgRemoveBgOpts.length === 2 && bgRemoveBgOpts.every((b) => !b.disabled) && !!doc.getElementById('bgRemoveBgImageBtn'),
      'jsdom: background-panel remove-background controls present + enabled (act on the bg image directly, no re-upload)');
    const bgDecomposeBtn = doc.getElementById('bgDecomposeBtn');
    assert(!!bgDecomposeBtn && !bgDecomposeBtn.disabled && !!doc.getElementById('bgDecomposeResults'),
      'jsdom: background-panel decompose control present + enabled (acts on the bg image directly, no re-upload)');
    const decomposeBtn = doc.getElementById('decomposeBtn');
    assert(!!decomposeBtn && !decomposeBtn.disabled && w.ED.decomposeAvailable === true,
      'jsdom: decompose-elements button present + enabled (vendor files found)');
    assert(!!doc.querySelector('.ed-tab[data-tab="decompose"]') && !!doc.getElementById('decomposeTabDrop') && !!doc.getElementById('decomposeTabRun'),
      'jsdom: standalone decompose tab (own upload) present in DOM');
    assert(!!doc.getElementById('decomposeResults') && !!doc.getElementById('decomposeTabResults'),
      'jsdom: decompose results-list containers present in DOM (image-panel + standalone tab)');
    assert(typeof w.ED.detectElements === 'function' && typeof w.ED.decomposeExtractPiece === 'function' && typeof w.ED.decomposeRenderResults === 'function',
      'jsdom: ED.detectElements/decomposeExtractPiece/decomposeRenderResults core exposed for reuse by the standalone tab');

    // bulk "decompose everything" — extracts every detected piece AND erases
    // each from the source in one pass (real TF.js/coco-ssd detection isn't
    // exercised here — same as the rest of this suite — renderResults() is
    // called directly with synthetic boxes instead, since it takes them as a
    // plain argument rather than running detection itself)
    {
      const fakeSrc = doc.createElement('canvas');
      fakeSrc.width = 100; fakeSrc.height = 100;
      const fakeBoxes = [
        { bx: 0, by: 0, bw: 10, bh: 10, cls: 'cat', name: 'Cat' },
        { bx: 20, by: 20, bw: 10, bh: 10, cls: 'dog', name: 'Dog' },
      ];
      const fakeFrame = { left: 0, top: 0, scaleX: 1, scaleY: 1 };
      const testContainer = doc.createElement('div');
      doc.body.appendChild(testContainer);
      let erasedCount = 0;
      const objsBeforeSet = new Set(w.ED.canvas.getObjects());
      // force the fast crop-only path (bypass the real segmenter — a separate,
      // heavier ML pipeline this change didn't touch, and not reliably fast
      // enough in jsdom to exercise here) so this test isolates the actual
      // thing that changed: the bulk sequential extract+erase loop itself
      const savedBgAvailable = w.ED.bgRemovalAvailable;
      w.ED.bgRemovalAvailable = false;
      // fabric.Image.fromURL() never fires its load callback in jsdom (no real
      // image decoder) — every other place in this suite that needs a
      // fabric.Image sidesteps it by constructing one directly instead of
      // waiting on a data: URL to "load". decomposeExtractPiece (unchanged,
      // proven code) calls fromURL internally, so it's stubbed here the same
      // way rather than changed — this is a jsdom limitation, not a real bug:
      // fromURL works fine against real data: URLs in an actual browser.
      const savedFromURL = w.fabric.Image.fromURL;
      w.fabric.Image.fromURL = (url, cb) => cb(new w.fabric.Image(doc.createElement('img'), {}));
      w.ED.decomposeRenderResults(testContainer, fakeSrc, fakeBoxes, fakeFrame, async () => { erasedCount++; });
      const allBtn = testContainer.querySelector('.ed-decompose-all');
      assert(!!allBtn, 'jsdom: bulk "decompose everything" button renders in the results list');
      allBtn.dispatchEvent(new w.Event('click', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 500));
      w.ED.bgRemovalAvailable = savedBgAvailable;
      w.fabric.Image.fromURL = savedFromURL;
      assert(erasedCount === 2, 'jsdom: "decompose everything" erases every detected piece from the source, not just extracts them', String(erasedCount));
      const added = w.ED.canvas.getObjects().filter((o) => !objsBeforeSet.has(o));
      assert(added.length === 2, 'jsdom: "decompose everything" adds one new layer per detected piece', String(added.length));
      assert(allBtn.hidden === true, 'jsdom: bulk button hides itself once every row is done');
      testContainer.remove();
      added.forEach((o) => w.ED.canvas.remove(o)); // only remove what THIS test actually added, never assume a count
    }

    // Freehand select — manual lasso tool for cutting an arbitrary region out
    // of a photo (independent of Decompose's fixed 80-class auto-detection).
    // The interactive draw-with-the-mouse part itself isn't exercised here —
    // same standing limitation as the mobile long-press/pinch gestures — this
    // covers wiring + the actual pixel-region math, which IS verifiable.
    {
      assert(!!doc.getElementById('lassoBtn') && !!doc.getElementById('bgLassoBtn'),
        'jsdom: freehand-select entry buttons present (image panel + background panel)');
      assert(!!doc.getElementById('lassobar') && !!doc.getElementById('lassoExtract')
        && !!doc.getElementById('lassoErase') && !!doc.getElementById('lassoRedraw') && !!doc.getElementById('lassoDone'),
        'jsdom: freehand-select mode bar + its 4 controls present in DOM');
      assert(typeof w.ED.lassoStart === 'function' && typeof w.ED.lassoCancel === 'function',
        'jsdom: ED.lassoStart/lassoCancel exposed');
      assert(typeof w.ED.lassoPointsToImageSpace === 'function' && typeof w.ED.lassoBuildExtractedDataUrl === 'function'
        && typeof w.ED.lassoBuildErasedDataUrl === 'function' && typeof w.ED.lassoExtractRegion === 'function'
        && typeof w.ED.lassoEraseRegion === 'function',
        'jsdom: lasso pixel/region helpers exposed for direct testing');

      // real math: canvas-space points -> image-local pixel space, inverting
      // the exact frame transform decompose.js's own forward math uses
      const frame = { left: 100, top: 50, scaleX: 2, scaleY: 4 };
      const canvasPts = [{ x: 100, y: 50 }, { x: 300, y: 450 }, { x: 104, y: 58 }];
      const imgPts = w.ED.lassoPointsToImageSpace(canvasPts, frame);
      assert(imgPts[0].x === 0 && imgPts[0].y === 0 && imgPts[1].x === 100 && imgPts[1].y === 100
        && imgPts[2].x === 2 && imgPts[2].y === 2,
        'jsdom: lassoPointsToImageSpace() correctly inverts the frame transform', JSON.stringify(imgPts));

      // real math: the extracted piece's bounding box comes straight from the
      // polygon's own min/max (jsdom's canvas 2d context is a no-op stub, so
      // the actual pixel clip can't be visually verified here — same class of
      // limitation as every other toDataURL()-based export in this suite)
      const lassoSrc = doc.createElement('canvas');
      lassoSrc.width = 200; lassoSrc.height = 150;
      const poly = [{ x: 10, y: 20 }, { x: 90, y: 20 }, { x: 90, y: 80 }, { x: 10, y: 80 }];
      const extracted = w.ED.lassoBuildExtractedDataUrl(lassoSrc, poly);
      assert(extracted.minX === 10 && extracted.minY === 20 && extracted.w === 80 && extracted.h === 60
        && /^data:image\/png/.test(extracted.dataUrl),
        'jsdom: lassoBuildExtractedDataUrl() computes the right crop box from the polygon', JSON.stringify(extracted));
      assert(/^data:image\/png/.test(w.ED.lassoBuildErasedDataUrl(lassoSrc, poly)),
        'jsdom: lassoBuildErasedDataUrl() returns a PNG data URL');

      // functional: extracting adds exactly one new layer at the right place
      // (fabric.Image.fromURL never fires its load callback in jsdom — same
      // stub-and-restore workaround the bulk-decompose test above already uses)
      const savedFromURL2 = w.fabric.Image.fromURL;
      w.fabric.Image.fromURL = (url, cb) => cb(new w.fabric.Image(doc.createElement('img'), {}));
      const beforeExtract = new Set(w.ED.canvas.getObjects());
      const extractedObj = await w.ED.lassoExtractRegion(lassoSrc, frame, poly);
      w.fabric.Image.fromURL = savedFromURL2;
      const addedByLasso = w.ED.canvas.getObjects().filter((o) => !beforeExtract.has(o));
      assert(addedByLasso.length === 1 && addedByLasso[0] === extractedObj,
        'jsdom: lassoExtractRegion() adds exactly one new layer');
      assert(Math.abs(extractedObj.left - (frame.left + extracted.minX * frame.scaleX)) < 0.001
        && Math.abs(extractedObj.top - (frame.top + extracted.minY * frame.scaleY)) < 0.001,
        'jsdom: the extracted layer is positioned using the same frame math as decompose.js');
      w.ED.canvas.remove(extractedObj);

      // functional: erasing resets crop and resolves cleanly (img.setSrc, like
      // fromURL, needs a real image decoder to fire its callback in a browser
      // — stubbed here at the instance level for the same documented reason)
      const eraseImg = new w.fabric.Image(doc.createElement('img'), { cropX: 5, cropY: 5, width: 50, height: 50 });
      eraseImg.setSrc = function (url, cb) { this._element = doc.createElement('img'); cb(true); };
      await w.ED.lassoEraseRegion(eraseImg, lassoSrc, poly);
      assert(eraseImg.cropX === 0 && eraseImg.cropY === 0, 'jsdom: lassoEraseRegion() resets cropX/cropY after erasing');
    }

    // Magic Grab — click/brush/foreground point-promptable segmentation
    // (MobileSAM via ONNX Runtime Web) + opencv.js content-aware-fill erase.
    // The actual model/WASM inference can't run in jsdom (same class of
    // limitation as GIF/SVG export's own createObjectURL gap) — this covers
    // wiring, config exposure, and every pure/synchronous math helper for
    // real (coordinate mapping, mask accumulation, brush painting, bbox
    // cropping), which together are most of the code that isn't literally
    // "call the ONNX/opencv API and trust the library".
    {
      assert(!!doc.getElementById('magicGrabBtn') && !!doc.getElementById('bgMagicGrabBtn'),
        'jsdom: Magic Grab entry buttons present (image panel + background panel)');
      assert(!!doc.getElementById('magicgrabbar') && !!doc.getElementById('magicgrabGrab')
        && !!doc.getElementById('magicgrabClear') && !!doc.getElementById('magicgrabDone')
        && !!doc.getElementById('magicgrabBrushRow') && !!doc.getElementById('magicgrabBrushSize'),
        'jsdom: Magic Grab mode bar + its controls present in DOM');
      const mggModes = [...doc.querySelectorAll('[data-mggmode]')].map((b) => b.dataset.mggmode);
      assert(mggModes.includes('foreground') && mggModes.includes('click') && mggModes.includes('brush'),
        'jsdom: all 3 Magic Grab modes (foreground/click/brush) present', JSON.stringify(mggModes));

      assert(typeof w.ED.magicGrabStart === 'function' && typeof w.ED.magicGrabCancel === 'function',
        'jsdom: ED.magicGrabStart/magicGrabCancel exposed');
      assert(typeof w.ED.magicGrabToImageSpace === 'function' && typeof w.ED.magicGrabBuildEncoderInput === 'function'
        && typeof w.ED.magicGrabOrLogitsIntoAccum === 'function' && typeof w.ED.magicGrabPaintBrush === 'function'
        && typeof w.ED.magicGrabAccumHasAny === 'function' && typeof w.ED.magicGrabAccumBBox === 'function'
        && typeof w.ED.magicGrabBuildExtractedDataUrl === 'function' && typeof w.ED.magicGrabBuildErasedTransparentDataUrl === 'function',
        'jsdom: magic-grab pixel/math helpers exposed for direct testing');

      // fetch-vendor.js was actually run this session — both flags should be
      // live-true, not just present, same standard decompose's own
      // w.ED.decomposeAvailable===true check above already holds itself to.
      assert(w.ED.magicGrabModelAvailable === true, 'jsdom: MobileSAM+ORT vendor files detected (ran npm run fetch-vendor)');
      assert(w.ED.magicGrabInpaintAvailable === true, 'jsdom: opencv.js vendor file detected (ran npm run fetch-vendor)');
      assert(w.ED.data.magicGrab && w.ED.data.magicGrab.encoderUrl && w.ED.data.magicGrab.decoderUrl
        && w.ED.data.magicGrab.ortUrl && w.ED.data.magicGrab.opencvUrl,
        'jsdom: magicGrab vendor URLs present in ED.data');

      // real math: canvas-space point -> image-local pixel space (identical
      // contract to lassoPointsToImageSpace, one point instead of an array)
      const mggFrame = { left: 100, top: 50, scaleX: 2, scaleY: 4 };
      const mggPt = w.ED.magicGrabToImageSpace({ x: 300, y: 450 }, mggFrame);
      assert(mggPt.x === 100 && mggPt.y === 100, 'jsdom: magicGrabToImageSpace() inverts the frame transform', JSON.stringify(mggPt));

      // real math: resize-longest-side-to-1024 (no padding) — both the
      // landscape and portrait branches, since a naive width-only resize
      // would pass one and silently fail the other
      const encLandscape = w.ED.magicGrabBuildEncoderInput(doc.createElement('canvas'), 200, 100);
      assert(encLandscape.rw === 1024 && encLandscape.rh === 512 && Math.abs(encLandscape.scale - 5.12) < 1e-9,
        'jsdom: magicGrabBuildEncoderInput() resizes a landscape image to width=1024', JSON.stringify(encLandscape));
      const encPortrait = w.ED.magicGrabBuildEncoderInput(doc.createElement('canvas'), 100, 200);
      assert(encPortrait.rh === 1024 && encPortrait.rw === 512 && Math.abs(encPortrait.scale - 5.12) < 1e-9,
        'jsdom: magicGrabBuildEncoderInput() resizes a portrait image to height=1024', JSON.stringify(encPortrait));

      // real math: sigmoid(logit)*255 OR'd (max, not overwrite) into the
      // accumulator — a confident positive logit should end up near-opaque,
      // a confident negative near-zero, and a later LOWER value must never
      // erase an earlier higher one (this is what lets 2 independent clicks
      // both stay selected instead of the 2nd click's edges cutting the 1st)
      const accum = new w.Uint8ClampedArray(4);
      w.ED.magicGrabOrLogitsIntoAccum(accum, new w.Float32Array([20, -20, 5, 5]), 2, 2);
      assert(accum[0] > 250 && accum[1] < 5, 'jsdom: magicGrabOrLogitsIntoAccum() converts logits to alpha via sigmoid', String(accum));
      w.ED.magicGrabOrLogitsIntoAccum(accum, new w.Float32Array([-20, -20, -20, -20]), 2, 2);
      assert(accum[0] > 250, 'jsdom: magicGrabOrLogitsIntoAccum() never lowers an existing higher value (OR, not overwrite)', String(accum));

      // real math: brush paints a filled circle in image-pixel space, exact
      // membership test (dx^2+dy^2<=r^2), nothing outside the radius touched
      const brushAccum = new w.Uint8ClampedArray(10 * 10);
      w.ED.magicGrabPaintBrush(brushAccum, 10, 10, 5, 5, 3);
      assert(brushAccum[5 * 10 + 5] === 255, 'jsdom: magicGrabPaintBrush() paints the brush center');
      assert(brushAccum[5 * 10 + 9] === 0, 'jsdom: magicGrabPaintBrush() leaves pixels outside the radius untouched');
      assert(!w.ED.magicGrabAccumHasAny(new w.Uint8ClampedArray(9)), 'jsdom: magicGrabAccumHasAny() is false on an all-zero mask');
      assert(w.ED.magicGrabAccumHasAny(brushAccum) === true, 'jsdom: magicGrabAccumHasAny() is true once something is painted');

      // real math: bounding box comes straight from the accumulator's own
      // nonzero extent
      assert(w.ED.magicGrabAccumBBox(new w.Uint8ClampedArray(9), 3, 3) === null, 'jsdom: magicGrabAccumBBox() returns null on an all-zero mask');
      const bbox = w.ED.magicGrabAccumBBox(brushAccum, 10, 10);
      assert(bbox.minX === 2 && bbox.minY === 2 && bbox.w === 7 && bbox.h === 7,
        'jsdom: magicGrabAccumBBox() computes the tight bounding box of a painted circle', JSON.stringify(bbox));

      // jsdom's canvas 2d context is a no-op stub (same standing limitation
      // as lasso's/decompose's own equivalent tests) — the crop-box geometry
      // (driven by accumBBox, pure math) and the PNG data-URL wrapper (the
      // stubbed toDataURL) are what's actually verifiable here, not real
      // pixel content.
      const mggSrc = doc.createElement('canvas');
      mggSrc.width = 10; mggSrc.height = 10;
      const mggExtracted = w.ED.magicGrabBuildExtractedDataUrl(mggSrc, brushAccum, 10, 10);
      assert(mggExtracted.minX === 2 && mggExtracted.minY === 2 && mggExtracted.w === 7 && mggExtracted.h === 7
        && /^data:image\/png/.test(mggExtracted.dataUrl),
        'jsdom: magicGrabBuildExtractedDataUrl() crops to the mask bbox and returns a PNG data URL', JSON.stringify(mggExtracted));
      assert(/^data:image\/png/.test(w.ED.magicGrabBuildErasedTransparentDataUrl(mggSrc, brushAccum, 10, 10)),
        'jsdom: magicGrabBuildErasedTransparentDataUrl() returns a PNG data URL');
    }

    // "use a photo already in your design" — decompose/remove-bg/brand-extract
    // tabs no longer force a fresh re-upload of a photo already on the canvas
    assert(typeof w.ED.canvasImages === 'function', 'jsdom: ED.canvasImages exposed');
    assert(!!doc.getElementById('decomposeTabCanvasPick') && !!doc.getElementById('removeBgTabCanvasPick') && !!doc.getElementById('brandExtractCanvasPick'),
      'jsdom: "use a photo already in your design" pickers present in the decompose/remove-bg/brand-extract tabs');
    const canvasPickBefore = w.ED.canvasImages().length;
    const canvasPickImg = new w.fabric.Image(doc.createElement('img'), { width: 40, height: 40 });
    w.ED.canvas.add(canvasPickImg);
    const canvasPickAfter = w.ED.canvasImages();
    assert(canvasPickAfter.length === canvasPickBefore + 1 && /^data:image\/png/.test(canvasPickAfter[canvasPickAfter.length - 1].url),
      'jsdom: canvasImages() picks up a newly placed image and renders it to a data URL');

    doc.querySelector('.ed-tab[data-tab="decompose"]').dispatchEvent(new w.Event('click', { bubbles: true }));
    assert(doc.getElementById('decomposeTabCanvasPick').hidden === false,
      'jsdom: decompose tab\'s canvas-photo picker populates (unhidden) once the tab is opened with an image on canvas');

    w.ED.canvas.remove(canvasPickImg);
    assert(w.ED.canvasImages().length === canvasPickBefore, 'jsdom: canvasImages() drops it again once removed from the canvas');

    // canvasImages(true) additionally surfaces the background image itself —
    // the Decompose/Remove Background tabs' own icon should work on whatever
    // photo is already in the design, background included, not just a
    // separately placed object (Brand's extract-colors picker keeps the
    // bg-excluded default, so it is NOT passed true here).
    assert(w.ED.canvasImages(true).length === canvasPickBefore,
      'jsdom: canvasImages(true) matches canvasImages() when there is no background image yet');
    const bgPickImg = new w.fabric.Image(doc.createElement('img'), { width: 40, height: 40, name: w.ED.BGIMAGE });
    w.ED.canvas.add(bgPickImg);
    assert(w.ED.canvasImages().length === canvasPickBefore,
      'jsdom: canvasImages() (default, used by Brand extract-colors) still excludes the background image');
    const withBg = w.ED.canvasImages(true);
    assert(withBg.length === canvasPickBefore + 1 && /^data:image\/png/.test(withBg[0].url),
      'jsdom: canvasImages(true) includes the background image, listed first');
    doc.querySelector('.ed-tab[data-tab="removebg"]').dispatchEvent(new w.Event('click', { bubbles: true }));
    assert(doc.getElementById('removeBgTabCanvasPick').hidden === false,
      'jsdom: remove-bg tab\'s canvas-photo picker includes the background image too');
    w.ED.canvas.remove(bgPickImg);
    assert(w.ED.canvasImages(true).length === canvasPickBefore, 'jsdom: canvasImages(true) drops the background image again once removed');

    const scRows = doc.querySelectorAll('#shortcutsDropdown .ed-shortcut-row');
    assert(!!doc.getElementById('btnShortcuts') && scRows.length >= 15, 'jsdom: keyboard-shortcuts dropdown lists the shortcuts', String(scRows.length));

    assert(!!doc.getElementById('btnSaveTpl') && !!doc.getElementById('saveTplName') && !!doc.getElementById('saveTplApply'),
      'jsdom: "save as template" control in the editor toolbar');
    assert(typeof w.ED.saveAsTemplate === 'function', 'jsdom: ED.saveAsTemplate exposed');

    const aiPrompt = doc.getElementById('aiPrompt');
    const aiGenerateBtn = doc.getElementById('aiGenerateBtn');
    assert(!!aiPrompt && !!aiGenerateBtn, 'jsdom: AI generate controls in DOM');
    assert(!aiGenerateBtn.disabled, 'jsdom: AI generate control enabled by default (no key/setup needed)');
    assert(!doc.getElementById('aiEditBtn'), 'jsdom: AI edit UI removed (Pollinations gated that model)');
    const objs = w.ED.canvas && w.ED.canvas.getObjects ? w.ED.canvas.getObjects() : [];
    assert(objs.some((o) => o.name === '__artboard'), 'jsdom: artboard present after boot', objs.length + ' objects');
    // build layers from the loaded template and confirm rows render
    try { w.ED_syncLayers(); } catch (e) {}
    await new Promise((r) => setTimeout(r, 60));
    assert(doc.querySelectorAll('#layersList .ed-layer-row').length >= 2, 'jsdom: layers list renders rows for template objects', doc.getElementById('layersList').innerHTML.slice(0, 80));

    // templates panel: category filter chips populated from the fetched template list
    assert(doc.querySelectorAll('#tplFilters .ed-el-chip').length > 1, 'jsdom: template category filters rendered', doc.getElementById('tplFilters').innerHTML.slice(0, 80));

    // elements panel: switch tabs to trigger loadElements(), then check the library (incl. icons)
    const elTab = doc.querySelector('.ed-tab[data-tab="elements"]');
    if (elTab) elTab.dispatchEvent(new w.Event('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 300));
    assert(doc.querySelectorAll('#elGrid .ed-el-item').length > 0, 'jsdom: elements library grid renders items');
    const iconsChip = doc.querySelector('#elFilters [data-cat="icons"]');
    assert(!!iconsChip, 'jsdom: elements library has an icons category');
    if (iconsChip) {
      iconsChip.dispatchEvent(new w.Event('click', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 60));
      const iconItems = [...doc.querySelectorAll('#elGrid .ed-el-item')];
      assert(iconItems.length === 16 && iconItems.every((el) => el.dataset.id.startsWith('icon-')),
        'jsdom: icons category filters to 16 icon- items', iconItems.length + ' items');
    }
    const socialChip = doc.querySelector('#elFilters [data-cat="social"]');
    assert(!!socialChip, 'jsdom: elements library has a social category');
    if (socialChip) {
      socialChip.dispatchEvent(new w.Event('click', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 60));
      const socialItems = [...doc.querySelectorAll('#elGrid .ed-el-item')];
      assert(socialItems.length === 12 && socialItems.every((el) => el.dataset.id.startsWith('social-')),
        'jsdom: social category filters to 12 social- items', socialItems.length + ' items');
    }
    const stickersChip = doc.querySelector('#elFilters [data-cat="stickers"]');
    assert(!!stickersChip, 'jsdom: elements library has a stickers category');
    if (stickersChip) {
      stickersChip.dispatchEvent(new w.Event('click', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 60));
      const stickerItems = [...doc.querySelectorAll('#elGrid .ed-el-item')];
      assert(stickerItems.length === 6 && stickerItems.every((el) => el.dataset.id.startsWith('sticker-')),
        'jsdom: stickers category filters to 6 sticker- items', stickerItems.length + ' items');
    }

    // template category filter actually narrows the list
    const allTplCount = doc.querySelectorAll('#tplList .ed-tpl-item').length;
    const presChip = doc.querySelector('#tplFilters [data-cat="presentation"]');
    if (presChip) {
      presChip.dispatchEvent(new w.Event('click', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 60));
      const presCount = doc.querySelectorAll('#tplList .ed-tpl-item').length;
      assert(presCount > 0 && presCount < allTplCount, 'jsdom: template category filter narrows the list',
        `presentation=${presCount} all=${allTplCount}`);
    }
    // reset category filter, then exercise the search boxes
    const allChip = doc.querySelector('#tplFilters [data-cat="all"]');
    if (allChip) { allChip.dispatchEvent(new w.Event('click', { bubbles: true })); await new Promise((r) => setTimeout(r, 60)); }

    const tplSearch = doc.getElementById('tplSearch');
    tplSearch.value = 'zzz-no-such-template-zzz';
    tplSearch.dispatchEvent(new w.Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 60));
    assert(doc.querySelectorAll('#tplList .ed-tpl-item').length === 0 && /ed-hint/.test(doc.getElementById('tplList').innerHTML),
      'jsdom: template search narrows to zero on a bogus query');
    tplSearch.value = '';
    tplSearch.dispatchEvent(new w.Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 60));
    assert(doc.querySelectorAll('#tplList .ed-tpl-item').length === allTplCount, 'jsdom: clearing template search restores the full list');

    const elAllChip = doc.querySelector('#elFilters [data-cat="all"]');
    if (elAllChip) { elAllChip.dispatchEvent(new w.Event('click', { bubbles: true })); await new Promise((r) => setTimeout(r, 60)); }
    const elSearch = doc.getElementById('elSearch');
    const allElCount = doc.querySelectorAll('#elGrid .ed-el-item').length;
    elSearch.value = 'heart';
    elSearch.dispatchEvent(new w.Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 60));
    const heartItems = [...doc.querySelectorAll('#elGrid .ed-el-item')];
    assert(heartItems.length > 0 && heartItems.length < allElCount && heartItems.every((el) => el.dataset.id.includes('heart')),
      'jsdom: element search filters by id substring', heartItems.length + ' items');
    elSearch.value = '';
    elSearch.dispatchEvent(new w.Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 60));

    // page strip: boots with 1 implicit page (legacy single-doc template), then add/switch/delete
    assert(Array.isArray(w.ED.pages) && w.ED.pages.length === 1, 'jsdom: boots with 1 implicit page (legacy shape)');
    assert(typeof w.ED.addPage === 'function' && typeof w.ED.switchPage === 'function'
      && typeof w.ED.duplicatePage === 'function' && typeof w.ED.deletePage === 'function'
      && typeof w.ED.reorderPage === 'function', 'jsdom: page API present');
    assert(!!doc.getElementById('pageStripList') && doc.querySelectorAll('#pageStripList .ed-page-tile').length === 1,
      'jsdom: page strip renders 1 tile');

    w.ED.addPage();
    await new Promise((r) => setTimeout(r, 60));
    assert(w.ED.pages.length === 2 && w.ED.activePage === 1, 'jsdom: addPage creates + switches to page 2');
    assert(doc.querySelectorAll('#pageStripList .ed-page-tile').length === 2, 'jsdom: page strip shows 2 tiles after addPage');
    assert(w.ED.pages[0].undo !== w.ED.pages[1].undo, 'jsdom: undo stacks are isolated per page');

    w.ED.switchPage(0);
    await new Promise((r) => setTimeout(r, 60));
    assert(w.ED.activePage === 0 && w.ED.W === 1080, 'jsdom: switchPage(0) restores page 1 dimensions');

    w.ED.duplicatePage(0);
    await new Promise((r) => setTimeout(r, 60));
    assert(w.ED.pages.length === 3 && w.ED.activePage === 1, 'jsdom: duplicatePage inserts a copy right after and switches to it');

    w.ED.deletePage(1);
    await new Promise((r) => setTimeout(r, 60));
    assert(w.ED.pages.length === 2, 'jsdom: deletePage removes a page');

    // magic resize: dropdown UI + rescales every page's content in place
    assert(!!doc.getElementById('btnResize') && !!doc.getElementById('resizeGroups'), 'jsdom: resize button + menu in DOM');
    assert(doc.querySelectorAll('#resizeGroups .ed-resize-item').length >= 10, 'jsdom: resize preset list populated');
    assert(typeof w.ED.magicResize === 'function', 'jsdom: ED.magicResize present');

    w.ED.switchPage(0);
    await new Promise((r) => setTimeout(r, 60));
    const beforeObj = w.ED.canvas.getObjects().find((o) => o.name !== '__artboard' && o.name !== '__bgimage');
    const beforeTop = beforeObj ? beforeObj.top : null;
    const pagesBefore = w.ED.pages.length;

    // 1080x1080 -> 1080x1920: width unchanged (scale=1, offX=0), so only `top` should
    // shift (vertical letterboxing) — that's what makes this a meaningful position check.
    w.ED.magicResize(1080, 1920);
    await new Promise((r) => setTimeout(r, 100));
    assert(w.ED.W === 1080 && w.ED.H === 1920, 'jsdom: magicResize updates active canvas dimensions', `${w.ED.W}x${w.ED.H}`);
    assert(w.ED.pages.length === pagesBefore && w.ED.pages.every((p) => p.width === 1080 && p.height === 1920),
      'jsdom: magicResize resizes every page');
    const artboardAfter = w.ED.canvas.getObjects().find((o) => o.name === '__artboard');
    assert(artboardAfter && artboardAfter.width === 1080 && artboardAfter.height === 1920, 'jsdom: magicResize resizes the artboard');
    if (beforeObj) {
      const afterObj = w.ED.canvas.getObjects().find((o) => o.name !== '__artboard' && o.name !== '__bgimage');
      assert(afterObj && afterObj.top !== beforeTop, 'jsdom: magicResize repositions existing content', `${beforeTop} -> ${afterObj && afterObj.top}`);
    }

    // font picker: clicking a font in the left panel, and changing the right-panel
    // select, both apply to the active text object's fontFamily.
    const headingBtn = doc.querySelector('[data-text="heading"]');
    headingBtn.dispatchEvent(new w.Event('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 60));
    const txt = w.ED.canvas.getActiveObject();
    const fontBtns = [...doc.querySelectorAll('#fontList button')];
    assert(fontBtns.length === 11, 'jsdom: font list renders all 11 fonts', fontBtns.length + ' buttons');
    const originalFontFamily = txt.fontFamily; // snapshot the string — `txt` itself mutates in place below
    const target = fontBtns.find((b) => b.textContent && !b.textContent.includes(originalFontFamily));
    target.dispatchEvent(new w.Event('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 200));
    assert(w.ED.canvas.getActiveObject().fontFamily !== originalFontFamily, 'jsdom: clicking a font in the left panel applies it to selected text');

    const pFont = doc.getElementById('pFont');
    const otherOpt = [...pFont.options].find((o) => o.value !== w.ED.canvas.getActiveObject().fontFamily);
    pFont.value = otherOpt.value;
    pFont.dispatchEvent(new w.Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 200));
    assert(w.ED.canvas.getActiveObject().fontFamily === otherOpt.value, 'jsdom: right-panel font select applies to selected text');

    // one-click image filter presets
    const testImg = new w.fabric.Image(doc.createElement('img'), { width: 200, height: 150 });
    w.ED.canvas.add(testImg);
    w.ED.canvas.setActiveObject(testImg);
    await new Promise((r) => setTimeout(r, 30));
    const presetBtns = [...doc.querySelectorAll('#imgFilterPresets [data-preset]')];
    assert(presetBtns.length === 8, 'jsdom: 8 quick-filter preset buttons in DOM', presetBtns.length + '');
    const vividBtn = presetBtns.find((b) => b.dataset.preset === 'vivid');
    vividBtn.dispatchEvent(new w.Event('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));
    assert(testImg.filters && testImg.filters.length === 3, 'jsdom: "vivid" preset applies 3 fabric filters to the selected image', (testImg.filters || []).length + '');
    assert(vividBtn.classList.contains('on'), 'jsdom: active filter preset button gets the "on" highlight');
    const noneBtn = presetBtns.find((b) => b.dataset.preset === 'none');
    noneBtn.dispatchEvent(new w.Event('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));
    assert(testImg.filters.length === 0, 'jsdom: "original" preset clears the filter stack');

    // curved text
    w.ED.applyTextCurve(txt, 60);
    assert(txt.path instanceof w.fabric.Path && txt.curveAmount === 60, 'jsdom: ED.applyTextCurve assigns a fabric.Path and stores curveAmount');
    w.ED.applyTextCurve(txt, 0);
    assert(txt.path === null && txt.curveAmount === 0, 'jsdom: curve amount 0 clears the path (straight text again)');

    // gradient fills (shapes only)
    const rectBtn = doc.querySelector('[data-shape="rect"]');
    rectBtn.dispatchEvent(new w.Event('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));
    const rectObj = w.ED.canvas.getActiveObject();
    assert(rectObj && rectObj.type === 'rect', 'jsdom: adding a rect shape selects it for the gradient test');
    const gradientBtn = doc.querySelector('[data-filltype="gradient"]');
    gradientBtn.dispatchEvent(new w.Event('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));
    assert(rectObj.fill && rectObj.fill.type === 'linear' && rectObj.fill.colorStops.length === 2,
      'jsdom: switching to gradient fill assigns a linear fabric.Gradient');
    assert(doc.getElementById('gradientFillRow').hidden === false && doc.getElementById('solidFillRow').hidden === true,
      'jsdom: gradient controls show and the solid color row hides');
    const solidBtn = doc.querySelector('[data-filltype="solid"]');
    solidBtn.dispatchEvent(new w.Event('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));
    assert(typeof rectObj.fill === 'string', 'jsdom: switching back to solid restores a plain color string');

    // freehand draw tool
    const drawTab = doc.querySelector('.ed-tab[data-tab="draw"]');
    drawTab.dispatchEvent(new w.Event('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));
    assert(w.ED.canvas.isDrawingMode === true && w.ED.canvas.freeDrawingBrush instanceof w.fabric.PencilBrush,
      'jsdom: opening the Draw tab enables free-drawing mode with a PencilBrush');
    const templatesTab = doc.querySelector('.ed-tab[data-tab="templates"]');
    templatesTab.dispatchEvent(new w.Event('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));
    assert(w.ED.canvas.isDrawingMode === false, 'jsdom: switching to another tab turns free-drawing mode back off');

    // real photo frames (shaped clipPath placeholders, not the decorative border elements)
    const circleFrameBtn = doc.querySelector('[data-frame="circle"]');
    assert(!!circleFrameBtn, 'jsdom: frame shape buttons present in Elements panel');
    const framesBefore = w.ED.canvas.getObjects().filter((o) => o.isFrame).length;
    circleFrameBtn.dispatchEvent(new w.Event('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));
    const frame = w.ED.canvas.getObjects().find((o) => o.isFrame && o.frameShape === 'circle');
    assert(!!frame && w.ED.canvas.getObjects().filter((o) => o.isFrame).length === framesBefore + 1,
      'jsdom: clicking a frame shape adds a circle frame object to the canvas');

    // brand palette extraction (jsdom's stubbed getImageData means we can only
    // confirm the pipeline runs cleanly, not that real colors come out)
    assert(!!doc.getElementById('brandExtractBtn') && !!doc.getElementById('brandExtractInput'),
      'jsdom: brand "extract colors from photo" control present in DOM');
    assert(typeof w.ED.extractPalette === 'function', 'jsdom: ED.extractPalette exposed');
    const fakeImgEl = doc.createElement('img');
    assert(Array.isArray(w.ED.extractPalette(fakeImgEl, 5)), 'jsdom: extractPalette runs without throwing and returns an array');

    assert(frame.containsPoint({ x: frame.left + frame.radius, y: frame.top + frame.radius }, null, true, true),
      'jsdom: frame.containsPoint recognizes its own center (used for drag-and-drop hit-testing)');
    assert(typeof w.ED.fillFrame === 'function', 'jsdom: ED.fillFrame exposed for the drag-and-drop handler');

    // photo grid layouts (several frames added at once)
    const framesBeforeGrid = w.ED.canvas.getObjects().filter((o) => o.isFrame).length;
    doc.querySelector('[data-grid="grid4"]').dispatchEvent(new w.Event('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));
    assert(w.ED.canvas.getObjects().filter((o) => o.isFrame).length === framesBeforeGrid + 4,
      'jsdom: clicking the 4-up grid layout adds 4 frame objects at once');

    // charts
    assert(typeof w.ED.buildChart === 'function', 'jsdom: ED.buildChart exposed');
    const sampleData = [{ label: 'A', value: 10 }, { label: 'B', value: 20 }, { label: 'C', value: 5 }];
    ['bar', 'pie', 'line'].forEach((type) => {
      const objs = w.ED.buildChart(type, sampleData);
      assert(Array.isArray(objs) && objs.length > 0, `jsdom: buildChart('${type}') returns fabric objects`, objs && objs.length);
    });
    const chartsBefore = w.ED.canvas.getObjects().length;
    doc.getElementById('chartInsertBtn').dispatchEvent(new w.Event('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));
    assert(w.ED.canvas.getObjects().length === chartsBefore + 1 && w.ED.canvas.getActiveObject().name === 'chart',
      'jsdom: "Insert chart" adds one grouped chart object to the canvas');

    // table
    assert(typeof w.ED.buildTable === 'function', 'jsdom: ED.buildTable exposed');
    const tableObjsBefore = w.ED.canvas.getObjects().length;
    doc.getElementById('tableRows').value = '2';
    doc.getElementById('tableCols').value = '3';
    doc.getElementById('tableInsertBtn').dispatchEvent(new w.Event('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));
    // 2 rows x 3 cols x (1 rect + 1 textbox) = 12 new objects, added ungrouped
    assert(w.ED.canvas.getObjects().length === tableObjsBefore + 12,
      'jsdom: inserting a 2x3 table adds 12 ungrouped cell objects (rect+text per cell)');
    const headerCell = w.ED.canvas.getObjects().find((o) => o.type === 'textbox' && /Column 1|عمود 1/.test(o.text || ''));
    assert(!!headerCell, 'jsdom: table header cells get a readable default label');

    // QR panel
    assert(!!doc.getElementById('qrText') && !!doc.getElementById('qrInsertBtn'), 'jsdom: QR panel controls in DOM');

    // multi-file upload
    assert(doc.getElementById('uploadInput').multiple === true, 'jsdom: upload input accepts multiple files');
    assert(!!doc.getElementById('uploadSearch'), 'jsdom: upload search box in DOM');

    // recently used colors/fonts
    assert(typeof w.ED.trackRecentColor === 'function' && typeof w.ED.recentColors === 'function',
      'jsdom: ED.trackRecentColor/recentColors exposed');
    assert(typeof w.ED.trackRecentFont === 'function' && typeof w.ED.recentFonts === 'function',
      'jsdom: ED.trackRecentFont/recentFonts exposed');
    {
      w.ED.trackRecentColor('#123456');
      assert(w.ED.recentColors()[0] === '#123456', 'jsdom: trackRecentColor puts the color first in recentColors()');
      w.ED.trackRecentFont('Poppins');
      assert(w.ED.recentFonts()[0] === 'Poppins', 'jsdom: trackRecentFont puts the font first in recentFonts()');
      // select a rect and confirm the recent-colors swatch row rendered + is clickable
      const swatchRect = new w.fabric.Rect({ left: 0, top: 0, width: 40, height: 40, fill: '#000' });
      w.ED.canvas.add(swatchRect);
      w.ED.canvas.setActiveObject(swatchRect);
      if (w.ED_syncProps) w.ED_syncProps();
      const swatchBtn = doc.querySelector('#recentColorsFill [data-recent-color="#123456"]');
      assert(!!swatchBtn, 'jsdom: recent-color swatch renders in the Fill group for a shape');
      swatchBtn.dispatchEvent(new w.Event('click', { bubbles: true }));
      assert(swatchRect.fill === '#123456', 'jsdom: clicking a recent-color swatch applies it to the selected shape');
      w.ED.canvas.remove(swatchRect);
    }

    // onboarding welcome modal — jsdom's localStorage starts empty, so this
    // is exercising the real "first visit" path, not a mocked one
    assert(!!doc.getElementById('onboardBackdrop') && !!doc.getElementById('onboardStart'), 'jsdom: onboarding modal in DOM');
    assert(doc.getElementById('onboardBackdrop').hidden === false, 'jsdom: onboarding modal shows on a first visit (no rasmah_onboarded key yet)');
    doc.getElementById('onboardStart').dispatchEvent(new w.Event('click', { bubbles: true }));
    assert(doc.getElementById('onboardBackdrop').hidden === true, 'jsdom: "start designing" dismisses the onboarding modal');
    assert(w.localStorage.getItem('rasmah_onboarded') === '1', 'jsdom: dismissing the modal persists so it won\'t show again next visit');
    doc.getElementById('onboardReplay').dispatchEvent(new w.Event('click', { bubbles: true }));
    assert(doc.getElementById('onboardBackdrop').hidden === false, 'jsdom: "show tour again" (shortcuts dropdown) reopens the onboarding modal');

    // custom fonts (upload -> rebuildable font pickers)
    assert(typeof w.ED.rebuildFontUI === 'function', 'jsdom: ED.rebuildFontUI exposed');
    assert(Array.isArray(w.ED._fontRefreshers) && w.ED._fontRefreshers.length === 3,
      'jsdom: all 3 font pickers (text-tab list, properties select, brand heading/body selects) registered a refresher', String(w.ED._fontRefreshers.length));
    assert(!!doc.getElementById('customFontsList') && !!doc.getElementById('fontUploadDrop'), 'jsdom: custom-font upload + list controls in DOM');
    {
      const before = w.ED.FONTS.length;
      w.ED.FONTS.push({ family: 'Smoke Test Font', label: 'Smoke Test Font', custom: true });
      w.ED.rebuildFontUI();
      const opts = [...doc.getElementById('pFont').options].map((o) => o.value);
      assert(opts.includes('Smoke Test Font'), 'jsdom: rebuildFontUI() adds a newly-registered font to the properties-panel select');
      w.ED.FONTS.length = before;
      w.ED.rebuildFontUI();
    }

    // rotation snapping (hold Shift -> snap to 15°)
    {
      const r = new w.fabric.Rect({ left: 0, top: 0, width: 50, height: 50, angle: 47 });
      w.ED.canvas.add(r);
      w.ED.canvas.fire('object:rotating', { target: r, e: { shiftKey: true } });
      assert(r.angle === 45, 'jsdom: Shift-rotating snaps to the nearest 15° step', 'angle=' + r.angle);
      r.angle = 47;
      w.ED.canvas.fire('object:rotating', { target: r, e: { shiftKey: false } });
      assert(r.angle === 47, 'jsdom: rotating without Shift stays free (no snap)', 'angle=' + r.angle);
      w.ED.canvas.remove(r);
    }

    // align-to-selection + distribute for a multi-object selection — real
    // fabric.js ActiveSelection math (not asserting DOM presence only),
    // same construction Ctrl+A already uses (io.js) so this exercises the
    // same object shape the real feature will operate on.
    {
      const a = new w.fabric.Rect({ left: 0, top: 0, width: 40, height: 40 });
      const b = new w.fabric.Rect({ left: 200, top: 90, width: 40, height: 40 });
      const c = new w.fabric.Rect({ left: 500, top: 300, width: 40, height: 40 });
      [a, b, c].forEach((o) => w.ED.canvas.add(o));
      const sel = new w.fabric.ActiveSelection([a, b, c], { canvas: w.ED.canvas });
      w.ED.canvas.setActiveObject(sel);

      doc.querySelector('[data-canvasalign="left"]').dispatchEvent(new w.Event('click', { bubbles: true }));
      const lefts = [a, b, c].map((o) => Math.round(o.getBoundingRect(true, true).left));
      assert(lefts[0] === lefts[1] && lefts[1] === lefts[2],
        'jsdom: aligning a multi-selection lines up every object\'s absolute left edge, not just against the canvas', lefts.join(','));

      doc.getElementById('pDistH').dispatchEvent(new w.Event('click', { bubbles: true }));
      const rects = [a, b, c].map((o) => o.getBoundingRect(true, true)).sort((p, q) => p.left - q.left);
      const gap1 = rects[1].left - (rects[0].left + rects[0].width);
      const gap2 = rects[2].left - (rects[1].left + rects[1].width);
      assert(Math.abs(gap1 - gap2) < 0.5, 'jsdom: distribute-horizontally gives equal spacing between all 3 objects', `gap1=${gap1} gap2=${gap2}`);

      w.ED.canvas.remove(a, b, c);
    }

    // editable chart data (double-click an already-placed chart to re-open
    // its data for editing instead of delete-and-rebuild)
    {
      doc.getElementById('chartData').value = 'A,10\nB,20';
      const before = w.ED.canvas.getObjects().length;
      doc.getElementById('chartInsertBtn').dispatchEvent(new w.Event('click', { bubbles: true }));
      assert(w.ED.canvas.getObjects().length === before + 1, 'jsdom: chart insert adds one object (edit-flow baseline)');
      const chart = w.ED.canvas.getObjects()[w.ED.canvas.getObjects().length - 1];
      assert(chart.chartType === 'bar' && chart.chartRaw === 'A,10\nB,20', 'jsdom: placed chart stores its own type + source data for later editing');

      w.ED.canvas.fire('mouse:dblclick', { target: chart });
      assert(doc.getElementById('chartData').value === 'A,10\nB,20' && doc.getElementById('chartInsertBtn').textContent === (w.ED.i18n.chartUpdate || ''),
        'jsdom: double-clicking a chart prefills its data and switches the button to "update"');

      doc.getElementById('chartData').value = 'A,10\nB,20\nC,30';
      doc.getElementById('chartInsertBtn').dispatchEvent(new w.Event('click', { bubbles: true }));
      assert(w.ED.canvas.getObjects().length === before + 1, 'jsdom: updating a chart replaces it in place rather than adding a second one');
      assert(doc.getElementById('chartInsertBtn').textContent !== (w.ED.i18n.chartUpdate || '###'),
        'jsdom: button label restored to "insert" after an update completes');
      w.ED.canvas.remove(w.ED.canvas.getObjects()[w.ED.canvas.getObjects().length - 1]);
    }

    // stock photos — PEXELS_API_KEY is blank in this test env (matches the real
    // .env by default), so the panel should render the "not configured" hint,
    // not a search box.
    assert(!doc.getElementById('stockSearch'), 'jsdom: stock-photo search box absent when PEXELS_API_KEY is unset');
    const stockPanelText = (doc.querySelector('[data-panel="stock"]') || {}).textContent || '';
    assert(stockPanelText.length > 0, 'jsdom: stock panel shows a setup hint instead');

    // GIF export — vendored locally by this test run's own `npm run fetch-vendor`
    const dlGifBtn = doc.getElementById('dlGifBtn');
    assert(!!dlGifBtn, 'jsdom: GIF download option in DOM');
    assert(typeof w.ED.exportGIF === 'function', 'jsdom: ED.exportGIF exposed');

    // ZIP export (Download > all pages, PNG/JPG) — same "can't invoke directly,
    // ends in URL.createObjectURL" limitation as GIF above, so this stays at
    // the same DOM+library-loaded level of coverage
    assert(!!w.JSZip, 'jsdom: JSZip vendor script loaded (window.JSZip defined)');
    assert(typeof w.ED.exportAllPagesZip === 'function', 'jsdom: ED.exportAllPagesZip exposed');

    // SVG export — ED.exportSVG() itself can't be called directly in this
    // harness (it ends in URL.createObjectURL, unimplemented in jsdom — same
    // reason the GIF check above stays a presence check), so the underlying
    // canvas.toSVG() call it wraps is exercised directly instead, with a known
    // object on canvas, to actually verify the serialized output rather than
    // just asserting the wiring exists.
    {
      const svgDlBtn = doc.querySelector('[data-fmt="svg"]');
      assert(!!svgDlBtn, 'jsdom: SVG download option in DOM');
      assert(typeof w.ED.exportSVG === 'function', 'jsdom: ED.exportSVG exposed');

      const marker = new w.fabric.Rect({ left: 5, top: 5, width: 20, height: 20, fill: '#123456' });
      w.ED.canvas.add(marker);
      const svg = w.ED.canvas.toSVG({
        width: w.ED.W, height: w.ED.H,
        viewBox: { x: 0, y: 0, width: w.ED.W, height: w.ED.H },
      });
      assert(typeof svg === 'string' && svg.includes('<svg') && svg.includes(`width="${w.ED.W}"`) && svg.includes(`height="${w.ED.H}"`),
        'jsdom: canvas.toSVG() emits a properly sized <svg> document');
      // Fabric serializes fills as rgb(r,g,b), not the original hex — #123456 -> rgb(18,52,86)
      assert(svg.includes('rgb(18,52,86)'), 'jsdom: canvas.toSVG() serializes a real placed object (fill color present)');
      w.ED.canvas.remove(marker);
    }

    // Version history dropdown — DOM presence only (its fetch calls are
    // exercised for real at the HTTP level above, not worth re-proving here)
    assert(!!doc.getElementById('btnHistory') && !!doc.getElementById('historyList'),
      'jsdom: version history dropdown + list container in DOM');

    // Bulk Create — real functional coverage (not just DOM presence): add a
    // known text object, map it to a CSV column through the actual UI, generate,
    // and check the resulting pages' serialized JSON carries the right values
    // into the right object.
    {
      const bulkBtn = doc.getElementById('btnBulk');
      const bulkBackdrop = doc.getElementById('bulkBackdrop');
      assert(!!bulkBtn && !!bulkBackdrop, 'jsdom: Bulk Create trigger + modal in DOM');

      const objIndexForNewObj = w.ED.canvas.getObjects().length;
      const nameBox = new w.fabric.Textbox('placeholder name', { left: 50, top: 50, width: 200 });
      w.ED.canvas.add(nameBox);

      bulkBtn.dispatchEvent(new w.Event('click', { bubbles: true }));
      assert(!bulkBackdrop.hidden, 'jsdom: clicking Bulk Create opens the modal');

      const csvEl = doc.getElementById('bulkCsv');
      csvEl.value = 'Name\nSara\nAli';
      csvEl.dispatchEvent(new w.Event('input', { bubbles: true }));

      const sel = doc.querySelector(`#bulkFields select[data-obj-index="${objIndexForNewObj}"]`);
      assert(!!sel, 'jsdom: the newly added textbox appears as a mappable field');
      sel.value = '0';
      sel.dispatchEvent(new w.Event('change', { bubbles: true }));

      const genBtn = doc.getElementById('bulkGenerate');
      assert(!genBtn.disabled, 'jsdom: Generate enables once CSV has rows and a field is mapped');

      const pagesBeforeBulk = w.ED.pages.length;
      const activeBeforeBulk = w.ED.activePage;
      genBtn.dispatchEvent(new w.Event('click', { bubbles: true }));

      assert(w.ED.pages.length === pagesBeforeBulk + 2,
        'jsdom: Bulk Create appended one page per CSV row', `before ${pagesBeforeBulk}, after ${w.ED.pages.length}`);
      const gen1 = w.ED.pages[activeBeforeBulk + 1];
      const gen2 = w.ED.pages[activeBeforeBulk + 2];
      assert(gen1.json.objects[objIndexForNewObj].text === 'Sara' && gen2.json.objects[objIndexForNewObj].text === 'Ali',
        'jsdom: generated pages carry the mapped CSV values into the right text object');

      // clean up — remove the generated pages + the marker object so nothing
      // here leaks into later tests that assume the original page/object counts
      w.ED.pages.splice(activeBeforeBulk + 1, 2);
      w.ED.canvas.remove(nameBox);
      if (!bulkBackdrop.hidden) doc.getElementById('bulkCancel').dispatchEvent(new w.Event('click', { bubbles: true }));
    }

    // Present mode — real functional coverage via the exposed ED.present* API
    // (a fresh fabric.StaticCanvas rendering ED.pages[...].json, entirely
    // separate from the live editing canvas)
    {
      const presentBtn = doc.getElementById('btnPresent');
      assert(!!presentBtn, 'jsdom: Present button in DOM');
      assert(typeof w.ED.presentOpen === 'function' && typeof w.ED.presentGo === 'function' && typeof w.ED.presentClose === 'function',
        'jsdom: ED.presentOpen/presentGo/presentClose exposed');

      presentBtn.dispatchEvent(new w.Event('click', { bubbles: true }));
      const overlay = doc.querySelector('.ed-present-overlay');
      assert(!!overlay && !overlay.hidden, 'jsdom: clicking Present opens the fullscreen overlay');
      assert(doc.querySelector('.ed-present-counter').textContent === `1 / ${w.ED.pages.length}`,
        'jsdom: present mode opens on the current page with a correct page counter');

      w.ED.presentGo(1);
      const expectedAfterNext = Math.min(2, w.ED.pages.length);
      assert(doc.querySelector('.ed-present-counter').textContent === `${expectedAfterNext} / ${w.ED.pages.length}`,
        'jsdom: presentGo(1) advances a page (or stays clamped on a single-page design)');

      w.ED.presentClose();
      assert(overlay.hidden, 'jsdom: presentClose hides the overlay');
    }

    // Magic Write — DOM presence + wiring (the real /api/ai/write call is
    // covered at the HTTP level above; not re-exercised here, same reasoning
    // as the GIF/SVG download buttons above)
    assert(!!doc.getElementById('mwPrompt') && !!doc.getElementById('mwTone') && !!doc.getElementById('mwGenerate'),
      'jsdom: Magic Write panel controls in DOM');
    assert(typeof w.ED.addText === 'function', 'jsdom: ED.addText exposed (reused by Magic Write to insert generated copy)');

    // save selection as a reusable "sticker" (flattened transparent PNG,
    // uploaded through the existing /api/uploads endpoint)
    {
      const btn = doc.getElementById('pSaveSticker');
      const hint = doc.getElementById('saveStickerHint');
      assert(!!btn && !!hint, 'jsdom: "save as sticker" button + hint in DOM');
      const rect = new w.fabric.Rect({ left: 0, top: 0, width: 30, height: 30, fill: '#7c5cff' });
      w.ED.canvas.add(rect);
      w.ED.canvas.setActiveObject(rect);
      btn.dispatchEvent(new w.Event('click', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 400));
      // this exercises fetch() on a data: URL through the jsdom test harness's
      // own http-proxying fetch shim (built for http(s) calls, not data: ones)
      // — whether that chain happens to resolve it or not is an environment
      // detail, not something this test should depend on; what matters is the
      // handler's own try/catch reaches ONE of its two defined end states
      // instead of leaving an uncaught rejection (which the later
      // "no uncaught errors" check would otherwise silently blame on
      // something else entirely).
      const known = [w.ED.i18n.saveStickerDone, w.ED.i18n.saveStickerError];
      assert(known.includes(hint.textContent), 'jsdom: "save as sticker" click reaches a defined end state (success or a caught error), not an uncaught crash', JSON.stringify(hint.textContent));
      w.ED.canvas.remove(rect);
    }

    // brand kit — apply to design (color remap preserves distinct-color
    // structure, font split is by relative size)
    assert(typeof w.ED.applyBrandKit === 'function', 'jsdom: ED.applyBrandKit exposed');
    assert(!!doc.getElementById('brandApplyBtn'), 'jsdom: brand "apply to design" button in DOM');
    {
      const csrf = doc.querySelector('meta[name="csrf-token"]').content;
      await w.fetch('/api/brand', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf },
        body: JSON.stringify({ colors: ['#ff0000', '#0000ff'], fontHeading: 'Poppins', fontBody: 'Cairo' }),
      });
      await w.ED.loadBrand();
      const rect = new w.fabric.Rect({ width: 100, height: 100, fill: '#00ff00' });
      w.ED.addObject(rect);
      const heading = new w.fabric.Textbox('Big', { fontSize: 100, fontFamily: 'Cairo' });
      w.ED.addObject(heading);
      const body = new w.fabric.Textbox('small', { fontSize: 20, fontFamily: 'Cairo' });
      w.ED.addObject(body);
      const r = await w.ED.applyBrandKit();
      assert(r && r.empty === false, 'jsdom: applyBrandKit reports non-empty once brand colors/fonts are set');
      assert(['#ff0000', '#0000ff'].includes(rect.fill),
        'jsdom: applyBrandKit remapped a shape fill to its nearest brand color', String(rect.fill));
      assert(heading.fontFamily === 'Poppins', 'jsdom: applyBrandKit set the larger text to the brand heading font');
      assert(body.fontFamily === 'Cairo', 'jsdom: applyBrandKit set the smaller text to the brand body font');
    }
  }

  const errs = (w.__errs || []).filter((e) => !/Could not parse CSS|Not implemented: HTMLCanvasElement/.test(e));
  assert(errs.length === 0, 'jsdom: no uncaught errors in editor scripts', errs.slice(0, 3).join(' | '));

  // Let any still-pending debounced autosave flush (ED.record()'s own 260ms
  // debounce -> scheduleAutosave()'s 1200ms one, chained worst-case ~1.5s)
  // BEFORE tearing down the window — this test exercises many actions in
  // quick succession near the end (rotation/align/distribute/chart-edit),
  // and closing while one of those timers is still in flight crashes the
  // whole process (setSaveState() reaching for a now-torn-down `document`)
  // well after the pass/fail totals below already printed "all green".
  await new Promise((r) => setTimeout(r, 1700));
  dom.window.close();
}
