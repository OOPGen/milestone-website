-- ============================================================================
-- 20260101000008_audit_log.sql
-- NOT YET APPLIED. See supabase/SUPABASE-SETUP.md.
--
-- Append-only. As with the Cloudflare design (worker/lib/audit.js), there is
-- deliberately no column here that could hold a password, token, session
-- value, or API key — do not add one. Any INSERT into this table (from an
-- Edge Function or a trigger) must redact secret-shaped fields the same way
-- worker/lib/audit.js's redact() does before writing `details`.
-- ============================================================================

create table public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id),
  actor_email text,
  action text not null,                 -- e.g. 'auth.login', 'content.publish'
  entity_type text,
  entity_id text,
  summary text not null default '',
  ip text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index audit_log_created_at_idx on public.audit_log (created_at desc);
create index audit_log_actor_idx on public.audit_log (actor_id);
create index audit_log_action_idx on public.audit_log (action);

alter table public.audit_log enable row level security;
-- Policies staged in supabase/policies/audit_log.sql — Super Admin read-only,
-- no client-side UPDATE/DELETE policy at all (append-only, enforced by
-- omission: a table with RLS enabled and no matching policy denies by
-- default for that operation, for every role including the table owner's
-- own client-side access).
