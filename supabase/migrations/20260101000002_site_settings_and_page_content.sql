-- ============================================================================
-- 20260101000002_site_settings_and_page_content.sql
-- NOT YET APPLIED. See supabase/SUPABASE-SETUP.md.
--
-- Converts D1's `settings` and `site_content` tables. Both are simple
-- key/value stores (key text primary key, value as JSON) — that shape
-- carries over to Postgres unchanged, using jsonb instead of a JSON-encoded
-- text column.
-- ============================================================================

create table public.settings (
  key text primary key,
  value jsonb not null,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

comment on table public.settings is
  'Site-wide configuration, e.g. feature toggles. Distinct from page_content, which holds editable copy shown on the public site.';

create table public.page_content (
  key text primary key,          -- e.g. 'home.announcement', 'home.hero.headline'
  value jsonb not null,
  status public.content_status not null default 'published',
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

comment on table public.page_content is
  'Structured page fields only — mirrors the Cloudflare design''s deliberate choice not to have a raw-HTML editor. See worker/lib/http.js sanitizeRichText() for the equivalent rule on the Cloudflare side; the same rule (sanitise before insert, never store raw attacker-controlled HTML) must apply wherever this table is written to from Postgres too.';

alter table public.settings enable row level security;
alter table public.page_content enable row level security;
-- Policies staged in supabase/policies/settings_and_page_content.sql.
