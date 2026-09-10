-- ============================================================================
-- RLS policies for public.settings and public.page_content
-- STAGED FOR REVIEW — not yet part of a migration, not yet applied.
-- ============================================================================

-- settings: staff-only in both directions. Nothing here is meant for public
-- display (that's page_content's job) — settings are internal configuration.
create policy "settings_select_by_staff"
on public.settings for select
to authenticated
using (public.is_active_staff());

create policy "settings_upsert_by_staff"
on public.settings for insert
to authenticated
with check (public.is_active_staff());

create policy "settings_update_by_staff"
on public.settings for update
to authenticated
using (public.is_active_staff());
-- No delete policy: settings rows are overwritten, not removed.

-- page_content: published rows are genuinely public (anonymous visitors
-- read these to render the homepage) — mirrors the Cloudflare design's
-- GET /api/public/site-content, which needs no session at all.
create policy "page_content_select_published_anon"
on public.page_content for select
to anon, authenticated
using (status = 'published');

-- Staff can read every row regardless of status (to see drafts before
-- publishing) and write. Note: `contacts.edit` in the Cloudflare design is a
-- PER-USER delegable grant (checked via extra_permissions), which a single
-- blanket is_active_staff() policy does not distinguish — see the
-- KNOWN LIMITATION note in supabase/policies/profiles.sql. If per-key
-- permission (e.g. only Super Admin may write the 'contact.details' key
-- unless granted) must be enforced at the database level rather than only
-- in application code, this policy needs a CASE/key-specific check added
-- before being applied — flag this explicitly for review.
create policy "page_content_select_all_by_staff"
on public.page_content for select
to authenticated
using (public.is_active_staff());

create policy "page_content_upsert_by_staff"
on public.page_content for insert
to authenticated
with check (public.is_active_staff());

create policy "page_content_update_by_staff"
on public.page_content for update
to authenticated
using (public.is_active_staff());
