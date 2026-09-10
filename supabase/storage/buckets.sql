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
-- THERE ARE NO client-side write policies on storage.objects — no INSERT,
-- no UPDATE, no DELETE, for ANY of the three buckets. Every byte written to
-- or removed from Storage goes through the manage-media Edge Function
-- (supabase/functions/manage-media/index.ts) using the service-role client,
-- which bypasses RLS the same way invite-staff / invite-parent already do.
-- The Edge Function is the only place that:
--   * chooses a bucket (derived from content type + the trusted
--     gallery/document visibility, never from a client-supplied name)
--   * generates object paths (server-side, crypto.randomUUID())
--   * uploads a NEW object                 (`upload` / `replace`)
--   * overwrites an EXISTING object's bytes (`replace_photo_bytes` — same
--     server-derived path, image type/size re-validated, no metadata change)
--   * removes an object                     (`delete`, Super-Admin only)
-- Because no write policy is granted to `authenticated` on this table for
-- any bucket, a direct `supabase.storage.from(...).upload/update/remove(...)`
-- call from the browser is denied by RLS regardless of role — Super Admin
-- included. The mapping and the checks enforced in the Edge Function can
-- only be bypassed by a request that never reaches Postgres RLS at all
-- (i.e. by getting hold of the service-role key), which is a materially
-- different and already-tracked risk (see supabase/SUPABASE-SETUP.md).
--
-- public-media needs no SELECT policy either: the bucket is `public = true`,
-- so Storage serves those objects directly without consulting RLS at all —
-- the Supabase-native equivalent of worker/routes/files.js serving a public
-- asset with "Cache-Control: public" and no session check.
-- ----------------------------------------------------------------------------

-- parent-media: read requires an active parent or staff session — this is
-- the direct equivalent of worker/routes/files.js's rule that a
-- parents-only asset returns 404 (not 403) to anyone without
-- 'content.read.parent' / 'documents.download.parent'. Storage's own
-- policy engine returns a generic "not found"-shaped error for a denied
-- object read by default, matching that behaviour without extra code.
--
-- Split into two policies (parent vs. staff) rather than one shared
-- condition: a parent must only ever reach a *published*, non-deleted photo
-- in a *published*, non-deleted gallery — mirrored from the identical check
-- already used in supabase/policies/galleries_and_photos.sql's
-- gallery_photos_select_published_by_parent. Staff needs the broader,
-- unfiltered bucket read (to review drafts before publishing), matching
-- gallery_photos_select_all_by_staff.
create policy "parent_media_select_by_parent"
on storage.objects for select
to authenticated
using (
  bucket_id = 'parent-media'
  and public.is_active_parent()
  and exists (
    select 1 from public.gallery_photos p
    join public.galleries g on g.id = p.gallery_id
    where p.storage_path = storage.objects.name
      and p.status = 'published' and p.deleted_at is null
      and g.status = 'published' and g.deleted_at is null
  )
);

create policy "parent_media_select_by_staff"
on storage.objects for select
to authenticated
using (bucket_id = 'parent-media' and public.is_active_staff());

-- (No parent-media write policy of any kind — see the header block above.
-- New objects, in-place byte replacement, and removal all go exclusively
-- through the manage-media Edge Function's service-role client.)

-- school-documents: read is gated through the documents/document_versions
-- tables (a document's own visibility, not a blanket parent-or-staff rule)
-- — a public-visibility document should be downloadable by anyone, exactly
-- as it would be on the public website, not gated behind a parent session
-- just because it happens to live in this bucket.
--
-- Split into two policies (rather than one policy with a single `to`
-- clause) because the original combined an anon-safe branch with two
-- authenticated-only branches in one OR'd USING expression — the same fix
-- already applied to document_versions_select_if_document_visible in
-- supabase/policies/documents_and_versions.sql, for the same reason: a
-- single policy cannot scope different branches of its own expression to
-- different roles. Postgres OR's multiple permissive policies for the same
-- operation together, so these two remain logically equivalent to the
-- original combined condition.
-- Anon and Parent may read only the CURRENT version's object
-- (v.id = d.current_version_id) — a superseded version's file stays in the
-- bucket for audit/version history, but is only ever reachable by active
-- staff (the staff branch below deliberately omits this check). This mirrors
-- the identical current_version_id restriction added to
-- document_versions_select_public_anon / document_versions_select_parent_or_staff
-- in supabase/policies/documents_and_versions.sql — the table-row check and
-- the storage-object check must agree, since either layer alone denying
-- access is sufficient, but both are meant to say the same thing.
create policy "school_documents_select_public"
on storage.objects for select
to anon, authenticated
using (
  bucket_id = 'school-documents'
  and exists (
    select 1 from public.document_versions v
    join public.documents d on d.id = v.document_id
    where v.storage_path = storage.objects.name
      and v.id = d.current_version_id
      and d.status = 'published' and d.visibility = 'public' and d.deleted_at is null
  )
);

create policy "school_documents_select_by_parent_or_staff"
on storage.objects for select
to authenticated
using (
  bucket_id = 'school-documents'
  and exists (
    select 1 from public.document_versions v
    join public.documents d on d.id = v.document_id
    where v.storage_path = storage.objects.name
      and (
        (public.is_active_parent() and v.id = d.current_version_id
          and d.status = 'published' and d.deleted_at is null)
        or (public.is_active_staff() and d.deleted_at is null)
      )
  )
);

-- (No school-documents write policy of any kind — see the header block
-- above. A document's file is replaced by uploading a NEW object + a new
-- document_versions row, never by overwriting one in place; object removal
-- is manage-media's `delete` operation only.)
--
-- ----------------------------------------------------------------------------
-- Final storage.objects policy inventory (this file):
--   SELECT : parent_media_select_by_parent, parent_media_select_by_staff,
--            school_documents_select_public,
--            school_documents_select_by_parent_or_staff
--   INSERT : (none)
--   UPDATE : (none)
--   DELETE : (none)
-- public-media has no policy at all (bucket public = true handles reads;
-- writes go through the Edge Function). Every write path in the whole
-- system is the manage-media service-role client.
-- ----------------------------------------------------------------------------
