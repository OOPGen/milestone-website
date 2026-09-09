/* Browser-driven smoke test for the account system, against a REAL running
   Worker with real (local) D1 + R2 bindings via `wrangler dev` — not the
   Node/SQLite harness in account-system.test.mjs, which drives the Worker
   module directly. This one exercises actual page loads, cookies, redirects,
   file uploads and layout, exactly as a browser would.

   Setup (three terminals):
     1. npm run build
     2. npx wrangler dev --config wrangler.local-test.toml --port 4200 \
          --local --persist-to .wrangler-local-test
     3. npx wrangler d1 execute milestone-db-local-test \
          --config wrangler.local-test.toml --local \
          --persist-to .wrangler-local-test --file migrations/0001_init.sql
     4. node tests/dashboard-smoke.test.mjs

   wrangler.local-test.toml is local-only scaffolding (dummy D1/R2 ids) — it
   is never used by `npm run deploy` and provisions nothing on Cloudflare.
   Re-run against a fresh --persist-to directory for a clean-state result;
   the bootstrap step below tolerates an already-bootstrapped database. */

import { chromium } from 'playwright';

const B = process.env.SMOKE_BASE || 'http://127.0.0.1:4200';
const pass = [], fail = [];
const ok = (n, c, d = '') => (c ? pass : fail).push(n + (d ? ' — ' + d : ''));
const SHOT = new URL('./.smoke-screenshots/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

async function j(url, opts) {
  const r = await fetch(url, opts);
  let body = {}; try { body = await r.json(); } catch {}
  return { status: r.status, body };
}

/* ---- bootstrap Super Admin via API (as the deployment doc describes) ---- */
const boot = await j(`${B}/api/auth/bootstrap-super-admin`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Bootstrap-Token': 'local-test-bootstrap-token' },
  body: JSON.stringify({ email: 'super-admin-test@example.test' }),
});
ok('Bootstrap succeeds against the real Worker+D1', boot.status === 200 || boot.status === 400, JSON.stringify(boot));

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
page.on('console', m => m.type() === 'error' && errors.push(m.text()));

/* Password verify/hash now costs ~250-1000ms of real work (600,000 PBKDF2
   iterations — see the report this test supports), and change-password does
   TWO such operations sequentially (verify the old one, hash the new one).
   Poll instead of guessing a fixed sleep, so this stays correct as that cost
   is tuned rather than becoming flaky. */
async function waitForText(locator, substring, timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const text = await locator.innerText().catch(() => '');
    if (text.includes(substring)) return text;
    await new Promise(r => setTimeout(r, 150));
  }
  return locator.innerText().catch(() => '');
}

let superAdminLink;
if (boot.status === 200) {
  superAdminLink = `${B}/accept-invitation.html?token=${boot.body.invitationToken}`;
} else {
  // Already bootstrapped by an earlier run in this same persisted D1 — sign in directly instead.
  superAdminLink = null;
}

// Login and invitation-accept now cost ~600,000 PBKDF2 iterations
// (~250-1000ms depending on runtime — see the benchmark in the report this
// test supports). Wait for the actual navigation rather than a guessed
// timeout, so this test doesn't become flaky as that cost is tuned.
if (superAdminLink) {
  await page.goto(superAdminLink, { waitUntil: 'networkidle' });
  await page.fill('#password', 'Sup3r-Admin-Passw0rd!');
  await page.fill('#confirmPassword', 'Sup3r-Admin-Passw0rd!');
  await page.locator('#acceptForm button[type=submit]').click();
  await page.waitForURL(/admin\.html/, { timeout: 15000 }).catch(() => {});
  ok('Accepting the bootstrap invitation lands on the dashboard', page.url().includes('admin.html'));
} else {
  await page.goto(`${B}/login.html`, { waitUntil: 'networkidle' });
  await page.fill('#email', 'super-admin-test@example.test');
  await page.fill('#password', 'Sup3r-Admin-Passw0rd!');
  await page.locator('#loginForm button[type=submit]').click();
  await page.waitForURL(/admin\.html/, { timeout: 15000 }).catch(() => {});
  ok('Signing in as Super Admin lands on the dashboard', page.url().includes('admin.html'));
}

await page.waitForTimeout(500);
ok('Dashboard shows the profile name/role', (await page.locator('#profileName').innerText()).length > 0);
await page.screenshot({ path: SHOT + 'dashboard-overview.png' });

/* ---- notices: create, publish ---- */
await page.locator('[data-view="notice"]').click();
await page.waitForTimeout(500);
await page.fill('[name=title]', 'Sports Day reminder');
await page.fill('[name=summary]', 'Please send your child in sports kit on Friday.');
await page.selectOption('[name=visibility]', 'parents');
await page.locator('#contentForm button[type=submit]').click();
await page.waitForTimeout(700);
ok('Notice appears in the list after creating', (await page.locator('.data-table').innerText()).includes('Sports Day reminder'));
await page.locator('[data-publish]').first().click();
await page.waitForTimeout(700);
ok('Notice can be published from the dashboard', (await page.locator('.data-table').innerText()).includes('published'));
await page.screenshot({ path: SHOT + 'dashboard-notices.png' });

/* ---- term dates & calendar ---- */
await page.locator('[data-view="term_date"]').click();
await page.waitForTimeout(500);
await page.fill('[name=title]', 'Term 4 begins');
await page.selectOption('[name=kind]', 'opening');
await page.fill('[name=startDate]', '2027-01-11');
await page.selectOption('[name=visibility]', 'public');
await page.locator('#contentForm button[type=submit]').click();
await page.waitForTimeout(700);
const calRow = await page.locator('.data-table').innerText();
ok('Calendar entry created with its kind shown', calRow.includes('Term 4 begins') && calRow.includes('Term opening'));
await page.locator('[data-publish]').first().click();
await page.waitForTimeout(600);

/* ---- gallery: album + photo upload ---- */
await page.locator('[data-view="album"]').click();
await page.waitForTimeout(500);
await page.fill('[name=title]', 'Open Day 2026');
await page.selectOption('[name=visibility]', 'parents');
await page.locator('#contentForm button[type=submit]').click();
await page.waitForTimeout(700);
ok('Album created', (await page.locator('.data-table').innerText()).includes('Open Day 2026'));
await page.locator('[data-open]').first().click();
await page.waitForTimeout(500);

const pngBuffer = Buffer.from([
  0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,
  0x00,0x00,0x00,0x0d,0x49,0x48,0x44,0x52,
  0x00,0x00,0x00,0x32,0x00,0x00,0x00,0x32,
  0x08,0x02,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
]);
await page.setInputFiles('#photoUploadForm input[type=file]', { name: 'photo.png', mimeType: 'image/png', buffer: pngBuffer });
await page.fill('#photoUploadForm [name=caption]', 'Parents arriving at the gate');
await page.locator('#photoUploadForm button[type=submit]').click();
await page.waitForTimeout(900);
ok('Photo uploaded and appears in the album', await page.locator('.gallery-thumb').count() >= 1);
// Photos are published immediately on upload (worker/routes/admin.js addAlbumPhoto),
// so the row shows "Unpublish", not "Publish" — confirm that state rather than
// assuming an extra publish step is needed.
ok('Uploaded photo is already published', await page.locator('[data-photo-unpublish]').count() >= 1);
await page.screenshot({ path: SHOT + 'dashboard-gallery.png' });

await page.locator('#backToAlbums').click();
await page.waitForTimeout(500);
await page.locator('[data-publish]').first().click(); // publish the album itself
await page.waitForTimeout(600);

/* ---- documents ---- */
await page.locator('[data-view="documents"]').click();
await page.waitForTimeout(500);
const pdfBuffer = Buffer.from('%PDF-1.4 fake handbook content for smoke test');
await page.setInputFiles('#docForm input[type=file]', { name: 'handbook.pdf', mimeType: 'application/pdf', buffer: pdfBuffer });
await page.fill('[name=title]', 'Parent Handbook');
await page.selectOption('[name=visibility]', 'parents');
await page.locator('#docForm button[type=submit]').click();
await page.waitForTimeout(900);
ok('Document uploaded and listed', (await page.locator('.data-table').innerText()).includes('Parent Handbook'));
await page.locator('[data-doc-publish]').click();
await page.waitForTimeout(600);
await page.screenshot({ path: SHOT + 'dashboard-documents.png' });

/* ---- website pages ---- */
await page.locator('[data-view="pages"]').click();
await page.waitForTimeout(500);
await page.fill('.page-field-form[data-key="home.announcement"] textarea, .page-field-form[data-key="home.announcement"] input', 'Applications for 2027 are now open.');
await page.locator('.page-field-form[data-key="home.announcement"] button[type=submit]').click();
await page.waitForTimeout(700);
ok('Website page field saves', (await page.locator('.page-field-form[data-key="home.announcement"] .form-status').innerText()).includes('Saved'));

/* ---- contacts ---- */
await page.locator('[data-view="contacts"]').click();
await page.waitForTimeout(500);
await page.fill('[name=phone]', '+263 773 072 639');
await page.locator('#contactForm button[type=submit]').click();
await page.waitForTimeout(600);
ok('Super Admin can save contact details', (await page.locator('#contactFormStatus').innerText()).includes('Saved'));

/* ---- invite a staff member ---- */
await page.locator('[data-view="staff"]').click();
await page.waitForTimeout(500);
await page.fill('[name=email]', 'staff-smoke@example.test');
await page.fill('[name=name]', 'Staff Smoke Test');
await page.locator('#inviteForm button[type=submit]').click();
await page.waitForTimeout(700);
ok('Staff invitation returns a usable link', !(await page.locator('#inviteLinkBox').isHidden()));
const staffLink = await page.locator('#inviteLinkBox input').inputValue();
ok('Staff invite link points at accept-invitation.html', staffLink.includes('accept-invitation.html?token='));

/* ---- invite a parent ---- */
await page.locator('[data-view="parents"]').click();
await page.waitForTimeout(500);
await page.fill('[name=email]', 'parent-smoke@example.test');
await page.fill('[name=name]', 'Parent Smoke Test');
await page.locator('#inviteForm button[type=submit]').click();
await page.waitForTimeout(700);
const parentLink = await page.locator('#inviteLinkBox input').inputValue();
ok('Parent invite link created', parentLink.includes('accept-invitation.html?token='));
await page.screenshot({ path: SHOT + 'dashboard-parents.png' });

/* ---- audit log ---- */
await page.locator('[data-view="audit"]').click();
await page.waitForTimeout(500);
const auditText = await page.locator('.data-table').innerText();
ok('Audit log shows content actions', auditText.includes('content.create') && auditText.includes('content.publish'));
ok('Audit log shows invitations', auditText.includes('staff.invited') && auditText.includes('parents.invited'));
ok('Audit log never shows a password', !auditText.toLowerCase().includes('passw'));
await page.screenshot({ path: SHOT + 'dashboard-audit.png' });

/* ---- checklist still works ---- */
await page.locator('[data-view="checklist"]').click();
await page.waitForTimeout(500);
ok('Content checklist view renders', (await page.locator('.checklist li').count()) > 0);

/* ---- settings ---- */
await page.locator('[data-view="settings"]').click();
await page.waitForTimeout(500);
ok('Settings shows system status', (await page.locator('#adminView').innerText()).includes('Accounts database'));

/* =================== now accept the parent invite and check the portal =================== */
const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 950 } });
const page2 = await ctx2.newPage();
page2.on('pageerror', e => errors.push('PAGEERROR(parent): ' + e.message));
await page2.goto(parentLink, { waitUntil: 'networkidle' });
await page2.fill('#password', 'Parent-Smoke-Passw0rd!');
await page2.fill('#confirmPassword', 'Parent-Smoke-Passw0rd!');
await page2.locator('#acceptForm button[type=submit]').click();
await page2.waitForURL(/parent\.html/, { timeout: 15000 }).catch(() => {});
ok('Parent invitation acceptance lands on parent.html', page2.url().includes('parent.html'));

await page2.locator('[data-view="notice"]').click();
await page2.waitForTimeout(500);
ok('Parent sees the published notice', (await page2.locator('#parentView').innerText()).includes('Sports Day reminder'));

await page2.locator('[data-view="term_date"]').click();
await page2.waitForTimeout(500);
ok('Parent sees the published calendar entry', (await page2.locator('#parentView').innerText()).includes('Term 4 begins'));

await page2.locator('[data-view="album"]').click();
await page2.waitForTimeout(500);
ok('Parent sees the published album', (await page2.locator('#parentView').innerText()).includes('Open Day 2026'));
await page2.locator('.gallery-thumb').first().click();
await page2.waitForTimeout(700);
ok('Parent can open the album and see the photo', (await page2.locator('img').count()) > 0);
await page2.screenshot({ path: SHOT + 'parent-gallery.png' });

await page2.locator('#backToAlbums').click();
await page2.waitForTimeout(300);
await page2.locator('[data-view="documents"]').click();
await page2.waitForTimeout(500);
const docLinkHref = await page2.locator('a[href^="/api/files/"]').first().getAttribute('href').catch(() => null);
ok('Parent sees a real download link for the published document', !!docLinkHref, String(docLinkHref));
await page2.screenshot({ path: SHOT + 'parent-documents.png' });

/* Parent cannot reach admin.html */
await page2.goto(`${B}/admin.html`, { waitUntil: 'networkidle' });
await page2.waitForTimeout(700);
ok('A parent visiting admin.html is redirected to parent.html', page2.url().includes('parent.html'));

/* Parent profile: change name and password */
await page2.goto(`${B}/parent.html`, { waitUntil: 'networkidle' });
await page2.locator('[data-view="profile"]').click();
await page2.waitForTimeout(500);
await page2.fill('#profileForm [name=name]', 'Updated Parent Name');
await page2.locator('#profileForm button[type=submit]').click();
const profileStatus = await waitForText(page2.locator('#profileFormStatus'), 'Saved');
ok('Parent can update their own display name', profileStatus.includes('Saved'));

await page2.fill('#passwordForm [name=currentPassword]', 'Parent-Smoke-Passw0rd!');
await page2.fill('#passwordForm [name=newPassword]', 'New-Parent-Passw0rd-2!');
await page2.locator('#passwordForm button[type=submit]').click();
const passwordStatus = await waitForText(page2.locator('#passwordFormStatus'), 'updated');
ok('Parent can change their own password', passwordStatus.includes('updated'));

/* ---- direct API probes: a parent cannot reach staff-only routes ---- */
const parentCookie = (await ctx2.cookies()).find(c => c.name.includes('mjla_session'));
const parentApiCheck = await page2.evaluate(async () => {
  const r = await fetch('/api/admin/parents', { credentials: 'include' });
  return r.status;
});
ok('Parent session gets 403 from a staff-only API route', parentApiCheck === 403, String(parentApiCheck));

/* ---- unauthenticated visitor is bounced from both dashboards ---- */
const ctx3 = await browser.newContext();
const page3 = await ctx3.newPage();
await page3.goto(`${B}/admin.html`, { waitUntil: 'networkidle' });
await page3.waitForTimeout(700);
ok('An unauthenticated visitor is redirected off admin.html', page3.url().includes('login.html'));
await page3.goto(`${B}/parent.html`, { waitUntil: 'networkidle' });
await page3.waitForTimeout(700);
ok('An unauthenticated visitor is redirected off parent.html', page3.url().includes('login.html'));

/* ---- responsive: no horizontal scroll on the dashboard at mobile widths ---- */
for (const w of [375, 768, 1440]) {
  await page.setViewportSize({ width: w, height: 900 });
  await page.waitForTimeout(300);
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok(`No horizontal scroll on dashboard @${w}px`, over <= 1, 'overflow ' + over);
}

ok('No console or page errors across the whole smoke test', errors.length === 0, errors.join(' | '));

await ctx3.close(); await ctx2.close();
await browser.close();

console.log('\nPASS ' + pass.length + '   FAIL ' + fail.length + '\n');
if (fail.length) { console.log('FAILURES:'); fail.forEach(f => console.log('  x ' + f)); }
else pass.forEach(p => console.log('  + ' + p));
process.exit(fail.length ? 1 : 0);
