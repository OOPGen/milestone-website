-- ============================================================================
-- 20260101000003_notices.sql
-- NOT YET APPLIED. See supabase/SUPABASE-SETUP.md.
--
-- Notices, calendar events, news posts and galleries were ONE polymorphic
-- `content_items` table in the D1 design (discriminated by a `type` column).
-- Split into separate tables here instead: RLS policies apply per table in
-- Postgres, and the brief lists these as distinct items — separate tables
-- make each one's policy easy to read and audit on its own, rather than
-- every policy needing to also filter by content type.
-- ============================================================================

create table public.notices (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  summary text not null default '',
  body text not null default '',       -- sanitised rich text — see page_content's comment on this same rule
  category text not null default '',
  status public.content_status not null default 'draft',
  visibility public.content_visibility not null default 'parents',
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  archived_at timestamptz,
  deleted_at timestamptz               -- soft delete, matching the Cloudflare design
);

create index notices_status_visibility_idx on public.notices (status, visibility) where deleted_at is null;

alter table public.notices enable row level security;
-- Policies staged in supabase/policies/notices.sql.
