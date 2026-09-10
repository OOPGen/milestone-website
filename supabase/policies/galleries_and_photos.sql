-- ============================================================================
-- RLS policies for public.galleries and public.gallery_photos
-- STAGED FOR REVIEW — not yet part of a migration, not yet applied.
--
-- galleries follows the same three-tier pattern as notices.sql.
-- gallery_photos has no visibility column of its own — a photo's
-- visibility is inherited from the gallery it belongs to (mirrors
-- worker/routes/publicContent.js listPublicAlbumPhotos() /
-- worker/routes/parent.js listParentAlbumPhotos(), which both join through
-- to the album's own status/visibility rather than trusting the photo row
-- alone).
-- ============================================================================

-- galleries -------------------------------------------------------------------

create policy "galleries_select_public_anon"
on public.galleries for select
to anon, authenticated
using (status = 'published' and visibility = 'public' and deleted_at is null);

create policy "galleries_select_published_by_parent"
on public.galleries for select
to authenticated
using (public.is_active_parent() and status = 'published' and deleted_at is null);

create policy "galleries_select_all_by_staff"
on public.galleries for select
to authenticated
using (public.is_active_staff() and deleted_at is null);

create policy "galleries_insert_by_staff"
on public.galleries for insert
to authenticated
with check (public.is_active_staff());

create policy "galleries_update_by_staff"
on public.galleries for update
to authenticated
using (public.is_active_staff());

create policy "galleries_delete_by_super_admin"
on public.galleries for delete
to authenticated
using (public.has_role('SUPER_ADMIN'));

-- gallery_photos ----------------------------------------------------------

create policy "gallery_photos_select_public_anon"
on public.gallery_photos for select
to anon, authenticated
using (
  status = 'published' and deleted_at is null
  and exists (
    select 1 from public.galleries g
    where g.id = gallery_photos.gallery_id
      and g.status = 'published' and g.visibility = 'public' and g.deleted_at is null
  )
);

create policy "gallery_photos_select_published_by_parent"
on public.gallery_photos for select
to authenticated
using (
  public.is_active_parent() and status = 'published' and deleted_at is null
  and exists (
    select 1 from public.galleries g
    where g.id = gallery_photos.gallery_id
      and g.status = 'published' and g.deleted_at is null
  )
);

create policy "gallery_photos_select_all_by_staff"
on public.gallery_photos for select
to authenticated
using (public.is_active_staff() and deleted_at is null);

create policy "gallery_photos_insert_by_staff"
on public.gallery_photos for insert
to authenticated
with check (public.is_active_staff());

create policy "gallery_photos_update_by_staff"
on public.gallery_photos for update
to authenticated
using (public.is_active_staff());

create policy "gallery_photos_delete_by_super_admin"
on public.gallery_photos for delete
to authenticated
using (public.has_role('SUPER_ADMIN'));
