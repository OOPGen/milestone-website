-- ============================================================================
-- RLS policies for public.audit_log
-- STAGED FOR REVIEW — not yet part of a migration, not yet applied.
--
-- Read-only for Super Admin, matching "audit.read" being the one capability
-- that even Staff Admin does not hold. No INSERT/UPDATE/DELETE policy for
-- any client role at all: rows are written only by Edge Functions using the
-- service-role key (bypasses RLS via the Supabase Admin client), the same
-- way worker/lib/audit.js's writeAudit() is only ever called from
-- server-side route handlers, never reachable as its own endpoint.
-- ============================================================================

create policy "audit_log_select_by_super_admin"
on public.audit_log for select
using (public.has_role('SUPER_ADMIN'));

-- Deliberately no insert/update/delete policy for any client role — append
-- via the service-role key only, and never update or delete a row once
-- written (append-only, exactly as the Cloudflare design's comment on this
-- table states).
