-- ============================================================================
-- 20260101000009_function_permissions.sql
-- NOT YET APPLIED. Proposed, staged for review — see the analysis in this
-- session's report for the full function-by-function reasoning.
--
-- Explicit least-privilege EXECUTE grants for the four SECURITY DEFINER
-- helper functions, replacing reliance on PostgreSQL's default behaviour
-- (PUBLIC receives EXECUTE automatically on function creation unless
-- revoked — migration 20260101000001 created these four without any
-- REVOKE, so right now all of PUBLIC — anon, authenticated, and anyone
-- else — has EXECUTE on all four purely by that default).
--
-- DEPENDS ON A COMPANION POLICY-FILE CHANGE NOT YET MADE: every policy in
-- supabase/policies/ that calls one of these four functions and is not
-- meant for anonymous visitors must ALSO gain an explicit `to authenticated`
-- clause. Without that change, applying this migration alone would break
-- anonymous read access to the public website's own content — see this
-- session's report for the exact diff pattern. Apply the policy-file change
-- first (or in the same reviewed batch), never this migration on its own.
--
-- No Supabase-internal role needs a grant here. The object owner (postgres /
-- supabase_admin) always retains implicit EXECUTE regardless of any REVOKE
-- FROM PUBLIC. service_role does not need these functions at all: it
-- bypasses RLS entirely (Supabase grants it BYPASSRLS), so server-side code
-- using the service-role client should query public.profiles directly
-- rather than through these auth.uid()-scoped helpers, which would not
-- resolve usefully outside an end-user's own JWT context anyway.
-- ============================================================================

revoke execute on function public.current_profile() from public;
revoke execute on function public.has_role(public.user_role) from public;
revoke execute on function public.is_active_staff() from public;
revoke execute on function public.is_active_parent() from public;

-- Explicit, defensive no-op: anon never had an explicit grant (only the
-- implicit PUBLIC one just revoked above), but revoking from it by name too
-- documents the intent plainly for anyone reading this migration later,
-- rather than leaving that guarantee implicit.
revoke execute on function public.current_profile() from anon;
revoke execute on function public.has_role(public.user_role) from anon;
revoke execute on function public.is_active_staff() from anon;
revoke execute on function public.is_active_parent() from anon;

-- current_profile(): needed ONLY by the authenticated
-- profiles_update_own_name_only policy's WITH CHECK clause (see
-- supabase/policies/profiles.sql). No anon-facing policy calls it.
grant execute on function public.current_profile() to authenticated;

-- has_role(target_role): needed by every *_delete_by_super_admin policy and
-- the two Super-Admin-tier profiles policies. Once Change A adds
-- `to authenticated` to all of those, only authenticated ever evaluates
-- this function (anon has no DELETE path and no path into the Super-Admin
-- profiles policies at all).
grant execute on function public.has_role(public.user_role) to authenticated;

-- is_active_staff(): needed by every staff-tier SELECT/INSERT/UPDATE policy
-- across notices, calendar_events, news_posts, galleries, gallery_photos,
-- documents, document_versions, settings, page_content, and the two
-- storage.objects buckets that gate writes by staff status.
grant execute on function public.is_active_staff() to authenticated;

-- is_active_parent(): needed by every parent-tier SELECT policy across the
-- same content tables, plus the parent-media bucket's read policy.
grant execute on function public.is_active_parent() to authenticated;
