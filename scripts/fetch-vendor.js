'use strict';

/* Downloads the front-end libraries and fonts the editor needs so the app
   runs fully offline. Safe to re-run. Requires Node 18+ (global fetch). */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const VENDOR = path.join(ROOT, 'public', 'vendor');
const FONTS = path.join(ROOT, 'public', 'fonts');
const MEDIAPIPE = path.join(VENDOR, 'mediapipe');
const COCO_MODEL = path.join(VENDOR, 'coco-ssd-model');
const MAGICGRAB = path.join(VENDOR, 'magicgrab');
fs.mkdirSync(VENDOR, { recursive: true });
fs.mkdirSync(FONTS, { recursive: true });
fs.mkdirSync(MEDIAPIPE, { recursive: true });
fs.mkdirSync(COCO_MODEL, { recursive: true });
fs.mkdirSync(MAGICGRAB, { recursive: true });

const LIBS = [
  {
    file: 'fabric.min.js',
    url: 'https://cdnjs.cloudflare.com/ajax/libs/fabric.js/5.3.0/fabric.min.js',
  },
  {
    file: 'jspdf.umd.min.js',
    url: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  },
  {
    file: 'tf.min.js',
    url: 'https://cdnjs.cloudflare.com/ajax/libs/tensorflow/4.22.0/tf.min.js',
  },
  {
    file: 'coco-ssd.min.js',
    url: 'https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.3/dist/coco-ssd.min.js',
  },
  {
    // animated GIF export (editor "Download > GIF" — cycles through pages).
    // Unlike fabric/jspdf above, this ALWAYS needs the local copy, not just
    // as a fallback: gif.js runs its encoder in a Web Worker, and
    // `new Worker(url)` requires a same-origin script regardless of CORS
    // headers — a CDN URL for gif.worker.js would just fail at runtime.
    file: 'gif.js',
    url: 'https://cdnjs.cloudflare.com/ajax/libs/gif.js/0.2.0/gif.js',
  },
  {
    file: 'gif.worker.js',
    url: 'https://cdnjs.cloudflare.com/ajax/libs/gif.js/0.2.0/gif.worker.js',
  },
  {
    // "Download > all pages as ZIP" for PNG/JPG (a single self-contained
    // UMD file, no worker — CDN-fallback pattern like fabric/jspdf, not the
    // always-local pair gif.js needs)
    file: 'jszip.min.js',
    url: 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
  },
];

const GF_CSS =
  'https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&family=Tajawal:wght@400;500;700&family=Almarai:wght@400;700;800&family=Amiri:ital@0;1&family=Reem+Kufi:wght@400;600;700&family=Lalezar&family=Poppins:ital,wght@0,400;0,600;0,700;0,800;1,400&family=Montserrat:ital,wght@0,400;0,600;0,700;1,400&family=Oswald:wght@400;600;700&family=Playfair+Display:ital,wght@0,400;0,700;0,800;1,400&family=Lobster&display=swap';

// a modern UA makes Google Fonts return woff2
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36';

async function download(url, dest, headers = {}) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
  return buf.length;
}

async function libs() {
  for (const lib of LIBS) {
    const dest = path.join(VENDOR, lib.file);
    try {
      const n = await download(lib.url, dest);
      console.log(`  ✓ ${lib.file}  (${(n / 1024).toFixed(0)} KB)`);
    } catch (err) {
      console.warn(`  ✗ ${lib.file} — ${err.message}`);
      console.warn('    (the editor will fall back to a CDN <script> for this file)');
    }
  }
}

// Background removal (editor "Remove background" button): MediaPipe's Vision
// Tasks runtime (Apache-2.0) + the small selfie-segmenter model (also Apache-2.0,
// via Google's MediaPipe model hub) — both self-hosted so the feature works
// offline. Optional: the editor shows a "run fetch-vendor" message if missing.
const MEDIAPIPE_VERSION = '0.10.14';
const MEDIAPIPE_FILES = [
  { file: 'vision_bundle.mjs', url: `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/vision_bundle.mjs` },
  { file: 'vision_wasm_internal.js', url: `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm/vision_wasm_internal.js` },
  { file: 'vision_wasm_internal.wasm', url: `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm/vision_wasm_internal.wasm` },
  { file: 'selfie_segmenter.tflite', url: 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite' },
];

async function mediapipe() {
  console.log('  (background removal: ~10 MB, one-time)');
  for (const f of MEDIAPIPE_FILES) {
    const dest = path.join(MEDIAPIPE, f.file);
    try {
      const n = await download(f.url, dest);
      console.log(`  ✓ mediapipe/${f.file}  (${(n / 1024).toFixed(0)} KB)`);
    } catch (err) {
      console.warn(`  ✗ mediapipe/${f.file} — ${err.message}`);
      console.warn('    (the "remove background" button will show a setup hint instead)');
    }
  }
}

// Element decomposition (editor "Decompose elements" button): the standard
// COCO-SSD object-detection graph (Apache-2.0, via TensorFlow.js' model hub),
// self-hosted for the same offline-first reason as the background remover.
const COCO_MODEL_BASE = 'https://storage.googleapis.com/tfjs-models/savedmodel/ssdlite_mobilenet_v2/';
const COCO_MODEL_FILES = [
  'model.json',
  'group1-shard1of5', 'group1-shard2of5', 'group1-shard3of5', 'group1-shard4of5', 'group1-shard5of5',
];

async function cocoSsdModel() {
  console.log('  (element decomposition: ~19 MB, one-time)');
  for (const f of COCO_MODEL_FILES) {
    const dest = path.join(COCO_MODEL, f);
    try {
      const n = await download(COCO_MODEL_BASE + f, dest);
      console.log(`  ✓ coco-ssd-model/${f}  (${(n / 1024).toFixed(0)} KB)`);
    } catch (err) {
      console.warn(`  ✗ coco-ssd-model/${f} — ${err.message}`);
      console.warn('    (the "decompose elements" button will show a setup hint instead)');
    }
  }
}

// Magic Grab (editor "Magic Grab" tool, Canva-clone): click/brush/foreground
// point-promptable segmentation via MobileSAM (Apache-2.0, TinyViT encoder +
// SAM's mask decoder, ONNX-exported by the community — see the comment above
// mobileSamModel() for provenance) running through ONNX Runtime Web (MIT),
// plus opencv.js (Apache-2.0) for the Telea content-aware-fill inpaint that
// patches the hole left behind after grabbing an object. All self-hosted for
// the same offline-first reason as mediapipe/coco-ssd above.
const ONNXRUNTIME_VERSION = '1.20.1';
const ORT_BASE = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ONNXRUNTIME_VERSION}/dist/`;
const ORT_FILES = ['ort.min.js', 'ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm'];

// The official Meta segment-anything ONNX export pads/letterboxes to a fixed
// 1024x1024 and needs separate mean/std normalization; this community export
// bakes normalization into the graph and accepts a variable, non-padded
// (aspect-preserving, longest-side-1024) image directly (confirmed by
// inspecting the actual graph's input shape — symbolic H/W, not fixed
// constants — and by a real Node onnxruntime forward pass against a
// synthetic test image, done before writing any browser code: a point click
// on a known rectangle produced a clean, spatially-correct mask). Source:
// https://github.com/akbartus/MobileSAM-in-the-Browser (decoder in-repo,
// encoder hosted on its HF Space — both mirrored here so the app works
// offline and isn't dependent on that demo repo staying up).
const MOBILESAM_ENCODER_URL = 'https://huggingface.co/spaces/Akbartus/projects/resolve/main/mobilesam.encoder.onnx';
const MOBILESAM_DECODER_URL = 'https://raw.githubusercontent.com/akbartus/MobileSAM-in-the-Browser/main/models/mobilesam.decoder.quant.onnx';

const OPENCV_VERSION = '5.0.0-release.1';
const OPENCV_URL = `https://cdn.jsdelivr.net/npm/@techstark/opencv-js@${OPENCV_VERSION}/dist/opencv.js`;

async function magicGrab() {
  console.log('  (magic grab: ~62 MB total, one-time)');
  for (const f of ORT_FILES) {
    const dest = path.join(MAGICGRAB, f);
    try {
      const n = await download(ORT_BASE + f, dest);
      console.log(`  ✓ magicgrab/${f}  (${(n / 1024).toFixed(0)} KB)`);
    } catch (err) {
      console.warn(`  ✗ magicgrab/${f} — ${err.message}`);
    }
  }
  for (const [file, url] of [
    ['mobilesam.encoder.onnx', MOBILESAM_ENCODER_URL],
    ['mobilesam.decoder.onnx', MOBILESAM_DECODER_URL],
  ]) {
    const dest = path.join(MAGICGRAB, file);
    try {
      const n = await download(url, dest);
      console.log(`  ✓ magicgrab/${file}  (${(n / 1024 / 1024).toFixed(1)} MB)`);
    } catch (err) {
      console.warn(`  ✗ magicgrab/${file} — ${err.message}`);
      console.warn('    (the "Magic Grab" tool\'s Foreground/Click modes will show a setup hint instead; Brush mode needs no model and still works)');
    }
  }
  try {
    const n = await download(OPENCV_URL, path.join(MAGICGRAB, 'opencv.js'));
    console.log(`  ✓ magicgrab/opencv.js  (${(n / 1024 / 1024).toFixed(1)} MB)`);
  } catch (err) {
    console.warn(`  ✗ magicgrab/opencv.js — ${err.message}`);
    console.warn('    (Magic Grab will erase to transparent instead of content-aware fill)');
  }
}

async function fonts() {
  let css;
  try {
    const res = await fetch(GF_CSS, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    css = await res.text();
  } catch (err) {
    console.warn(`  ✗ fonts CSS — ${err.message}`);
    console.warn('    (keeping the online @import in public/fonts/fonts.css)');
    return;
  }

  const seen = new Map(); // remote url -> local filename
  let idx = 0;
  const rewritten = css.replace(/url\((https:\/\/[^)]+\.woff2)\)/g, (m, u) => {
    let name = seen.get(u);
    if (!name) {
      name = `gf-${String(++idx).padStart(3, '0')}.woff2`;
      seen.set(u, name);
    }
    return `url('/static/fonts/${name}')`;
  });

  let ok = 0;
  for (const [u, name] of seen) {
    try {
      await download(u, path.join(FONTS, name), { 'User-Agent': UA });
      ok++;
    } catch (err) {
      console.warn(`  ✗ ${name} — ${err.message}`);
    }
  }

  const header =
    '/* Self-hosted fonts — generated by scripts/fetch-vendor.js. */\n' +
    '/* Re-run `npm run fetch-vendor` to refresh. */\n\n';
  fs.writeFileSync(path.join(FONTS, 'fonts.css'), header + rewritten);
  console.log(`  ✓ fonts  (${ok}/${seen.size} files, fonts.css rewritten to local)`);
}

(async () => {
  console.log('\nFetching editor vendor assets…\n');
  await libs();
  await mediapipe();
  await cocoSsdModel();
  await magicGrab();
  await fonts();
  console.log('\nDone.\n');
})();
