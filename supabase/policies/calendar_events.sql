-- ============================================================================
-- RLS policies for public.calendar_events
-- STAGED FOR REVIEW — not yet part of a migration, not yet applied.
-- Same three-tier pattern as supabase/policies/notices.sql.
-- ============================================================================

create policy "calendar_events_select_public_anon"
on public.calendar_events for select
to anon, authenticated
using (status = 'published' and visibility = 'public' and deleted_at is null);

create policy "calendar_events_select_published_by_parent"
on public.calendar_events for select
using (public.is_active_parent() and status = 'published' and deleted_at is null);

create policy "calendar_events_select_all_by_staff"
on public.calendar_events for select
using (public.is_active_staff() and deleted_at is null);

create policy "calendar_events_insert_by_staff"
on public.calendar_events for insert
with check (public.is_active_staff());

create policy "calendar_events_update_by_staff"
on public.calendar_events for update
using (public.is_active_staff());

create policy "calendar_events_delete_by_super_admin"
on public.calendar_events for delete
using (public.has_role('SUPER_ADMIN'));
