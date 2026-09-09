# Deployment guide — Milestone Junior Level Up Academy

**Status: prepared, not deployed.** Everything in this repo is ready to build
and ship. The final `wrangler deploy` has deliberately not been run.

Before deploying, read [`CONTENT-CHECKLIST.md`](CONTENT-CHECKLIST.md) — 18
content items are still outstanding. None of them block deployment (the site
does not claim anything unverified), but the school should know what is missing.

---

## 1. Hosting platform

**Cloudflare Workers with Static Assets.**

Note this is *not* Cloudflare Pages, despite what earlier versions of this
document said. The project was created as a Worker, which is why deployment
previously failed with "Missing entry-point" until `wrangler.toml` was given an
`[assets]` block. Do not follow Pages instructions for this project.

| | |
|---|---|
| Platform | Cloudflare Workers (Static Assets) |
| Worker name | `milestone-website` |
| Current URL | `https://milestone-website.jeremichaeljunior.workers.dev` |
| Build command | `npm run build` |
| Output directory | `dist/` |
| Node version | 20 or newer (built and tested on 24) |
| Source repo | `https://github.com/OOPGen/milestone-website` (private) |

Config, already in place:

```toml
# wrangler.toml
name = "milestone-website"
compatibility_date = "2026-08-12"

[assets]
directory = "./dist/"
not_found_handling = "single-page-application"
html_handling = "none"
```

`html_handling = "none"` is load-bearing — without it, `/admin` and `/parent`
enter a 307 redirect loop. `_redirects` contains only the two clean-URL rewrites;
a catch-all rule there is rejected by Cloudflare as an infinite loop.

### Build entry points

`vite.config.js` lists all six HTML pages explicitly. **Any new page must be
added there or it is silently dropped from `dist/`** — this has caused two
production bugs already.

```
index.html  admin.html  parent.html  privacy.html  terms.html  login.html
```

Files referenced by non-module `<script src>` (`app.js`, `admin.js`, `login.js`,
`assets.js`, `marketingConfig.js`, `style.css`, `sw.js`) are not bundled, so a
copy lives in `public/` for Vite to pass through. **When you edit one of these
at the repo root, copy it to `public/` or the change will not ship.**

### Deploy commands

```bash
npm ci
npm run build
npx wrangler deploy          # ← the step deliberately not yet run
```

---

## 1b. ⚠️ PRE-LAUNCH BLOCKER — account system requires a paid Workers plan

**Parent and staff authentication requires Cloudflare Workers Paid or
another execution environment with sufficient CPU capacity for
PBKDF2-HMAC-SHA256 at 600,000 iterations. Cloudflare Workers Free has a
10 ms CPU limit per request and must not be used for the live
login/invitation/password flow.**

This applies to the site as a whole, not just an `/api/auth/*` route — the
Free plan's CPU limit is set per Worker. Measured cost: one password hash or
verify at 600,000 iterations takes ~250–290 ms of real CPU time (~870–1000 ms
observed wall-clock under `wrangler dev`/workerd, including D1 round trips) —
roughly 25–29× the Free plan's entire per-request budget. See
`tests/bench-hash.mjs` and `ACCOUNT-SYSTEM-PLAN.md` section 10 for the full
benchmark and the reasoning behind the iteration count.

**Recommended configuration**, before enabling accounts:

- Move the site to a paid Cloudflare Workers plan.
- Set an intentionally conservative per-request CPU cap for password
  operations — start with `[limits] cpu_ms = 2000` in `wrangler.toml`
  (measured cost ~250–290 ms; 2000 ms leaves headroom for slower devices,
  cold starts, and traffic spikes) — and measure real production CPU/error
  behaviour before ever reducing it.
- **Never** lower password hashing below PBKDF2-HMAC-SHA256 at 600,000
  iterations to fit a smaller CPU budget. If that trade-off is ever
  reconsidered, it must be a deliberate decision by the site owner, not a
  default reached for under deployment pressure.
- Confirm login throttling still runs before password verification
  (`isLockedOut()` before `verifyPassword()` in `worker/routes/auth.js`) —
  already true and covered by `tests/account-system.test.mjs`; don't reorder
  it if that route is touched again.
- After launch, monitor the Worker's CPU time and error-rate graphs in the
  Cloudflare dashboard. A CPU-limit-exceeded error on `/api/auth/*` is the
  signal the cap or plan is insufficient.

This is a hosting-plan and configuration requirement, not something a code
change fixes — it belongs in the pre-launch checklist (section 6) as a
blocking item, separate from and in addition to the account-specific
"before real parents or staff can log in" steps in `ACCOUNT-SYSTEM-PLAN.md`
section 10.

---

## 2. Environment variables and secrets

**Names only. No value in this repository, this document, or the browser bundle.**

### Required before the forms can deliver

| Name | Kind | Purpose |
|---|---|---|
| `RESEND_API_KEY` | **Secret** | Authenticates to Resend. Server-side only. |
| `ENQUIRY_TO` | Var | Monitored school inbox that receives enquiries. **Not yet confirmed.** |
| `ENQUIRY_FROM` | Var | Verified sender, e.g. `Milestone Website <website@yourdomain>`. |

### Recommended before launch

| Name | Kind | Purpose |
|---|---|---|
| `TURNSTILE_SECRET_KEY` | **Secret** | Server-side Turnstile verification. |
| `VITE_TURNSTILE_SITE_KEY` | Build-time, public | Renders the widget. Set at `npm run build`. |

While `TURNSTILE_SECRET_KEY` is unset the Worker **skips** verification so the
forms keep working. The honeypot and rate limit still apply, but this is a
deliberate fail-open — treat provisioning Turnstile as a launch task.

### Optional

| Name | Kind | Purpose |
|---|---|---|
| `RATE_LIMIT_MAX` | Var | Submissions per IP per 10 min. Defaults to 5. **Test-only — leave unset in production.** |
| `RESEND_API_BASE` | Var | Overrides the provider URL. **Test-only.** |

### Not needed yet

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` — only when
real authentication is built. The service-role key bypasses every row-level
security policy and must never reach the browser.

### Setting them

```bash
# Secrets — stored encrypted, never printed back, never in git
npx wrangler secret put RESEND_API_KEY          # paste the key when prompted
npx wrangler secret put TURNSTILE_SECRET_KEY    # paste the key when prompted

# Non-secret vars — edit the [vars] block in wrangler.toml, or:
npx wrangler deploy --var ENQUIRY_TO:office@yourdomain --var "ENQUIRY_FROM:Milestone Website <website@yourdomain>"

# Confirm what is set (names only, values are never shown)
npx wrangler secret list
```

Locally, copy `.dev.vars.example` to `.dev.vars` (gitignored) and use test
values. Never put a production secret in any file.

---

## 3. Domain and DNS

The site currently answers on the `workers.dev` subdomain. To move it to the
school's domain:

1. Add the domain as a zone in Cloudflare (Websites → Add a site).
2. At the domain registrar, change the nameservers to the two Cloudflare
   assigns. Propagation is usually under an hour.
3. In the Worker → Settings → Domains & Routes → **Add custom domain**.
   Cloudflare creates the DNS record and issues the TLS certificate itself.

| Type | Name | Target | Proxy |
|---|---|---|---|
| Custom domain | `milestonejuniorlevelupacademy.co.zw` | Worker `milestone-website` | Proxied |
| Custom domain | `www` | Worker `milestone-website` | Proxied |

Adding a custom domain to a Worker creates the correct record automatically —
do **not** hand-create a `CNAME` to `workers.dev` as well.

Recommended zone settings: **Always Use HTTPS** on, **Automatic HTTPS Rewrites**
on, TLS mode **Full (strict)**, Brotli on. Leave Auto Minify off — it is
deprecated and the HTML is already minified by Vite.

### Update the canonical domain in four places

These still point at `milestonejuniorlevelupacademy.co.zw`. If the final domain
differs, update **all four** or search engines will index the wrong host:

1. `index.html` — `<link rel="canonical">`
2. `index.html` — JSON-LD `"url"`
3. `sitemap.xml` **and** `public/sitemap.xml` — every `<loc>`
4. `robots.txt` **and** `public/robots.txt` — the `Sitemap:` line

`manifest.webmanifest` needs no change: its `start_url` and `scope` are
relative, so it is domain-agnostic.

Also add an email DNS record set (SPF, DKIM, DMARC) if the school will send mail
from the domain — the transactional provider in section 4 supplies the values.

---

## 4. Forms and email delivery

| Form | Status |
|---|---|
| **Application** (`#applyForm`) | **Connected.** Posts to `/api/enquiry`. Success is shown only after the provider accepts the email. WhatsApp remains as a secondary "faster response" action. |
| **Contact** (`#contact-form`) | **Connected.** Same endpoint, same guarantees. |
| **Document requests** (6 cards) | Working. Opens a dialog offering WhatsApp, phone and email. |
| **Newsletter** | **Removed.** Replaced with a WhatsApp/call call-to-action — the school has no mailing-list or consent process, so collecting addresses would collect data nobody can act on. |

### Architecture

```
browser ──POST /api/enquiry──▶ Worker (worker/index.js) ──HTTPS──▶ Resend ──▶ school inbox
                                 │
                                 ├─ honeypot check (silent discard)
                                 ├─ rate limit (5 per IP / 10 min)
                                 ├─ server-side validation
                                 └─ Turnstile verification (when configured)
```

`run_worker_first = ["/api/*"]` in `wrangler.toml` routes only the API to the
Worker; every other path is served asset-first exactly as before.

### Why Resend

The Workers runtime has no outbound SMTP or raw TCP, so the provider must offer
a plain HTTPS API. Resend does, needs no SDK in the bundle, and its free tier
(3,000 emails/month, 100/day) comfortably covers a single school's enquiries.
**MailChannels** was the traditional free choice for Workers but withdrew that
offering in June 2024. **Postmark** has excellent deliverability but no free
production tier. Swapping provider means changing one `fetch` in
`sendEmail()` — the rest of the Worker is provider-agnostic.

### Email format

Subject: `[Website Enquiry] <Parent Name> — <Grade or "General enquiry">`

Body carries every submitted field, the submission time (UTC), the source page,
and sets `reply_to` to the parent's address so staff can reply directly. All
values are HTML-escaped.

### Security notes

- The API key lives only in a Worker secret. It is never in the bundle, the
  repo, or a URL. Verified by an automated check in `tests/ui.test.mjs`.
- Submitted values are never written to `console`, to analytics, or to a query
  string. Only outcomes and counts are logged.
- The honeypot returns `200` and silently discards. Only bots fill that field,
  so no real parent is ever shown a false success.
- The rate limiter is per-isolate, so the effective ceiling is a multiple of 5.
  It is a speed bump. For production-grade limiting add a WAF rule:
  **Security → WAF → Rate limiting rules**, matching `http.request.uri.path eq
  "/api/enquiry"`, 5 requests per 10 minutes per IP, action Block.

### Still to do

- [ ] Confirm the official admissions inbox and set `ENQUIRY_TO`
- [ ] Verify a sending domain with Resend and set `ENQUIRY_FROM`
- [ ] Provision Turnstile and set both keys
- [ ] Send one real test enquiry and confirm it arrives — **check the spam folder**

---

### Cost, sender verification and deliverability

**Cost.** Resend's free tier is 3,000 emails/month and 100/day — far beyond a
single school's enquiry volume; the paid tier starts at US$20/month if ever
needed. Cloudflare Workers' free tier allows 100,000 requests/day, and static
assets are unmetered. Expect **US$0/month** for this setup, excluding the domain.

**Sender verification.** Resend will not send from an unverified domain. Either:

- **Quickest:** use `onboarding@resend.dev` as `ENQUIRY_FROM` to test today. Fine
  for verification, not for production — it looks untrustworthy to parents.
- **Correct:** verify the school's domain in Resend → Domains, which issues DNS
  records to add in Cloudflare:

| Type | Name | Purpose |
|---|---|---|
| TXT | `send.<domain>` (or as Resend specifies) | SPF — authorises Resend to send |
| TXT | `resend._domainkey.<domain>` | DKIM — cryptographically signs mail |
| TXT | `_dmarc.<domain>` | DMARC policy, e.g. `v=DMARC1; p=none; rua=mailto:…` |

Set these **DNS-only** (grey cloud), not proxied. Verification usually completes
within an hour.

**Deliverability.** Start DMARC at `p=none` and tighten to `quarantine` once the
reports look clean. Because `ENQUIRY_TO` is currently a Gmail address, check the
Spam and Promotions tabs on the first test and mark as "not spam" if needed. Do
not set `reply_to` to a domain you have not verified — replies are aimed at the
parent's own address, which is correct and does not affect your domain's
reputation.

## 5. Analytics, cookies and privacy

**Today the site sets no cookies and loads no third-party analytics.** Page
events are written to the visitor's own `localStorage` under
`milestoneAnalytics` and never leave the device. This is why no cookie banner is
shown — and under GDPR/ePrivacy none is required for this setup.

Two third-party requests do leave the browser:

| Request | Purpose | Note |
|---|---|---|
| `fonts.googleapis.com` / `fonts.gstatic.com` | Fraunces + Inter webfonts | Sends the visitor's IP to Google. Self-host the two fonts to remove this. |
| `google.com/maps` iframe | Location map in the contact section | Google may set cookies. Consider a click-to-load placeholder. |

If analytics is wanted, **Cloudflare Web Analytics** is the right default: it is
free, needs no cookie banner, and requires no consent because it does not
fingerprint visitors. Enable it in the dashboard and add the one script tag it
gives you. Only add Google Analytics if the school genuinely needs it — that
does require a consent banner and a privacy-policy update.

`privacy.html` and `terms.html` exist and ship. **Have someone read them against
what the site actually does before launch.** This now matters more than it did:
the enquiry forms genuinely transmit personal data (parent name, email, optional
phone, and a child's first name and class) to the school's inbox via Resend. The
privacy policy should say so, name Resend as a processor, and state how long
enquiries are kept. A consent checkbox is required before submitting, and its
wording is deliberately narrow — permission to *respond to this enquiry*, not
permission to market. Do not add a marketing opt-in until a real mailing-list
process exists.

---

## 5b. Local testing

Three terminals. The mock provider stands in for Resend so the full path can be
exercised — including failures — without sending real email.

```bash
# 1. mock email provider (records what the Worker sends, on :4199)
npm run test:mock

# 2. build, then run the Worker + assets locally
cp .dev.vars.example .dev.vars     # then set RESEND_API_BASE=http://127.0.0.1:4199
npm run build
npx wrangler dev --port 4195

# 3. the suites
npm run test:api     # 48 checks: validation, honeypot, rate limit, delivery, failure
npm run test:ui      # 72 checks: inline errors, disabled state, success/failure copy
```

Notes:
- `tests/api.test.mjs` and `tests/ui.test.mjs` hardcode port `4195`; change it
  there if you run the Worker elsewhere.
- `test:ui` needs `RATE_LIMIT_MAX=5000` in `.dev.vars` (it makes many
  submissions). `test:api` must run **without** it, so it can assert the real
  default of 5.
- Inspect what the Worker actually sent: `curl http://127.0.0.1:4199/__received`
- Force a provider failure: `curl http://127.0.0.1:4199/__mode/fail`
  (`/__mode/slow`, `/__mode/ok`, `/__reset` also available).
- `wrangler dev` occasionally starts wedged — the port listens but never
  answers. Kill it and restart on a different port.

## 6. Pre-launch checklist

Blocking:

- [ ] **Move to a paid Cloudflare Workers plan before enabling accounts** — see section 1b. The Free plan's 10 ms CPU limit cannot run the 600,000-iteration password hashing the account system requires.
- [ ] Confirm the official admissions inbox, set `ENQUIRY_TO`, send a real test enquiry (section 4)
- [ ] Verify a sending domain with Resend and set `ENQUIRY_FROM`
- [ ] Confirm the final domain, then update all five canonical references (section 3)
- [ ] Confirm the WhatsApp/phone split: WhatsApp goes to `+48 791 753 077`, "Call the office" dials `+263 773 072 639`
- [ ] Remove the two unconfirmed contact details from `src/siteConfig.js` if unused
- [ ] Read `privacy.html` and `terms.html` against actual site behaviour
- [ ] Confirm the school is happy with every photo published

Should do:

- [ ] Work through `CONTENT-CHECKLIST.md` (18 items)
- [ ] Enable Cloudflare Web Analytics
- [ ] Add Turnstile to the forms
- [ ] Submit `sitemap.xml` to Google Search Console
- [ ] Claim the Google Business Profile so the map and hours match the site

Verify after deploying:

- [ ] `curl https://<domain>/api/health` → `emailConfigured: true`, `turnstileConfigured: true`
- [ ] Submit a **real** contact enquiry; confirm it arrives in the school inbox (check spam)
- [ ] Submit a **real** admissions application; confirm subject is `[Website Enquiry] <name> — <grade>`
- [ ] Reply to that email and confirm it reaches the parent address (`reply_to` works)
- [ ] Submit with an invalid email → inline error, nothing sent
- [ ] Submit without ticking consent → blocked
- [ ] Submit 6 times quickly → the 6th is refused, and the message does not claim success
- [ ] View source / DevTools → no `RESEND_API_KEY`, no `re_…` string anywhere
- [ ] `/`, `/admin`, `/parent`, `/login.html`, `/privacy.html`, `/terms.html` all load
- [ ] `/downloads/prospectus.pdf` does **not** return a PDF (placeholders are unpublished)
- [ ] All six document cards open the request dialog
- [ ] No console errors; no horizontal scroll at 320px
- [ ] Service worker registers and the PWA installs on Android
- [ ] `robots.txt` and `sitemap.xml` are reachable

To confirm a failure is handled honestly in production, temporarily unset the
API key (`npx wrangler secret delete RESEND_API_KEY`), submit once, and check
the form says it could **not** send. Then set it back.

Known and accepted at launch:

- Sign-in on `login.html`, `admin.html` and `parent.html` is a **front-end
  placeholder**. Anything typed in signs you in. `robots.txt` keeps these pages
  out of search results, but they are not access-controlled. Do not describe
  them to the school as secure, and do not put real pupil data in them.
- The admin dashboard shows demo figures, not live data.

---

## 7. Rollback

Cloudflare keeps every previous version of the Worker, so rollback is fast and
does not need a rebuild.

**Dashboard (fastest):** Workers & Pages → `milestone-website` → Deployments →
find the last good version → **Rollback**. Takes effect in seconds.

**CLI:**

```bash
npx wrangler deployments list                 # find the version id
npx wrangler rollback [<version-id>]          # omit the id for the previous one
```

**From source**, if the bad state is in the repo rather than the deploy:

```bash
git revert <bad-commit>     # prefer revert over reset — keeps history intact
npm run build
npx wrangler deploy
```

Two things rollback does *not* undo:

- **The service worker.** Returning visitors may hold a cached shell. `sw.js`
  uses a versioned cache (`milestone-academy-v2`); bump that string when
  shipping a change that must invalidate old caches.
- **DNS changes.** Nameserver moves take their own time to propagate. Keep the
  previous DNS records noted before changing them.

Before any risky deploy, note the current version id from
`npx wrangler deployments list` so you can roll back to a known-good target
without guessing.
