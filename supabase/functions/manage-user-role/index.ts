// ============================================================================
// manage-user-role — SCAFFOLD ONLY. Not deployed. Not implemented.
//
// Covers two Cloudflare routes at once: worker/routes/admin.js's
// setAccountStatus() (activate/deactivate) and setExtraPermission()
// (grant/revoke the one delegable capability, contacts.edit).
//
// IMPORTANT: this function exists BECAUSE the lock-out rules cannot be
// expressed in a static RLS policy — see the KNOWN LIMITATION note at the
// top of supabase/policies/profiles.sql. Both rules below MUST be
// implemented here before this function is trusted with the same
// guarantee the Cloudflare version already has automated tests for
// (tests/account-system.test.mjs, section 6):
//   1. A user cannot deactivate their own account.
//   2. The last ACTIVE SUPER_ADMIN cannot be deactivated or demoted.
// ============================================================================

import { createClient } from 'jsr:@supabase/supabase-js@2';

type Action =
  | { op: 'set_status'; userId: string; status: 'active' | 'deactivated' }
  | { op: 'set_permission'; userId: string; capability: string; grant: boolean };

// Mirrors worker/lib/permissions.js's GRANTABLE set exactly — nothing that
// touches accounts, roles, security, or the audit trail may ever be granted
// this way, no matter what a caller requests.
const GRANTABLE_CAPABILITIES = new Set(['contacts.edit']);

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ ok: false, error: 'unauthorized' }, 401);

  const caller = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  );
  const { data: userData, error: userErr } = await caller.auth.getUser();
  if (userErr || !userData?.user) return json({ ok: false, error: 'unauthorized' }, 401);

  const { data: callerProfile } = await caller
    .from('profiles').select('role, status').eq('id', userData.user.id).single();
  if (callerProfile?.status !== 'active') return json({ ok: false, error: 'forbidden' }, 403);

  let action: Action;
  try {
    action = await req.json();
  } catch {
    return json({ ok: false, error: 'bad_request' }, 400);
  }

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  if (action.op === 'set_status') {
    // TODO (implementation):
    //   const { data: target } = await admin.from('profiles').select('role, status').eq('id', action.userId).single();
    //   const capability = target.role === 'PARENT' ? 'parents.manage' : 'staff.manage';
    //   if (!canManageUser(callerProfile.role, target.role)) return json({ ok:false, error:'forbidden' }, 403);
    //
    //   RULE 1 — self-deactivation:
    //   if (action.status === 'deactivated' && action.userId === userData.user.id)
    //     return json({ ok:false, error:'validation', message:'You cannot deactivate your own account.' }, 400);
    //
    //   RULE 2 — last active Super Admin:
    //   if (action.status === 'deactivated' && target.role === 'SUPER_ADMIN') {
    //     const { count } = await admin.from('profiles').select('id', { count: 'exact', head: true })
    //       .eq('role', 'SUPER_ADMIN').eq('status', 'active').neq('id', action.userId);
    //     if ((count ?? 0) < 1) return json({ ok:false, error:'validation', message:'At least one active Super Admin must remain.' }, 400);
    //   }
    //
    //   await admin.from('profiles').update({ status: action.status }).eq('id', action.userId);
    //   if (action.status === 'deactivated') {
    //     // Also revoke every live session for this user — Supabase Auth's
    //     // admin.auth.admin.signOut(userId, 'global') is the equivalent of
    //     // worker/lib/auth.js's destroyAllSessionsFor().
    //   }
    //   write audit_log row (action: status==='active' ? 'account.reactivated' : 'account.deactivated')
    return json({ ok: false, error: 'not_implemented' }, 501);
  }

  if (action.op === 'set_permission') {
    if (callerProfile.role !== 'SUPER_ADMIN') return json({ ok: false, error: 'forbidden' }, 403);
    if (!GRANTABLE_CAPABILITIES.has(action.capability)) {
      return json({ ok: false, error: 'validation', message: 'That permission cannot be delegated.' }, 400);
    }
    // TODO (implementation): only onto a STAFF_ADMIN target (mirrors
    // worker/routes/admin.js's setExtraPermission() restricting this to
    // role === 'STAFF_ADMIN'), read-modify-write extra_permissions as a
    // deduplicated array, write audit_log row (action: 'permission.granted'
    // | 'permission.revoked', details: { capability }).
    return json({ ok: false, error: 'not_implemented' }, 501);
  }

  return json({ ok: false, error: 'bad_request' }, 400);
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
