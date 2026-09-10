-- ============================================================================
-- 20260101000011_content_audit_trigger.sql
-- NOT YET APPLIED. Proposed, staged for review.
--
-- The Super Admin content-editing workflow writes notices / news_posts /
-- calendar_events / page_content / settings DIRECTLY from the browser, using
-- the Super Admin's own JWT, gated by the RLS policies already applied
-- (supabase/policies/*). Those policies enforce WHO may write; they do not
-- produce an audit trail. public.audit_log has no client INSERT policy by
-- design — the Cloudflare design's rule is "audit rows are written only by a
-- trusted server-side path, never a client endpoint".
--
-- This migration adds that trusted path as a database trigger: a
-- SECURITY DEFINER function (owner-privileged, so its INSERT into audit_log
-- bypasses that table's absent INSERT policy) fired AFTER every
-- INSERT / UPDATE / DELETE on the five editable content tables. The actor is
-- taken from the request JWT (auth.uid() / auth.jwt()), never from anything
-- the client sends, so it cannot be spoofed.
--
-- Action names match the Cloudflare design's audit vocabulary
-- (worker/routes/admin.js): content.create / content.update /
-- content.soft_delete / content.delete_hard.
--
-- Idempotent: CREATE OR REPLACE FUNCTION + DROP TRIGGER IF EXISTS, safe to
-- re-run.
-- ============================================================================

create or replace function public.log_content_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  rec       jsonb;
  prev      jsonb;
  act       text;
  ent_id    text;
  label     text;
  actor_em  text;
begin
  if (tg_op = 'DELETE') then
    rec := to_jsonb(old);
    act := 'content.delete_hard';
  elsif (tg_op = 'INSERT') then
    rec := to_jsonb(new);
    act := 'content.create';
  else
    rec  := to_jsonb(new);
    prev := to_jsonb(old);
    if (prev ->> 'deleted_at') is null and (rec ->> 'deleted_at') is not null then
      act := 'content.soft_delete';
    else
      act := 'content.update';
    end if;
  end if;

  ent_id := coalesce(rec ->> 'id', rec ->> 'key');
  label  := coalesce(rec ->> 'title', rec ->> 'key', '');
  actor_em := nullif(coalesce(auth.jwt() ->> 'email', ''), '');

  insert into public.audit_log (actor_id, actor_email, action, entity_type, entity_id, summary)
  values (
    auth.uid(),
    actor_em,
    act,
    tg_table_name,
    ent_id,
    left(tg_table_name || ': ' || label, 500)
  );

  if (tg_op = 'DELETE') then
    return old;
  end if;
  return new;
end;
$$;

comment on function public.log_content_change() is
  'AFTER row trigger for the five editable content tables — appends one public.audit_log row per change, actor taken from the request JWT. SECURITY DEFINER so it may write audit_log, which has no client INSERT policy.';

-- Least-privilege: the trigger function is invoked by the trigger machinery,
-- not called directly by any role, so it needs no EXECUTE grant to anon or
-- authenticated. Strip the implicit PUBLIC grant to be explicit, matching
-- 20260101000009 / 20260101000010.
revoke execute on function public.log_content_change() from public;
revoke execute on function public.log_content_change() from anon;
revoke execute on function public.log_content_change() from authenticated;

drop trigger if exists trg_audit_notices on public.notices;
create trigger trg_audit_notices
after insert or update or delete on public.notices
for each row execute function public.log_content_change();

drop trigger if exists trg_audit_news_posts on public.news_posts;
create trigger trg_audit_news_posts
after insert or update or delete on public.news_posts
for each row execute function public.log_content_change();

drop trigger if exists trg_audit_calendar_events on public.calendar_events;
create trigger trg_audit_calendar_events
after insert or update or delete on public.calendar_events
for each row execute function public.log_content_change();

drop trigger if exists trg_audit_page_content on public.page_content;
create trigger trg_audit_page_content
after insert or update or delete on public.page_content
for each row execute function public.log_content_change();

drop trigger if exists trg_audit_settings on public.settings;
create trigger trg_audit_settings
after insert or update or delete on public.settings
for each row execute function public.log_content_change();
