# Milestone Academy deployment plan

## Current status
The public website is a static, responsive PWA. The Supabase production schema is prepared in `supabase/schema.sql`, but the frontend must be connected to the Supabase project before collecting real applications, messages, parent records, or documents.

## Cloudflare Pages deployment

The frontend is configured for Cloudflare Pages with `wrangler.toml`, `_headers`, and `_redirects`.

### Dashboard deployment

1. Go to Cloudflare Dashboard → Workers & Pages → Create application → Pages.
2. Choose **Direct Upload** for a first launch, or connect a Git repository for automatic deployments.
3. Upload the project root. There is no build command for this static frontend.
4. Set the output directory to `.` when Cloudflare asks for one.
5. Confirm that the Pages deployment serves `index.html` and that `/admin` and `/parent` resolve correctly.
6. Add the custom domain under Pages → Custom domains. Cloudflare will provision SSL.
7. Test the PWA from HTTPS on an Android device and verify the service worker scope.

### Recommended Cloudflare settings

- Enable Always Use HTTPS.
- Keep Brotli compression enabled.
- Enable Auto Minify only after testing the inline scripts and PWA files.
- Add a Cloudflare Turnstile widget to contact and application forms before production.
- Use Cloudflare Analytics or connect the Supabase analytics events for the monthly report.
- Do not use Cloudflare Pages Functions for secrets unless the Supabase server-side integration is moved there deliberately.

## Recommended deployment sequence

1. Register the school domain, for example `milestonejuniorlevelupacademy.co.zw`.
2. Create a Supabase project in a region appropriate for the school.
3. Run `supabase/schema.sql` in the Supabase SQL editor.
4. Create an admin user in Supabase Auth and add the user ID to `public.admin_roles` with role `admin`.
5. Configure email confirmation, password reset, SMTP, storage policies, and rate limits.
6. Connect the public forms to Supabase Edge Functions rather than exposing service-role keys in the browser.
7. Connect the admin dashboard to authenticated Supabase queries.
8. Store application documents in the private `private-documents` bucket and issue short-lived signed URLs.
9. Store public gallery/news media in `school-media`.
10. Configure a transactional email provider for application, message and newsletter confirmations.
11. Add a server-side spam provider such as Turnstile or reCAPTCHA Enterprise.
12. Deploy the static files to the chosen host with HTTPS enabled.
13. Set the final canonical domain in `index.html`, `sitemap.xml`, `robots.txt`, JSON-LD and PWA manifest.
14. Submit the sitemap to Google Search Console and verify the Google Business Profile.
15. Test mobile install, offline fallback, forms, WhatsApp, map, downloads, login, admin permissions and password reset.

## Production acceptance checklist

- [ ] Domain DNS configured
- [ ] HTTPS / SSL active
- [ ] `canonical` URL changed from the placeholder domain if necessary
- [ ] Supabase Auth enabled
- [ ] Admin roles seeded
- [ ] Row-level security policies tested with anonymous, parent and admin users
- [ ] Server-side validation added to every form
- [ ] Honeypot plus server-side rate limiting enabled
- [ ] Private document signed URLs tested
- [ ] Audit log inserts enabled for admin mutations
- [ ] Email confirmation and unsubscribe flows tested
- [ ] Payment provider and webhook verified before advertising online payments
- [ ] Image consent confirmed by the school
- [ ] Privacy policy and terms reviewed by the school
- [ ] Google Search Console and analytics property connected
- [ ] Monthly analytics report tested
- [ ] Staff trained on the admin dashboard
- [ ] Backup and recovery plan documented

## Important security rule
Never place a Supabase service-role key, payment secret, SMTP password or private API key in frontend files. Use Edge Functions or a server-side API for privileged actions.
