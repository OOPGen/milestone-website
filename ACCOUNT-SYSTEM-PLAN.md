# Account system — architecture plan

Scope: a **school website** with a small CMS and a read-only parent portal.
Not a school management system. No attendance, marks, reports, fees, payments,
medical, discipline, transport, learner profiles, or parent–teacher messaging.
No table in this design stores information about a child.

---

## 1. What exists today (inspection)

| Area | Current state |
|---|---|
| Public site | `index.html` → React shell → `src/legacyMarkup.js` (one scrolling page). Content is **hardcoded in a template literal**. |
| Admin | `admin.html` + `admin.js` (57 lines). Fake login: any email/password sets `localStorage.milestoneAdminSignedIn`. All dashboard data is hardcoded demo values. |
| Parent | `parent.html`. A login form whose only behaviour is printing "contact the office". Static demo tiles. |
| Login | `login.html` + `login.js`. `fakeAuthenticate()` resolves after a delay, then redirects by role. Stores `milestoneRememberedLogin` in `localStorage`. |
| Worker | `worker/index.js` (292 lines). `/api/enquiry`, `/api/health`, `env.ASSETS` fallthrough. `run_worker_first = ["/api/*"]`. |
| Build | Vite multi-page; every HTML entry listed in `vite.config.js` or it is silently dropped. Non-module scripts must be duplicated into `public/`. |
| Routing | `_redirects`: `/admin`, `/parent`. `_headers`: security headers already set. |
| Preview safety | `noindex` block + dismissible preview banner, both marked `PREVIEW ONLY`. |
| Storage | **None.** No database, no object storage, no sessions. |

**Everything called "login" today is theatre.** It is replaced wholesale.

---

## 2. Architecture

```
Browser
  │
  ├── static assets ──────────────► Cloudflare Static Assets (dist/)
  │
  └── /api/* ─────────────────────► Cloudflare Worker
                                      ├── D1   (users, sessions, content, audit)
                                      └── R2   (images, PDFs)
                                            ├── public objects  → cacheable
                                            └── parent-only     → streamed only
                                                                  after auth
```

Parent-only files are **never** served by a public URL. R2 has no public bucket
binding in this design; every object is fetched through
`GET /api/files/:assetId`, which checks visibility and session before streaming.
That also satisfies "keep the six placeholder PDFs inaccessible" — they are not
in `dist/` and are not in R2.

### Worker module layout

```
worker/
  index.js            router + existing /api/enquiry, /api/health
  lib/http.js         JSON responses, error shapes, cookie helpers
  lib/crypto.js       PBKDF2 password hashing, token generation
  lib/db.js           D1 query helpers
  lib/permissions.js  role → capability matrix (single source of truth)
  lib/auth.js         sessions, login rate limiting, requirePermission()
  lib/audit.js        append-only audit writer
  routes/auth.js      login, logout, me, invitation accept, change password
  routes/publicContent.js  published + public content for the website
  routes/parent.js    parent-only reads
  routes/admin.js     CMS + account management
  routes/files.js     authorised asset streaming
```

### API route shapes

```
POST /api/auth/login | logout | accept-invitation | change-password | profile
GET  /api/auth/me
POST /api/auth/bootstrap-super-admin      (inert once a Super Admin exists)

GET  /api/public/content/:type            (:type = notice|news|event|term_date|album)
GET  /api/public/content/:type/:id
GET  /api/public/albums/:id/photos
GET  /api/public/site-content

GET  /api/parent/content/:type            (session required)
GET  /api/parent/content/:type/:id
GET  /api/parent/albums/:id/photos
GET  /api/parent/documents

GET  /api/files/:assetId                  (public: open; parents-only: session + capability, else 404)

GET|POST /api/admin/content/:type         (list, create)
PATCH|DELETE /api/admin/content/item/:id  (update, hard-delete)
POST /api/admin/content/item/:id/publish|unpublish|archive|soft-delete

GET  /api/admin/documents
POST /api/admin/documents/versions
POST /api/admin/documents/:id/status

POST /api/admin/media                     (multipart upload)
POST /api/admin/site-content/:key

GET|POST /api/admin/parents | /api/admin/parents/invite
GET|POST /api/admin/staff   | /api/admin/staff/invite
POST /api/admin/accounts/:id/status
POST /api/admin/accounts/permission/:id

GET  /api/admin/audit
```

`:type` (a content type) and `:id` (a specific row) are deliberately never at
the same path position — that ambiguity was a real bug caught by the test
suite (`item/` disambiguates them) and is worth flagging for anyone extending
these routes.

### Deployability

`wrangler.toml` stays **deployable exactly as it is today** — the D1 and R2
bindings are present but commented out, because a binding with a placeholder id
makes `wrangler deploy` fail. Local development uses `wrangler.local.toml`.

The Worker degrades honestly: with no `DB` binding every account route returns
`503 {"error":"not_configured"}` and the UI says the system is not connected
yet, exactly like the enquiry form does.

### Password hashing

**PBKDF2-SHA256, 210,000 iterations, 16-byte salt, 32-byte key**, via WebCrypto.
Workers have no native bcrypt/argon2 and pulling one in as WASM is a large
dependency for this project's size. PBKDF2 at OWASP's recommended iteration
count is the accepted alternative. Stored as
`pbkdf2$sha256$<iterations>$<salt-b64>$<hash-b64>` so the cost can be raised
later without invalidating existing hashes. Verification is constant-time.

### Sessions

- 32 random bytes, base64url.
- **Only the SHA-256 of the token is stored.** A database leak cannot be
  replayed as a session.
- Cookie `__Host-mjla_session`: `HttpOnly; Secure; SameSite=Lax; Path=/`.
  The `__Host-` prefix forbids `Domain` and requires `Secure` + `Path=/`.
- 12-hour absolute expiry; sliding refresh on use.
- No token, role, or permission is ever written to `localStorage`.
- Every protected request re-reads the session **and the user's current role
  from the database**. Deactivating an account takes effect immediately.

### Login abuse control

Attempts recorded per email **and** per IP. 5 failures in 15 minutes locks that
pair for 15 minutes. The response is always the same generic
`"Email or password is incorrect."` with the same status, whether the account
exists, is deactivated, or the password is wrong. Turnstile verification hooks
into login and invitation acceptance once keys exist.

---

## 3. Permissions matrix

Capabilities, not role checks scattered through the code. `lib/permissions.js`
is the only place roles are interpreted, and every route declares the capability
it needs. **Default is deny** — an unlisted capability is refused.

| Capability | SUPER_ADMIN | STAFF_ADMIN | PARENT |
|---|:--:|:--:|:--:|
| `content.read.public` | ✅ | ✅ | ✅ |
| `content.read.parent` | ✅ | ✅ | ✅ |
| `content.create` | ✅ | ✅ | ❌ |
| `content.update` | ✅ | ✅ | ❌ |
| `content.publish` | ✅ | ✅ | ❌ |
| `content.archive` | ✅ | ✅ | ❌ |
| `content.delete.hard` | ✅ | ❌ | ❌ |
| `media.upload` | ✅ | ✅ | ❌ |
| `media.archive` | ✅ | ✅ | ❌ |
| `documents.manage` | ✅ | ✅ | ❌ |
| `documents.download.parent` | ✅ | ✅ | ✅ |
| `pages.edit` | ✅ | ✅ | ❌ |
| `contacts.edit` | ✅ | ⚠️ granted | ❌ |
| `parents.manage` | ✅ | ✅ | ❌ |
| `staff.manage` | ✅ | ❌ | ❌ |
| `roles.assign` | ✅ | ❌ | ❌ |
| `audit.read` | ✅ | ❌ | ❌ |
| `settings.manage` | ✅ | ❌ | ❌ |
| `profile.self.edit` | ✅ | ✅ | ✅ |

⚠️ `contacts.edit` is the one per-user grant, held in `users.extra_permissions`
(a JSON array), matching "manage school contact details **if explicitly
granted**".

Hard rules enforced in code, not just convention:

- Nobody can read a password hash through any API. It is never selected into a
  response object.
- `STAFF_ADMIN` cannot create, edit, deactivate, or change the role of a
  `SUPER_ADMIN`, and cannot grant `staff.manage` or `roles.assign`.
- A user cannot deactivate or demote themselves (prevents lock-out).
- The last active `SUPER_ADMIN` cannot be deactivated or demoted.
- `PARENT` requests are never given a listing of other users. There is no
  parent-facing endpoint that returns a user record other than `me`.

---

## 4. Public vs parent-only

Visibility is a column on each content row (`public` | `parents`), combined
with status (`draft` | `published` | `archived`). **Public API returns only
`status='published' AND visibility='public'`** — enforced in SQL, not in the UI.

| Content | Public site | Parent portal |
|---|:--:|:--:|
| Home, About, Learning, Admissions, School life | ✅ | ✅ |
| Contact details | ✅ | ✅ |
| News marked Public | ✅ | ✅ |
| Events marked Public | ✅ | ✅ |
| Gallery albums marked Public | ✅ | ✅ |
| Notices & announcements | ❌ | ✅ |
| Term opening / closing dates, holidays | ❌ | ✅ |
| Full school calendar | ❌ | ✅ |
| Uniform guidance, parent handbook, policies | ❌ | ✅ |
| Parent-only news, galleries | ❌ | ✅ |
| Downloadable school documents | ❌ | ✅ |

The parent portal is **read-only**, with one exception: a parent may change
their own display name and password. There is no upload, no content editing, no
user listing, and no self-registration route at all — invitation is the only way
an account comes into existence.

Existing public homepage copy stays exactly where it is for now. The CMS
`site_content` table overrides specific fields (hero headline, announcement,
about text, admissions text, contact details) when a published value exists, so
migrating page content is incremental and never leaves the site blank.

---

## 5. Database schema (D1 / SQLite)

`migrations/0001_init.sql`. Tables:

| Table | Purpose |
|---|---|
| `users` | id, email, name, role, status, password_hash, extra_permissions, timestamps |
| `invitations` | email, role, token_hash, expires_at, accepted_at, created_by |
| `sessions` | user_id, token_hash, expires_at, last_seen_at, ip, user_agent |
| `login_attempts` | email, ip, ok, created_at — rate limiting |
| `content_items` | one table for notice / news / event / term_date / album, with type, title, summary, body, category, dates, status, visibility, authorship, soft delete |
| `gallery_photos` | album_id, asset_id, caption, sort order, status |
| `documents` | title, category, description, date, visibility, status, current_version_id |
| `document_versions` | document_id, asset_id, version, note, uploaded_by — replacement history |
| `assets` | r2_key, filename, content_type, size, width/height, visibility, checksum |
| `site_content` | structured page fields (key → JSON value), updated_by |
| `settings` | site settings (key → JSON value) |
| `audit_log` | actor, action, entity, summary, ip, user agent, timestamp |

Notes:
- No table references a child. There is no learner entity anywhere.
- Every content table has `created_by`, `updated_by`, `published_at`,
  `archived_at`, `deleted_at`. Delete is **soft** by default; hard delete is
  `SUPER_ADMIN` only and still writes an audit row.
- `audit_log` has no column that could hold a password, token, or key, and the
  writer strips any field named like a secret.

---

## 6. Cloudflare resources required later

| Resource | Name | Binding | Purpose |
|---|---|---|---|
| D1 database | `milestone-db` | `DB` | users, content, audit |
| R2 bucket | `milestone-media` | `MEDIA` | images and PDFs |
| Turnstile | site + secret keypair | — | login / invitation abuse |
| Resend (already planned) | verified sender domain | — | invitation + reset email |

```bash
npx wrangler d1 create milestone-db
npx wrangler r2 bucket create milestone-media
# then paste the returned database_id into wrangler.toml and uncomment
npx wrangler d1 migrations apply milestone-db --remote
```

## 7. Environment variables and secrets — names only

| Name | Kind | Purpose |
|---|---|---|
| `SESSION_SECRET` | **Secret** | Signs/derives session-related values |
| `TURNSTILE_SECRET_KEY` | **Secret** | Server-side Turnstile verification |
| `RESEND_API_KEY` | **Secret** | Invitation and reset email |
| `SUPER_ADMIN_EMAIL` | Var | Bootstrap allow-list, `jeremichaeljunior@gmail.com` |
| `ENQUIRY_TO` / `ENQUIRY_FROM` | Var | Existing enquiry delivery |
| `VITE_TURNSTILE_SITE_KEY` | Build-time, public | Renders the widget |
| `DB`, `MEDIA` | Bindings | D1 and R2 |

No value for any of these appears in the repository.

---

## 8. What can be built and tested locally, and what cannot

### Built and tested locally now

- Full schema and migrations, run against real SQLite.
- Password hashing and verification (WebCrypto works identically in Node and Workers).
- Session issue / verify / expiry / revocation.
- The whole permission matrix and every route guard.
- Login rate limiting and generic failure wording.
- Content CRUD, status and visibility filtering.
- Audit logging.
- Invitation create → accept → password set, with token hashing and expiry.
- Dashboard and parent portal UI against the real API.
- Access-control and content-visibility tests.

Tests drive the **real Worker module** with a D1 adapter built over Node's
built-in `node:sqlite`, so the SQL and the auth code under test are the code
that ships — not a mock of it.

### Cannot be completed without a real Cloudflare account

| Blocked | Needs |
|---|---|
| Real D1 in production | `wrangler d1 create` + account auth |
| Any file upload or download | R2 bucket; without it upload routes return 503 |
| Image optimisation on upload | R2 + Images (or a resize step at upload time) |
| Turnstile enforcement | Real site + secret keys |
| Invitation **emails** | Resend key + verified sender domain |
| Self-service password reset | Confirmed email delivery first — deliberately not enabled |
| The Super Admin account itself | Production D1 + a secure one-time bootstrap |

`wrangler deploy` is also currently blocked: the CLI is not authenticated on
this machine.

---

## 9. Super Admin bootstrap (production only — not created here)

No account, password, or hash for `jeremichaeljunior@gmail.com` exists anywhere
in this repository, and none is created by any migration or seed. The seed data
is local-only and contains no real address.

The procedure, to run **once**, after D1 exists:

1. Set `SUPER_ADMIN_EMAIL=jeremichaeljunior@gmail.com` as a Worker var.
2. Set a strong one-time value: `npx wrangler secret put BOOTSTRAP_TOKEN`.
3. `POST /api/auth/bootstrap` with header `X-Bootstrap-Token`. The route:
   - refuses unless the users table has **zero** `SUPER_ADMIN` rows;
   - refuses unless the requested email equals `SUPER_ADMIN_EMAIL`;
   - creates the account with **no password**, in `invited` status;
   - returns a single-use invitation link valid for 60 minutes;
   - writes an audit row.
4. Open that link and choose a password. The password is set by the owner, in
   the browser, and is only ever stored as a PBKDF2 hash.
5. `npx wrangler secret delete BOOTSTRAP_TOKEN`. The route is inert afterwards
   anyway, because a `SUPER_ADMIN` now exists.

At no point does anyone but the account owner know the password, and it is never
transmitted or logged in readable form.

---

## 10. Before real parents or staff can log in

> ## ⚠️ PRE-LAUNCH BLOCKER — Cloudflare plan
>
> **Parent and staff authentication requires Cloudflare Workers Paid or
> another execution environment with sufficient CPU capacity for
> PBKDF2-HMAC-SHA256 at 600,000 iterations. Cloudflare Workers Free has a
> 10 ms CPU limit per request and must not be used for the live
> login/invitation/password flow.**
>
> Measured (see `tests/bench-hash.mjs` and the benchmark in the pre-launch
> security-correction report): one PBKDF2-HMAC-SHA256 hash or verify at
> 600,000 iterations costs **~250–290 ms of real CPU time** — 25–29× the
> Free plan's entire per-request budget. Under the real Workers runtime
> (`wrangler dev` / workerd, not just Node), login and invitation-accept
> measured **~870–1000 ms wall-clock**, consistent with that CPU cost plus
> D1 round trips. A login attempt on the Free plan would very likely be
> terminated mid-hash.
>
> This is a plan/configuration requirement, not a code change — do not
> "fix" it by lowering the iteration count. See the recommended
> configuration immediately below.

### Recommended production configuration

- **Use a paid Cloudflare Workers plan before enabling accounts.** The Free
  plan's 10 ms CPU limit is incompatible with 600,000-iteration PBKDF2 by
  roughly two orders of magnitude — there is no reasonable request pattern
  that fits.
- **Set an intentionally conservative per-request CPU cap** appropriate for
  password operations — `[limits] cpu_ms = 2000` in `wrangler.toml` as a
  starting point (measured cost is ~250–290 ms; 2000 ms leaves generous
  headroom for slower client hardware, cold starts, and traffic spikes).
  Measure real production behaviour (see below) before ever reducing it.
- **Never lower password hashing below the approved configuration** —
  PBKDF2-HMAC-SHA256, 600,000 iterations minimum — merely to fit under the
  Free plan or a tighter CPU cap. If cost must come down, that is a decision
  for the site owner to make deliberately and explicitly, not a default to
  reach for under deployment pressure.
- **Keep login throttling before password verification.** `login()` in
  `worker/routes/auth.js` already checks `isLockedOut()` before calling
  `verifyPassword()` — confirmed under both the Node test suite and live
  `curl` against the real Worker (locked-out responses return in
  ~195–200 ms vs. ~910–996 ms for a full verification). Do not reorder this
  when touching that route.
- **Monitor Worker CPU usage and login error rates after launch.** Watch the
  Cloudflare dashboard's CPU time and error-rate graphs for the Worker in
  the days after accounts go live; a CPU-limit-exceeded error on `/api/auth/*`
  is the signal that the configured cap or plan is insufficient.

### Steps, in order

1. Move to a paid Cloudflare Workers plan and set the CPU cap above —
   **before** step 3 (the bootstrap creates a real password immediately on
   invitation acceptance, which is exactly the operation this blocker is about).
2. Create D1 and R2, apply migrations, uncomment the bindings.
3. Set `SESSION_SECRET`.
4. Run the bootstrap above and set the owner's password.
5. Configure Resend and verify a sending domain, so invitations can be emailed.
   Until then the dashboard shows the invitation link for manual delivery — it
   must be sent over a channel the recipient controls, and it expires.
6. Configure Turnstile and set both keys.
7. Deploy over HTTPS. `__Host-` cookies do not work over plain HTTP.
8. Only then invite staff, and only then invite parents.
