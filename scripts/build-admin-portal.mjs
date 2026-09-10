#!/usr/bin/env node
/* Builds the standalone Super Admin portal into dist-admin/ and makes it a
   proper root-served SPA:

     1. vite build --config vite.config.admin.js   (only admin-portal.html)
     2. rename dist-admin/admin-portal.html -> dist-admin/index.html, so "/"
        and every unknown path (via not_found_handling = single-page-application)
        serve the portal.
     3. write dist-admin/_headers and dist-admin/robots.txt — noindex, no
        crawling. The portal is Super-Admin-only; it must never be indexed.
     4. self-check: exactly one .html (index.html), the Supabase URL/anon key
        were actually injected, and no service-role key / secret leaked in.

   Run:  npm run build:admin-portal   (deploy: npm run deploy:admin-portal) */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const outDir = path.join(root, 'dist-admin');

console.log('→ vite build --config vite.config.admin.js');
execSync('npx vite build --config vite.config.admin.js', { cwd: root, stdio: 'inherit' });

// 1. admin-portal.html -> index.html
const built = path.join(outDir, 'admin-portal.html');
const indexHtml = path.join(outDir, 'index.html');
if (fs.existsSync(built)) {
  fs.renameSync(built, indexHtml);
  console.log('  renamed admin-portal.html -> index.html');
}

// 2. noindex everywhere — this is a private admin surface.
fs.writeFileSync(path.join(outDir, '_headers'),
  '/*\n  X-Robots-Tag: noindex, nofollow, noarchive\n  X-Frame-Options: DENY\n  Referrer-Policy: no-referrer\n');
fs.writeFileSync(path.join(outDir, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
console.log('  wrote _headers + robots.txt (noindex)');

// 3. self-check
const htmls = fs.readdirSync(outDir).filter(f => f.endsWith('.html'));
const assetsDir = path.join(outDir, 'assets');
const jsFiles = fs.existsSync(assetsDir) ? fs.readdirSync(assetsDir).filter(f => f.endsWith('.js')) : [];
const bundle = jsFiles.map(f => fs.readFileSync(path.join(assetsDir, f), 'utf8')).join('\n');

const rootFiles = fs.readdirSync(outDir).filter(f => fs.statSync(path.join(outDir, f)).isFile());
const strayJs = rootFiles.filter(f => f.endsWith('.js'));

const problems = [];
if (!fs.existsSync(indexHtml)) problems.push('dist-admin/index.html is missing');
if (htmls.length !== 1 || htmls[0] !== 'index.html') problems.push('expected exactly one HTML file (index.html), got: ' + htmls.join(', '));
if (strayJs.length) problems.push('unexpected JS at dist-admin root (public/ leak?): ' + strayJs.join(', '));
{
  const allowed = new Set(['index.html', '_headers', 'robots.txt']);
  const unexpected = rootFiles.filter(f => !allowed.has(f));
  if (unexpected.length) problems.push('unexpected files at dist-admin root: ' + unexpected.join(', '));
}
if (!/\.supabase\.co/.test(bundle)) {
  problems.push('no Supabase URL in the bundle — built without .env.local? the portal would render "Supabase is not configured".');
}
if (/service[_-]?role/i.test(bundle) || /SUPABASE_SERVICE_ROLE_KEY/.test(bundle) || /BOOTSTRAP_TOKEN/.test(bundle)) {
  problems.push('a service-role key / bootstrap token string leaked into the bundle');
}

if (problems.length) {
  console.error('\n✗ build-admin-portal self-check FAILED:');
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}

console.log(`\n✓ dist-admin/ ready — 1 HTML (index.html), ${jsFiles.length} JS asset(s), noindex, no secrets.`);
console.log('  deploy:  npx wrangler deploy --config wrangler.admin.toml');
