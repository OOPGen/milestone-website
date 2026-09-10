/* Pure authorization logic for the Super Admin portal.

   Deliberately free of any import.meta.env read, any DOM reference, and any
   @supabase/supabase-js import, so it can be unit-tested in plain Node
   (tests/admin-portal.test.mjs).

   The portal's real protection is server-side + database-side:
     - Supabase Auth verifies the JWT on every request.
     - The RLS policies in supabase/policies/* only let an active
       SUPER_ADMIN read staff-tier content or write anything.
   evaluateAccess() below is the CLIENT-SIDE gate: it decides what the UI
   renders. It never grants access the database would refuse — a user who
   defeats it still cannot read a draft or write a row, because RLS denies
   it. Its job is to show the right screen and to sign a non-admin out
   rather than leaving them on a broken dashboard. */

/**
 * @param {object} args
 * @param {object|null} args.session  the Supabase auth session (or null)
 * @param {object|null} args.profile  the caller's public.profiles row (or null)
 * @returns {{allowed: boolean, reason: string}}
 */
export function evaluateAccess({ session, profile } = {}) {
  if (!session || !session.user || !session.user.id) {
    return { allowed: false, reason: 'no_session' };
  }
  if (!profile || !profile.id) {
    return { allowed: false, reason: 'no_profile' };
  }
  if (profile.id !== session.user.id) {
    // A profile that isn't the signed-in user's own row should never reach
    // here (profiles_select_own only returns id = auth.uid()), but fail
    // closed if it somehow does.
    return { allowed: false, reason: 'profile_mismatch' };
  }
  if (profile.role !== 'SUPER_ADMIN') {
    return { allowed: false, reason: 'not_super_admin' };
  }
  if (profile.status !== 'active') {
    return { allowed: false, reason: 'inactive' };
  }
  return { allowed: true, reason: 'ok' };
}

/** Human-readable message for a denied reason, for the login screen. */
export function accessMessage(reason) {
  switch (reason) {
    case 'no_session': return 'Please sign in.';
    case 'no_profile': return 'This account has no portal profile. Ask a system administrator to complete the Super Admin bootstrap.';
    case 'profile_mismatch': return 'Session and profile do not match. Please sign in again.';
    case 'not_super_admin': return 'This portal is for Super Admin accounts only.';
    case 'inactive': return 'This account is not active.';
    default: return 'Access denied.';
  }
}
