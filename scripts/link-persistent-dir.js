'use strict';

/* Cloud-deploy-only bootstrap (Railway, or any host with a mounted volume):
   symlinks this app's local data/ (SQLite) and public/uploads/ directories
   into a persistent volume, so they survive redeploys/restarts instead of
   living on the container's ephemeral filesystem.

   No-op unless PERSIST_DIR is set — local dev and the smoke-test harness
   never set it, so this changes nothing about either. Safe to run on every
   boot: if the link already points at the right place (a restart against an
   existing volume), it's left alone; only a plain directory (first boot, or
   a rebuilt image before the volume was ever mounted) gets replaced. */

const fs = require('fs');
const path = require('path');

const persistDir = process.env.PERSIST_DIR;
if (!persistDir) {
  console.log('[link-persistent-dir] PERSIST_DIR not set, skipping (local/dev mode)');
  process.exit(0);
}

const root = path.join(__dirname, '..');
const links = [
  { real: path.join(persistDir, 'data'), link: path.join(root, 'data') },
  { real: path.join(persistDir, 'uploads'), link: path.join(root, 'public', 'uploads') },
];

for (const { real, link } of links) {
  fs.mkdirSync(real, { recursive: true });
  let linkStat = null;
  try { linkStat = fs.lstatSync(link); } catch { /* doesn't exist yet */ }
  if (linkStat) {
    if (linkStat.isSymbolicLink()) {
      console.log(`[link-persistent-dir] ${link} already linked`);
      continue;
    }
    fs.rmSync(link, { recursive: true, force: true });
  }
  fs.symlinkSync(real, link, 'dir');
  console.log(`[link-persistent-dir] linked ${link} -> ${real}`);
}
