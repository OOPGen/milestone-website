/* STANDALONE ADMIN-PORTAL BUILD CONFIG.

   Deliberately separate from vite.config.js (the full Phase 2 multi-page
   build) and vite.config.phase1.js (the public site). This one builds ONLY
   admin-portal.html + src/admin-portal/* into dist-admin/, so the standalone
   admin deployment ships nothing else — not the public site, not the old
   Cloudflare admin.html / login.html / parent.html pages.

   Build with:  npm run build:admin-portal   (scripts/build-admin-portal.mjs
   wraps this, then renames the output to index.html and adds noindex
   headers). Deploy with:  npm run deploy:admin-portal.

   The portal reads only the two PUBLIC values VITE_SUPABASE_URL and
   VITE_SUPABASE_ANON_KEY (from .env.local at build time) — the anon key is
   publishable by design; RLS is the security boundary. No service-role key
   or other secret is ever read here. */

import { defineConfig } from 'vite';

export default defineConfig({
  base: '/',
  // Do NOT copy the repo's public/ directory. It holds the PUBLIC site's
  // assets and the old Cloudflare account-system client files (admin.js,
  // login.js, apiClient.js, …) — none of which belong on the standalone
  // admin portal domain. Vite would otherwise copy all of it wholesale.
  publicDir: false,
  build: {
    outDir: 'dist-admin',
    emptyOutDir: true,
    rollupOptions: {
      input: { adminPortal: 'admin-portal.html' },
    },
  },
});
