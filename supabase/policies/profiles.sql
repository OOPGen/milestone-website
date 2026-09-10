-- ============================================================================
-- RLS policies for public.profiles
-- STAGED FOR REVIEW — not yet part of a migration, not yet applied.
-- Requires 20260101000001_profiles_and_roles.sql to already be applied
-- (needs public.profiles, public.has_role(), public.is_active_staff(),
-- public.current_profile()).
--
-- KNOWN LIMITATION: the Cloudflare design's lock-out rules — a user cannot
-- deactivate their own account, and the last active SUPER_ADMIN cannot be
-- deactivated or demoted (see worker/routes/admin.js setAccountStatus()) —
-- are business logic that cannot be fully expressed in a static RLS policy.
-- These policies grant Super Admin broad UPDATE access; the lock-out checks
-- MUST be re-enforced in the manage-user-role Edge Function before that
-- function is trusted to guarantee the same safety the Cloudflare version
-- already tests for (see tests/account-system.test.mjs, section 6).
-- ============================================================================

-- SELECT ------------------------------------------------------------------

-- Anyone signed in can read their own row (the app needs this to know its
-- own role/name after login).
create policy "profiles_select_own"
on public.profiles for select
to authenticated
using (id = auth.uid());

-- Staff (Staff Admin or Super Admin) can read PARENT profiles only —
-- mirrors "parents.manage", which both roles hold.
create policy "profiles_select_parents_by_staff"
on public.profiles for select
to authenticated
using (public.is_active_staff() and role = 'PARENT');

-- Super Admin can read every profile, including other staff — mirrors
-- "staff.manage", which only SUPER_ADMIN holds.
create policy "profiles_select_all_by_super_admin"
on public.profiles for select
to authenticated
using (public.has_role('SUPER_ADMIN'));

-- INSERT --------------------------------------------------------------------
-- Deliberately NO client-facing insert policy. A profile row is created only
-- by the invite-staff / invite-parent Edge Functions using the service-role
-- key, which bypasses RLS entirely via the Supabase Admin client — matching
-- "invite-only, no public self-registration". Omission here means every
-- client-side INSERT attempt is denied by default.

-- UPDATE ----------------------------------------------------------------------

-- A user may update only their own display name — role/status/permissions
-- must stay exactly as they were, checked against a fresh read via the
-- SECURITY DEFINER helper (never a raw self-referential subquery, which
-- would otherwise re-trigger this same RLS check recursively).
create policy "profiles_update_own_name_only"
on public.profiles for update
to authenticated
using (id = auth.uid())
with check (
  id = auth.uid()
  and role = (select p.role from public.current_profile() p)
  and status = (select p.status from public.current_profile() p)
  and extra_permissions = (select p.extra_permissions from public.current_profile() p)
);

-- Staff can change a PARENT account's status (activate/deactivate) but
-- cannot change its role — mirrors "parents.manage".
create policy "profiles_update_parent_status_by_staff"
on public.profiles for update
to authenticated
using (public.is_active_staff() and role = 'PARENT')
with check (role = 'PARENT');

-- Super Admin can update any profile (role, status, extra_permissions) —
-- mirrors "staff.manage" + "roles.assign". See the KNOWN LIMITATION note
-- above: the lock-out rules are NOT enforced here.
create policy "profiles_update_any_by_super_admin"
on public.profiles for update
to authenticated
using (public.has_role('SUPER_ADMIN'));

-- DELETE ----------------------------------------------------------------------
-- Deliberately none. Deactivate via `status`, never delete a profile row —
-- matches "cannot permanently delete important records; use archive/soft-delete".
