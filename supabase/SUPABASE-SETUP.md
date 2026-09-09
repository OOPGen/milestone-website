# Supabase integration — local preparation

**Status: local preparation only. No Supabase project has been created, no
migration has been applied, no bucket exists, no Edge Function has been
deployed, and no Supabase Auth user of any kind exists.** Everything in this
directory is a plan and a set of files, reviewed and approved before any of
it touches a real Supabase project.

The existing Cloudflare account-system backend (`worker/`, `migrations/0001_init.sql`,
`admin.html`/`parent.html`/`login.html`/`accept-invitation.html` and their
scripts) **stays exactly as it is** — nothing here replaces it yet. Per the
explicit instruction this work was done under: *"Keep the existing custom
Cloudflare account-system code unchanged for now. Do not delete it until the
Supabase replacement is complete, tested, reviewed, and explicitly
approved."*

---

## 1. What exists in this directory

```
supabase/
  migrations/           8 SQL files — schema only, NOT applied
  policies/             8 SQL files — RLS policies, staged for review, NOT applied
  storage/buckets.sql   3 bucket definitions + their policies, NOT applied
  functions/            5 Edge Function scaffolds — NOT implemented, NOT deployed
  SUPABASE-SETUP.md     this file
```

Plus, outside `supabase/`:

- `src/supabase/client.js` — a frontend Supabase client, reachable only by
  code that explicitly imports it. **Not imported by anything in the
  currently deployed Phase 1 build** (`src/main.jsx`, `src/legacyMarkup.js`,
  `app.js`) — confirmed by rebuilding Phase 1 fresh and checking `dist/` for
  any trace of it (see §6).
- `.env.local` (gitignored, not part of this or any commit) holds the two
  public config values this client reads.
- `tests/supabase-sql.test.mjs`, `tests/supabase-client.test.mjs` — local,
  static validation. Neither connects to any database, local or remote.

---

## 2. Design decisions — why the schema differs from the Cloudflare/D1 version

The Cloudflare backend (`migrations/0001_init.sql`) had to build its own
`users`, `sessions`, `invitations`, and `login_attempts` tables, and its own
password hashing (`worker/lib/crypto.js`), because Cloudflare D1 is a plain
SQL database with no built-in auth system. **Supabase already has one** —
`auth.users`, managed by GoTrue — so this schema does not reinvent it:

| Cloudflare (D1) | Supabase equivalent | Why |
|---|---|---|
| `users` (with `password_hash`) | `auth.users` (built-in) + `public.profiles` | Supabase Auth owns password hashing, session tokens, and the invite/signup lifecycle. `profiles` holds only the domain fields Cloudflare's `users` table had beyond that — role, status, extra_permissions. |
| `sessions` | `auth.sessions` (built-in) | Same reasoning. |
| `invitations` | Supabase Auth's `admin.inviteUserByEmail()` | Issues its own secure, expiring links — a custom token table isn't needed. |
| `login_attempts` | Supabase Auth's built-in rate limiting | GoTrue already throttles sign-in attempts. |
| `assets` (mirrors R2, which has no metadata catalogue of its own) | *(none)* — `storage.objects` (built-in) | Supabase Storage already tracks bucket, path, owner and metadata for every object. A parallel `assets` table would just be a second, driftable source of truth. `gallery_photos`/`document_versions` store a `storage_path` and resolve through Storage directly. |
| One polymorphic `content_items` table (`type` discriminator) | Five separate tables: `notices`, `calendar_events`, `news_posts`, `galleries` (+`gallery_photos`) | RLS policies apply per table in Postgres. Five small, independently-readable policy files are easier to audit than one shared policy with a type filter buried in every clause — and the brief listed these as distinct items, not one grouped one. |

Everything else — status/visibility/soft-delete columns, the document
version-history model, the audit log's shape and its "never log a secret"
rule — carries over unchanged, because those design decisions were already
reasoned through and tested for the Cloudflare version
(`tests/account-system.test.mjs`) and nothing about moving to Postgres
changes them.

### Known limitation: account-lock-out rules are not fully expressible in RLS

The Cloudflare version enforces two rules in code, not just in the database
(`worker/routes/admin.js` `setAccountStatus()`):
1. A user cannot deactivate their own account.
2. The last active `SUPER_ADMIN` cannot be deactivated or demoted.

A static RLS policy can express "is the caller an active Super Admin" but
not "would this specific UPDATE leave zero active Super Admins" without a
more elaborate constraint. **These two rules must be re-implemented in the
`manage-user-role` Edge Function** (marked with `TODO` comments in
`supabase/functions/manage-user-role/index.ts`) before that function is
trusted with the same guarantee the Cloudflare version already has an
automated test for (`tests/account-system.test.mjs`, section 6). Do not
treat the RLS policies on `profiles` as sufficient on their own for this.

---

## 3. Environment variables — names only, this project

| Name | Where | Kind |
|---|---|---|
| `VITE_SUPABASE_URL` | `.env.local` (frontend) | Public |
| `VITE_SUPABASE_ANON_KEY` | `.env.local` (frontend) | Public — publishable by design |
| `SUPABASE_URL` | Edge Function runtime | Provided automatically by Supabase |
| `SUPABASE_ANON_KEY` | Edge Function runtime | Provided automatically by Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Edge Function runtime | Provided automatically by Supabase — **never** given to the frontend client, never logged, never returned in a response |
| `SUPER_ADMIN_EMAIL` | Edge Function secret (`supabase secrets set`) | Not itself a secret value, but only ever set as one |
| `BOOTSTRAP_TOKEN` | Edge Function secret | One-time shared secret for `bootstrap-super-admin` |

No value for any of these appears anywhere in this repository. The two
`VITE_*` values live only in the gitignored `.env.local`; `.env.example`
carries the same two names with empty values.

---

## 4. Remote-action plan — for approval, not yet executed

Nothing below has been run. This is the exact plan for what applying this
preparation would require, laid out so it can be approved (or corrected)
piece by piece rather than as one irreversible bundle.

### Step 1 — Create the Supabase project *(if not already done)*

**Irreversible in effect:** a new project gets its own URL/keys; nothing
destructive, but it is a new billable resource.

- Dashboard: [supabase.com/dashboard](https://supabase.com/dashboard) → New Project.
- CLI equivalent (needs `supabase login` first — not run): none required if
  using the dashboard for project creation.

### Step 2 — Apply the 8 migrations

**Not easily reversible: creates real tables.** Running this against a
project with no existing data is safe; running it against a project that
already has conflicting objects is not — confirm the project is empty first.

```bash
supabase link --project-ref <project-ref>      # requires supabase login (not run)
supabase db push                                # applies supabase/migrations/*.sql in order
```

### Step 3 — Fold the reviewed policies into a migration, then apply

**Not yet done even locally.** The files in `supabase/policies/` are staged
for review, not yet part of any numbered migration. Once approved, they get
copied into a new `supabase/migrations/20260101000009_rls_policies.sql` (or
similar) and applied via the same `supabase db push` as step 2 — this is a
deliberate extra pause between "policies are written" and "policies are
live", not an oversight.

### Step 4 — Create the 3 storage buckets and their policies

**Irreversible in effect once files are uploaded:** a bucket set `public`
can serve objects to anyone with the URL from the moment they're uploaded;
making it private later does not un-serve what was already cached/indexed.

```bash
supabase db push     # storage.buckets rows are created via SQL — see supabase/storage/buckets.sql
```

(Alternative: Dashboard → Storage → New Bucket, matching the same
name/public/size-limit/MIME-type values as the SQL file — the SQL route is
preferred so bucket creation is captured in migration history rather than a
one-off dashboard click no one can review.)

### Step 5 — Implement and deploy the 5 Edge Functions

**Reversible** (a function can be deleted or redeployed), but each becomes a
live, callable endpoint the moment it's deployed.

```bash
supabase functions deploy bootstrap-super-admin
supabase functions deploy invite-staff
supabase functions deploy invite-parent
supabase functions deploy manage-user-role
supabase functions deploy private-file-access   # only if actually needed — see the note in that file
```

Each requires implementing the `TODO`-marked logic first (they are scaffolds,
not working code) and setting its secrets:

```bash
supabase secrets set SUPER_ADMIN_EMAIL=<real address, to be confirmed>
supabase secrets set BOOTSTRAP_TOKEN=<generated, one-time>
```

### Step 6 — Bootstrap the Super Admin

**Creates a real account.** Exactly one call, exactly like the Cloudflare
version's bootstrap (`ACCOUNT-SYSTEM-PLAN.md` section 9) — no password is
set by this step; the account owner sets their own via the invite link it
returns.

### Step 7 — Only then: invite staff, then parents; only then: point the
live frontend at this backend instead of the Cloudflare one.

**This is the step that actually changes what parents and staff experience.**
Everything above can be built and even applied without affecting the live
Phase 1 site, because nothing in the deployed Cloudflare Worker
(`worker/phase1.js`) or the built frontend imports `src/supabase/client.js`.
This step is its own separate approval, later, after the above is reviewed
and tested.

### Exact approval request for each step above

Before running **any** step in this section, the request will be: *"Step
N is ready. It [creates / does not create] live data. It is [reversible /
not easily reversible] for this reason: __. Exact command: __. Approve?"*
— one step at a time, not as a batch.

---

## 5. What's NOT done — do not assume otherwise

- No Supabase project, account, bucket, or Edge Function exists remotely.
- No migration has been applied to any database, local or remote — the SQL
  in `supabase/migrations/` has only been **statically parsed** (see §7),
  never executed.
- No Supabase Auth user exists. `bootstrap-super-admin` has not been called.
- `.env.local`'s values are real (frontend-safe) Supabase project
  credentials, but nothing in the deployed site reads them yet.
- The RLS policies in `supabase/policies/` are drafts, not yet folded into
  a migration or applied.

## 6. Confirming Phase 1 is unaffected

```bash
node scripts/build-phase1.mjs     # rebuild the Phase 1 artifact fresh
grep -rl "supabase" dist/          # expect no output at all
npx wrangler deploy --dry-run      # expect the same bindings as before: ASSETS, ENQUIRY_TO, ENQUIRY_FROM, SUPER_ADMIN_EMAIL — nothing Supabase-related
```

## 7. Local tests

```bash
node tests/supabase-sql.test.mjs      # static validation of every .sql file — no database touched
node tests/supabase-client.test.mjs   # fail-safe behaviour of src/supabase/client.js — no .env file touched
```

`supabase-sql.test.mjs` parses what it genuinely can (CREATE TABLE/TYPE/INDEX/INSERT,
via `node-sql-parser`) and does purpose-built structural checks for what
that parser doesn't support (`CREATE POLICY`, `ALTER TABLE ... ENABLE ROW
LEVEL SECURITY`, dollar-quoted function bodies): balanced parentheses,
balanced `$$` pairs, every foreign key pointing at a table that's actually
defined, and every policy targeting a table that actually has RLS enabled.
See the comment at the top of that file for exactly why each parser gap is
handled the way it is rather than reported as a false failure.
