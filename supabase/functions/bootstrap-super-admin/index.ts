// ============================================================================
// bootstrap-super-admin — SCAFFOLD ONLY. Not deployed. Not implemented.
//
// Supabase equivalent of worker/routes/auth.js's bootstrapSuperAdmin().
// One-time procedure: creates the first SUPER_ADMIN account, but issues no
// password — the owner sets their own via Supabase's own invite/recovery
// link, the same "nobody but the account owner ever sees the password" rule
// ACCOUNT-SYSTEM-PLAN.md section 9 already established for the Cloudflare
// version.
//
// Reads env vars by NAME only — see supabase/SUPABASE-SETUP.md for the full
// list. No value for any of them is written here or anywhere in this repo.
//   SUPER_ADMIN_EMAIL     — allow-list, matches env.SUPER_ADMIN_EMAIL in wrangler.toml
//   BOOTSTRAP_TOKEN       — one-time shared secret, set with `supabase secrets set`
//   SUPABASE_URL          — provided automatically to every Edge Function
//   SUPABASE_SERVICE_ROLE_KEY — provided automatically; NEVER logged, NEVER
//                               returned in a response, NEVER passed to the
//                               anon/frontend client
// ============================================================================

import { createClient } from 'jsr:@supabase/supabase-js@2';

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return json({ ok: false, error: 'method_not_allowed' }, 405);
  }

  const bootstrapToken = Deno.env.get('BOOTSTRAP_TOKEN');
  const superAdminEmail = Deno.env.get('SUPER_ADMIN_EMAIL');
  if (!bootstrapToken || !superAdminEmail) {
    return json({ ok: false, error: 'not_configured' }, 503);
  }

  const provided = req.headers.get('X-Bootstrap-Token') ?? '';
  if (provided !== bootstrapToken) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  // TODO (implementation, not scaffold): refuse unless zero SUPER_ADMIN rows
  // exist in public.profiles — mirrors the Cloudflare route's
  //   "SELECT COUNT(*) AS n FROM users WHERE role = 'SUPER_ADMIN'"
  // guard, so this function becomes permanently inert once a Super Admin
  // exists, exactly like the Cloudflare version.
  //
  // const { count } = await admin.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'SUPER_ADMIN');
  // if ((count ?? 0) > 0) return json({ ok: false, error: 'already_bootstrapped' }, 400);

  let body: { email?: string };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: 'bad_request' }, 400);
  }
  if (body.email?.toLowerCase() !== superAdminEmail.toLowerCase()) {
    return json({ ok: false, error: 'validation', message: 'Email does not match the configured Super Admin address.' }, 400);
  }

  // TODO (implementation): create the auth.users row via
  //   admin.auth.admin.inviteUserByEmail(superAdminEmail, { data: { role: 'SUPER_ADMIN' } })
  // then insert the matching public.profiles row (role='SUPER_ADMIN',
  // status='invited', password_hash does not exist in this design —
  // Supabase Auth owns the password). inviteUserByEmail sends Supabase's
  // own invite email AND returns an action_link — surface that link the
  // same way the Cloudflare version returns invitationToken, in case email
  // delivery is not yet configured (see DEPLOYMENT.md section 4's
  // equivalent note for the enquiry form).
  //
  // Then: write ONE audit_log row (action: 'auth.bootstrap_super_admin'),
  // using the service-role client (RLS has no client-facing INSERT policy
  // on audit_log — see supabase/policies/audit_log.sql).

  return json({ ok: false, error: 'not_implemented' }, 501);
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
