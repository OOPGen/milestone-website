// ============================================================================
// invite-parent — SCAFFOLD ONLY. Not deployed. Not implemented.
//
// Same shape as invite-staff, but the role check mirrors
// canManageUser(actor, 'PARENT') — both SUPER_ADMIN and STAFF_ADMIN may
// invite a parent (worker/routes/admin.js authorizes this via
// 'parents.manage', which both roles hold), unlike invite-staff which is
// SUPER_ADMIN only.
// ============================================================================

import { createClient } from 'jsr:@supabase/supabase-js@2';

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
    .from('profiles')
    .select('role, status')
    .eq('id', userData.user.id)
    .single();

  const allowed = callerProfile?.status === 'active'
    && (callerProfile.role === 'SUPER_ADMIN' || callerProfile.role === 'STAFF_ADMIN');
  if (!allowed) return json({ ok: false, error: 'forbidden' }, 403);

  let body: { email?: string; name?: string };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: 'bad_request' }, 400);
  }
  // TODO (implementation): validate body.email, reject duplicates.

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  // TODO (implementation): same three steps as invite-staff — invite via
  // Auth, insert the public.profiles row with role='PARENT', write an
  // audit_log row (action: 'parents.invited').

  return json({ ok: false, error: 'not_implemented' }, 501);
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
