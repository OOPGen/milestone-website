-- ============================================================================
-- RLS policies for public.notices
-- STAGED FOR REVIEW — not yet part of a migration, not yet applied.
--
-- This same three-tier pattern (anon: public+published / parent: adds
-- parents-only+published / staff: everything not soft-deleted) repeats for
-- calendar_events, news_posts and galleries — see those files. Written out
-- per table rather than as one shared policy so each is independently
-- readable and auditable.
-- ============================================================================

create policy "notices_select_public_anon"
on public.notices for select
to anon, authenticated
using (status = 'published' and visibility = 'public' and deleted_at is null);

create policy "notices_select_published_by_parent"
on public.notices for select
using (public.is_active_parent() and status = 'published' and deleted_at is null);

create policy "notices_select_all_by_staff"
on public.notices for select
using (public.is_active_staff() and deleted_at is null);

create policy "notices_insert_by_staff"
on public.notices for insert
with check (public.is_active_staff());

create policy "notices_update_by_staff"
on public.notices for update
using (public.is_active_staff());

-- Hard delete: Super Admin only — mirrors "content.delete.hard", which
-- Staff Admin does not hold. Staff Admin archives via UPDATE (status =
-- 'archived'), never DELETE.
create policy "notices_delete_by_super_admin"
on public.notices for delete
using (public.has_role('SUPER_ADMIN'));
