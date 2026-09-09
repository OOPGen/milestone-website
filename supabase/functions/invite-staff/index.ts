// ============================================================================
// invite-staff — SCAFFOLD ONLY. Not deployed. Not implemented.
//
// Supabase equivalent of worker/routes/admin.js's inviteStaff(). Invite-only:
// no public self-registration exists anywhere in this design. Must be
// called with the CALLER's own auth token (not the service-role key) so
// the function can verify the caller is an active SUPER_ADMIN before doing
// anything privileged internally with the service-role client.
// ============================================================================

import { createClient } from 'jsr:@supabase/supabase-js@2';

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ ok: false, error: 'unauthorized' }, 401);

  // Client scoped to the CALLER's token — used only to find out who is
  // calling. It must never be used to bypass RLS; that's what the separate
  // `admin` client below (service-role) is for, and only after the role
  // check below passes.
  const caller = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  );
  const { data: userData, error: userErr } = await caller.auth.getUser();
  if (userErr || !userData?.user) return json({ ok: false, error: 'unauthorized' }, 401);

  const { data: callerProfile } = await caller
    .from('profiles')
    .select('role, status')
    .eq('id', userData.user.id)
    .single();

  // Mirrors canManageUser(actor, 'STAFF_ADMIN') / canAssignRole in
  // worker/lib/permissions.js: only an active SUPER_ADMIN may invite staff
  // (including another SUPER_ADMIN) — a STAFF_ADMIN calling this must be
  // refused, exactly as worker/routes/admin.js's inviteStaff() refuses it
  // via authorize(env, request, 'staff.manage').
  if (callerProfile?.role !== 'SUPER_ADMIN' || callerProfile.status !== 'active') {
    return json({ ok: false, error: 'forbidden' }, 403);
  }

  let body: { email?: string; name?: string; role?: 'STAFF_ADMIN' | 'SUPER_ADMIN' };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: 'bad_request' }, 400);
  }
  const role = body.role === 'SUPER_ADMIN' ? 'SUPER_ADMIN' : 'STAFF_ADMIN';
  // TODO (implementation): validate body.email with the same permissive
  // EMAIL_RE worker/routes/admin.js uses, reject duplicates (check
  // public.profiles for an existing row with this email first).

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  // TODO (implementation):
  //   1. admin.auth.admin.inviteUserByEmail(body.email, { data: { role } })
  //   2. insert into public.profiles (id: <returned user id>, email, name,
  //      role, status: 'invited', created_by: userData.user.id)
  //   3. write an audit_log row (action: 'staff.invited') via the admin client
  //   4. return the invite action_link (or rely on Supabase's own invite
  //      email if SMTP is configured) — do not fabricate a fake success if
  //      email delivery is not confirmed, matching DEPLOYMENT.md section 4's
  //      "does the enquiry form actually deliver" honesty rule.

  return json({ ok: false, error: 'not_implemented' }, 501);
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
