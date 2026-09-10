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

-- "Create an EMPTY album" — retained as a direct staff capability, but only
-- for a record that carries NO storage path and (by definition of a new
-- row) no photos. cover_storage_path must be null on the inserted row; it
-- is set later, and only by the manage-media Edge Function, once a real
-- photo object exists for it to point at. This is the "clearly separate
-- create-empty-gallery from add/upload gallery photo" split: album shell
-- here, every byte-bearing operation through manage-media.
create policy "galleries_insert_by_staff"
on public.galleries for insert
to authenticated
with check (public.is_active_staff() and cover_storage_path is null);

-- Staff may edit an album's title / summary / visibility / status directly
-- (ordinary non-upload content management) — but NOT its cover_storage_path.
-- The WITH CHECK pins cover_storage_path to the row's current committed
-- value via the SECURITY DEFINER helper public.gallery_current_cover_path()
-- (see 20260101000010_gallery_cover_helper.sql), so a client UPDATE that
-- tries to set, change, or clear the cover is rejected. Setting a cover is
-- done only by the manage-media Edge Function's set_gallery_cover operation,
-- which takes a gallery_photo_id (never a path), verifies the photo belongs
-- to that gallery / exists / is not soft-deleted / is eligible, derives the
-- photo's own storage_path server-side, and writes it with the service-role
-- client (which bypasses RLS and this WITH CHECK). `is not distinct from`
-- so a NULL cover compares equal to NULL (staff editing an album that has
-- no cover is unaffected).
create policy "galleries_update_by_staff"
on public.galleries for update
to authenticated
using (public.is_active_staff())
with check (
  public.is_active_staff()
  and cover_storage_path is not distinct from public.gallery_current_cover_path(id)
);

-- No DELETE policy for galleries — deliberately. Hard deletion of an album
-- row is performed ONLY by the manage-media Edge Function's `delete`
-- operation (service-role client, active-Super-Admin check in code, removes
-- every related Storage object first, writes an audit_log row, and records
-- media.orphan_cleanup_failed for any object it could not remove). A
-- browser session with the publishable key — Super Admin included — has no
-- DELETE grant on this table and cannot remove a row. The normal staff
-- workflow is soft delete (deleted_at) / archive via manage-media, which is
-- recoverable; hard delete is not.

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

-- No client-side INSERT, UPDATE, or DELETE policy for gallery_photos —
-- deliberately. Every gallery_photos row is created, edited (caption /
-- sort_order / status), soft-deleted (deleted_at), and hard-deleted ONLY by
-- the manage-media Edge Function using the service-role client, which is
-- also the only code that ever writes storage_path. A browser session
-- holding the publishable (anon) key has no write grant of any kind on this
-- table for any role — Super Admin included — so it cannot create a photo
-- row, cannot point one at an arbitrary storage_path, cannot flip a photo
-- to 'published' out of band, and cannot delete a photo row or its Storage
-- object. See supabase/functions/manage-media/index.ts: `delete` removes
-- the Storage object(s) first, then the row(s), writes an audit_log event,
-- and records media.orphan_cleanup_failed for anything it could not remove.
