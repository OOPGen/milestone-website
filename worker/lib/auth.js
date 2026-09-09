/* Sessions, login abuse control, and the authorisation gate.

   Every protected request re-reads the session AND the user's current role and
   status from the database, so deactivating an account or changing a role takes
   effect immediately rather than at the next login. */

import { generateToken, hashToken, newId } from './crypto.js';
import { can } from './permissions.js';
import { clientIp, nowIso, readCookie, SESSION_COOKIE } from './http.js';

export const SESSION_TTL_SECONDS = 12 * 60 * 60;      // absolute lifetime
const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;

/* One wording for every failure mode — wrong password, unknown account,
   deactivated account, or an account that never set a password. Nothing about
   which one it was reaches the client. */
export const GENERIC_LOGIN_FAILURE = 'Email or password is incorrect.';

export async function createSession(env, user, request) {
  const token = await generateToken();
  const expires = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();
  await env.DB.prepare(
    `INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at, last_seen_at, ip, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    newId('ses_'), user.id, await hashToken(token), nowIso(), expires, nowIso(),
    clientIp(request), (request.headers.get('User-Agent') || '').slice(0, 300)
  ).run();
  return { token, expiresAt: expires };
}

/** Returns the live user row for a request, or null. Never returns a hash. */
export async function getSessionUser(env, request) {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;

  const row = await env.DB.prepare(
    `SELECT s.id AS session_id, s.expires_at,
            u.id, u.email, u.name, u.role, u.status, u.extra_permissions
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?`
  ).bind(await hashToken(token)).first();

  if (!row) return null;

  if (new Date(row.expires_at).getTime() <= Date.now()) {
    await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(row.session_id).run();
    return null;
  }
  // A deactivated user's session stops working immediately.
  if (row.status !== 'active') return null;

  await env.DB.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?')
    .bind(nowIso(), row.session_id).run();

  return {
    sessionId: row.session_id,
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    status: row.status,
    extra_permissions: row.extra_permissions,
  };
}

export async function destroySession(env, request) {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return;
  await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?')
    .bind(await hashToken(token)).run();
}

export async function destroyAllSessionsFor(env, userId) {
  await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId).run();
}

/* ---------------------------------------------------------------------------
   Login abuse control — counted per email AND per IP so neither a single
   account nor a single source can be hammered.
   --------------------------------------------------------------------------- */

export async function isLockedOut(env, emailLower, ip) {
  const since = new Date(Date.now() - LOCKOUT_WINDOW_MS).toISOString();
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM login_attempts
      WHERE ok = 0 AND created_at > ?
        AND (email_lower = ? OR ip = ?)`
  ).bind(since, emailLower, ip).first();
  return (row?.n || 0) >= MAX_FAILURES;
}

export async function recordAttempt(env, emailLower, ip, success) {
  await env.DB.prepare(
    'INSERT INTO login_attempts (email_lower, ip, ok, created_at) VALUES (?, ?, ?, ?)'
  ).bind(emailLower, ip, success ? 1 : 0, nowIso()).run();
}

export async function clearAttempts(env, emailLower) {
  await env.DB.prepare('DELETE FROM login_attempts WHERE email_lower = ?')
    .bind(emailLower).run();
}

/* ---------------------------------------------------------------------------
   Authorisation gate. Deny by default.
   --------------------------------------------------------------------------- */

/**
 * Resolves to { user } when allowed, or { error } describing the refusal.
 * `capability` is required — calling this without one is a programming error
 * and is treated as a denial rather than silently allowing the request.
 */
export async function authorize(env, request, capability) {
  const user = await getSessionUser(env, request);
  if (!user) return { error: 'unauthorized' };
  if (!capability) return { error: 'forbidden' };
  if (!can(user, capability)) return { error: 'forbidden' };
  return { user };
}

/** Verify a Turnstile token when keys are configured; skipped until then. */
export async function verifyTurnstile(env, token, ip) {
  if (!env.TURNSTILE_SECRET_KEY) return true;
  if (!token) return false;
  const body = new FormData();
  body.append('secret', env.TURNSTILE_SECRET_KEY);
  body.append('response', token);
  if (ip) body.append('remoteip', ip);
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST', body,
    });
    const out = await res.json();
    return out.success === true;
  } catch {
    return false;
  }
}
