# Supabase backend — setup & current state

This file tracks what has actually been applied to the live Supabase project
and what remains. Update it whenever a remote step is completed.

Project reference: **`ypvnvczuxkcbhxcjqghz`** (URL + anon/publishable key live
only in the gitignored `.env.local`; `.env.example` carries the two names
with empty values). No service-role key, DB password, PAT, JWT secret, or
bootstrap token is stored anywhere in this repository.

The existing Cloudflare account-system backend (`worker/`,
`migrations/0001_init.sql`, `admin.html` / `parent.html` / `login.html` /
`accept-invitation.html` and their scripts) **stays exactly as it is** —
nothing here has replaced it. The deployed Phase 1 public site
(`worker/phase1.js`) does not read any Supabase value; `src/supabase/client.js`
is imported by nothing in the build.

---

## 1. Applied to the live project — DONE

| Item | State |
|---|---|
| Schema migrations `20260101000001`–`20260101000008` | **Applied** (tables, enums, the 4 SECURITY DEFINER helper functions, RLS enabled on all 11 tables) |
| Migration `20260101000009_function_permissions.sql` | **Applied** — least-privilege EXECUTE on the 4 helpers (`REVOKE … FROM public/anon`, `GRANT … TO authenticated`) |
| Migration `20260101000010_gallery_cover_helper.sql` | **Applied** — `public.gallery_current_cover_path(uuid)` + its grants |
| RLS policy files in `supabase/policies/` (all 8, 45 policies) | **Applied** via the SQL Editor. An idempotent consolidated re-apply block is kept in the session report / `README` of this work in case a partial state needs reconciling — every policy statement is safe to re-run as `DROP POLICY IF EXISTS … ; CREATE POLICY …` on the empty tables. |
| `storage/buckets.sql` (3 buckets + 4 `storage.objects` SELECT policies) | **Applied** via the SQL Editor (Batch B). No client write policies exist. |
| Migration `20260101000011_content_audit_trigger.sql` | ⬜ **staged, not yet applied** — one SQL Editor paste. Adds `public.log_content_change()` + AFTER triggers on the 5 editable content tables so the Super Admin portal's direct writes are audited. |

All 11 application tables (`profiles`, `settings`, `page_content`, `notices`,
`calendar_events`, `news_posts`, `galleries`, `gallery_photos`, `documents`,
`document_versions`, `audit_log`) currently hold **zero rows**. `auth.users`
holds **zero users**. `storage.buckets` holds **zero buckets**.

### Read-only verification queries

The full set (policy inventory + role targets, no implicit `TO PUBLIC`,
anon-facing set, function `SECURITY DEFINER` / `search_path` / EXECUTE grants,
RLS enabled on 11 tables, 0 rows, 0 users, 0 buckets) is in this work's
session report. They are all `SELECT`-only and can be re-run any time.

---

## 1b. Super Admin content-editing portal — IMPLEMENTED (Phase 2, not deployed)

A minimal secure admin portal exists at `admin-portal.html` + `src/admin-portal/`.
It uses **Supabase Auth for login and the already-applied RLS policies for
authorization** — no custom backend, no Edge Function, no service-role key.
Every content write is audited by the trigger in migration
`20260101000011` (server-side, actor taken from the JWT).

**Scope:** log in / out; a Super-Admin-only dashboard; create, edit, publish,
unpublish, archive, and remove **notices, news posts, calendar events, page
content, and site settings**; an Activity-log tab reading `audit_log`.
Explicitly NOT included: staff invites, parent accounts, gallery/document
uploads, media management (deferred — see §2).

**To run it now (local, against the live project):**
```
# .env.local must have VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (it does)
npm run dev            # then open http://localhost:5173/admin-portal.html
# or a production static build:
npm run build:admin    # dist/admin-portal.html + assets — deploy as a SEPARATE
                       # static site (Cloudflare Pages / second Worker); do NOT
                       # add it to the Phase 1 worker.
```

**One-time Super Admin bootstrap** (see §6 of the session report for the copy-paste version):
1. Supabase Dashboard → **Authentication → Users → Add user** → enter the
   Super Admin's email + a strong password, tick "Auto Confirm User".
2. Supabase Dashboard → **SQL Editor**, run once:
   ```sql
   insert into public.profiles (id, email, name, role, status)
   select u.id, u.email, 'Super Admin', 'SUPER_ADMIN', 'active'
   from auth.users u
   where u.email = 'REPLACE_WITH_THE_EMAIL'
   on conflict (id) do update set role = 'SUPER_ADMIN', status = 'active';
   ```
3. Apply migration `20260101000011_content_audit_trigger.sql` in the SQL Editor.
No `BOOTSTRAP_TOKEN`, no service-role key, no Edge Function involved.

---

## 2. NOT applied — remaining remote steps

### 2a. Storage buckets + `storage.objects` read policies — *applied (Batch B)*

`supabase/storage/buckets.sql` creates 3 buckets (`public-media` public,
`parent-media` / `school-documents` private) and 4 `SELECT` policies on
`storage.objects`. **There are deliberately no INSERT / UPDATE / DELETE
policies** — every Storage write goes through the `manage-media` Edge
Function's service-role client.

Creating the buckets *empty* is reversible (`delete from storage.buckets
where id in ('public-media','parent-media','school-documents');` while they
contain no objects). The "irreversible-in-effect" concern only applies once
public objects are actually served — which cannot happen until the Edge
Functions are implemented and deployed.

An idempotent consolidated block (`… on conflict (id) do nothing` for the
buckets, `DROP POLICY IF EXISTS` for the 4 policies) is in the session
report.

### 2b. Edge Functions — *scaffolds only, NOT implemented, NOT deployed*

`supabase/functions/` holds 6 scaffolds. Every one returns
`{ ok:false, error:'not_implemented' }` / `501` for its real paths and is
marked with `TODO`s:

| Function | Purpose | Notable TODO |
|---|---|---|
| `bootstrap-super-admin` | one-time first Super Admin | verify `BOOTSTRAP_TOKEN`, create the auth user + `profiles` row, return the invite link |
| `invite-staff` | Super Admin invites Staff Admin / Super Admin | `admin.inviteUserByEmail` + `profiles` insert + audit |
| `invite-parent` | staff invites a parent | same shape as invite-staff |
| `manage-user-role` | change role / status | **must re-implement the two lock-out rules** (a user can't deactivate themselves; the last active `SUPER_ADMIN` can't be deactivated/demoted) that RLS cannot express — see §4 |
| `private-file-access` | signed-URL issuance for private objects, *if needed* | evaluate whether Storage's own signed URLs suffice first |
| `manage-media` | the sole authority for every media/document create / edit / publish / archive / set-cover / replace-photo-bytes / soft-delete / hard-delete | the full operation set is designed in the file's comments; the RPC helpers it calls (`manage_media_*`) are not written yet |

Deploying requires implementing the logic, then:

```
supabase functions deploy <name>          # per function
supabase secrets set SUPER_ADMIN_EMAIL=<real address>
supabase secrets set BOOTSTRAP_TOKEN=<generated one-time value>
```

`SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` are
injected by the Supabase Edge runtime automatically — never set them
manually, never expose the service-role key to the frontend, never log it.

### 2c. Bootstrap the Super Admin — *creates a real account*

One call to `bootstrap-super-admin` once it is implemented + deployed. No
password is set by this step; the account owner sets their own via the
invite link it returns. Needs a real Super Admin email address decided
first.

### 2d. Point the live frontend at Supabase — *separate, later approval*

This is the step that changes what parents and staff experience. It means
wiring `src/supabase/client.js` into the account-system UI, replacing the
Cloudflare Worker auth/content routes, and only then retiring the Worker
account-system code. Not started; out of scope for the backend-hardening
work.

---

## 3. RLS design summary

Three-tier read model on the content tables (`notices`, `calendar_events`,
`news_posts`, `galleries` + `gallery_photos`, `documents` +
`document_versions`), plus `page_content`:

- **anon + authenticated** — `status='published' AND visibility='public' AND
  deleted_at IS NULL` (documents/versions additionally require the row be the
  *current* version).
- **authenticated / active parent** — adds parents-only published content
  (current version only for documents).
- **authenticated / active staff** — everything not soft-deleted, drafts
  included; staff also see the full document version history.

Writes to the media/document tables (`gallery_photos`, `documents`,
`document_versions`) and to `storage.objects` have **no client policy at
all** — they are exclusively the `manage-media` service-role path.
`galleries` keeps a client INSERT (empty album only, `cover_storage_path IS
NULL`) and UPDATE (title/summary/visibility/status; `cover_storage_path`
pinned immutable via `gallery_current_cover_path()`). Hard `DELETE` exists
nowhere as a client policy — it is `manage-media`'s `delete` operation
(Super-Admin-checked in code) only. `audit_log` is Super-Admin `SELECT`
only; rows are written only by the service-role path.

`profiles`: own-row `SELECT`; staff read parents; Super Admin reads all;
own-name `UPDATE` with role/status/permissions pinned via
`current_profile()`; staff set parent status; Super Admin updates any. No
client INSERT (invite-only) or DELETE (deactivate via `status`).

---

## 4. Known limitations / unverified

- **Account lock-out rules are not in RLS.** "A user cannot deactivate their
  own account" and "the last active `SUPER_ADMIN` cannot be
  deactivated/demoted" must be enforced in `manage-user-role`
  (`tests/account-system.test.mjs` section 6 is the Cloudflare version's
  coverage of the same rules). Do not treat the `profiles` UPDATE policies
  as sufficient on their own.
- **`page_content` per-key permissions.** The Cloudflare design's
  `contacts.edit` is a per-user delegable grant. The current
  `page_content_upsert/update_by_staff` policies are a blanket
  `is_active_staff()`. If per-key enforcement must live in the database (not
  just app code), those policies need a key-specific `CASE` added before the
  frontend is pointed at Supabase.
- **Cross-service atomicity.** Supabase Storage and Postgres share no
  transaction. `manage-media` handles this with upload-first / compensating
  delete / `media.orphan_cleanup_failed` audit + a reconciliation sweep, and
  does not claim full atomicity — see the `FAILURE / CLEANUP MATRIX` in
  `supabase/functions/manage-media/index.ts`.
- **`manage_media_*` RPC helpers are not written.** The Edge Function's
  design references SECURITY DEFINER RPCs for its atomic multi-row writes;
  those need to be authored (and added as a migration) when the function is
  implemented.
- **Verification query results not captured here.** Run the §1 queries and
  paste the output into this file or the session log to have a durable
  record.

---

## 5. Local tests (no database touched)

```
node tests/supabase-sql.test.mjs          # static validation of every .sql file
node tests/supabase-client.test.mjs       # fail-safe behaviour of src/supabase/client.js
node tests/manage-media-function.test.mjs  # static validation of the manage-media scaffold
npm run test:accounts                      # Cloudflare account-system suite (unaffected)
```

## 6. Confirming Phase 1 is unaffected

```
node scripts/build-phase1.mjs        # rebuild the Phase 1 artifact fresh
grep -rl "supabase" dist/            # expect no output
npx wrangler deploy --dry-run        # expect the same bindings as before, nothing Supabase-related
```
