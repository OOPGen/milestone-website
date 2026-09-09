/* Append-only audit log.

   Never pass a password, token, session value, API key, or anything that
   looks like one — writeAudit() strips such fields defensively even so, in
   case a caller passes something it shouldn't. */

import { clientIp, nowIso } from './http.js';

const SECRET_KEY_PATTERN = /pass|token|secret|hash|session|cookie|key$/i;

function redact(details) {
  if (!details || typeof details !== 'object') return '';
  const safe = {};
  for (const [k, v] of Object.entries(details)) {
    if (SECRET_KEY_PATTERN.test(k)) continue;
    safe[k] = typeof v === 'string' ? v.slice(0, 200) : v;
  }
  const s = JSON.stringify(safe);
  return s.length > 500 ? s.slice(0, 500) : s;
}

export async function writeAudit(env, request, { actor, action, entityType, entityId, details }) {
  await env.DB.prepare(
    `INSERT INTO audit_log (actor_id, actor_email, action, entity_type, entity_id, summary, ip, user_agent, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    actor?.id || null,
    actor?.email || null,
    action,
    entityType || null,
    entityId || null,
    redact(details),
    request ? clientIp(request) : null,
    request ? (request.headers.get('User-Agent') || '').slice(0, 300) : null,
    nowIso()
  ).run();
}
