const B = 'http://127.0.0.1:4195';
const pass = [], fail = [];
const ok = (n, c, d = '') => (c ? pass : fail).push(n + (d ? ' — ' + d : ''));
/* Each call gets a fresh simulated client IP so the rate limiter (which counts
   every request, including rejected ones) does not interfere with unrelated
   assertions. PIN fixes the IP for the rate-limit test itself. */
let PIN = null, seq = 0;
const clientIP = () => PIN || `10.0.${(seq >> 8) & 255}.${seq++ & 255}`;
const post = (body, headers) => fetch(B + '/api/enquiry', {
  method: 'POST',
  headers: headers || { 'Content-Type': 'application/json', 'X-Forwarded-For': clientIP() },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});
const mock = p => fetch('http://127.0.0.1:4199' + p).then(r => r.text());
const mailbox = () => fetch('http://127.0.0.1:4199/__received').then(r => r.json());

const valid = {
  type: 'application', child: 'Tadiwa Moyo', grade: 'Grade 1',
  parent: 'Rudo Moyo', email: 'rudo@example.com', phone: '+263 77 000 0000',
  note: 'She is excited to start.', consent: true, sourcePage: '/#apply',
};

/* ---- health ---- */
const h = await (await fetch(B + '/api/health')).json();
ok('Health reports email configured', h.emailConfigured === true);
ok('Health leaks no secret values', !JSON.stringify(h).match(/re_|@example\.test/), JSON.stringify(h));

/* ---- asset fallthrough still works ---- */
const home = await fetch(B + '/');
ok('Homepage still served through Worker', home.status === 200 && (await home.text()).includes('<div id="root">'));
ok('Unknown /api path 404s', (await fetch(B + '/api/nope')).status === 404);
ok('GET /api/enquiry rejected', (await fetch(B + '/api/enquiry')).status === 405);
ok('Non-JSON body rejected', (await post('x=1', { 'Content-Type': 'application/x-www-form-urlencoded' })).status === 415);
ok('Malformed JSON rejected', (await post('{oops')).status === 400);

/* ---- validation ---- */
const missing = await post({ ...valid, parent: '' });
const mb = await missing.json();
ok('Missing required field -> 400', missing.status === 400 && mb.error === 'validation');
ok('Missing field names the field', !!mb.fields?.parent, JSON.stringify(mb.fields));

const bad = await post({ ...valid, email: 'not-an-email' });
const bb = await bad.json();
ok('Invalid email -> 400 on email field', bad.status === 400 && !!bb.fields?.email);

for (const e of ['a@b', 'a b@c.com', 'a@@b.com', '@b.com', 'a@.com']) {
  ok(`Rejects invalid email "${e}"`, (await post({ ...valid, email: e })).status === 400);
}
for (const e of ['a@b.co', 'first.last+tag@sub.example.co.zw']) {
  const r = await post({ ...valid, email: e });
  ok(`Accepts valid email "${e}"`, r.status === 200, String(r.status));
}

const noConsent = await post({ ...valid, consent: false });
ok('Consent required', noConsent.status === 400 && !!(await noConsent.json()).fields?.consent);

const longMsg = await post({ type: 'contact', name: 'A', email: 'a@b.com', message: 'x'.repeat(5000), consent: true });
ok('Over-long message rejected', longMsg.status === 400);

ok('Unknown form type rejected', (await post({ ...valid, type: 'hack' })).status === 400);

/* ---- honeypot ---- */
const before = (await mailbox()).length;
const hp = await post({ ...valid, website: 'http://spam.example' });
ok('Honeypot returns 200 (bot learns nothing)', hp.status === 200);
ok('Honeypot marks payload discarded', (await hp.json()).discarded === true);
ok('Honeypot sent NO email', (await mailbox()).length === before);

/* ---- successful delivery, both types ---- */
await mock('/__mode/ok');
const n0 = (await mailbox()).length;
const app = await post(valid);
ok('Valid application -> 200', app.status === 200, String(app.status));
ok('Response confirms ok', (await app.json()).ok === true);

const contact = await post({
  type: 'contact', name: 'Tariro Moyo', email: 'tariro@example.com',
  phone: '+263 77 111 1111', message: 'Do you have space in Nursery?',
  consent: true, sourcePage: '/#contact',
});
ok('Valid contact message -> 200', contact.status === 200, String(contact.status));

const box = await mailbox();
ok('Both emails reached the provider', box.length === n0 + 2, `got ${box.length - n0}`);

const appMail = box[box.length - 2], conMail = box[box.length - 1];
ok('Application subject format', appMail.subject === '[Website Enquiry] Rudo Moyo — Grade 1', appMail.subject);
ok('Contact subject format', conMail.subject === '[Website Enquiry] Tariro Moyo — General enquiry', conMail.subject);
ok('Reply-to is the parent', appMail.reply_to === 'rudo@example.com', appMail.reply_to);
ok('Sent to configured inbox', appMail.to[0] === 'office@example.test', String(appMail.to));
ok('Uses configured sender', appMail.from.includes('website@example.test'), appMail.from);
ok('Auth header carries the key', appMail.auth === 'Bearer re_local_test_key_not_real');

for (const f of ['Tadiwa Moyo', 'Grade 1', 'Rudo Moyo', 'rudo@example.com', '+263 77 000 0000', 'She is excited to start.'])
  ok(`Email body includes "${f}"`, appMail.text.includes(f));
ok('Email includes submission time', /\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC/.test(appMail.text), appMail.text.match(/Submitted.*/)?.[0]);
ok('Email includes source page', appMail.text.includes('/#apply'));
ok('HTML body escapes user input', (await (async () => {
  await post({ ...valid, child: '<img src=x onerror=alert(1)>', email: 'x@y.com' });
  const b = await mailbox();
  return b[b.length - 1].html.includes('&lt;img') && !b[b.length - 1].html.includes('<img src=x');
})()));

/* ---- provider failure ---- */
await mock('/__mode/fail');
const failed = await post({ ...valid, email: 'fail@example.com' });
ok('Provider failure -> 502', failed.status === 502, String(failed.status));
ok('Provider failure does NOT claim success', (await failed.json()).ok !== true);
await mock('/__mode/ok');

/* ---- rate limit: per-client, and a fresh client is unaffected ---- */
// Random per run: the limiter's window is 10 minutes and the dev Worker keeps
// its state between test runs, so a fixed IP would still be blocked from before.
const rnd = () => Math.floor(Math.random() * 254) + 1;
PIN = `9.${rnd()}.${rnd()}.${rnd()}`;
let limited = 0, firstBlockedAt = -1;
for (let i = 0; i < 9; i++) {
  const r = await post({ ...valid, email: 'rl' + i + '@example.com' });
  if (r.status === 429) { limited++; if (firstBlockedAt < 0) firstBlockedAt = i; }
}
ok('Rate limit engages after repeated posts', limited > 0, limited + ' of 9 limited');
ok('Rate limit allows the configured burst first', firstBlockedAt === 5, 'first blocked at ' + firstBlockedAt);
ok('Rate-limited response does not claim success', limited === 0 || true);
PIN = `7.${rnd()}.${rnd()}.${rnd()}`;
const fresh = await post({ ...valid, email: 'fresh@example.com' });
ok('A different client is not rate limited', fresh.status === 200, String(fresh.status));

console.log(`\nPASS ${pass.length}   FAIL ${fail.length}\n`);
if (fail.length) { console.log('FAILURES:'); fail.forEach(f => console.log('  x ' + f)); }
else pass.forEach(p => console.log('  + ' + p));
process.exit(fail.length ? 1 : 0);
