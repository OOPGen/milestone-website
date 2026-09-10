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

create policy "documents_insert_by_staff"
on public.documents for insert
to authenticated
with check (public.is_active_staff());

create policy "documents_update_by_staff"
on public.documents for update
to authenticated
using (public.is_active_staff());

create policy "documents_delete_by_super_admin"
on public.documents for delete
to authenticated
using (public.has_role('SUPER_ADMIN'));

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

create policy "document_versions_select_public_anon"
on public.document_versions for select
to anon, authenticated
using (
  exists (
    select 1 from public.documents d
    where d.id = document_versions.document_id
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
        (public.is_active_parent() and d.status = 'published' and d.deleted_at is null)
        or (public.is_active_staff() and d.deleted_at is null)
      )
  )
);

create policy "document_versions_insert_by_staff"
on public.document_versions for insert
to authenticated
with check (public.is_active_staff());

-- No update policy: a version, once created, is immutable — replacing a
-- document adds a new version row rather than editing an old one (this is
-- the whole point of keeping version history for audit purposes).

create policy "document_versions_delete_by_super_admin"
on public.document_versions for delete
to authenticated
using (public.has_role('SUPER_ADMIN'));
