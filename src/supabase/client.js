/* Supabase client — Phase 2 preparation only.

   NOT imported by any Phase 1 file (src/main.jsx, src/legacyMarkup.js,
   app.js, or anything under public/). Phase 1's build (vite.config.phase1.js)
   only bundles what index.html/privacy.html/terms.html actually import, and
   none of them reference this module — so it is entirely absent from the
   currently deployed Phase 1 build regardless of whether this file exists in
   the repo. Do not import this from any Phase 1 entry point until the
   Supabase migration has been reviewed and explicitly approved — see
   ACCOUNT-SYSTEM-PLAN.md and supabase/SUPABASE-SETUP.md.

   Reads ONLY the two public, frontend-safe values:
     VITE_SUPABASE_URL
     VITE_SUPABASE_ANON_KEY
   Both are meant to ship in a browser bundle — Supabase's security model
   relies on Row Level Security policies, not on the anon key being secret.
   This file must never read, accept, or reference a service-role key,
   database password, personal access token, JWT secret, or SMTP credential —
   those belong only in Edge Functions / server-side contexts. */

import { createClient } from '@supabase/supabase-js';

/**
 * Pure factory, deliberately separated from the module-level
 * import.meta.env read below so it can be unit-tested in plain Node without
 * Vite's env injection or any .env file — see
 * tests/supabase-client.test.mjs. Never throws: returns null for any missing
 * or malformed input instead, which is what "fails safely" means for this
 * module — a missing configuration degrades a feature, it does not break
 * the page that imports it.
 */
export function createSupabaseClientSafely(url, anonKey, { warn = true } = {}) {
  const configured = typeof url === 'string' && url.length > 0
    && typeof anonKey === 'string' && anonKey.length > 0;

  if (!configured) {
    if (warn && typeof console !== 'undefined') {
      // A single quiet warning, not thrown. Never logs the values
      // themselves — there's nothing sensitive to leak here, but the point
      // of this module is to fail safely, not loudly.
      console.warn('[supabase] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY not set — Supabase features are disabled.');
    }
    return null;
  }

  try {
    return createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  } catch (err) {
    // A malformed URL (e.g. missing scheme) throws from inside
    // @supabase/supabase-js itself — caught here so a bad value degrades
    // the same way a missing one does, rather than crashing the importer.
    if (warn && typeof console !== 'undefined') {
      console.warn('[supabase] client could not be created — check VITE_SUPABASE_URL is a valid URL.');
    }
    return null;
  }
}

const client = createSupabaseClientSafely(
  import.meta.env?.VITE_SUPABASE_URL,
  import.meta.env?.VITE_SUPABASE_ANON_KEY
);

/** True once both required env vars were present and the client was built successfully. */
export const isSupabaseConfigured = client !== null;

/**
 * Returns the Supabase client, or null if not configured. Never throws.
 * Callers MUST handle a null return rather than assuming a client always
 * exists, e.g.:
 *
 *   const supabase = getSupabaseClient();
 *   if (!supabase) { showFallbackUI(); return; }
 *   const { data, error } = await supabase.from('notices').select('*');
 */
export function getSupabaseClient() {
  return client;
}
