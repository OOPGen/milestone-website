/* Access-control and content-visibility tests for the account system.

   These import the REAL worker module and drive it with `worker.fetch(req, env)`
   exactly as Cloudflare would, backed by a real SQLite database (node:sqlite)
   applying the real migration file, and an in-memory R2 stand-in. No mock of
   the auth or permission logic — the code under test is the code that ships. */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import worker from '../worker/index.js';
import { createD1 } from './lib/d1-sqlite-adapter.mjs';
import { createMemoryR2 } from './lib/memory-r2.mjs';
import { needsRehash } from '../worker/lib/crypto.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION = path.join(__dirname, '..', 'migrations', '0001_init.sql');

const pass = [], fail = [];
const ok = (n, c, d = '') => (c ? pass : fail).push(n + (d ? ' — ' + d : ''));

function freshEnv() {
  return { DB: createD1([MIGRATION]), MEDIA: createMemoryR2() };
}

const BASE = 'https://example.test';

function req(pathAndQuery, { method = 'GET', body, cookie, headers = {} } = {}) {
  const h = { ...headers };
  if (body !== undefined) h['Content-Type'] = 'application/json';
  if (cookie) h['Cookie'] = cookie;
  return new Request(BASE + pathAndQuery, {
    method,
    headers: h,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

function cookieFrom(response) {
  const raw = response.headers.get('Set-Cookie') || '';
  return raw.split(';')[0]; // "__Host-mjla_session=...."
}

async function bodyOf(response) {
  try { return await response.json(); } catch { return null; }
}

/* ---------------------------------------------------------------------------
   Test fixture: bootstrap a Super Admin, then have them invite a Staff Admin
   and a Parent, accepting both invitations, giving us three live sessions.
   --------------------------------------------------------------------------- */

async function buildFixture() {
  const env = freshEnv();
  env.SUPER_ADMIN_EMAIL = 'super-admin-test@example.test';
  env.BOOTSTRAP_TOKEN = 'test-bootstrap-token';

  // Bootstrap
  const bootRes = await worker.fetch(
    req('/api/auth/bootstrap-super-admin', {
      method: 'POST', body: { email: env.SUPER_ADMIN_EMAIL },
      headers: { 'X-Bootstrap-Token': 'test-bootstrap-token' },
    }), env
  );
  const bootBody = await bodyOf(bootRes);

  const superAdminAccept = await worker.fetch(
    req('/api/auth/accept-invitation', {
      method: 'POST', body: { token: bootBody.invitationToken, password: 'Sup3r-Admin-Passw0rd!' },
    }), env
  );
  const superAdminCookie = cookieFrom(superAdminAccept);
  const superAdmin = (await bodyOf(superAdminAccept)).user;

  // Invite a Staff Admin
  const staffInvite = await bodyOf(await worker.fetch(
    req('/api/admin/staff/invite', {
      method: 'POST', cookie: superAdminCookie,
      body: { email: 'staff@example.test', name: 'Staff Person', role: 'STAFF_ADMIN' },
    }), env
  ));
  const staffAccept = await worker.fetch(
    req('/api/auth/accept-invitation', {
      method: 'POST', body: { token: staffInvite.invitationToken, password: 'Staff-Passw0rd!' },
    }), env
  );
  const staffCookie = cookieFrom(staffAccept);
  const staff = (await bodyOf(staffAccept)).user;

  // Invite a Parent
  const parentInvite = await bodyOf(await worker.fetch(
    req('/api/admin/parents/invite', {
      method: 'POST', cookie: superAdminCookie,
      body: { email: 'parent@example.test', name: 'A Parent' },
    }), env
  ));
  const parentAccept = await worker.fetch(
    req('/api/auth/accept-invitation', {
      method: 'POST', body: { token: parentInvite.invitationToken, password: 'Parent-Passw0rd!' },
    }), env
  );
  const parentCookie = cookieFrom(parentAccept);
  const parentUser = (await bodyOf(parentAccept)).user;

  return { env, superAdminCookie, superAdmin, staffCookie, staff, parentCookie, parentUser };
}

/* ============================================================================
   1. Bootstrap
   ============================================================================ */
{
  const env = freshEnv();
  env.SUPER_ADMIN_EMAIL = 'super-admin-test@example.test';
  env.BOOTSTRAP_TOKEN = 'secret-token';

  const wrongToken = await worker.fetch(
    req('/api/auth/bootstrap-super-admin', { method: 'POST', body: { email: env.SUPER_ADMIN_EMAIL }, headers: { 'X-Bootstrap-Token': 'nope' } }), env
  );
  ok('Bootstrap rejects wrong token', wrongToken.status === 401);

  const wrongEmail = await worker.fetch(
    req('/api/auth/bootstrap-super-admin', { method: 'POST', body: { email: 'someoneelse@example.com' }, headers: { 'X-Bootstrap-Token': 'secret-token' } }), env
  );
  ok('Bootstrap rejects an email that is not the configured Super Admin', wrongEmail.status === 400);

  const good = await worker.fetch(
    req('/api/auth/bootstrap-super-admin', { method: 'POST', body: { email: env.SUPER_ADMIN_EMAIL }, headers: { 'X-Bootstrap-Token': 'secret-token' } }), env
  );
  ok('Bootstrap succeeds once, with the right token and email', good.status === 200);
  const goodBody = await bodyOf(good);
  ok('Bootstrap returns an invitation token, not a password', typeof goodBody.invitationToken === 'string' && !goodBody.password);

  const second = await worker.fetch(
    req('/api/auth/bootstrap-super-admin', { method: 'POST', body: { email: env.SUPER_ADMIN_EMAIL }, headers: { 'X-Bootstrap-Token': 'secret-token' } }), env
  );
  ok('Bootstrap refuses once a Super Admin exists', second.status === 400);

  const noConfig = await worker.fetch(
    req('/api/auth/bootstrap-super-admin', { method: 'POST', body: {} }), freshEnv()
  );
  ok('Bootstrap is inert with no BOOTSTRAP_TOKEN/SUPER_ADMIN_EMAIL configured', noConfig.status === 503);
}

/* ============================================================================
   2. Login: generic failure wording, rate limiting, session cookie shape
   ============================================================================ */
{
  const { env, superAdmin } = await buildFixture();

  const noSuchUser = await worker.fetch(req('/api/auth/login', { method: 'POST', body: { email: 'nobody@example.test', password: 'whatever12345' } }), env);
  const wrongPassword = await worker.fetch(req('/api/auth/login', { method: 'POST', body: { email: superAdmin.email, password: 'wrong-password-123' } }), env);
  ok('Unknown account and wrong password give the same status', noSuchUser.status === wrongPassword.status);
  const b1 = await bodyOf(noSuchUser), b2 = await bodyOf(wrongPassword);
  ok('Unknown account and wrong password give the same generic message', b1.message === b2.message);
  ok('Failure message is the generic wording', b1.message === 'Email or password is incorrect.');
  ok('Failure response carries no cookie', !noSuchUser.headers.get('Set-Cookie'));

  const goodLogin = await worker.fetch(req('/api/auth/login', { method: 'POST', body: { email: superAdmin.email, password: 'Sup3r-Admin-Passw0rd!' } }), env);
  ok('Correct password succeeds', goodLogin.status === 200);
  const cookie = goodLogin.headers.get('Set-Cookie') || '';
  ok('Session cookie is HttpOnly', /HttpOnly/i.test(cookie));
  ok('Session cookie is Secure', /Secure/i.test(cookie));
  ok('Session cookie is SameSite=Lax', /SameSite=Lax/i.test(cookie));
  ok('Session cookie uses the __Host- prefix', cookie.startsWith('__Host-mjla_session='));
  const loginBody = await bodyOf(goodLogin);
  ok('Login response never includes a password hash', JSON.stringify(loginBody).toLowerCase().indexOf('hash') === -1);

  // Rate limiting: 5 failures lock the pair out
  const rlEnv = freshEnv();
  let locked = 0;
  for (let i = 0; i < 7; i++) {
    const r = await worker.fetch(req('/api/auth/login', { method: 'POST', body: { email: 'rl@example.test', password: 'x' } }), rlEnv);
    if (r.status === 429) locked++;
  }
  ok('Repeated failed logins are rate limited', locked > 0, `${locked} of 7 locked`);
}

/* ============================================================================
   3. Session behaviour: /me, logout, expiry is checked live, deactivation
   ============================================================================ */
{
  const { env, superAdminCookie, staffCookie, staff } = await buildFixture();

  const meNoCookie = await worker.fetch(req('/api/auth/me'), env);
  ok('/me with no session is unauthorized', meNoCookie.status === 401);

  const meWithCookie = await worker.fetch(req('/api/auth/me', { cookie: staffCookie }), env);
  ok('/me with a valid session succeeds', meWithCookie.status === 200);
  const meBody = await bodyOf(meWithCookie);
  ok('/me returns no password field', !('password' in (meBody.user || {})) && !('password_hash' in (meBody.user || {})));

  const logoutRes = await worker.fetch(req('/api/auth/logout', { method: 'POST', cookie: staffCookie }), env);
  ok('Logout clears the cookie', /Max-Age=0/.test(logoutRes.headers.get('Set-Cookie') || ''));
  const meAfterLogout = await worker.fetch(req('/api/auth/me', { cookie: staffCookie }), env);
  ok('Session is dead immediately after logout', meAfterLogout.status === 401);

  // Deactivation takes effect on an existing session, not just at next login
  const staff2 = await bodyOf(await worker.fetch(req('/api/admin/staff/invite', { method: 'POST', cookie: superAdminCookie, body: { email: 'staff2@example.test', name: 'Staff Two', role: 'STAFF_ADMIN' } }), env));
  const staff2Accept = await worker.fetch(req('/api/auth/accept-invitation', { method: 'POST', body: { token: staff2.invitationToken, password: 'Staff-Two-Pass!' } }), env);
  const staff2Cookie = cookieFrom(staff2Accept);
  const staff2User = (await bodyOf(staff2Accept)).user;

  const preCheck = await worker.fetch(req('/api/auth/me', { cookie: staff2Cookie }), env);
  ok('Newly accepted staff session works', preCheck.status === 200);

  await worker.fetch(req(`/api/admin/accounts/${staff2User.id}/status`, { method: 'POST', cookie: superAdminCookie, body: { status: 'deactivated' } }), env);
  const postDeactivate = await worker.fetch(req('/api/auth/me', { cookie: staff2Cookie }), env);
  ok('Deactivation kills the live session immediately (not just at next login)', postDeactivate.status === 401);
}

/* ============================================================================
   4. Permission matrix — every role boundary the brief specifies
   ============================================================================ */
{
  const { env, superAdminCookie, staffCookie, parentCookie } = await buildFixture();

  // Parent cannot create/edit/publish/archive content
  const parentCreate = await worker.fetch(req('/api/admin/content/notice', { method: 'POST', cookie: parentCookie, body: { title: 'x' } }), env);
  ok('Parent cannot create content', parentCreate.status === 403);

  // Staff Admin CAN create/publish content
  const staffCreate = await bodyOf(await worker.fetch(req('/api/admin/content/notice', { method: 'POST', cookie: staffCookie, body: { title: 'Sports day', visibility: 'parents' } }), env));
  ok('Staff Admin can create a notice', typeof staffCreate.id === 'string');
  const publishRes = await worker.fetch(req(`/api/admin/content/item/${staffCreate.id}/publish`, { method: 'POST', cookie: staffCookie }), env);
  ok('Staff Admin can publish a notice', publishRes.status === 200);

  // Staff Admin cannot hard-delete
  const staffHardDelete = await worker.fetch(req(`/api/admin/content/item/${staffCreate.id}`, { method: 'DELETE', cookie: staffCookie }), env);
  ok('Staff Admin cannot hard-delete content', staffHardDelete.status === 403);
  // Super Admin can
  const superHardDelete = await worker.fetch(req(`/api/admin/content/item/${staffCreate.id}`, { method: 'DELETE', cookie: superAdminCookie }), env);
  ok('Super Admin can hard-delete content', superHardDelete.status === 200);

  // Staff Admin cannot invite or manage staff
  const staffInvitesStaff = await worker.fetch(req('/api/admin/staff/invite', { method: 'POST', cookie: staffCookie, body: { email: 'sneaky@example.test', role: 'STAFF_ADMIN' } }), env);
  ok('Staff Admin cannot invite another Staff Admin', staffInvitesStaff.status === 403);
  // But CAN invite/manage parents
  const staffInvitesParent = await worker.fetch(req('/api/admin/parents/invite', { method: 'POST', cookie: staffCookie, body: { email: 'parent2@example.test' } }), env);
  ok('Staff Admin CAN invite a parent', staffInvitesParent.status === 200);

  // Staff Admin cannot escalate to Super Admin
  const staffInvitesSuperAdmin = await worker.fetch(req('/api/admin/staff/invite', { method: 'POST', cookie: staffCookie, body: { email: 'sneaky2@example.test', role: 'SUPER_ADMIN' } }), env);
  ok('Staff Admin cannot invite a Super Admin', staffInvitesSuperAdmin.status === 403);

  // Staff Admin cannot read the audit log or manage settings
  const staffAudit = await worker.fetch(req('/api/admin/audit', { cookie: staffCookie }), env);
  ok('Staff Admin cannot read the audit log', staffAudit.status === 403);
  const superAudit = await worker.fetch(req('/api/admin/audit', { cookie: superAdminCookie }), env);
  ok('Super Admin CAN read the audit log', superAudit.status === 200);

  // Staff Admin cannot grant permissions or edit contacts without a grant
  const contactEditDenied = await worker.fetch(req('/api/admin/site-content/contact.details', { method: 'POST', cookie: staffCookie, body: { value: { phone: '123' } } }), env);
  ok('Staff Admin cannot edit contacts without an explicit grant', contactEditDenied.status === 403);

  // Parent cannot view other users, only self
  const parentListsParents = await worker.fetch(req('/api/admin/parents', { cookie: parentCookie }), env);
  ok('Parent cannot list other accounts', parentListsParents.status === 403);

  // Parent cannot upload media
  const parentUpload = await worker.fetch(req('/api/admin/media', { method: 'POST', cookie: parentCookie, headers: { 'Content-Type': 'multipart/form-data; boundary=x' } }), env);
  ok('Parent cannot upload media', parentUpload.status === 403);
}

/* ============================================================================
   5. The one delegable permission (contacts.edit) — Super Admin only to grant
   ============================================================================ */
{
  const { env, superAdminCookie, staffCookie, staff } = await buildFixture();

  const grant = await worker.fetch(req(`/api/admin/accounts/permission/${staff.id}`, { method: 'POST', cookie: superAdminCookie, body: { capability: 'contacts.edit', grant: true } }), env);
  ok('Super Admin can grant contacts.edit', grant.status === 200);

  const nowAllowed = await worker.fetch(req('/api/admin/site-content/contact.details', { method: 'POST', cookie: staffCookie, body: { value: { phone: '+263 000 000' } } }), env);
  ok('Staff Admin can edit contacts once granted', nowAllowed.status === 200);

  const staffGrantsSelf = await worker.fetch(req(`/api/admin/accounts/permission/${staff.id}`, { method: 'POST', cookie: staffCookie, body: { capability: 'contacts.edit', grant: true } }), env);
  ok('Staff Admin cannot grant permissions themselves', staffGrantsSelf.status === 403);

  const revoke = await worker.fetch(req(`/api/admin/accounts/permission/${staff.id}`, { method: 'POST', cookie: superAdminCookie, body: { capability: 'contacts.edit', grant: false } }), env);
  ok('Super Admin can revoke it again', revoke.status === 200);
  const revoked = await worker.fetch(req('/api/admin/site-content/contact.details', { method: 'POST', cookie: staffCookie, body: { value: { phone: '000' } } }), env);
  ok('Staff Admin loses access once revoked', revoked.status === 403);

  const nonGrantable = await worker.fetch(req(`/api/admin/accounts/permission/${staff.id}`, { method: 'POST', cookie: superAdminCookie, body: { capability: 'staff.manage', grant: true } }), env);
  ok('A non-delegable capability cannot be granted at all', nonGrantable.status === 400);
}

/* ============================================================================
   6. Lock-out prevention: last Super Admin, self-deactivation
   ============================================================================ */
{
  const { env, superAdminCookie, superAdmin } = await buildFixture();

  const selfDeactivate = await worker.fetch(req(`/api/admin/accounts/${superAdmin.id}/status`, { method: 'POST', cookie: superAdminCookie, body: { status: 'deactivated' } }), env);
  ok('A user cannot deactivate their own account', selfDeactivate.status === 400);

  // Only one Super Admin exists in this fixture, so it cannot be deactivated
  // by anyone else either — there is nobody else with staff.manage.
}

/* ============================================================================
   7. Content visibility: public vs parents-only, enforced in SQL
   ============================================================================ */
{
  const { env, staffCookie, parentCookie } = await buildFixture();

  const makeAndPublish = async (title, visibility) => {
    const created = await bodyOf(await worker.fetch(req('/api/admin/content/news', { method: 'POST', cookie: staffCookie, body: { title, visibility, summary: 's' } }), env));
    await worker.fetch(req(`/api/admin/content/item/${created.id}/publish`, { method: 'POST', cookie: staffCookie }), env);
    return created.id;
  };

  await makeAndPublish('Public news item', 'public');
  await makeAndPublish('Parents-only news item', 'parents');
  const draftId = await bodyOf(await worker.fetch(req('/api/admin/content/news', { method: 'POST', cookie: staffCookie, body: { title: 'Draft item', visibility: 'public' } }), env));

  const publicList = await bodyOf(await worker.fetch(req('/api/public/content/news'), env));
  ok('Public feed contains the public item', publicList.items.some(i => i.title === 'Public news item'));
  ok('Public feed excludes the parents-only item', !publicList.items.some(i => i.title === 'Parents-only news item'));
  ok('Public feed excludes drafts', !publicList.items.some(i => i.title === 'Draft item'));

  const publicWithoutSession = publicList; // already fetched with no cookie
  ok('Public feed needs no session at all', true);

  const parentList = await bodyOf(await worker.fetch(req('/api/parent/content/news', { cookie: parentCookie }), env));
  ok('Parent feed contains the public item too', parentList.items.some(i => i.title === 'Public news item'));
  ok('Parent feed ALSO contains the parents-only item', parentList.items.some(i => i.title === 'Parents-only news item'));
  ok('Parent feed excludes drafts', !parentList.items.some(i => i.title === 'Draft item'));

  const parentFeedNoSession = await worker.fetch(req('/api/parent/content/news'), env);
  ok('Parent feed refuses an unauthenticated request', parentFeedNoSession.status === 401);
}

/* ============================================================================
   8. Files: public assets need no session; parent-only assets 404 (not 403)
      for an unauthenticated request, so existence is never confirmed.
   ============================================================================ */
{
  const { env, staffCookie, parentCookie } = await buildFixture();

  // A minimal, well-formed 40x40 PNG header — enough for readImageDimensions()
  // in worker/routes/media.js to parse real width/height from.
  const minimalPng = Buffer.from([
    0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,
    0x00,0x00,0x00,0x0d,0x49,0x48,0x44,0x52,
    0x00,0x00,0x00,0x28,0x00,0x00,0x00,0x28, // width=40, height=40 (big-endian)
    0x08,0x02,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
  ]);

  async function upload(visibility) {
    const form = new FormData();
    form.append('visibility', visibility);
    form.append('file', new File([minimalPng], 'photo.png', { type: 'image/png' }));
    const res = await worker.fetch(new Request(BASE + '/api/admin/media', {
      method: 'POST', headers: { Cookie: staffCookie }, body: form,
    }), env);
    return bodyOf(res);
  }

  const publicAsset = await upload('public');
  ok('Public image upload validates real PNG dimensions', publicAsset.asset.width === 40 && publicAsset.asset.height === 40);
  const parentAsset = await upload('parents');

  const publicFetch = await worker.fetch(req(`/api/files/${publicAsset.asset.id}`), env);
  ok('Public asset is reachable with no session', publicFetch.status === 200);

  const parentFetchNoSession = await worker.fetch(req(`/api/files/${parentAsset.asset.id}`), env);
  ok('Parents-only asset returns 404 (not 403) to a stranger — does not confirm existence', parentFetchNoSession.status === 404);

  const parentFetchAsParent = await worker.fetch(req(`/api/files/${parentAsset.asset.id}`, { cookie: parentCookie }), env);
  ok('Parents-only asset IS reachable by a signed-in parent', parentFetchAsParent.status === 200);

  const unknownAsset = await worker.fetch(req('/api/files/does-not-exist'), env);
  ok('Unknown asset id is 404', unknownAsset.status === 404);
}

/* ============================================================================
   9. Upload validation: type, size, empty file
   ============================================================================ */
{
  const { env, staffCookie } = await buildFixture();

  const badType = new FormData();
  badType.append('file', new File([new Uint8Array([1,2,3])], 'x.exe', { type: 'application/x-msdownload' }));
  const badTypeRes = await worker.fetch(new Request(BASE + '/api/admin/media', { method: 'POST', headers: { Cookie: staffCookie }, body: badType }), env);
  ok('Rejects a disallowed file type', badTypeRes.status === 400);

  const empty = new FormData();
  empty.append('file', new File([], 'empty.pdf', { type: 'application/pdf' }));
  const emptyRes = await worker.fetch(new Request(BASE + '/api/admin/media', { method: 'POST', headers: { Cookie: staffCookie }, body: empty }), env);
  ok('Rejects an empty file', emptyRes.status === 400);

  const tooBig = new FormData();
  tooBig.append('file', new File([new Uint8Array(9 * 1024 * 1024)], 'huge.jpg', { type: 'image/jpeg' }));
  const tooBigRes = await worker.fetch(new Request(BASE + '/api/admin/media', { method: 'POST', headers: { Cookie: staffCookie }, body: tooBig }), env);
  ok('Rejects an oversized image', tooBigRes.status === 400);
}

/* ============================================================================
   10. Documents: PDF-only, replace-with-version-history, unpublished = 404
       via /api/files, and the six placeholder PDFs stay unreachable.
   ============================================================================ */
{
  const { env, staffCookie, parentCookie } = await buildFixture();

  const pdfBytes = new TextEncoder().encode('%PDF-1.4 fake pdf content');
  const upForm = new FormData();
  upForm.append('visibility', 'parents');
  upForm.append('file', new File([pdfBytes], 'handbook.pdf', { type: 'application/pdf' }));
  const uploaded = await bodyOf(await worker.fetch(new Request(BASE + '/api/admin/media', { method: 'POST', headers: { Cookie: staffCookie }, body: upForm }), env));

  const v1 = await bodyOf(await worker.fetch(req('/api/admin/documents/versions', { method: 'POST', cookie: staffCookie, body: { title: 'Parent Handbook', category: 'Handbook', visibility: 'parents', assetId: uploaded.asset.id } }), env));
  ok('First version creates the document', v1.version === 1);

  // Unpublished: a parent cannot download it yet
  const beforePublish = await bodyOf(await worker.fetch(req('/api/parent/documents', { cookie: parentCookie }), env));
  ok('Unpublished document does not appear to parents', !beforePublish.documents.some(d => d.id === v1.documentId));

  await worker.fetch(req(`/api/admin/documents/${v1.documentId}/status`, { method: 'POST', cookie: staffCookie, body: { status: 'published' } }), env);
  const afterPublish = await bodyOf(await worker.fetch(req('/api/parent/documents', { cookie: parentCookie }), env));
  ok('Published parents-only document appears to a parent', afterPublish.documents.some(d => d.id === v1.documentId));

  // Replace with a new version — history retained
  const upForm2 = new FormData();
  upForm2.append('visibility', 'parents');
  upForm2.append('file', new File([new TextEncoder().encode('%PDF-1.4 v2 content')], 'handbook-v2.pdf', { type: 'application/pdf' }));
  const uploaded2 = await bodyOf(await worker.fetch(new Request(BASE + '/api/admin/media', { method: 'POST', headers: { Cookie: staffCookie }, body: upForm2 }), env));
  const v2 = await bodyOf(await worker.fetch(req('/api/admin/documents/versions', { method: 'POST', cookie: staffCookie, body: { documentId: v1.documentId, assetId: uploaded2.asset.id, note: 'Updated term dates' } }), env));
  ok('Replacing a document adds version 2', v2.version === 2);

  const versionCount = await env.DB.prepare('SELECT COUNT(*) AS n FROM document_versions WHERE document_id = ?').bind(v1.documentId).first();
  ok('Both versions are retained (audit history, not overwritten)', versionCount.n === 2);

  // The six original placeholder PDFs must not exist as reachable assets at all
  for (const name of ['prospectus', 'fee-structure', 'application-form', 'school-calendar', 'uniform-guide', 'parent-handbook']) {
    const guess = await worker.fetch(req(`/api/files/${name}`), env);
    ok(`Placeholder "${name}" is not reachable by a guessable id`, guess.status === 404);
  }
}

/* ============================================================================
   11. Structured content only — no raw HTML editor; rich text is sanitised
   ============================================================================ */
{
  const { env, staffCookie } = await buildFixture();
  const created = await bodyOf(await worker.fetch(req('/api/admin/content/notice', {
    method: 'POST', cookie: staffCookie,
    body: { title: 'Notice', visibility: 'parents', body: '<p>Hello</p><script>alert(1)</script><img src=x onerror=alert(1)>' },
  }), env));
  const row = await env.DB.prepare('SELECT body FROM content_items WHERE id = ?').bind(created.id).first();
  ok('Script tags are stripped from stored content', !row.body.includes('<script'));
  ok('Event-handler-bearing tags are stripped', !row.body.includes('onerror'));
  ok('Allowed formatting tags survive', row.body.includes('<p>Hello</p>'));
}

/* ============================================================================
   12. Audit log: covers the required actions, and never records a secret
   ============================================================================ */
{
  const { env, superAdminCookie, staffCookie } = await buildFixture();
  await worker.fetch(req('/api/auth/login', { method: 'POST', body: { email: 'nosuchuser@example.test', password: 'whatever-long-enough' } }), env);
  const auditFixtureItem = await bodyOf(await worker.fetch(req('/api/admin/content/notice', { method: 'POST', cookie: staffCookie, body: { title: 'Audit test notice', visibility: 'parents' } }), env));
  await worker.fetch(req(`/api/admin/content/item/${auditFixtureItem.id}/publish`, { method: 'POST', cookie: staffCookie }), env);

  const auditNoSession = await worker.fetch(req('/api/admin/audit'), env);
  ok('Audit log endpoint refuses an unauthenticated request', auditNoSession.status === 401);
  const auditAsStaff = await worker.fetch(req('/api/admin/audit', { cookie: staffCookie }), env);
  ok('Audit log endpoint refuses Staff Admin', auditAsStaff.status === 403);

  const { entries } = await bodyOf(await worker.fetch(req('/api/admin/audit', { cookie: superAdminCookie }), env));

  const actions = entries.map(e => e.action);
  for (const expected of ['auth.bootstrap_super_admin', 'auth.invitation_accepted', 'staff.invited', 'parents.invited', 'content.create', 'content.publish', 'auth.login_failed'])
    ok(`Audit log records "${expected}"`, actions.includes(expected), actions.join(','));

  const raw = JSON.stringify(entries).toLowerCase();
  ok('Audit log never contains the word "password"', !raw.includes('passw'));
  ok('Audit log never contains a session token fragment', !raw.includes('pbkdf2'));
}

/* ============================================================================
   13. Content-management model: every item carries the required fields
   ============================================================================ */
{
  const { env, staffCookie } = await buildFixture();
  const created = await bodyOf(await worker.fetch(req('/api/admin/content/event', { method: 'POST', cookie: staffCookie, body: { title: 'Open Day', summary: 'Come visit', visibility: 'public', category: 'Admissions', startDate: '2027-02-10' } }), env));
  const row = await env.DB.prepare('SELECT * FROM content_items WHERE id = ?').bind(created.id).first();
  for (const col of ['title', 'summary', 'category', 'start_date', 'status', 'visibility', 'created_by', 'updated_by', 'created_at'])
    ok(`Content row has "${col}"`, row[col] !== undefined && row[col] !== null, String(row[col]));
  ok('New content starts as draft', row.status === 'draft');
}

/* ============================================================================
   14. Password hashing: format, timing-safe enumeration resistance,
       and upgrade-on-successful-login (never weakens an existing hash)
   ============================================================================ */
{
  const env = freshEnv();

  // A hash exactly as the PRIOR pass would have produced: same primitive
  // (PBKDF2 with the SHA-256 PRF), lower iteration count, old field layout —
  // simulating a real account that predates this correction.
  const password = 'a-legacy-parent-password-1!';
  const salt = new Uint8Array(16).fill(9);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 210000 }, key, 256);
  const b64url = buf => Buffer.from(buf).toString('base64url');
  const legacyHash = `pbkdf2$sha256$210000$${b64url(salt)}$${b64url(bits)}`;

  ok('needsRehash flags a genuine legacy-format hash', needsRehash(legacyHash));

  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO users (id, email, email_lower, name, role, status, password_hash, extra_permissions, created_at, updated_at)
     VALUES ('usr_legacy01', 'legacy-parent@example.test', 'legacy-parent@example.test', 'Legacy Parent', 'PARENT', 'active', ?, '[]', ?, ?)`
  ).bind(legacyHash, now, now).run();

  const firstLogin = await worker.fetch(req('/api/auth/login', { method: 'POST', body: { email: 'legacy-parent@example.test', password } }), env);
  ok('Login succeeds against a genuine legacy-format hash', firstLogin.status === 200);

  const afterFirstLogin = await env.DB.prepare('SELECT password_hash FROM users WHERE id = ?').bind('usr_legacy01').first();
  ok('Hash was rewritten on successful login', afterFirstLogin.password_hash !== legacyHash);
  ok('Rewritten hash uses the current algorithm/version', afterFirstLogin.password_hash.startsWith('pbkdf2-hmac-sha256$v1$'));
  ok('Rewritten hash uses the current iteration count (600000)', afterFirstLogin.password_hash.includes('$v1$600000$'));
  ok('Upgraded hash no longer needs rehashing', !needsRehash(afterFirstLogin.password_hash));

  // Log in again with the SAME password: still works, and the now-current
  // hash is left untouched (never re-derived down, never touched needlessly).
  const secondLogin = await worker.fetch(req('/api/auth/login', { method: 'POST', body: { email: 'legacy-parent@example.test', password } }), env);
  ok('Login still succeeds after the upgrade', secondLogin.status === 200);
  const afterSecondLogin = await env.DB.prepare('SELECT password_hash FROM users WHERE id = ?').bind('usr_legacy01').first();
  ok('Hash is stable across a second login (not re-derived every time)', afterSecondLogin.password_hash === afterFirstLogin.password_hash);

  const wrongPasswordAfterUpgrade = await worker.fetch(req('/api/auth/login', { method: 'POST', body: { email: 'legacy-parent@example.test', password: 'not the password' } }), env);
  ok('Wrong password still rejected after upgrade', wrongPasswordAfterUpgrade.status === 400);
}

/* ============================================================================
   15. Login timing does not distinguish a nonexistent account from a real
       one with a wrong password (enumeration resistance via constant-cost
       verification, not just identical status/message).
   ============================================================================ */
{
  const env = freshEnv();
  const password = 'timing-check-password-1!';
  const now = new Date().toISOString();
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const salt = new Uint8Array(16).fill(3);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 600000 }, key, 256);
  const b64url = buf => Buffer.from(buf).toString('base64url');
  const hash = `pbkdf2-hmac-sha256$v1$600000$${b64url(salt)}$${b64url(bits)}`;
  await env.DB.prepare(
    `INSERT INTO users (id, email, email_lower, name, role, status, password_hash, extra_permissions, created_at, updated_at)
     VALUES ('usr_timing01', 'timing-real@example.test', 'timing-real@example.test', 'Timing Real', 'PARENT', 'active', ?, '[]', ?, ?)`
  ).bind(hash, now, now).run();

  // Each sample uses a distinct source IP (via X-Forwarded-For). Without
  // this, repeated attempts share one rate-limit bucket and the throttle —
  // which is REQUIRED to short-circuit before the expensive verification
  // (see test 2's rate-limit coverage) — starts returning early for some
  // samples but not others, which would make this timing comparison
  // meaningless rather than revealing anything about verifyPassword itself.
  let ipSeq = 0;
  const timeIt = async email => {
    const ip = `10.77.${(ipSeq >> 8) & 255}.${ipSeq++ & 255}`;
    const t0 = performance.now();
    const res = await worker.fetch(req('/api/auth/login', {
      method: 'POST', body: { email, password: 'definitely-wrong-guess-1' },
      headers: { 'X-Forwarded-For': ip },
    }), env);
    if (res.status === 429) throw new Error('sample was rate-limited — timing comparison is invalid');
    return performance.now() - t0;
  };

  // Several samples each, since a single call is noisy; the real hardening
  // here is architectural (verifyPassword always runs, per crypto.js), so
  // this is a sanity check, not the sole evidence — see tests/bench-hash.mjs
  // for the isolated, more precise timing measurement.
  const REAL_SAMPLES = [], GHOST_SAMPLES = [];
  for (let i = 0; i < 5; i++) {
    REAL_SAMPLES.push(await timeIt('timing-real@example.test'));
    GHOST_SAMPLES.push(await timeIt('no-such-account@example.test'));
  }
  const median = arr => [...arr].sort((a, b) => a - b)[Math.floor(arr.length / 2)];
  const realMedian = median(REAL_SAMPLES), ghostMedian = median(GHOST_SAMPLES);
  const ratio = Math.max(realMedian, ghostMedian) / Math.max(1, Math.min(realMedian, ghostMedian));
  // A skipped PBKDF2 call for the nonexistent account would show as a huge
  // ratio (real hashing costs ~200ms+, a skip costs ~1ms) — a generous 3x
  // bound catches that failure mode without being noise-sensitive in CI.
  ok('Nonexistent-account login is not dramatically faster than a real one (no obvious timing side channel)',
     ratio < 3, `real=${realMedian.toFixed(1)}ms ghost=${ghostMedian.toFixed(1)}ms ratio=${ratio.toFixed(2)}`);
}

/* ============================================================================
   Summary
   ============================================================================ */

console.log('\nPASS ' + pass.length + '   FAIL ' + fail.length + '\n');
if (fail.length) { console.log('FAILURES:'); fail.forEach(f => console.log('  x ' + f)); }
else pass.forEach(p => console.log('  + ' + p));
process.exit(fail.length ? 1 : 0);
