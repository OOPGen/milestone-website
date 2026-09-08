/* ==========================================================================
   Milestone Junior Level Up Academy — central contact configuration

   SINGLE SOURCE OF TRUTH for every phone number, WhatsApp link, and email
   address shown on the public website.

   Edit values here only. They are interpolated into the homepage markup at
   build time and exposed to app.js at runtime as window.SITE, so the header,
   footer, contact section, application flow and document-request messages
   can never drift out of sync.

   STATUS OF EACH VALUE (update when the school confirms):
   - whatsapp        CONFIRMED by the site owner as the parent-enquiry number.
   - phonePrimary    Appears on the school's printed banner, in the school
                     documents and in the site's structured data.
   - phoneSecondary  NOT CONFIRMED — listed as an additional contact only.
   - emailOffice     Appears on the school's printed materials.
   - emailSecondary  NOT CONFIRMED — secondary/community enquiries.
   ========================================================================== */

export const contact = {
  schoolName: 'Milestone Junior Level Up Academy',

  // WhatsApp (digits only, international format, no + or spaces)
  whatsappDigits: '48791753077',
  whatsappDisplay: '+48 791 753 077',

  // Voice
  phonePrimary: '+263 773 072 639',
  phonePrimaryHref: 'tel:+263773072639',
  phoneSecondary: '+48 572 630 737',
  phoneSecondaryHref: 'tel:+48572630737',

  // Email
  emailOffice: 'milestonejnrlevelupacademy@gmail.com',
  emailSecondary: 'jeretarisaibee@gmail.com',

  /* Gates the "Email the School" action in the enquiry-form fallback panel.
     FALSE until the school owner explicitly confirms this inbox is monitored.
     The address appears on the school's printed materials, but "printed
     somewhere" is not the same as "someone reads it", and a parent sent to an
     unread inbox is worse than one fewer button. Flip to true on confirmation. */
  emailOfficeConfirmed: false,

  // Location
  address: '1838 Raylands Park Estate, Gweru, Zimbabwe',
  addressQuery: '1838+Raylands+Park+Estate,+Gweru,+Zimbabwe', // URL-encoded, for map links
  hours: 'Mon–Fri · 07:00–16:30',
};

/**
 * Cloudflare Turnstile site key. Public by design — safe to ship to the browser.
 * The matching TURNSTILE_SECRET_KEY is a Worker secret and never appears here.
 *
 * Set VITE_TURNSTILE_SITE_KEY at build time to switch the widget on. While it
 * is empty the widget is not rendered and the Worker skips verification, so the
 * forms keep working before Turnstile is provisioned.
 */
export const turnstileSiteKey =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_TURNSTILE_SITE_KEY) || '';

/** Build an official wa.me click-to-chat link with a pre-filled message. */
export function waLink(message) {
  return 'https://wa.me/' + contact.whatsappDigits +
    (message ? '?text=' + encodeURIComponent(message) : '');
}
