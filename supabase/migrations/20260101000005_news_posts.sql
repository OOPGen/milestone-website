-- ============================================================================
-- 20260101000005_news_posts.sql
-- NOT YET APPLIED. See supabase/SUPABASE-SETUP.md.
-- ============================================================================

create table public.news_posts (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  summary text not null default '',
  body text not null default '',        -- sanitised rich text — see page_content's comment
  category text not null default '',
  cover_storage_path text,              -- e.g. 'public-media/news/xyz.webp' — see supabase/storage/buckets.sql
  status public.content_status not null default 'draft',
  visibility public.content_visibility not null default 'public',
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  archived_at timestamptz,
  deleted_at timestamptz
);

create index news_posts_status_visibility_idx on public.news_posts (status, visibility) where deleted_at is null;

alter table public.news_posts enable row level security;
-- Policies staged in supabase/policies/news_posts.sql.
