/* ==========================================================================
   Milestone Junior Level Up Academy — enquiry API

   POST /api/enquiry   Admissions applications and contact-form messages.
   GET  /api/health    Reports which integrations are configured (no secrets).

   Everything else falls through to the static assets in dist/.

   SECURITY NOTES
   - Secrets are read from `env` only. Nothing here is ever sent to the browser,
     and no secret is echoed in a response, an error, or a log line.
   - Submitted field values are never logged. Logs record outcomes and counts
     only, because this endpoint carries parents' and children's names.
   - The response tells the browser the truth: 200 only after the email
     provider has accepted the message for delivery.
   ========================================================================== */

const MAX = { name: 120, email: 200, phone: 40, grade: 60, message: 4000, note: 2000 };

/* Deliberately permissive — the authoritative check is whether the reply
   actually reaches the parent, not whether it matches an exotic RFC 5322 form. */
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

/* --------------------------------------------------------------------------
   Abuse control

   A per-isolate sliding window. This is a speed bump, not the main defence:
   Cloudflare may run several isolates, so the effective limit is a multiple of
   MAX_PER_WINDOW. Turnstile is the real protection, and a zone-level WAF rate
   limiting rule is the production-grade layer — both documented in
   DEPLOYMENT.md section 4.
   -------------------------------------------------------------------------- */
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 5;
const seen = new Map();

function rateLimited(ip, max = MAX_PER_WINDOW) {
  // No early return for an unknown client: unattributable requests share one
  // bucket rather than bypassing the limit entirely. Cloudflare always sets
  // CF-Connecting-IP in production, so this bucket is a local-dev/edge case.
  const now = Date.now();
  if (seen.size > 5000) seen.clear(); // crude memory ceiling for a long-lived isolate
  const hits = (seen.get(ip) || []).filter(t => now - t < WINDOW_MS);
  if (hits.length >= max) {
    seen.set(ip, hits);
    return true;
  }
  hits.push(now);
  seen.set(ip, hits);
  return false;
}

/* -------------------------------------------------------------------------- */

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
  // Not configured yet — skipped, and flagged as a pre-launch item in
  // DEPLOYMENT.md. Once TURNSTILE_SECRET_KEY is set, verification is enforced.
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

/**
 * Resend was chosen over MailChannels and Postmark — see DEPLOYMENT.md §4.
 * It is a plain HTTPS API, which is the only kind that works in the Workers
 * runtime (no outbound SMTP/TCP), and needs no SDK in the bundle.
 */
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
    // Status only. The provider's body can echo submitted content.
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

  /* Honeypot. Only a bot fills this — the field is visually hidden and
     aria-hidden, and the real form never populates it. Accept and discard
     silently so the bot learns nothing. No human reaches this branch. */
  if (str(data.website)) {
    console.log('enquiry: honeypot triggered, discarded');
    return json({ ok: true, discarded: true });
  }

  // RATE_LIMIT_MAX is raised only in local .dev.vars so UI tests can run many
  // submissions. It is unset in production, which keeps the default of 5.
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

import { readJson } from './lib/http.js';
import * as auth from './routes/auth.js';
import * as pub from './routes/publicContent.js';
import * as parent from './routes/parent.js';
import * as admin from './routes/admin.js';
import * as media from './routes/media.js';
import { streamAsset } from './routes/files.js';

/* authorize()/route handlers return either a Response, or a plain
   { error: 'unauthorized' | 'forbidden' } object when they used authorize()
   internally and stopped before doing anything. This turns the latter into a
   real HTTP response at the edge, once, instead of in every route. */
function toResponse(result) {
  if (result instanceof Response) return result;
  if (result?.error === 'unauthorized')
    return json({ ok: false, error: 'unauthorized', message: 'Please sign in.' }, 401);
  if (result?.error === 'forbidden')
    return json({ ok: false, error: 'forbidden', message: 'You do not have access to that.' }, 403);
  return json({ ok: false, error: 'not_found' }, 404);
}

const CONTENT_TYPES = ['notice', 'news', 'event', 'term_date', 'album'];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    const seg = path.split('/').filter(Boolean); // ['api','admin','content','notice']

    try {
      if (path === '/api/enquiry') return handleEnquiry(request, env);

      if (path === '/api/health') {
        return json({
          ok: true,
          emailConfigured: Boolean(env.RESEND_API_KEY && env.ENQUIRY_TO && env.ENQUIRY_FROM),
          turnstileConfigured: Boolean(env.TURNSTILE_SECRET_KEY),
          accountsConfigured: Boolean(env.DB),
          mediaConfigured: Boolean(env.MEDIA),
        });
      }

      // ---- auth ----
      if (path === '/api/auth/login' && method === 'POST') return toResponse(await auth.login(request, env));
      if (path === '/api/auth/logout' && method === 'POST') return toResponse(await auth.logout(request, env));
      if (path === '/api/auth/me' && method === 'GET') return toResponse(await auth.me(request, env));
      if (path === '/api/auth/accept-invitation' && method === 'POST') return toResponse(await auth.acceptInvitation(request, env));
      if (path === '/api/auth/change-password' && method === 'POST') return toResponse(await auth.changeOwnPassword(request, env));
      if (path === '/api/auth/profile' && method === 'POST') return toResponse(await auth.updateOwnProfile(request, env));
      if (path === '/api/auth/bootstrap-super-admin' && method === 'POST') return toResponse(await auth.bootstrapSuperAdmin(request, env));

      // ---- public content (no session) ----
      if (seg[0] === 'api' && seg[1] === 'public') {
        if (seg[2] === 'content' && CONTENT_TYPES.includes(seg[3]) && method === 'GET' && !seg[4])
          return toResponse(await pub.listPublicContent(request, env, seg[3]));
        if (seg[2] === 'content' && CONTENT_TYPES.includes(seg[3]) && seg[4] && method === 'GET')
          return toResponse(await pub.getPublicContentItem(request, env, seg[4]));
        if (seg[2] === 'albums' && seg[3] && seg[4] === 'photos' && method === 'GET')
          return toResponse(await pub.listPublicAlbumPhotos(request, env, seg[3]));
        if (seg[2] === 'site-content' && method === 'GET')
          return toResponse(await pub.getSiteContent(request, env));
      }

      // ---- parent portal (read-only) ----
      if (seg[0] === 'api' && seg[1] === 'parent') {
        if (seg[2] === 'content' && CONTENT_TYPES.includes(seg[3]) && method === 'GET' && !seg[4])
          return toResponse(await parent.listParentContent(request, env, seg[3]));
        if (seg[2] === 'content' && CONTENT_TYPES.includes(seg[3]) && seg[4] && method === 'GET')
          return toResponse(await parent.getParentContentItem(request, env, seg[4]));
        if (seg[2] === 'albums' && seg[3] && seg[4] === 'photos' && method === 'GET')
          return toResponse(await parent.listParentAlbumPhotos(request, env, seg[3]));
        if (seg[2] === 'documents' && method === 'GET')
          return toResponse(await parent.listParentDocuments(request, env));
      }

      // ---- files (public + parent, auth-checked inside) ----
      if (seg[0] === 'api' && seg[1] === 'files' && seg[2] && method === 'GET')
        return toResponse(await streamAsset(request, env, seg[2]));

      // ---- media upload (staff) ----
      if (path === '/api/admin/media' && method === 'POST')
        return toResponse(await media.uploadMedia(request, env));

      // ---- admin: content ----
      // Two shapes, deliberately distinct so a content id can never be mistaken
      // for a type: /api/admin/content/:type (list/create) and
      // /api/admin/content/item/:id[/action] (everything id-based).
      if (seg[0] === 'api' && seg[1] === 'admin' && seg[2] === 'content' && seg[3] === 'item') {
        const id = seg[4];
        if (id && !seg[5] && method === 'PATCH') {
          const body = await readJson(request);
          if (!body) return json({ ok: false, error: 'validation' }, 400);
          return toResponse(await admin.updateContent(request, env, id, body));
        }
        if (id && seg[5] === 'publish' && method === 'POST')
          return toResponse(await admin.publishContent(request, env, id));
        if (id && seg[5] === 'unpublish' && method === 'POST')
          return toResponse(await admin.unpublishContent(request, env, id));
        if (id && seg[5] === 'archive' && method === 'POST')
          return toResponse(await admin.archiveContent(request, env, id));
        if (id && seg[5] === 'soft-delete' && method === 'POST')
          return toResponse(await admin.softDeleteContent(request, env, id));
        if (id && !seg[5] && method === 'DELETE')
          return toResponse(await admin.hardDeleteContent(request, env, id));
      } else if (seg[0] === 'api' && seg[1] === 'admin' && seg[2] === 'content') {
        if (CONTENT_TYPES.includes(seg[3]) && method === 'GET' && !seg[4])
          return toResponse(await admin.listAdminContent(request, env, seg[3]));
        if (CONTENT_TYPES.includes(seg[3]) && method === 'POST' && !seg[4]) {
          const body = await readJson(request);
          if (!body) return json({ ok: false, error: 'validation' }, 400);
          return toResponse(await admin.createContent(request, env, seg[3], body));
        }
      }

      // ---- admin: gallery photos within an album ----
      if (seg[0] === 'api' && seg[1] === 'admin' && seg[2] === 'albums' && seg[3] && seg[4] === 'photos') {
        if (method === 'GET' && !seg[5])
          return toResponse(await admin.listAdminAlbumPhotos(request, env, seg[3]));
        if (method === 'POST' && !seg[5]) {
          const body = await readJson(request);
          if (!body) return json({ ok: false, error: 'validation' }, 400);
          return toResponse(await admin.addAlbumPhoto(request, env, seg[3], body));
        }
        if (seg[5] && seg[6] === 'status' && method === 'POST') {
          const body = await readJson(request);
          return toResponse(await admin.setAlbumPhotoStatus(request, env, seg[5], body?.status));
        }
        if (seg[5] && seg[6] === 'soft-delete' && method === 'POST')
          return toResponse(await admin.softDeleteAlbumPhoto(request, env, seg[5]));
      }

      // ---- admin: documents ----
      if (path === '/api/admin/documents' && method === 'GET')
        return toResponse(await admin.listAdminDocuments(request, env));
      if (path === '/api/admin/documents/versions' && method === 'POST') {
        const body = await readJson(request);
        if (!body) return json({ ok: false, error: 'validation' }, 400);
        return toResponse(await admin.createDocumentVersion(request, env, body));
      }
      if (seg[0] === 'api' && seg[1] === 'admin' && seg[2] === 'documents' && seg[3] && seg[4] === 'status' && method === 'POST') {
        const body = await readJson(request);
        return toResponse(await admin.setDocumentStatus(request, env, seg[3], body?.status));
      }

      // ---- admin: site content ----
      if (path === '/api/admin/site-content' && method === 'GET')
        return toResponse(await admin.listAdminSiteContent(request, env));
      if (seg[0] === 'api' && seg[1] === 'admin' && seg[2] === 'site-content' && seg[3] && method === 'POST') {
        const body = await readJson(request);
        if (!body) return json({ ok: false, error: 'validation' }, 400);
        return toResponse(await admin.updateSiteContent(request, env, seg[3], body));
      }

      // ---- admin: accounts ----
      if (path === '/api/admin/parents' && method === 'GET')
        return toResponse(await admin.listParentAccounts(request, env));
      if (path === '/api/admin/parents/invite' && method === 'POST') {
        const body = await readJson(request);
        if (!body) return json({ ok: false, error: 'validation' }, 400);
        return toResponse(await admin.inviteParent(request, env, body));
      }
      if (path === '/api/admin/staff' && method === 'GET')
        return toResponse(await admin.listStaffAccounts(request, env));
      if (path === '/api/admin/staff/invite' && method === 'POST') {
        const body = await readJson(request);
        if (!body) return json({ ok: false, error: 'validation' }, 400);
        return toResponse(await admin.inviteStaff(request, env, body));
      }
      if (seg[0] === 'api' && seg[1] === 'admin' && seg[2] === 'accounts' && seg[3] && seg[4] === 'status' && method === 'POST') {
        const body = await readJson(request);
        return toResponse(await admin.setAccountStatus(request, env, seg[3], body?.status));
      }
      if (seg[0] === 'api' && seg[1] === 'admin' && seg[2] === 'accounts' && seg[3] === 'permission' && seg[4] && method === 'POST') {
        const body = await readJson(request);
        return toResponse(await admin.setExtraPermission(request, env, seg[4], body?.capability, Boolean(body?.grant)));
      }

      // ---- admin: audit log ----
      if (path === '/api/admin/audit' && method === 'GET')
        return toResponse(await admin.listAuditLog(request, env, url.searchParams.get('cursor')));

      if (path.startsWith('/api/')) return json({ ok: false, error: 'not_found' }, 404);

      return env.ASSETS.fetch(request);
    } catch (err) {
      console.error('unhandled worker error:', err instanceof Error ? err.message : String(err));
      if (path.startsWith('/api/')) return json({ ok: false, error: 'internal' }, 500);
      return env.ASSETS.fetch(request);
    }
  },
};
