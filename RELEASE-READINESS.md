# Deployment-readiness report

**Status: NOT READY TO DEPLOY.** Four blockers below. Nothing has been deployed.

---

## 0. Approval status of the forms

You approved the forms **only if** end-to-end delivery was verified using the
confirmed official school recipient address. That condition is **not met**:

| | |
|---|---|
| What was verified | Full path browser → Worker → provider → inbox, against a **local mock** provider (`tests/mock-email-provider.cjs`) with `office@example.test`. 48 API checks + 72 UI checks, all passing. |
| What was **not** verified | Delivery to a real inbox, through the real Resend API, at a confirmed school address. |
| Why not | No official school recipient address has been confirmed, and no Resend account or API key exists yet. |

The code path is identical either way — only `RESEND_API_BASE` differs — but
"identical code path" is not the same as "an email arrived". **The forms remain
unapproved until a real test enquiry lands in the school's inbox.** Step 6 of the
smoke test is that verification.

Until `RESEND_API_KEY`, `ENQUIRY_TO` and `ENQUIRY_FROM` are set, the Worker
returns 503 and the form tells parents it could not send. Nothing is faked.

---

## 1. Custom domain — NOT CONFIRMED

**There is no confirmed custom domain.** The site answers only on:

```
https://milestone-website.jeremichaeljunior.workers.dev
```

`milestonejuniorlevelupacademy.co.zw` is hardcoded in four files but has never
been confirmed as registered or owned by the school. If it is not, the site will
tell search engines its canonical home is a domain that does not serve it.

### Every place the domain is configured

| # | File | Line | What |
|---|---|---|---|
| 1 | `index.html` | 7 | `<link rel="canonical" href="https://…/">` |
| 2 | `index.html` | 10 | JSON-LD `"url"` |
| 3 | `sitemap.xml` + `public/sitemap.xml` | 4–10 | 7 × `<loc>` |
| 4 | `robots.txt` + `public/robots.txt` | 15 | `Sitemap:` line |

Correction to an earlier note: this is **four** places, not five.
`manifest.webmanifest` uses relative paths (`start_url: "/index.html"`,
`scope: "/"`) and needs no change. Remember the root and `public/` copies of
`robots.txt` and `sitemap.xml` must be edited together — only the `public/` copy
ships.

**Decision needed:** confirm the domain, or say the workers.dev URL is the
launch target — in which case all four references should point there instead.

---

## 2. DNS for the website domain

Once the domain is confirmed:

1. Cloudflare → **Websites → Add a site**, enter the domain.
2. At the registrar, replace the nameservers with the two Cloudflare gives you.
   (For a `.co.zw` domain this is done through ZISPA or your local registrar and
   can take longer than the usual hour.)
3. Cloudflare → **Workers & Pages → `milestone-website` → Settings → Domains &
   Routes → Add custom domain**. Add both entries below.

| Type | Name | Target | Proxy |
|---|---|---|---|
| Custom domain | `milestonejuniorlevelupacademy.co.zw` | Worker `milestone-website` | Proxied |
| Custom domain | `www` | Worker `milestone-website` | Proxied |

Cloudflare creates the underlying records and issues the certificate itself.
**Do not also hand-create a CNAME to `workers.dev`** — that conflicts.

Zone settings: Always Use HTTPS **on**, Automatic HTTPS Rewrites **on**, TLS
mode **Full (strict)**, Brotli **on**, Auto Minify **off** (deprecated; Vite
already minifies).

---

## 3. DNS for the email sender domain (Resend)

Resend will not send from an unverified domain. In Resend → **Domains → Add
Domain**, it generates the exact records for your domain and region. They take
this shape — **use the values Resend shows you, not these**:

| Purpose | Type | Name (host) | Value | Notes |
|---|---|---|---|---|
| Bounce handling | MX | `send.<domain>` | `feedback-smtp.<region>.amazonses.com` | Priority 10 |
| **SPF** | TXT | `send.<domain>` | `v=spf1 include:amazonses.com ~all` | Authorises Resend to send |
| **DKIM** | TXT | `resend._domainkey.<domain>` | long public key from Resend | Signs each message |
| **DMARC** | TXT | `_dmarc.<domain>` | `v=DMARC1; p=none; rua=mailto:dmarc@<domain>` | Start at `p=none` |

**Critical:** set every one of these to **DNS only (grey cloud)** in Cloudflare.
Proxying a mail record breaks verification.

Notes:
- Verification usually completes within an hour of the records propagating.
- Keep DMARC at `p=none` for the first few weeks, read the reports, then tighten
  to `p=quarantine`.
- Adding SPF/DKIM/DMARC does **not** affect the school's existing Gmail. If the
  school later sends mail from this domain via Google, its SPF include must be
  merged into a single SPF record — a domain may have only one.
- Before the domain is verified you can send from `onboarding@resend.dev`. That
  is fine for the smoke test, **not** for production — parents should not receive
  school mail from an unknown sender.

---

## 4. Cloudflare Worker secrets (names only)

```bash
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put TURNSTILE_SECRET_KEY
```

| Name | Required | Effect if unset |
|---|---|---|
| `RESEND_API_KEY` | **Yes** | Worker returns 503; form honestly reports it could not send |
| `TURNSTILE_SECRET_KEY` | Strongly recommended | Spam verification **skipped** (fail-open); honeypot + rate limit still apply |

Not secrets — plain vars in `wrangler.toml` `[vars]`:
`ENQUIRY_TO`, `ENQUIRY_FROM`.

Not a secret — build-time public value: `VITE_TURNSTILE_SITE_KEY`
(must be set when `npm run build` runs, or the widget is not rendered).

Verify with `npx wrangler secret list` — it prints names only, never values.
No secret value appears in this repository, the build output, or this document.

---

## 5. Release checklist

### Blockers — deployment should not proceed until these are done

- [ ] **B1.** Confirm the official admissions inbox → set `ENQUIRY_TO`
- [ ] **B2.** Confirm the custom domain (or accept the workers.dev URL) → update the four references in §1
- [ ] **B3.** Create the Resend account, verify the sender domain, set `RESEND_API_KEY` + `ENQUIRY_FROM`
- [ ] **B4.** **Commit and push.** 39 files are uncommitted and the branch is level with `origin/main`. Every change from the redesign, content-safety and forms passes exists only on this machine. There is currently **no commit to roll back to.**

### Forms

- [ ] Real test enquiry from the contact form arrives in the school inbox
- [ ] Real test admissions application arrives, subject `[Website Enquiry] <name> — <grade>`
- [ ] Replying to that email reaches the parent's address (`reply_to`)
- [ ] Invalid email → inline error, nothing sent
- [ ] Consent unticked → blocked
- [ ] Turnstile enabled and verified server-side
- [ ] Confirm nobody expects a newsletter — that form was removed by design

### Official contacts

- [ ] WhatsApp `+48 791 753 077` — confirmed; monitored by a real person
- [ ] Phone `+263 773 072 639` — used by "Call the office" and in JSON-LD
- [ ] Decide on `+48 572 630 737` and `jeretarisaibee@gmail.com` (both unconfirmed) — keep or remove from `src/siteConfig.js`
- [ ] Confirm office hours `Mon–Fri · 07:00–16:30`
- [ ] Confirm the WhatsApp/phone split is intentional (chat → Poland, calls → Zimbabwe)

### Legal and privacy

- [ ] Read `privacy.html` against actual behaviour — the forms now **do** transmit personal data (parent name, email, optional phone, child's name and class)
- [ ] Name Resend as a data processor
- [ ] State how long enquiries are retained
- [ ] Read `terms.html`
- [ ] Confirm photo consent for all 8 published photographs
- [ ] Confirm both testimonials are published with permission

### Title and meta tags

- [ ] `<title>` and `<meta name="description">` present ✅
- [ ] `og:title`, `og:description`, `og:type` present ✅
- [ ] **Add `og:url`** — missing
- [ ] **Add `twitter:image`** — missing (`twitter:card` is set but has no image)

### robots.txt

- [x] Present and now shipping ✅ (it previously never reached `dist/`)
- [x] Excludes `/admin.html`, `/parent.html`, `/login.html` and their assets ✅
- [ ] Update the `Sitemap:` line to the final domain

### sitemap.xml

- [x] Present and now shipping ✅ (also previously missing from `dist/`)
- [x] Includes `privacy.html` and `terms.html` ✅
- [ ] Update all 7 `<loc>` values to the final domain
- [ ] Submit to Google Search Console after launch

### Favicon — MISSING

`index.html` has **no `rel="icon"` link of any kind**, and there is no
`favicon.ico`. Browsers request `/favicon.ico`, the SPA fallback answers with
`index.html`, and no tab icon appears. `icon-192.png` and `icon-512.png` exist
and are referenced only by the PWA manifest.

- [ ] Add to `<head>`:
  ```html
  <link rel="icon" href="/icon-192.png"/>
  <link rel="apple-touch-icon" href="/icon-192.png"/>
  ```
- [ ] Optionally add a true `favicon.ico` in `public/` for older browsers

### Social sharing image — WILL NOT RENDER

Two independent problems with `og:image`:

1. **Relative URL.** It is `content="/social-preview.webp"`. Facebook, WhatsApp
   and LinkedIn require an **absolute** URL and will silently show no preview.
2. **WebP format.** WhatsApp — the main sharing channel for this audience — does
   not reliably render WebP previews. A JPEG or PNG is needed.

- [ ] Export `social-preview.jpg` (1200×630) from the existing WebP
- [ ] Change to `content="https://<final-domain>/social-preview.jpg"`
- [ ] Add matching `twitter:image` and `og:url`
- [ ] Test with the Facebook Sharing Debugger and by sending the link to yourself on WhatsApp

### Mobile testing

- [x] No horizontal scroll at 320/375/414/768/1024/1440 ✅ (automated)
- [x] Dialog buttons ≥ 44px tall ✅
- [x] Dark mode verified ✅
- [ ] Test on a **real Android phone** on mobile data, not just an emulator
- [ ] Install the PWA from HTTPS and confirm the icon and splash screen
- [ ] Submit an enquiry from the phone
- [ ] Confirm WhatsApp buttons open the WhatsApp app with the message prefilled
- [ ] Test on a low-bandwidth connection — this matters for the audience

### Backups

- [ ] **Push to GitHub** (see B4 — this is the real gap)
- [ ] Tag the release: `git tag -a v1.0 -m "Initial public launch"`
- [ ] Note the current Worker version id before deploying (see §8)
- [ ] Confirm `OOPGen/milestone-website` has a second collaborator, so access is not tied to one account
- [ ] Keep the 8 original school photographs backed up outside the repo — they are irreplaceable

---

## 6. Exact deployment command

Non-destructive: it creates a **new immutable version**, deletes nothing,
touches no DNS, and leaves every previous version available for instant
rollback.

```bash
# 0. Back up first — currently there is nothing to roll back to
git add -A && git commit -m "Pre-launch: forms, content safety, deployment prep"
git push origin main

# 1. Record the current version so rollback has a known-good target
npx wrangler deployments list

# 2. Clean install, build, validate WITHOUT deploying
npm ci
npm run build
npx wrangler deploy --dry-run          # already verified: 44 assets, bindings OK

# 3. Deploy
npx wrangler deploy
```

A staged alternative — `npx wrangler versions upload` to publish a version
without shifting traffic, then `npx wrangler versions deploy` to move traffic
gradually. This is the safer path for a risky release, but it could not be
exercised in this environment, so treat it as untested here.

**This command has not been run.**

---

## 7. Production URL to test

```
https://milestone-website.jeremichaeljunior.workers.dev
```

After a custom domain is added, also test `https://milestonejuniorlevelupacademy.co.zw`
and the `www` variant, and confirm one redirects to the other consistently.

---

## 8. 10-minute post-deployment smoke test

**0–1 min — is it alive**
1. Open the production URL. Homepage renders, hero image loads.
2. `curl https://<url>/api/health` → `emailConfigured: true`, `turnstileConfigured: true`.

**1–3 min — routes and files**
3. `/admin`, `/parent`, `/login.html`, `/privacy.html`, `/terms.html` all load — no redirect loop.
4. `/robots.txt` and `/sitemap.xml` return real content.
5. `/downloads/prospectus.pdf` does **not** return a PDF (placeholders are unpublished).

**3–6 min — the forms actually deliver** *(the approval gate)*
6. Submit a real contact enquiry. **Confirm it arrives in the school inbox — check spam.**
7. Submit a real admissions application. Subject reads `[Website Enquiry] <name> — <grade>`.
8. Reply to that email; confirm it reaches the parent address.
9. Submit with an invalid email → inline error, nothing sent.
10. Submit without ticking consent → blocked.

**6–8 min — security**
11. DevTools → Sources: search for `re_` and `RESEND` → **no matches**.
12. Submit 6 times quickly → the 6th is refused and does **not** claim success.
13. Confirm the Turnstile widget renders on both forms.

**8–10 min — mobile and appearance**
14. On a real phone: load the site, open the menu, submit an enquiry.
15. Tap a document card → dialog opens with WhatsApp / Call / Email.
16. Tap Chat on WhatsApp → WhatsApp opens with the message prefilled.
17. Send the site link to yourself on WhatsApp → confirm the preview image renders.
18. DevTools console on desktop → zero errors.

**If step 6 or 7 fails, roll back immediately** and fix the mail configuration
before parents encounter the form.

---

## 9. Rollback

### Fastest — Cloudflare dashboard (seconds)

Workers & Pages → `milestone-website` → **Deployments** → find the last good
version → **Rollback**.

### CLI

```bash
npx wrangler deployments list           # list versions, newest first
npx wrangler rollback                   # revert to the immediately previous version
npx wrangler rollback <version-id>      # or revert to a specific one
```

### From source, if the bad state is in the repo

```bash
git revert <bad-commit>                 # revert, never reset — keeps history
npm run build
npx wrangler deploy
```

### Two things rollback does not undo

1. **The service worker.** Returning visitors may hold a cached shell. `sw.js`
   uses a versioned cache (`milestone-academy-v2`) — bump that string whenever a
   change must invalidate old caches. If a rollback appears not to have worked
   for one person, have them hard-refresh before assuming the rollback failed.
2. **DNS.** Nameserver and record changes propagate on their own schedule. Note
   the previous records before changing anything.

### Emergency: take the forms offline without a rollback

If enquiries are being lost, delete the API key. The Worker then returns 503 and
the form tells parents plainly that it could not send, with WhatsApp, phone and
email offered instead — which is safe, honest behaviour.

```bash
npx wrangler secret delete RESEND_API_KEY
```
