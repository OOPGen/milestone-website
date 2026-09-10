/* End-to-end behavioural test for the Super Admin portal, run against a REAL
   Supabase project. Opt-in: it does nothing unless all four env vars are
   set, so it never blocks CI and never needs credentials in the repo.

   Set these to a THROWAWAY Super Admin you control (not a personal account):

     SUPABASE_TEST_URL=https://<ref>.supabase.co
     SUPABASE_TEST_ANON_KEY=<publishable anon key>
     SUPABASE_TEST_SUPERADMIN_EMAIL=<the bootstrapped Super Admin email>
     SUPABASE_TEST_SUPERADMIN_PASSWORD=<its password>

   Run:  npm run test:admin-portal:live

   It proves, against live RLS + Auth + the audit trigger:
     - login succeeds and yields an active SUPER_ADMIN profile
     - an anonymous client cannot read a draft or write anything
     - the Super Admin can create a draft, publish it, and soft-delete it
     - each of those writes produced an audit_log row
     - logout clears the session
   It cleans up the test row (hard delete) at the end. */

import { createClient } from '@supabase/supabase-js';
import { evaluateAccess } from '../src/admin-portal/auth.js';
import { publishPatch, softDeletePatch } from '../src/admin-portal/content.js';

const URL = process.env.SUPABASE_TEST_URL;
const ANON = process.env.SUPABASE_TEST_ANON_KEY;
const EMAIL = process.env.SUPABASE_TEST_SUPERADMIN_EMAIL;
const PASSWORD = process.env.SUPABASE_TEST_SUPERADMIN_PASSWORD;

if (!URL || !ANON || !EMAIL || !PASSWORD) {
  console.log('SKIP  admin-portal.live — set SUPABASE_TEST_URL / SUPABASE_TEST_ANON_KEY / SUPABASE_TEST_SUPERADMIN_EMAIL / SUPABASE_TEST_SUPERADMIN_PASSWORD to run.');
  process.exit(0);
}

const pass = [], fail = [];
const ok = (n, c, d = '') => { (c ? pass : fail).push(n + (d ? ' — ' + d : '')); };
const opts = { auth: { persistSession: false, autoRefreshToken: false } };

let createdId = null;
const admin = createClient(URL, ANON, opts);   // becomes authenticated below
const anon = createClient(URL, ANON, opts);    // stays anonymous

try {
  /* 1 — login */
  const { data: signIn, error: signInErr } = await admin.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
  ok('login: signInWithPassword succeeds', !signInErr && !!signIn?.session, signInErr?.message);
  const session = signIn?.session ?? null;

  /* 2 — own profile is an active SUPER_ADMIN */
  const { data: profile } = await admin.from('profiles').select('id,email,role,status').eq('id', session?.user?.id).maybeSingle();
  ok('login: own profile is role=SUPER_ADMIN status=active', profile?.role === 'SUPER_ADMIN' && profile?.status === 'active', JSON.stringify(profile));
  ok('login: evaluateAccess() allows this session', evaluateAccess({ session, profile }).allowed === true);

  /* 3 — create a draft notice */
  const marker = 'PORTAL-TEST ' + new Date().toISOString();
  const { data: inserted, error: insErr } = await admin.from('notices')
    .insert({ title: marker, status: 'draft', visibility: 'parents' })
    .select('id,status')
    .single();
  ok('content editing: Super Admin can insert a draft notice', !insErr && !!inserted?.id, insErr?.message);
  createdId = inserted?.id ?? null;
  ok('content editing: the new row starts as draft', inserted?.status === 'draft');

  /* 4 — an anonymous client cannot see the draft, and cannot write */
  if (createdId) {
    const { data: anonRead } = await anon.from('notices').select('id').eq('id', createdId);
    ok('authorization: anonymous client cannot read the draft (RLS)', Array.isArray(anonRead) && anonRead.length === 0);
  }
  const { error: anonWriteErr } = await anon.from('notices').insert({ title: 'anon should fail', status: 'draft', visibility: 'parents' });
  ok('authorization: anonymous client cannot insert a notice (RLS denies)', !!anonWriteErr);

  /* 5 — publish, and check the status transition */
  if (createdId) {
    const { data: pub, error: pubErr } = await admin.from('notices').update(publishPatch()).eq('id', createdId).select('status,published_at').single();
    ok('publish status: update to published succeeds', !pubErr && pub?.status === 'published' && !!pub?.published_at, pubErr?.message);

    /* 6 — audit rows exist for the create and the publish */
    const { data: auditRows } = await admin.from('audit_log')
      .select('action,entity_type,entity_id')
      .eq('entity_type', 'notices').eq('entity_id', createdId).order('created_at', { ascending: true });
    const actions = (auditRows ?? []).map(r => r.action);
    ok('audit logging: a content.create row was written by the trigger', actions.includes('content.create'), JSON.stringify(actions));
    ok('audit logging: a content.update row was written for the publish', actions.includes('content.update'), JSON.stringify(actions));

    /* 7 — soft delete */
    const { data: del, error: delErr } = await admin.from('notices').update(softDeletePatch()).eq('id', createdId).select('deleted_at,status').single();
    ok('soft delete: update sets deleted_at and archives', !delErr && !!del?.deleted_at && del?.status === 'archived', delErr?.message);

    const { data: auditAfterDelete } = await admin.from('audit_log')
      .select('action').eq('entity_type', 'notices').eq('entity_id', createdId);
    ok('audit logging: the soft delete produced a content.soft_delete row',
      (auditAfterDelete ?? []).some(r => r.action === 'content.soft_delete'));
  }

  /* 8 — logout */
  await admin.auth.signOut();
  const { data: after } = await admin.auth.getSession();
  ok('logout: session is cleared after signOut', !after?.session);
} catch (e) {
  fail.push('unexpected exception — ' + (e?.message ?? e));
} finally {
  /* cleanup: hard-delete the test row with a fresh authed client */
  if (createdId) {
    try {
      const cleanup = createClient(URL, ANON, opts);
      await cleanup.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
      await cleanup.from('notices').delete().eq('id', createdId);
      await cleanup.auth.signOut();
    } catch { /* best effort */ }
  }
}

console.log('\nPASS ' + pass.length + '   FAIL ' + fail.length + '\n');
if (fail.length) { console.log('FAILURES:'); fail.forEach(f => console.log('  x ' + f)); }
else pass.forEach(p => console.log('  + ' + p));
process.exit(fail.length ? 1 : 0);
