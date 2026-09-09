-- ============================================================================
-- 20260101000001_profiles_and_roles.sql
--
-- NOT YET APPLIED. Local preparation only — see supabase/SUPABASE-SETUP.md
-- for the exact remote-action plan this needs before it can be run against
-- a real Supabase project.
--
-- Converts the account-system design from migrations/0001_init.sql (D1 /
-- SQLite, the Cloudflare Workers backend already committed for later use)
-- into idiomatic Postgres/Supabase. The single biggest change: Supabase Auth
-- (auth.users, managed by GoTrue) already handles password hashing, session
-- tokens, and the invite/signup lifecycle securely — this schema does NOT
-- reinvent D1's users/sessions/login_attempts tables. `profiles` holds only
-- the domain-specific fields this project actually needs, one row per
-- auth.users account.
--
-- Fulfils two brief items at once: "profiles" (the table) and "user roles"
-- (the user_role enum + the three helper functions below, which every RLS
-- policy in supabase/policies/ is built on).
-- ============================================================================

-- Shared enums, used across this and later migrations.
create type public.user_role as enum ('SUPER_ADMIN', 'STAFF_ADMIN', 'PARENT');
create type public.account_status as enum ('invited', 'active', 'deactivated');
create type public.content_status as enum ('draft', 'published', 'archived');
create type public.content_visibility as enum ('public', 'parents');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  name text not null default '',
  role public.user_role not null,
  status public.account_status not null default 'invited',
  -- The one delegable capability carried over from the Cloudflare design
  -- (contacts.edit) — kept as JSON for the same reason it was in D1:
  -- extensible without a schema migration for each new grantable capability.
  extra_permissions jsonb not null default '[]'::jsonb,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_login_at timestamptz
);

comment on table public.profiles is
  'One row per auth.users account. Never inserted by public signup — rows are created only by the invite-staff / invite-parent Edge Functions (see supabase/functions/), mirroring the Cloudflare design''s invite-only account creation.';

create index profiles_role_idx on public.profiles (role);
create index profiles_status_idx on public.profiles (status);

-- ----------------------------------------------------------------------------
-- Helper functions used by every RLS policy in supabase/policies/.
--
-- SECURITY DEFINER + a fixed search_path is required here: without it, a
-- policy calling this function would recursively re-trigger RLS on
-- `profiles` while trying to read the caller's own row, which either
-- infinite-loops or (more likely) silently returns no rows depending on the
-- policy shape. Defining it SECURITY DEFINER makes THIS function's own
-- internal query bypass RLS, while the function itself only ever returns
-- information about auth.uid() — the calling user's own id — so it grants
-- no broader access than "let me see my own role".
-- ----------------------------------------------------------------------------

create or replace function public.current_profile()
returns public.profiles
language sql
security definer
stable
set search_path = public
as $$
  select * from public.profiles where id = auth.uid();
$$;

create or replace function public.has_role(target_role public.user_role)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = target_role and status = 'active'
  );
$$;

create or replace function public.is_active_staff()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('SUPER_ADMIN', 'STAFF_ADMIN') and status = 'active'
  );
$$;

create or replace function public.is_active_parent()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'PARENT' and status = 'active'
  );
$$;

comment on function public.has_role(public.user_role) is
  'True if the calling user (auth.uid()) has this exact role AND is active. Used by RLS policies — see supabase/policies/.';

alter table public.profiles enable row level security;
-- Policy definitions for this table are staged in supabase/policies/profiles.sql,
-- reviewed there before being folded into a migration and applied.
