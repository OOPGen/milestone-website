-- ============================================================================
-- 20260101000007_documents_and_versions.sql
-- NOT YET APPLIED. See supabase/SUPABASE-SETUP.md.
--
-- Replacing a document adds a new version rather than overwriting the file —
-- carried over unchanged from the D1 design, which the pre-launch content
-- pass relied on to keep an audit trail of every uploaded PDF (see
-- CONTENT-CHECKLIST.md). documents.current_version_id and
-- document_versions.document_id reference each other, so documents is
-- created first WITHOUT that foreign key, document_versions is created
-- referencing documents, and the foreign key back onto documents is added
-- last — the same two-step approach used in migrations/0001_init.sql for D1.
-- ============================================================================

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category text not null default '',
  description text not null default '',
  doc_date date,
  visibility public.content_visibility not null default 'parents',
  status public.content_status not null default 'draft',
  current_version_id uuid,             -- FK added below, after document_versions exists
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  archived_at timestamptz,
  deleted_at timestamptz
);

create table public.document_versions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  storage_path text not null,          -- PDF only, in the school-documents bucket
  version integer not null,
  note text not null default '',
  uploaded_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (document_id, version)
);

alter table public.documents
  add constraint documents_current_version_fk
  foreign key (current_version_id) references public.document_versions(id);

create index documents_status_visibility_idx on public.documents (status, visibility) where deleted_at is null;
create index document_versions_document_idx on public.document_versions (document_id);

alter table public.documents enable row level security;
alter table public.document_versions enable row level security;
-- Policies staged in supabase/policies/documents_and_versions.sql.
