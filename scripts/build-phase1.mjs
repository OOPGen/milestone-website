#!/usr/bin/env node
/* Builds the Phase 1 public-preview artifact into dist/.

   Run: node scripts/build-phase1.mjs   (or: npm run build:phase1)

   Vite's `public/` directory is copied to dist/ WHOLESALE regardless of
   which HTML entries are built — narrowing vite.config.phase1.js's
   rollupOptions.input to just index/privacy/terms does NOT stop
   public/admin.js, public/parent.js, public/login.js, public/apiClient.js,
   public/admin.css, public/parent.css, public/accept-invitation.js from
   landing in dist/ anyway, unreferenced but still fetchable and still
   revealing the account-system's client-side API surface. This script
   builds normally, then removes exactly those files from the OUTPUT
   ARTIFACT ONLY — none of the source files in public/ or the repo root are
   touched, so the Phase 2 build (`npm run build`) is unaffected. */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'dist');

console.log('→ vite build --config vite.config.phase1.js');
execSync('npx vite build --config vite.config.phase1.js', { cwd: root, stdio: 'inherit' });

// 1. Remove account-system client files that leaked in via public/ passthrough.
const LEAKED_PUBLIC_FILES = [
  'admin.js', 'admin.css', 'parent.js', 'parent.css',
  'login.js', 'apiClient.js', 'accept-invitation.js',
];
for (const f of LEAKED_PUBLIC_FILES) {
  const p = path.join(dist, f);
  if (fs.existsSync(p)) { fs.rmSync(p); console.log('  removed leaked file:', f); }
}

// 2. sw.js precaches /parent.html and /parent.css, which don't exist in this
//    build — Cache.addAll() fails ATOMICALLY if any entry 404s, breaking the
//    whole service worker install. Strip those two entries from the built
//    copy only.
const swPath = path.join(dist, 'sw.js');
if (fs.existsSync(swPath)) {
  let sw = fs.readFileSync(swPath, 'utf8');
  const before = sw;
  sw = sw.replace(/'\/parent\.html',?/, '').replace(/'\/parent\.css',?/, '');
  if (sw !== before) {
    fs.writeFileSync(swPath, sw);
    console.log('  patched sw.js: removed /parent.html and /parent.css from precache list');
  }
}

// 3. _redirects routes /admin and /parent to pages that no longer exist in
//    this build. worker/phase1.js already returns a genuine 404 for these
//    paths (and run_worker_first must list them — see wrangler.toml), but
//    removing the now-dangling redirect rules too avoids relying on
//    precedence between the two layers.
const redirectsPath = path.join(dist, '_redirects');
if (fs.existsSync(redirectsPath)) {
  const lines = fs.readFileSync(redirectsPath, 'utf8').split('\n')
    .filter(l => !/^\/admin\s|^\/parent\s/.test(l));
  if (lines.filter(Boolean).length) fs.writeFileSync(redirectsPath, lines.join('\n'));
  else { fs.rmSync(redirectsPath); console.log('  removed now-empty _redirects'); }
  console.log('  cleaned _redirects: removed /admin and /parent rules');
}

// 4. The PWA manifest advertises a "Parent portal" shortcut to /parent.html,
//    which is now a 404. Remove just that shortcut; keep the others.
const manifestPath = path.join(dist, 'manifest.webmanifest');
if (fs.existsSync(manifestPath)) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (Array.isArray(manifest.shortcuts)) {
    const kept = manifest.shortcuts.filter(s => s.url !== '/parent.html');
    if (kept.length !== manifest.shortcuts.length) {
      manifest.shortcuts = kept;
      fs.writeFileSync(manifestPath, JSON.stringify(manifest));
      console.log('  patched manifest.webmanifest: removed the Parent portal shortcut');
    }
  }
}

// 5. Sanity: fail loudly if any account-system artifact is present.
const FORBIDDEN = [
  'admin.html', 'parent.html', 'login.html', 'accept-invitation.html',
  ...LEAKED_PUBLIC_FILES,
];
const present = FORBIDDEN.filter(f => fs.existsSync(path.join(dist, f)));
if (present.length) {
  console.error('\n✗ Phase 1 build FAILED self-check — still present in dist/:', present.join(', '));
  process.exit(1);
}
if (fs.existsSync(path.join(dist, 'downloads'))) {
  console.error('\n✗ Phase 1 build FAILED self-check — dist/downloads/ exists (placeholder documents must stay unpublished).');
  process.exit(1);
}

console.log('\n✓ Phase 1 build ready in dist/ — no account-system pages, scripts, styles, or downloads present.');
