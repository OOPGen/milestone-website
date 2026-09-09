-- ============================================================================
-- supabase/storage/buckets.sql
-- STAGED FOR REVIEW — NOT YET APPLIED, NO BUCKET HAS BEEN CREATED.
--
-- Three buckets, matching the Cloudflare design's R2 visibility split
-- (worker/routes/media.js, worker/routes/files.js) plus a distinct
-- documents bucket, since PDFs and images have different validation rules
-- (worker/routes/media.js's MAX_PDF_BYTES/MAX_IMAGE_BYTES and
-- IMAGE_TYPES/'application/pdf' checks):
--
--   public-media      images for public-facing galleries/news covers.
--                     Bucket itself can be `public = true` — object URLs
--                     are directly readable with no auth check needed,
--                     because the CONTENT at those paths is, by policy,
--                     only ever public-visibility material.
--   parent-media       images for parents-only galleries. Bucket is
--                     `public = false` — every read goes through a
--                     storage.objects RLS policy requiring an active
--                     parent or staff session, mirroring
--                     worker/routes/files.js's 404-not-403 rule (a stranger
--                     gets "not found", never "forbidden", so existence is
--                     never confirmed).
--   school-documents   PDFs, all visibilities. Kept separate from
--                     parent-media because document policies are
--                     structurally different from photo policies (gated
--                     through the documents/document_versions tables
--                     rather than an image's own visibility column) — see
--                     the policies at the bottom of this file.
--
-- Creating a bucket is a REMOTE, irreversible-in-effect action (once public
-- objects have been served from a URL, they may be cached/indexed even
-- after the bucket is later made private) — see supabase/SUPABASE-SETUP.md
-- section "Exact remote-action plan" for what running this actually
-- requires and the approval this needs before it is run.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('public-media', 'public-media', true, 8388608, array['image/jpeg','image/png','image/webp']),
  ('parent-media', 'parent-media', false, 8388608, array['image/jpeg','image/png','image/webp']),
  ('school-documents', 'school-documents', false, 20971520, array['application/pdf']);
  -- file_size_limit in bytes: 8 MiB for images, 20 MiB for PDFs — matches
  -- worker/routes/media.js's MAX_IMAGE_BYTES / MAX_PDF_BYTES exactly.

-- ----------------------------------------------------------------------------
-- storage.objects policies.
--
-- public-media needs no SELECT policy: the bucket itself is `public = true`,
-- so Storage serves those objects directly without consulting RLS at all —
-- this is the Supabase-native equivalent of worker/routes/files.js serving a
-- public asset with "Cache-Control: public" and no session check.
-- ----------------------------------------------------------------------------

-- Writes to public-media: staff only, regardless of bucket-level public read.
create policy "public_media_insert_by_staff"
on storage.objects for insert
with check (bucket_id = 'public-media' and public.is_active_staff());

create policy "public_media_update_by_staff"
on storage.objects for update
using (bucket_id = 'public-media' and public.is_active_staff());

create policy "public_media_delete_by_staff"
on storage.objects for delete
using (bucket_id = 'public-media' and public.is_active_staff());

-- parent-media: read requires an active parent or staff session — this is
-- the direct equivalent of worker/routes/files.js's rule that a
-- parents-only asset returns 404 (not 403) to anyone without
-- 'content.read.parent' / 'documents.download.parent'. Storage's own
-- policy engine returns a generic "not found"-shaped error for a denied
-- object read by default, matching that behaviour without extra code.
create policy "parent_media_select_by_parent_or_staff"
on storage.objects for select
using (bucket_id = 'parent-media' and (public.is_active_parent() or public.is_active_staff()));

create policy "parent_media_insert_by_staff"
on storage.objects for insert
with check (bucket_id = 'parent-media' and public.is_active_staff());

create policy "parent_media_update_by_staff"
on storage.objects for update
using (bucket_id = 'parent-media' and public.is_active_staff());

create policy "parent_media_delete_by_staff"
on storage.objects for delete
using (bucket_id = 'parent-media' and public.is_active_staff());

-- school-documents: read is gated through the documents/document_versions
-- tables (a document's own visibility, not a blanket parent-or-staff rule)
-- — a public-visibility document should be downloadable by anyone, exactly
-- as it would be on the public website, not gated behind a parent session
-- just because it happens to live in this bucket.
create policy "school_documents_select_if_document_visible"
on storage.objects for select
using (
  bucket_id = 'school-documents'
  and exists (
    select 1 from public.document_versions v
    join public.documents d on d.id = v.document_id
    where v.storage_path = storage.objects.name
      and (
        (d.status = 'published' and d.visibility = 'public' and d.deleted_at is null)
        or (public.is_active_parent() and d.status = 'published' and d.deleted_at is null)
        or (public.is_active_staff() and d.deleted_at is null)
      )
  )
);

create policy "school_documents_insert_by_staff"
on storage.objects for insert
with check (bucket_id = 'school-documents' and public.is_active_staff());

create policy "school_documents_delete_by_super_admin"
on storage.objects for delete
using (bucket_id = 'school-documents' and public.has_role('SUPER_ADMIN'));
-- No update policy: a document's file is replaced by uploading a new
-- object and a new document_versions row, not by overwriting one in place —
-- matches "Replace an outdated document while retaining an audit history".
