-- ============================================================================
-- RLS policies for public.news_posts
-- STAGED FOR REVIEW — not yet part of a migration, not yet applied.
-- Same three-tier pattern as supabase/policies/notices.sql. News defaults to
-- public visibility (see migration), so the anon policy is the one most
-- news rows are expected to satisfy in practice.
-- ============================================================================

create policy "news_posts_select_public_anon"
on public.news_posts for select
to anon, authenticated
using (status = 'published' and visibility = 'public' and deleted_at is null);

create policy "news_posts_select_published_by_parent"
on public.news_posts for select
to authenticated
using (public.is_active_parent() and status = 'published' and deleted_at is null);

create policy "news_posts_select_all_by_staff"
on public.news_posts for select
to authenticated
using (public.is_active_staff() and deleted_at is null);

create policy "news_posts_insert_by_staff"
on public.news_posts for insert
to authenticated
with check (public.is_active_staff());

create policy "news_posts_update_by_staff"
on public.news_posts for update
to authenticated
using (public.is_active_staff());

create policy "news_posts_delete_by_super_admin"
on public.news_posts for delete
to authenticated
using (public.has_role('SUPER_ADMIN'));
