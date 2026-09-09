-- ============================================================================
-- 20260101000004_calendar_events.sql
-- NOT YET APPLIED. See supabase/SUPABASE-SETUP.md.
--
-- Covers the D1 design's `type='term_date'` rows: term openings/closings,
-- holidays, events and reminders — one table, discriminated by `kind`,
-- matching the "Term Dates & Calendar" section of the admin dashboard brief.
-- ============================================================================

create type public.calendar_event_kind as enum ('opening', 'closing', 'holiday', 'event', 'reminder');

create table public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  kind public.calendar_event_kind not null default 'event',
  title text not null,
  summary text not null default '',
  category text not null default '',
  start_date date,
  end_date date,
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

create index calendar_events_status_visibility_idx on public.calendar_events (status, visibility) where deleted_at is null;
create index calendar_events_start_date_idx on public.calendar_events (start_date);

alter table public.calendar_events enable row level security;
-- Policies staged in supabase/policies/calendar_events.sql.
