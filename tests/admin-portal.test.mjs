/* Unit + static checks for the Super Admin portal (src/admin-portal/*).

   Runs in plain Node, no browser, no Supabase connection. It imports the
   PURE modules (auth.js, content.js) and text-scans the DOM module (app.js)
   and the HTML entry. Behavioural coverage against a real project (login,
   RLS denial, publish, audit rows, logout) is in
   tests/admin-portal.live.test.mjs, which runs only when SUPABASE_TEST_*
   env vars are set. */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateAccess, accessMessage } from '../src/admin-portal/auth.js';
import {
  CONTENT_TYPES, CONTENT_TYPE_KEYS,
  publishPatch, unpublishPatch, archivePatch, softDeletePatch,
  kvPublishPatch, kvUnpublishPatch, parseJsonField, buildRow,
} from '../src/admin-portal/content.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const pass = [], fail = [];
const ok = (n, c, d = '') => (c ? pass : fail).push(n + (d ? ' — ' + d : ''));

const SESSION = { user: { id: 'u-1' } };

/* ---------- evaluateAccess: the client-side gate ---------- */

ok('access denied when there is no session', evaluateAccess({ session: null, profile: null }).reason === 'no_session');
ok('access denied when session has no profile',
  evaluateAccess({ session: SESSION, profile: null }).reason === 'no_profile');
ok('access denied when profile id != session user id',
  evaluateAccess({ session: SESSION, profile: { id: 'someone-else', role: 'SUPER_ADMIN', status: 'active' } }).reason === 'profile_mismatch');
ok('access denied for STAFF_ADMIN',
  evaluateAccess({ session: SESSION, profile: { id: 'u-1', role: 'STAFF_ADMIN', status: 'active' } }).reason === 'not_super_admin');
ok('access denied for PARENT',
  evaluateAccess({ session: SESSION, profile: { id: 'u-1', role: 'PARENT', status: 'active' } }).reason === 'not_super_admin');
ok('access denied for SUPER_ADMIN that is only invited',
  evaluateAccess({ session: SESSION, profile: { id: 'u-1', role: 'SUPER_ADMIN', status: 'invited' } }).reason === 'inactive');
ok('access denied for SUPER_ADMIN that is deactivated',
  evaluateAccess({ session: SESSION, profile: { id: 'u-1', role: 'SUPER_ADMIN', status: 'deactivated' } }).reason === 'inactive');
{
  const a = evaluateAccess({ session: SESSION, profile: { id: 'u-1', role: 'SUPER_ADMIN', status: 'active' } });
  ok('access ALLOWED only for an active SUPER_ADMIN whose profile is their own row', a.allowed === true && a.reason === 'ok');
}
for (const r of ['no_session', 'no_profile', 'profile_mismatch', 'not_super_admin', 'inactive', 'whatever']) {
  ok(`accessMessage('${r}') returns a non-empty string`, typeof accessMessage(r) === 'string' && accessMessage(r).length > 0);
}

/* ---------- content.js: descriptors match the real schema ---------- */

const REAL_TABLES = new Set(['notices', 'news_posts', 'calendar_events', 'page_content', 'settings']);
ok('exactly the 5 editable content types are exposed',
  CONTENT_TYPE_KEYS.length === 5 && CONTENT_TYPE_KEYS.every(k => REAL_TABLES.has(CONTENT_TYPES[k].table)));
ok('no content type invents a table outside the applied migrations',
  CONTENT_TYPE_KEYS.every(k => k === CONTENT_TYPES[k].table));

// Every table named here is one the RLS policy files actually cover.
const policyText = fs.readFileSync(path.join(root, 'supabase/policies/notices.sql'), 'utf8')
  + fs.readFileSync(path.join(root, 'supabase/policies/news_posts.sql'), 'utf8')
  + fs.readFileSync(path.join(root, 'supabase/policies/calendar_events.sql'), 'utf8')
  + fs.readFileSync(path.join(root, 'supabase/policies/settings_and_page_content.sql'), 'utf8');
for (const k of CONTENT_TYPE_KEYS) {
  ok(`policy file has a staff INSERT/UPSERT path for "${k}"`,
    new RegExp(`"${k === 'settings' || k === 'page_content' ? k + '_upsert_by_staff' : k + '_insert_by_staff'}"`).test(policyText));
}

// canHardDelete must only be true where a *_delete_by_super_admin policy exists.
for (const k of CONTENT_TYPE_KEYS) {
  const hasDeletePolicy = new RegExp(`"${k}_delete_by_super_admin"`).test(policyText);
  ok(`"${k}": canHardDelete flag matches whether a super-admin DELETE policy exists`,
    CONTENT_TYPES[k].canHardDelete === hasDeletePolicy);
}

/* ---------- status-transition patch shapes ---------- */

const isoRe = /^\d{4}-\d{2}-\d{2}T/;
{
  const p = publishPatch();
  ok('publishPatch -> {status:published, published_at:ISO}', p.status === 'published' && isoRe.test(p.published_at));
}
{
  const p = unpublishPatch();
  ok('unpublishPatch -> {status:draft, published_at:null}', p.status === 'draft' && p.published_at === null);
}
{
  const p = archivePatch();
  ok('archivePatch -> {status:archived, archived_at:ISO}', p.status === 'archived' && isoRe.test(p.archived_at));
}
{
  const p = softDeletePatch();
  ok('softDeletePatch -> {status:archived, deleted_at:ISO}', p.status === 'archived' && isoRe.test(p.deleted_at));
}
ok('kvPublishPatch -> {status:published} only (no timestamps — page_content has none)',
  JSON.stringify(kvPublishPatch()) === JSON.stringify({ status: 'published' }));
ok('kvUnpublishPatch -> {status:draft} only',
  JSON.stringify(kvUnpublishPatch()) === JSON.stringify({ status: 'draft' }));

/* ---------- form value handling ---------- */

ok('parseJsonField parses valid JSON', JSON.stringify(parseJsonField('{"a":1}')) === '{"a":1}');
let threw = false; try { parseJsonField(''); } catch { threw = true; }
ok('parseJsonField throws on empty', threw);
threw = false; try { parseJsonField('not json'); } catch { threw = true; }
ok('parseJsonField throws on invalid JSON', threw);

{
  const row = buildRow('notices', { title: 'Hello', summary: '  ', body: 'x', category: '', status: 'draft', visibility: 'parents' });
  ok('buildRow drops empty optional fields', !('category' in row) && !('summary' in row) && row.title === 'Hello' && row.body === 'x');
}
threw = false; try { buildRow('notices', { title: '  ', status: 'draft', visibility: 'parents' }); } catch { threw = true; }
ok('buildRow throws when a required field is blank', threw);
{
  const row = buildRow('settings', { key: 'contact.phone', value: '{"e164":"+123"}' });
  ok('buildRow coerces a json field', row.key === 'contact.phone' && row.value.e164 === '+123');
}
threw = false; try { buildRow('page_content', { key: 'home.hero', value: 'nope' }); } catch { threw = true; }
ok('buildRow throws on invalid json for a page_content value', threw);

/* ---------- no secret ever appears in portal code ---------- */

function listFiles(dir) {
  let out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    out = e.isDirectory() ? out.concat(listFiles(p)) : out.concat(p);
  }
  return out;
}
const portalFiles = [...listFiles(path.join(root, 'src/admin-portal')), path.join(root, 'admin-portal.html')];
ok('portal has source files to scan', portalFiles.length >= 4);
const SECRET_PATTERNS = [/service[_-]?role/i, /BOOTSTRAP_TOKEN/, /SERVICE_ROLE_KEY/, /sb_secret/, /\beyJ[A-Za-z0-9_-]{20,}/];
const offenders = [];
for (const f of portalFiles) {
  const raw = fs.readFileSync(f, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')            // block comments
    .replace(/<!--[\s\S]*?-->/g, '')             // html comments
    .split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');   // line comments
  if (SECRET_PATTERNS.some(re => re.test(raw))) offenders.push(path.relative(root, f));
}
ok('no secret-shaped string in any portal file (service-role key, bootstrap token, JWT)', offenders.length === 0, offenders.join(', '));

/* ---------- the portal actually enforces the gate + real auth calls ---------- */

const appSrc = fs.readFileSync(path.join(root, 'src/admin-portal/app.js'), 'utf8');
ok('app.js gates the dashboard through evaluateAccess()', /evaluateAccess\(/.test(appSrc));
ok('app.js signs a non-admin out rather than showing a broken dashboard',
  /if \(!access\.allowed\)[\s\S]{0,200}auth\.signOut\(\)/.test(appSrc));
ok('app.js logs in via Supabase Auth (signInWithPassword)', /auth\.signInWithPassword\(/.test(appSrc));
ok('app.js logs out via Supabase Auth (signOut)', /auth\.signOut\(/.test(appSrc));
ok('app.js reads audit_log for the Activity log tab', /from\(['"]audit_log['"]\)/.test(appSrc));
{
  const appCode = appSrc.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');
  ok('app.js never reads env directly and never names a service-role key (comments stripped)',
    !/import\.meta\.env/.test(appCode) && !/service[_-]?role/i.test(appCode));
}
ok('app.js reuses the shared safe client factory', /from '\.\.\/supabase\/client\.js'/.test(appSrc));

/* ---------- Phase 1 isolation ---------- */

ok('vite.config.phase1.js does NOT list the admin portal',
  !/admin-portal/.test(fs.readFileSync(path.join(root, 'vite.config.phase1.js'), 'utf8')));
ok('vite.config.js DOES list admin-portal.html as a Phase 2 entry',
  /admin-portal\.html/.test(fs.readFileSync(path.join(root, 'vite.config.js'), 'utf8')));
ok('admin-portal.html is noindex,nofollow',
  /<meta name="robots" content="noindex,nofollow"/.test(fs.readFileSync(path.join(root, 'admin-portal.html'), 'utf8')));

/* ---------- summary ---------- */
console.log('\nPASS ' + pass.length + '   FAIL ' + fail.length + '\n');
if (fail.length) { console.log('FAILURES:'); fail.forEach(f => console.log('  x ' + f)); }
else pass.forEach(p => console.log('  + ' + p));
process.exit(fail.length ? 1 : 0);
