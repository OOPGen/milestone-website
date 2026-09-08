import { chromium } from 'playwright';
const B = 'http://127.0.0.1:4195/';
const pass = [], fail = [];
const ok = (n, c, d = '') => (c ? pass : fail).push(n + (d ? ' — ' + d : ''));
const mock = p => fetch('http://127.0.0.1:4199' + p).then(r => r.text());
const mailbox = () => fetch('http://127.0.0.1:4199/__received').then(r => r.json());
const SUCCESS = 'Thank you — we have received your enquiry. Our school team will respond using your preferred contact details.';
const FAILURE = 'We could not send your enquiry right now. Please try again, or contact the school directly by WhatsApp, phone, or email.';
const SHOT = 'C:/Users/USER/AppData/Local/Temp/claude/c--Users-USER-Pictures-milestone-website/84f8ed6e-ab92-434c-935e-1fe29a00ad6d/scratchpad/';

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
const page = await ctx.newPage();
const errors = [];
page.on('console', m => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
await mock('/__mode/ok');
await mock('/__reset');   // the mock persists between runs; start from empty
await page.goto(B, { waitUntil: 'networkidle' });

/* ---------- newsletter replaced by CTA ---------- */
const body = await page.locator('body').innerText();
ok('No newsletter email input', await page.locator('.newsletter-card input[type=email]').count() === 0);
ok('No Subscribe button', !body.includes('Subscribe'));
ok('CTA heading exact', body.includes('Stay connected with Milestone'));
ok('CTA body exact', body.includes('For school updates and admissions enquiries, contact our team directly on WhatsApp.'));
const cta = page.locator('.connect-card');
ok('CTA primary is Chat on WhatsApp', (await cta.locator('a').first().innerText()).includes('Chat on WhatsApp'));
ok('CTA secondary is Call the School', (await cta.locator('a').nth(1).innerText()).includes('Call the School'));
ok('CTA WhatsApp uses config number', (await cta.locator('a').first().getAttribute('href')).includes('wa.me/48791753077'));

/* ---------- contact form: client-side validation ---------- */
const cf = page.locator('#contact-form');
await cf.scrollIntoViewIfNeeded();
await cf.locator('button[type=submit]').click();
await page.waitForTimeout(300);
ok('Empty submit shows inline name error', (await page.locator('#cf-name-error').innerText()).length > 0);
ok('Invalid field marked aria-invalid', await page.locator('#cf-name').getAttribute('aria-invalid') === 'true');
ok('Error linked via aria-describedby', await page.locator('#cf-name').getAttribute('aria-describedby') === 'cf-name-error');
ok('Form is novalidate (no native bubbles)', await cf.getAttribute('novalidate') !== null);
ok('Focus moved to first invalid field', await page.evaluate(() => document.activeElement?.id) === 'cf-name');

await page.fill('#cf-name', 'Tariro Moyo');
await page.fill('#cf-email', 'not-an-email');
await page.fill('#cf-message', 'Do you have space in Nursery?');
await cf.locator('button[type=submit]').click();
await page.waitForTimeout(300);
ok('Invalid email shows inline error', (await page.locator('#cf-email-error').innerText()).toLowerCase().includes('valid email'));
ok('Values preserved after validation failure', await page.inputValue('#cf-name') === 'Tariro Moyo');

await page.fill('#cf-email', 'tariro@example.com');
await cf.locator('button[type=submit]').click();
await page.waitForTimeout(300);
ok('Consent required before sending', (await page.locator('#cf-consent-error').innerText()).length > 0);
ok('Nothing sent while consent unchecked', (await mailbox()).every(m => m.reply_to !== 'tariro@example.com'));

/* ---------- contact form: service failure ---------- */
await mock('/__mode/fail');
await page.check('#cf-consent');
await cf.locator('button[type=submit]').click();
await page.waitForTimeout(1500);
const outcome = cf.locator('.form-outcome');
ok('Failure shows exact failure text', (await outcome.innerText()).includes(FAILURE));
ok('Failure does NOT claim receipt', !(await outcome.innerText()).includes('we have received'));
ok('Failure styled as error', (await outcome.getAttribute('class')).includes('is-error'));
const failActions = await outcome.locator('a').evaluateAll(a => a.map(x => x.getAttribute('href')));
ok('Failure offers WhatsApp', failActions.some(h => h.includes('wa.me/48791753077')));
ok('Failure offers phone', failActions.some(h => h.startsWith('tel:')));
ok('Failure offers email', failActions.some(h => h.startsWith('mailto:')));
ok('Values preserved after failure', await page.inputValue('#cf-message') === 'Do you have space in Nursery?');
ok('Consent still checked after failure', await page.isChecked('#cf-consent'));
await page.screenshot({ path: SHOT + 'form-failure.png', clip: await cf.boundingBox() });

/* ---------- slow response -> disabled button ---------- */
await mock('/__mode/slow');
const submitBtn = cf.locator('button[type=submit]');
await submitBtn.click();
await page.waitForTimeout(700);
ok('Submit disabled while sending', await submitBtn.isDisabled());
ok('Sending status announced', (await cf.locator('.form-status').innerText()).includes('Sending'));
ok('Status region is aria-live', await cf.locator('.form-status').getAttribute('aria-live') === 'polite');
await page.waitForTimeout(3600);
ok('Submit re-enabled after response', !(await submitBtn.isDisabled()));

/* ---------- duplicate click ---------- */
await mock('/__mode/ok');
// The slow submission above succeeded, which correctly clears the form, so
// refill every field before testing duplicate clicks.
await page.fill('#cf-name', 'Tariro Moyo');
await page.fill('#cf-email', 'tariro@example.com');
await page.fill('#cf-message', 'Do you have space in Nursery?');
await page.check('#cf-consent');
const beforeDupe = (await mailbox()).length;
await Promise.all([submitBtn.click(), submitBtn.click(), submitBtn.click()]);
await page.waitForTimeout(2000);
const afterDupe = (await mailbox()).length;
ok('Triple click sends exactly one email', afterDupe === beforeDupe + 1, 'sent ' + (afterDupe - beforeDupe));

/* ---------- success ---------- */
ok('Success shows exact required text', (await outcome.innerText()).includes(SUCCESS));
ok('Success styled as success', (await outcome.getAttribute('class')).includes('is-success'));
ok('Success offers WhatsApp secondary', (await outcome.innerText()).includes('Need a faster response? Chat with us on WhatsApp.'));
ok('Success clears the form', await page.inputValue('#cf-name') === '');
const lastMail = (await mailbox()).slice(-1)[0];
ok('Contact email reached configured inbox', lastMail.to[0] === 'office@example.test');
ok('Contact subject correct', lastMail.subject === '[Website Enquiry] Tariro Moyo — General enquiry', lastMail.subject);
await page.screenshot({ path: SHOT + 'form-success.png', clip: await cf.boundingBox() });

/* ---------- honeypot from a real browser ---------- */
const beforeHp = (await mailbox()).length;
await page.evaluate(() => {
  const f = document.querySelector('#contact-form');
  f.name.value = 'Bot'; f.email.value = 'bot@spam.test'; f.message.value = 'spam';
  f.consent.checked = true; f.website.value = 'http://spam.example';
  f.requestSubmit();
});
await page.waitForTimeout(1600);
ok('Honeypot submission sends no email', (await mailbox()).length === beforeHp);

/* ---------- admissions modal end-to-end ---------- */
await page.locator('a[href="#apply"]').first().click();
await page.waitForTimeout(500);
await page.locator('#nextBtn').click();
await page.waitForTimeout(300);
ok('Step 1 blocks on empty child name', (await page.locator('#af-child-error').innerText()).length > 0);
ok('Stays on step 1 when invalid', await page.locator('#stepNum').innerText() === '1');

await page.fill('#af-child', 'Tadiwa Moyo');
await page.selectOption('#af-grade', 'Grade 1');
await page.locator('#nextBtn').click();
await page.waitForTimeout(300);
ok('Advances to step 2', await page.locator('#stepNum').innerText() === '2');

await page.locator('#nextBtn').click();
await page.waitForTimeout(300);
ok('Step 2 blocks on empty parent name', (await page.locator('#af-parent-error').innerText()).length > 0);
ok('Step 1 values retained', await page.inputValue('#af-child') === 'Tadiwa Moyo');

await page.fill('#af-parent', 'Rudo Moyo');
await page.fill('#af-email', 'rudo@example.com');
await page.fill('#af-phone', '+263 77 000 0000');
await page.fill('#af-note', 'She is excited to start.');
await page.locator('#nextBtn').click();
await page.waitForTimeout(300);
ok('Apply requires consent', (await page.locator('#af-consent-error').innerText()).length > 0);

await page.check('#af-consent');
const beforeApp = (await mailbox()).length;
await page.locator('#nextBtn').click();
await page.waitForTimeout(2200);
const applyOutcome = page.locator('#applyForm .form-outcome');
ok('Application success shows exact text', (await applyOutcome.innerText()).includes(SUCCESS));
ok('Application offers WhatsApp secondary', (await applyOutcome.innerText()).includes('Need a faster response? Chat with us on WhatsApp.'));
ok('Application email delivered', (await mailbox()).length === beforeApp + 1);
const appMail = (await mailbox()).slice(-1)[0];
ok('Application subject correct', appMail.subject === '[Website Enquiry] Rudo Moyo — Grade 1', appMail.subject);
ok('Application email carries child + phone', appMail.text.includes('Tadiwa Moyo') && appMail.text.includes('+263 77 000 0000'));
ok('WhatsApp link uses config number', (await applyOutcome.locator('a').first().getAttribute('href')).includes('wa.me/48791753077'));
ok('Active apply step hidden after success', await page.locator('#applyForm .apply-step[data-step="2"]').isHidden());
ok('Submit button hidden after success', await page.locator('#nextBtn').isHidden());
await page.screenshot({ path: SHOT + 'apply-success.png' });

await page.keyboard.press('Escape');
await page.waitForTimeout(400);
await page.locator('a[href="#apply"]').first().click();
await page.waitForTimeout(400);
ok('Reopening resets to step 1', await page.locator('#stepNum').innerText() === '1');
ok('Reopening clears outcome', await applyOutcome.isHidden());
ok('Reopening clears values', await page.inputValue('#af-child') === '');
await page.keyboard.press('Escape');

/* ---------- application failure path ---------- */
await mock('/__mode/fail');
await page.locator('a[href="#apply"]').first().click();
await page.waitForTimeout(400);
await page.fill('#af-child', 'Anesu Dube');
await page.selectOption('#af-grade', 'Nursery');
await page.locator('#nextBtn').click();
await page.waitForTimeout(300);
await page.fill('#af-parent', 'Kundai Dube');
await page.fill('#af-email', 'kundai@example.com');
await page.check('#af-consent');
await page.locator('#nextBtn').click();
await page.waitForTimeout(1900);
ok('Application failure shows exact failure text', (await applyOutcome.innerText()).includes(FAILURE));
ok('Application failure preserves values', await page.inputValue('#af-parent') === 'Kundai Dube');
ok('Application failure keeps form usable', await page.locator('#nextBtn').isVisible());
await page.keyboard.press('Escape');
await mock('/__mode/ok');

/* ---------- regressions ---------- */
await page.locator('.theme-btn').click();
ok('Dark mode still toggles', await page.evaluate(() => document.body.classList.contains('dark')));
await page.locator('#contact-form').scrollIntoViewIfNeeded();
await page.waitForTimeout(300);
await page.screenshot({ path: SHOT + 'form-dark.png', clip: await cf.boundingBox() });
await page.locator('.theme-btn').click();

await page.locator('.download-card').first().click();
await page.waitForTimeout(400);
ok('Document dialog still works', await page.locator('#docModal').evaluate(e => e.classList.contains('open')));
await page.keyboard.press('Escape');

await page.locator('.gallery-filters button').nth(1).click();
ok('Gallery filters still work', await page.locator('.gallery-item:not([hidden])').count() > 0);

for (const w of [320, 375, 414, 768, 1024, 1440]) {
  await page.setViewportSize({ width: w, height: 900 });
  await page.waitForTimeout(300);
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok('No horizontal scroll @' + w + 'px', over <= 1, 'overflow ' + over);
}
await page.setViewportSize({ width: 375, height: 812 });
await page.locator('#contact-form').scrollIntoViewIfNeeded();
await page.waitForTimeout(400);
await page.screenshot({ path: SHOT + 'form-mobile.png' });

// The failure-path tests deliberately make the API return 502/403, and the
// browser logs those as resource errors. Everything else must be clean.
const unexpected = errors.filter(e => !/status of (502|403|429)/.test(e));
ok('No unexpected console or page errors', unexpected.length === 0, unexpected.join(' | '));
ok('No uncaught page exceptions', !errors.some(e => e.startsWith('PAGEERROR')), errors.filter(e => e.startsWith('PAGEERROR')).join(' | '));

/* ---------- nothing secret ships to the browser ---------- */
const html = await (await fetch(B)).text();
const bundle = await (await fetch(B + 'app.js')).text();
const combined = html + bundle;
for (const s of ['re_local_test_key_not_real', 'RESEND_API_KEY', 'TURNSTILE_SECRET', 'example.test', 'Bearer '])
  ok('Client free of "' + s + '"', !combined.includes(s));

await browser.close();
console.log('\nPASS ' + pass.length + '   FAIL ' + fail.length + '\n');
if (fail.length) { console.log('FAILURES:'); fail.forEach(f => console.log('  x ' + f)); }
process.exit(fail.length ? 1 : 0);
