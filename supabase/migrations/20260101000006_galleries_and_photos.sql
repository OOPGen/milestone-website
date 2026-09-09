-- ============================================================================
-- 20260101000006_galleries_and_photos.sql
-- NOT YET APPLIED. See supabase/SUPABASE-SETUP.md.
--
-- No custom "assets" table: Supabase Storage already tracks every uploaded
-- object in its own storage.objects table (bucket, path, owner, metadata).
-- Duplicating that in a parallel `assets` table (as the Cloudflare D1 design
-- does, because R2 has no equivalent built-in catalogue) would just be two
-- sources of truth going out of sync. Instead, gallery_photos and
-- document_versions (next migration) store a `storage_path` — the bucket
-- name and object path — and resolve the actual file through Storage
-- directly. See supabase/storage/buckets.sql for the three buckets this
-- references (public-media, parent-media, school-documents).
-- ============================================================================

create table public.galleries (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  summary text not null default '',
  cover_storage_path text,
  status public.content_status not null default 'draft',
  visibility public.content_visibility not null default 'parents',
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  archived_at timestamptz,
  deleted_at timestamptz
);

create table public.gallery_photos (
  id uuid primary key default gen_random_uuid(),
  gallery_id uuid not null references public.galleries(id) on delete cascade,
  storage_path text not null,
  -- The bucket a photo actually lives in must agree with the gallery's own
  -- visibility (a public gallery's photos belong in public-media, a
  -- parents-only gallery's in parent-media) — enforced by the upload path
  -- (Edge Function / dashboard logic), not by this column alone.
  caption text not null default '',
  sort_order integer not null default 0,
  status public.content_status not null default 'published',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index galleries_status_visibility_idx on public.galleries (status, visibility) where deleted_at is null;
create index gallery_photos_gallery_idx on public.gallery_photos (gallery_id, sort_order) where deleted_at is null;

alter table public.galleries enable row level security;
alter table public.gallery_photos enable row level security;
-- Policies staged in supabase/policies/galleries_and_photos.sql.
