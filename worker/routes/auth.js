import {
  ok, badRequest, unauthorized, notFound, tooMany, notConfigured,
  readJson, str, nowIso, sessionCookie, clearedSessionCookie, clientIp,
} from '../lib/http.js';
import { hashPassword, verifyPassword, needsRehash, DUMMY_HASH, hashToken, newId } from '../lib/crypto.js';
import {
  createSession, getSessionUser, destroySession, destroyAllSessionsFor,
  isLockedOut, recordAttempt, clearAttempts, verifyTurnstile,
  GENERIC_LOGIN_FAILURE, SESSION_TTL_SECONDS,
} from '../lib/auth.js';
import { writeAudit } from '../lib/audit.js';

const EMAIL_RE = /^[^\s@,;:<>()[\]\\]+@[^\s@.,;:<>()[\]\\]+(\.[^\s@.,;:<>()[\]\\]+)+$/;

function publicUser(u) {
  if (!u) return null;
  return { id: u.id, email: u.email, name: u.name, role: u.role };
}

export async function login(request, env) {
  if (!env.DB) return notConfigured();
  const body = await readJson(request);
  if (!body) return badRequest();

  const email = str(body.email).toLowerCase();
  const password = str(body.password);
  const ip = clientIp(request);

  if (!email || !password) return badRequest('Please enter your email and password.');
  if (!(await verifyTurnstile(env, str(body.turnstileToken), ip)))
    return badRequest('Please try again.');

  // Rate limiting runs BEFORE the expensive PBKDF2 verification below, so a
  // 600,000-iteration hash is never computed for an already-throttled caller.
  if (await isLockedOut(env, email, ip)) return tooMany();

  const row = await env.DB.prepare(
    `SELECT id, email, name, role, status, password_hash FROM users WHERE email_lower = ?`
  ).bind(email).first();

  // verifyPassword ALWAYS runs the full PBKDF2 computation — against
  // DUMMY_HASH when the account doesn't exist or has no password yet — so a
  // nonexistent account and a real wrong-password attempt cost the same time.
  // Skipping this call for a missing row would reopen a timing side channel
  // for account enumeration even though the response body/status stay identical.
  const passOk = await verifyPassword(password, row?.password_hash || DUMMY_HASH);

  if (!row || row.status !== 'active' || !passOk) {
    await recordAttempt(env, email, ip, false);
    await writeAudit(env, request, { action: 'auth.login_failed', details: { email } });
    // Same message and same status whether the account doesn't exist, is
    // deactivated, has no password set yet, or the password was wrong.
    return badRequest(GENERIC_LOGIN_FAILURE);
  }

  await recordAttempt(env, email, ip, true);
  await clearAttempts(env, email);

  // Upgrade-on-login: a hash created under an older, lower iteration count is
  // re-derived at the current one now that we have the plaintext in hand.
  // needsRehash() only ever returns true for a WEAKER stored hash than the
  // current configuration, so this can only raise the cost, never lower it.
  if (needsRehash(row.password_hash)) {
    const upgraded = await hashPassword(password);
    await env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
      .bind(upgraded, row.id).run();
    await writeAudit(env, request, {
      actor: row, action: 'auth.password_rehashed', entityType: 'user', entityId: row.id,
    });
  }

  const { token } = await createSession(env, row, request);
  await env.DB.prepare('UPDATE users SET last_login_at = ? WHERE id = ?')
    .bind(nowIso(), row.id).run();
  await writeAudit(env, request, {
    actor: row, action: 'auth.login', entityType: 'user', entityId: row.id,
  });

  return new Response(JSON.stringify({ ok: true, user: publicUser(row) }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': sessionCookie(token, SESSION_TTL_SECONDS),
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}

export async function logout(request, env) {
  if (!env.DB) return notConfigured();
  const user = await getSessionUser(env, request);
  await destroySession(env, request);
  if (user) await writeAudit(env, request, { actor: user, action: 'auth.logout' });
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': clearedSessionCookie(),
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}

export async function me(request, env) {
  if (!env.DB) return notConfigured();
  const user = await getSessionUser(env, request);
  if (!user) return unauthorized();
  return ok({ user: publicUser(user) });
}

/** Accept an invitation: verify the token, then set the chosen password. */
export async function acceptInvitation(request, env) {
  if (!env.DB) return notConfigured();
  const body = await readJson(request);
  if (!body) return badRequest();

  const token = str(body.token);
  const password = str(body.password);
  if (!token) return badRequest('This invitation link looks incomplete.');
  if (password.length < 10) return badRequest('Please choose a password of at least 10 characters.');

  const invite = await env.DB.prepare(
    `SELECT id, user_id, email_lower, expires_at, accepted_at, revoked_at
       FROM invitations WHERE token_hash = ?`
  ).bind(await hashToken(token)).first();

  if (!invite || invite.accepted_at || invite.revoked_at) return notFound();
  if (new Date(invite.expires_at).getTime() <= Date.now()) return notFound();

  const passwordHash = await hashPassword(password);
  await env.DB.prepare(
    `UPDATE users SET password_hash = ?, status = 'active', updated_at = ? WHERE id = ?`
  ).bind(passwordHash, nowIso(), invite.user_id).run();
  await env.DB.prepare('UPDATE invitations SET accepted_at = ? WHERE id = ?')
    .bind(nowIso(), invite.id).run();

  const user = await env.DB.prepare(
    'SELECT id, email, name, role, status FROM users WHERE id = ?'
  ).bind(invite.user_id).first();

  const { token: sessionToken } = await createSession(env, user, request);
  await writeAudit(env, request, {
    actor: user, action: 'auth.invitation_accepted', entityType: 'user', entityId: user.id,
  });

  return new Response(JSON.stringify({ ok: true, user: publicUser(user) }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': sessionCookie(sessionToken, SESSION_TTL_SECONDS),
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}

/** A signed-in user changes their own password. Every other session is revoked. */
export async function changeOwnPassword(request, env) {
  if (!env.DB) return notConfigured();
  const user = await getSessionUser(env, request);
  if (!user) return unauthorized();

  const body = await readJson(request);
  if (!body) return badRequest();
  const current = str(body.currentPassword);
  const next = str(body.newPassword);
  if (next.length < 10) return badRequest('Please choose a password of at least 10 characters.');

  const row = await env.DB.prepare('SELECT password_hash FROM users WHERE id = ?')
    .bind(user.id).first();
  if (!row?.password_hash || !(await verifyPassword(current, row.password_hash)))
    return badRequest('Your current password is incorrect.');

  await env.DB.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?')
    .bind(await hashPassword(next), nowIso(), user.id).run();
  await destroyAllSessionsFor(env, user.id);

  const { token } = await createSession(env, user, request);
  await writeAudit(env, request, {
    actor: user, action: 'auth.password_changed', entityType: 'user', entityId: user.id,
  });

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': sessionCookie(token, SESSION_TTL_SECONDS),
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}

/** A signed-in user updates their own display name (their only editable field besides password). */
export async function updateOwnProfile(request, env) {
  if (!env.DB) return notConfigured();
  const user = await getSessionUser(env, request);
  if (!user) return unauthorized();

  const body = await readJson(request);
  if (!body) return badRequest();
  const name = str(body.name).slice(0, 120);
  if (!name) return badRequest('Please enter a name.');

  await env.DB.prepare('UPDATE users SET name = ?, updated_at = ? WHERE id = ?')
    .bind(name, nowIso(), user.id).run();
  await writeAudit(env, request, {
    actor: user, action: 'auth.profile_updated', entityType: 'user', entityId: user.id,
  });
  return ok({ user: publicUser({ ...user, name }) });
}

/* ---------------------------------------------------------------------------
   One-time Super Admin bootstrap. See ACCOUNT-SYSTEM-PLAN.md section 9.

   Refuses unless: a BOOTSTRAP_TOKEN secret is set and matches, the users table
   has zero SUPER_ADMIN rows, and the requested email matches SUPER_ADMIN_EMAIL.
   Creates the account with NO password and returns a single-use invitation
   link. This route is a no-op once any Super Admin exists.
   --------------------------------------------------------------------------- */
export async function bootstrapSuperAdmin(request, env) {
  if (!env.DB) return notConfigured();
  if (!env.BOOTSTRAP_TOKEN || !env.SUPER_ADMIN_EMAIL)
    return notConfigured();

  const provided = request.headers.get('X-Bootstrap-Token') || '';
  if (provided !== env.BOOTSTRAP_TOKEN) return unauthorized();

  const existing = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM users WHERE role = 'SUPER_ADMIN'"
  ).first();
  if ((existing?.n || 0) > 0) return badRequest('A Super Admin already exists.');

  const body = await readJson(request);
  const email = str(body?.email).toLowerCase();
  if (email !== env.SUPER_ADMIN_EMAIL.toLowerCase())
    return badRequest('Email does not match the configured Super Admin address.');
  if (!EMAIL_RE.test(email)) return badRequest('Invalid email.');

  const userId = newId('usr_');
  await env.DB.prepare(
    `INSERT INTO users (id, email, email_lower, name, role, status, extra_permissions, created_at, updated_at)
     VALUES (?, ?, ?, '', 'SUPER_ADMIN', 'invited', '[]', ?, ?)`
  ).bind(userId, body.email, email, nowIso(), nowIso()).run();

  const token = await (await import('../lib/crypto.js')).generateToken();
  const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  await env.DB.prepare(
    `INSERT INTO invitations (id, email_lower, user_id, role, token_hash, expires_at, created_by, created_at)
     VALUES (?, ?, ?, 'SUPER_ADMIN', ?, ?, ?, ?)`
  ).bind(newId('inv_'), email, userId, await hashToken(token), expires, userId, nowIso()).run();

  await writeAudit(env, request, {
    action: 'auth.bootstrap_super_admin', entityType: 'user', entityId: userId, details: { email },
  });

  return ok({ invitationToken: token, expiresAt: expires });
}
