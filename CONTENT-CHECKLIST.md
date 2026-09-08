# Content checklist — outstanding items

Everything below was **removed, disabled, or made non-specific** before launch
because it could not be verified. Nothing here is broken — each item is waiting
on real information from the school.

The same checklist is visible in the admin dashboard under
**Content checklist** (`admin.html`), so whoever maintains the site can see it
without reading the repo.

---

## 1. Documents — 6 outstanding

The six files in `downloads/` are ~850-byte placeholder stubs containing only a
title and the school's address. They have been **removed from `public/`**, so
they are no longer published and cannot be downloaded from the live site.
Each document card on the homepage now opens a request dialog instead.

| Document | Status |
|---|---|
| School prospectus | Placeholder — needs the real PDF |
| Fee structure | Placeholder — needs the real PDF |
| Application form | Placeholder — needs the real PDF |
| School calendar | Placeholder — needs the real PDF |
| Uniform guide | Placeholder — needs the real PDF |
| Parent handbook | Placeholder — needs the real PDF |

**To publish one:** follow the steps in [`downloads/README.md`](downloads/README.md).

## 2. Term dates and events — outstanding

Four events were removed because none were confirmed by the school:
Open Day (22 Aug), applications closing (1 Sep), Term 4 start (14 Sep),
prize-giving (6 Nov). The events card now shows "Term dates are being
confirmed."

**Needed:** term start/end dates, open day dates, and any events to publish.
**Where to restore:** `src/legacyMarkup.js`, the `.events-empty` block — replace
with `.event-item` entries (the original markup pattern is in git history).

## 3. Application deadline — outstanding

A live countdown to `2026-09-01` was removed; the date was never confirmed.
Replaced with "Speak to the school office for current intake dates and
availability."

**Needed:** whether there is a real application deadline, and the date.

## 4. School facts and figures — outstanding

These three claims were removed because no source exists for them:

| Claim shown before | Status |
|---|---|
| "6+ Enrichments" | Removed — number unverified |
| "1:12 Teacher ratio" | Removed — ratio unverified |
| "100% Curiosity" | Replaced with "Curiosity encouraged every day." |

**Needed:** any figures the school can stand behind in writing — class sizes,
staff:pupil ratio, number of enrichment programmes, years established.
**Where to edit:** `src/legacyMarkup.js`, the `.intro-note` line (marked
`EDITABLE`).

## 5. Contact details — 2 unconfirmed

All contact details now come from one file: **[`src/siteConfig.js`](src/siteConfig.js)**.
Edit values there and they update the header, footer, contact section,
application WhatsApp message and document requests together.

| Value | Status |
|---|---|
| WhatsApp `+48 791 753 077` | **Confirmed** by the site owner |
| Phone `+263 773 072 639` | On the school's printed banner and in the site's structured data |
| Phone `+48 572 630 737` | **Unconfirmed** — remove if not in use |
| Email `milestonejnrlevelupacademy@gmail.com` | On the school's printed materials |
| **Admissions inbox for `ENQUIRY_TO`** | **BLOCKING — not confirmed.** Every website enquiry will be delivered here. Must be an inbox someone actually monitors daily. |
| Email `jeretarisaibee@gmail.com` | **Unconfirmed** — remove if not in use |
| Address `1838 Raylands Park Estate, Gweru` | On the school's printed materials |
| Hours `Mon–Fri · 07:00–16:30` | **Unconfirmed** — please verify |

> The Zimbabwe number `+263 773 072 639` is still what the site's JSON-LD
> structured data reports to search engines (`index.html`) and what the
> "Call the office" buttons dial. WhatsApp goes to the Poland number. Confirm
> this split is intentional.

## 6. News articles — 2 published, dates removed

The two articles are generic and undated. Publication dates ("8 August 2026",
"1 August 2026") were removed because they were invented.

**Needed:** real dates, or real articles to replace them.
**Where to edit:** `app.js`, the `articles` object, and `src/legacyMarkup.js`.

## 7. Testimonials — 2 published

Both are pre-existing and marked as published with permission. Not changed.
**Needed:** written consent on file, if not already held.

## 8. Admin dashboard — demo data

The dashboard at `admin.html` still shows placeholder figures (48 applications,
1,284 visits, sample names) and a hardcoded date. It sits behind a **fake**
sign-in and is not parent-facing, so it was left alone in this pass — but it
must not be presented to the school as live data until it is wired to a real
backend.

---

## Not outstanding — deliberately excluded

- **Photographs.** All 8 photos on the site are the school's own. No stock or
  AI images were introduced.
- **Authentication.** Sign-in on `login.html`, `admin.html` and `parent.html` is
  a front-end placeholder by instruction. No real auth, no Supabase.
- **Form delivery.** The admissions and contact forms are now connected to a real
  Cloudflare Worker endpoint and send email through Resend. Success is shown only
  after the provider accepts the message; a failure says so plainly. See
  `DEPLOYMENT.md` §4.
- **Newsletter.** Removed rather than faked — replaced with a WhatsApp/call
  call-to-action, because the school has no mailing-list or consent process.
