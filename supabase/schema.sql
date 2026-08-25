-- Milestone Junior Level Up Academy production schema
-- Run in Supabase SQL editor after creating a project.
create extension if not exists pgcrypto;

create table if not exists public.applications (
  id uuid primary key default gen_random_uuid(),
  reference text unique not null default ('ML-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,8))),
  child_name text not null,
  grade text not null check (grade in ('Baby Class','Nursery','Grade 1','Grade 2')),
  parent_name text not null,
  parent_email text not null,
  note text,
  status text not null default 'Pending' check (status in ('Pending','Reviewed','Accepted','Enrolled','Archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.contact_messages (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  message text not null,
  status text not null default 'Unread' check (status in ('Unread','Read','Archived')),
  created_at timestamptz not null default now()
);

create table if not exists public.news_posts (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  slug text unique not null,
  category text not null,
  summary text not null,
  body text not null,
  image_path text,
  published boolean not null default false,
  published_at timestamptz,
  author_id uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  event_type text not null,
  starts_at timestamptz not null,
  ends_at timestamptz,
  published boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.newsletter_subscribers (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  consented_at timestamptz not null default now(),
  unsubscribed_at timestamptz
);

create table if not exists public.analytics_events (
  id bigint generated always as identity primary key,
  event_name text not null,
  page_path text,
  source text,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id),
  action text not null,
  entity_type text not null,
  entity_id text,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.admin_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('admin','editor','viewer')) default 'viewer'
);

create or replace function public.is_admin() returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.admin_roles where user_id=auth.uid() and role in ('admin','editor'));
$$;

alter table public.applications enable row level security;
alter table public.contact_messages enable row level security;
alter table public.news_posts enable row level security;
alter table public.events enable row level security;
alter table public.newsletter_subscribers enable row level security;
alter table public.analytics_events enable row level security;
alter table public.audit_logs enable row level security;
alter table public.admin_roles enable row level security;

-- Public visitors may submit forms and read published content only.
create policy "public may submit applications" on public.applications for insert to anon, authenticated with check (true);
create policy "admins manage applications" on public.applications for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "public may send messages" on public.contact_messages for insert to anon, authenticated with check (true);
create policy "admins manage messages" on public.contact_messages for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "public read published news" on public.news_posts for select to anon, authenticated using (published=true or public.is_admin());
create policy "admins manage news" on public.news_posts for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "public read events" on public.events for select to anon, authenticated using (published=true or public.is_admin());
create policy "admins manage events" on public.events for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "public subscribe newsletter" on public.newsletter_subscribers for insert to anon, authenticated with check (true);
create policy "admins manage subscribers" on public.newsletter_subscribers for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "public write analytics" on public.analytics_events for insert to anon, authenticated with check (true);
create policy "admins read analytics" on public.analytics_events for select to authenticated using (public.is_admin());
create policy "admins read audit logs" on public.audit_logs for select to authenticated using (public.is_admin());
create policy "admins manage roles" on public.admin_roles for all to authenticated using (public.is_admin()) with check (public.is_admin());

insert into storage.buckets (id,name,public) values ('school-media','school-media',true) on conflict (id) do nothing;
insert into storage.buckets (id,name,public) values ('private-documents','private-documents',false) on conflict (id) do nothing;
