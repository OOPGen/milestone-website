/* ==========================================================================
   Milestone Junior Level Up Academy — PHASE 1 PUBLIC-PREVIEW WORKER

   This is a deliberately separate, self-contained entry point from
   worker/index.js (the full account-system backend, already built, tested
   and committed for a later Phase 2). It exists so a Phase 1 deploy can
   ship the public preview WITHOUT the account-system backend code, its
   routes, or its dependencies reachable at all — not merely disabled by a
   missing D1/R2 binding, but genuinely absent from what is uploaded.

   Routes:
     POST /api/enquiry   Same enquiry handling as worker/index.js (copied
                          verbatim, not imported, so this file has zero
                          dependency on worker/lib/* or worker/routes/* —
                          see the note at the bottom of this file for why).
     GET  /api/health    Reports enquiry/turnstile config only. No
                          accountsConfigured/mediaConfigured fields, because
                          this Worker never binds DB or MEDIA at all.
     /admin, /admin.html, /parent, /parent.html, /login, /login.html,
     /accept-invitation.html  →  explicit 404, before the static-asset
                          layer's SPA fallback would otherwise silently
                          serve the homepage at these paths. Matches these
                          routes being genuinely unavailable, not aliased.
     Any other /api/*     →  404 JSON. No account-system route exists in
                          this Worker to accidentally match.
     Everything else       →  env.ASSETS.fetch (the Phase 1 static build —
                          see vite.config.phase1.js — which does not
                          contain admin.html/parent.html/login.html/
                          accept-invitation.html or their JS/CSS at all).

   SECURITY NOTES (unchanged from worker/index.js)
   - Secrets are read from `env` only. Nothing here is ever sent to the
     browser, and no secret is echoed in a response, an error, or a log line.
   - Submitted field values are never logged.
   - The enquiry response tells the browser the truth: 200 only after the
     email provider has accepted the message for delivery. (The current
     public site's forms do not call this endpoint at all — see
     src/legacyMarkup.js / app.js's honest "Online enquiries are being set
     up" state — so this route is present but presently unused.)
   ========================================================================== */

const MAX = { name: 120, email: 200, phone: 40, grade: 60, message: 4000, note: 2000 };

const EMAIL_RE = /^[^\s@,;:<>()[\]\\]+@[^\s@.,;:<>()[\]\\]+(\.[^\s@.,;:<>()[\]\\]+)+$/;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });

const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 5;
const seen = new Map();

function rateLimited(ip, max = MAX_PER_WINDOW) {
  const now = Date.now();
  if (seen.size > 5000) seen.clear();
  const hits = (seen.get(ip) || []).filter(t => now - t < WINDOW_MS);
  if (hits.length >= max) {
    seen.set(ip, hits);
    return true;
  }
  hits.push(now);
  seen.set(ip, hits);
  return false;
}

const str = v => (typeof v === 'string' ? v.trim() : '');

function validate(data) {
  const errors = {};
  const type = data.type === 'application' || data.type === 'contact' ? data.type : null;
  if (!type) return { errors: { form: 'Unrecognised form.' } };

  const clean = { type };
  const need = (key, label, max) => {
    const v = str(data[key]);
    if (!v) errors[key] = `${label} is required.`;
    else if (v.length > max) errors[key] = `${label} must be under ${max} characters.`;
    else clean[key] = v;
  };
  const optional = (key, max) => {
    const v = str(data[key]);
    if (v.length > max) errors[key] = `Please shorten this to under ${max} characters.`;
    else if (v) clean[key] = v;
  };

  const email = str(data.email);
  if (!email) errors.email = 'Email address is required.';
  else if (email.length > MAX.email || !EMAIL_RE.test(email))
    errors.email = 'Please enter a valid email address.';
  else clean.email = email;

  optional('phone', MAX.phone);

  if (type === 'application') {
    need('child', "The child's name", MAX.name);
    need('grade', 'The class applied for', MAX.grade);
    need('parent', 'Your name', MAX.name);
    optional('note', MAX.note);
  } else {
    need('name', 'Your name', MAX.name);
    need('message', 'Your message', MAX.message);
  }

  if (data.consent !== true) errors.consent = 'Please agree so we can reply to you.';

  return { errors, clean };
}

async function verifyTurnstile(token, env, ip) {
  if (!env.TURNSTILE_SECRET_KEY) return { ok: true, skipped: true };
  if (!token) return { ok: false };

  const body = new FormData();
  body.append('secret', env.TURNSTILE_SECRET_KEY);
  body.append('response', token);
  if (ip) body.append('remoteip', ip);

  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body,
    });
    const out = await res.json();
    return { ok: out.success === true };
  } catch {
    return { ok: false, unavailable: true };
  }
}

const esc = s =>
  String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function buildEmail(d, meta) {
  const who = d.type === 'application' ? d.parent : d.name;
  const about = d.type === 'application' ? d.grade : 'General enquiry';
  const subject = `[Website Enquiry] ${who} — ${about}`;

  const rows = [
    ['Enquiry type', d.type === 'application' ? 'Admissions application' : 'Contact form message'],
    d.type === 'application' && ["Child's name", d.child],
    d.type === 'application' && ['Class applied for', d.grade],
    ['From', who],
    ['Email', d.email],
    d.phone && ['Phone', d.phone],
    d.note && ['Additional information', d.note],
    d.message && ['Message', d.message],
    ['Submitted', meta.submittedAt],
    ['Source page', meta.sourcePage],
  ].filter(Boolean);

  const text =
    rows.map(([k, v]) => `${k}: ${v}`).join('\n') +
    `\n\nReply directly to this email to respond to ${who}.`;

  const html =
    `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:640px">` +
    `<h2 style="color:#4a148c;margin:0 0 4px">${esc(subject)}</h2>` +
    `<p style="color:#6e6376;margin:0 0 18px;font-size:14px">Sent from the Milestone Junior Level Up Academy website.</p>` +
    `<table style="border-collapse:collapse;width:100%;font-size:14px">` +
    rows
      .map(
        ([k, v]) =>
          `<tr>` +
          `<td style="padding:8px 12px 8px 0;border-bottom:1px solid #e8e1e6;color:#6e6376;white-space:nowrap;vertical-align:top">${esc(k)}</td>` +
          `<td style="padding:8px 0;border-bottom:1px solid #e8e1e6;white-space:pre-wrap">${esc(v)}</td>` +
          `</tr>`
      )
      .join('') +
    `</table>` +
    `<p style="margin-top:18px;font-size:14px">Reply directly to this email to respond to ${esc(who)}.</p>` +
    `</div>`;

  return { subject, text, html };
}

async function sendEmail(env, mail, replyTo) {
  const base = env.RESEND_API_BASE || 'https://api.resend.com';
  const res = await fetch(`${base}/emails`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.ENQUIRY_FROM,
      to: [env.ENQUIRY_TO],
      reply_to: replyTo,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    }),
  });

  if (!res.ok) {
    console.error('enquiry: provider rejected send, status', res.status);
    return { ok: false };
  }
  const out = await res.json().catch(() => ({}));
  return { ok: true, id: out.id };
}

async function handleEnquiry(request, env) {
  if (request.method !== 'POST')
    return json({ ok: false, error: 'method_not_allowed' }, 405);

  const ctype = request.headers.get('content-type') || '';
  if (!ctype.includes('application/json'))
    return json({ ok: false, error: 'bad_request' }, 415);

  let data;
  try {
    data = await request.json();
  } catch {
    return json({ ok: false, error: 'bad_request' }, 400);
  }
  if (!data || typeof data !== 'object')
    return json({ ok: false, error: 'bad_request' }, 400);

  const ip =
    request.headers.get('CF-Connecting-IP') ||
    (request.headers.get('X-Forwarded-For') || '').split(',')[0].trim() ||
    'unknown';

  if (str(data.website)) {
    console.log('enquiry: honeypot triggered, discarded');
    return json({ ok: true, discarded: true });
  }

  const max = Number(env.RATE_LIMIT_MAX) || MAX_PER_WINDOW;
  if (rateLimited(ip, max)) return json({ ok: false, error: 'rate_limit' }, 429);

  const { errors, clean } = validate(data);
  if (Object.keys(errors).length) return json({ ok: false, error: 'validation', fields: errors }, 400);

  const turnstile = await verifyTurnstile(str(data.turnstileToken), env, ip);
  if (!turnstile.ok) {
    return json(
      { ok: false, error: turnstile.unavailable ? 'delivery' : 'spam' },
      turnstile.unavailable ? 502 : 403
    );
  }

  if (!env.RESEND_API_KEY || !env.ENQUIRY_TO || !env.ENQUIRY_FROM) {
    console.error('enquiry: email delivery is not configured');
    return json({ ok: false, error: 'delivery' }, 503);
  }

  const meta = {
    submittedAt: new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC',
    sourcePage: str(data.sourcePage).slice(0, 200) || 'unknown',
  };

  const sent = await sendEmail(env, buildEmail(clean, meta), clean.email);
  if (!sent.ok) return json({ ok: false, error: 'delivery' }, 502);

  console.log('enquiry: delivered', clean.type);
  return json({ ok: true, id: sent.id });
}

/* --------------------------------------------------------------------------
   Explicit not-found for account-system entry points.

   These paths are checked BEFORE env.ASSETS.fetch, so they never depend on
   whether admin.html/parent.html/login.html happen to exist in the Phase 1
   build (they don't — see vite.config.phase1.js) or on how the assets
   layer's not_found_handling is configured. A genuine 404, always.
   -------------------------------------------------------------------------- */
const BLOCKED_PAGES = new Set([
  '/admin', '/admin.html', '/admin.js', '/admin.css',
  '/parent', '/parent.html', '/parent.js', '/parent.css',
  '/login', '/login.html', '/login.js',
  '/accept-invitation', '/accept-invitation.html', '/accept-invitation.js',
  '/apiClient.js',
]);

function notFoundPage() {
  return new Response(
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<title>Not available</title><meta name="robots" content="noindex,nofollow"></head>' +
    '<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1.5rem;color:#231b2c">' +
    '<h1 style="font-size:1.4rem">This page is not available.</h1>' +
    '<p><a href="/">Return to the homepage</a></p></body></html>',
    { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-Robots-Tag': 'noindex, nofollow' } }
  );
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, '') || '/';

    try {
      if (path === '/api/enquiry') return handleEnquiry(request, env);

      if (path === '/api/health') {
        return json({
          ok: true,
          phase: 1,
          emailConfigured: Boolean(env.RESEND_API_KEY && env.ENQUIRY_TO && env.ENQUIRY_FROM),
          turnstileConfigured: Boolean(env.TURNSTILE_SECRET_KEY),
          // Deliberately no accountsConfigured/mediaConfigured — this Worker
          // has no DB/MEDIA bindings and no account-system routes at all.
        });
      }

      if (BLOCKED_PAGES.has(path)) return notFoundPage();

      if (path.startsWith('/api/')) return json({ ok: false, error: 'not_found' }, 404);

      return env.ASSETS.fetch(request);
    } catch (err) {
      console.error('phase1 worker error:', err instanceof Error ? err.message : String(err));
      if (path.startsWith('/api/')) return json({ ok: false, error: 'internal' }, 500);
      return env.ASSETS.fetch(request);
    }
  },
};

/* Why the enquiry logic above is duplicated from worker/index.js rather than
   imported from a shared module: worker/index.js is the already-approved,
   already-committed Phase 2 backend. Extracting a shared module would mean
   editing that committed file for the sake of this temporary, Phase 1-only
   artifact — unnecessary risk to already-tested code for a build that will
   likely be discarded once Phase 2 (Supabase) replaces this Worker entirely.
   The two copies are small (~270 lines) and behaviourally identical as of
   this writing; if the enquiry logic changes in worker/index.js later,
   remember this file will not pick that up automatically. */
