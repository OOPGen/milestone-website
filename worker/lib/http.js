/* Response helpers, cookies, and body parsing. */

export const SESSION_COOKIE = '__Host-mjla_session';

export function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      // Account and API surfaces must never be indexed.
      'X-Robots-Tag': 'noindex, nofollow',
      ...extraHeaders,
    },
  });
}

export const ok = body => json({ ok: true, ...body });
export const badRequest = (msg = 'Invalid request.', fields) =>
  json({ ok: false, error: 'validation', message: msg, ...(fields ? { fields } : {}) }, 400);
export const unauthorized = () =>
  json({ ok: false, error: 'unauthorized', message: 'Please sign in.' }, 401);
export const forbidden = () =>
  json({ ok: false, error: 'forbidden', message: 'You do not have access to that.' }, 403);
export const notFound = () =>
  json({ ok: false, error: 'not_found', message: 'Not found.' }, 404);
export const tooMany = (msg = 'Too many attempts. Please wait and try again.') =>
  json({ ok: false, error: 'rate_limit', message: msg }, 429);
export const notConfigured = () =>
  json({
    ok: false,
    error: 'not_configured',
    message: 'Accounts are not connected yet. Please contact the school office.',
  }, 503);

export function readCookie(request, name) {
  const header = request.headers.get('Cookie') || '';
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() === name) return part.slice(idx + 1).trim();
  }
  return null;
}

/* __Host- requires Secure and Path=/ and forbids Domain. HttpOnly keeps the
   token away from JavaScript entirely — no token is ever in localStorage. */
export function sessionCookie(token, maxAgeSeconds) {
  return `${SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}`;
}

export function clearedSessionCookie() {
  return `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

export async function readJson(request) {
  const type = request.headers.get('content-type') || '';
  if (!type.includes('application/json')) return null;
  try {
    const body = await request.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
  } catch {
    return null;
  }
}

export function clientIp(request) {
  return (
    request.headers.get('CF-Connecting-IP') ||
    (request.headers.get('X-Forwarded-For') || '').split(',')[0].trim() ||
    'unknown'
  );
}

export const str = v => (typeof v === 'string' ? v.trim() : '');
export const nowIso = () => new Date().toISOString();

/* Rich text is stored sanitised. There is no raw-HTML editor: only this small
   tag set survives, and no attributes at all, so no href/src/style/on* can be
   injected through content. */
const ALLOWED_TAGS = new Set(['p', 'br', 'strong', 'em', 'ul', 'ol', 'li', 'h3', 'h4']);

export function sanitizeRichText(input) {
  if (typeof input !== 'string') return '';
  return input
    .replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g, (match, tag) => {
      const name = tag.toLowerCase();
      if (!ALLOWED_TAGS.has(name)) return '';
      return match[1] === '/' ? `</${name}>` : `<${name}>`;
    })
    .replace(/<!--[\s\S]*?-->/g, '')
    .slice(0, 20000);
}
