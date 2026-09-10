-- ============================================================================
-- RLS policies for public.documents and public.document_versions
-- STAGED FOR REVIEW — not yet part of a migration, not yet applied.
--
-- These policies gate the METADATA rows only (title, category, which version
-- is current, etc.). The actual PDF bytes are gated separately by Supabase
-- Storage's own policies on storage.objects — see
-- supabase/storage/buckets.sql. A client being able to read a documents row
-- does not by itself grant access to the file; both layers must agree.
-- ============================================================================

-- documents -----------------------------------------------------------------

create policy "documents_select_public_anon"
on public.documents for select
to anon, authenticated
using (status = 'published' and visibility = 'public' and deleted_at is null);

create policy "documents_select_published_by_parent"
on public.documents for select
to authenticated
using (public.is_active_parent() and status = 'published' and deleted_at is null);

create policy "documents_select_all_by_staff"
on public.documents for select
to authenticated
using (public.is_active_staff() and deleted_at is null);

-- No client-side INSERT or UPDATE policy for documents — deliberately.
-- A documents row is created (with its first version), has its metadata
-- edited, is published / archived / soft-deleted, and has its
-- current_version_id advanced ONLY by the manage-media Edge Function using
-- the service-role client. A browser session with the publishable (anon)
-- key therefore cannot create a document, cannot change current_version_id
-- to point at a different (or non-current) version, and cannot publish a
-- document whose Storage object does not yet exist. See
-- supabase/functions/manage-media/index.ts.
-- (A future refinement could re-introduce a narrow
-- documents_update_metadata_by_staff for plain text fields only — title,
-- category, description, doc_date — guarded by a SECURITY DEFINER old-row
-- helper that pins current_version_id and gates status transitions, if the
-- Edge-Function round trip for a typo fix proves too heavy. Not done here:
-- the strict version is the reviewed one.)
--
-- No client-side DELETE policy either. Hard deletion of a document (and all
-- its version rows + Storage objects) is performed ONLY by the manage-media
-- Edge Function's `delete` operation: active-Super-Admin check in code,
-- service-role client, removes every school-documents object for the
-- document's versions first, then the rows (nulling current_version_id to
-- satisfy the FK), writes an audit_log event, and records
-- media.orphan_cleanup_failed for any object it could not remove. A browser
-- with the publishable key — Super Admin included — has no DELETE grant.
-- Normal staff workflow is soft delete (deleted_at) / archive via
-- manage-media, which is recoverable; hard delete is not.

-- document_versions ------------------------------------------------------
-- Readable by whoever can already read the parent document — visibility is
-- not duplicated onto this table, it is checked via the same three tiers
-- against `documents`.

-- Split into two policies (rather than one policy with a single `to`
-- clause) because the original combined an anon-safe branch with two
-- authenticated-only branches in one OR'd USING expression — a single
-- policy cannot scope different branches of its own expression to
-- different roles. Postgres OR's multiple permissive policies for the
-- same operation together, so these two remain logically equivalent to
-- the original combined condition.

-- Anon and Parent may read only the CURRENT version row (d.current_version_id
-- = document_versions.id) — a superseded version stays in the table for
-- audit/version history, but is never reachable by anyone other than active
-- staff. Staff's branch deliberately omits this check: staff must be able to
-- review the full version history, not just the live one.
create policy "document_versions_select_public_anon"
on public.document_versions for select
to anon, authenticated
using (
  exists (
    select 1 from public.documents d
    where d.id = document_versions.document_id
      and d.current_version_id = document_versions.id
      and d.status = 'published' and d.visibility = 'public' and d.deleted_at is null
  )
);

create policy "document_versions_select_parent_or_staff"
on public.document_versions for select
to authenticated
using (
  exists (
    select 1 from public.documents d
    where d.id = document_versions.document_id
      and (
        (public.is_active_parent() and d.current_version_id = document_versions.id
          and d.status = 'published' and d.deleted_at is null)
        or (public.is_active_staff() and d.deleted_at is null)
      )
  )
);

-- No client-side INSERT, UPDATE, or DELETE policy for document_versions —
-- deliberately. A version row is created ONLY by the manage-media Edge
-- Function (service-role client), atomically with the Storage object upload
-- and the documents.current_version_id advance. It is never updated (a
-- version is immutable — replacing a document adds a NEW version row). It is
-- deleted only as part of manage-media's `delete` of the parent document
-- (service-role, active-Super-Admin check in code, Storage objects removed
-- first, audit_log written). A browser with the publishable key — Super
-- Admin included — has no write grant of any kind on this table.
