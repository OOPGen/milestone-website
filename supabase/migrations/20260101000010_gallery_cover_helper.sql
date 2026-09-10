-- ============================================================================
-- 20260101000010_gallery_cover_helper.sql
-- NOT YET APPLIED. Proposed, staged for review.
--
-- One SECURITY DEFINER helper, public.gallery_current_cover_path(uuid), used
-- by galleries_update_by_staff's WITH CHECK to make public.galleries.cover_
-- storage_path effectively immutable through a client (publishable-key)
-- UPDATE: the check compares the NEW row's cover_storage_path to the row's
-- CURRENT committed value and rejects the UPDATE if they differ. A staff
-- browser session can still edit an album's title / summary / visibility /
-- status directly, but can never set, change, or clear its cover path —
-- that is done only by the manage-media Edge Function's set_gallery_cover
-- operation (service-role client, which bypasses RLS and therefore this
-- WITH CHECK entirely).
--
-- Why a SECURITY DEFINER function and not a raw self-referential subquery in
-- the policy: identical reasoning to public.current_profile() in migration
-- 20260101000001 — a policy expression that queries the same table the
-- policy is on risks recursively re-triggering RLS. SECURITY DEFINER + a
-- fixed search_path makes this function's own read bypass RLS, and it
-- returns nothing but one already-non-secret column (a storage path) for a
-- caller-supplied gallery id, so it widens no access.
--
-- APPLY ORDER: this migration must be applied before the revised
-- supabase/policies/galleries_and_photos.sql (which references the
-- function). In the future single reviewed batch: migration 9, then this
-- migration 10, then the policy files.
-- ============================================================================

create or replace function public.gallery_current_cover_path(p_gallery_id uuid)
returns text
language sql
security definer
stable
set search_path = public
as $$
  select cover_storage_path from public.galleries where id = p_gallery_id;
$$;

-- Least-privilege EXECUTE, matching the pattern in
-- 20260101000009_function_permissions.sql: strip the implicit PUBLIC grant,
-- deny anon explicitly (galleries_update_by_staff is `to authenticated`, so
-- anon never evaluates that WITH CHECK and never needs this), grant only
-- authenticated.
revoke execute on function public.gallery_current_cover_path(uuid) from public;
revoke execute on function public.gallery_current_cover_path(uuid) from anon;
grant execute on function public.gallery_current_cover_path(uuid) to authenticated;
