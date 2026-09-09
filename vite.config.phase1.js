/* PHASE 1 PUBLIC-PREVIEW BUILD CONFIG.

   Deliberately separate from vite.config.js (the full multi-page build,
   used for Phase 2). Only the public site and its two legal pages are
   listed as entries — admin.html, parent.html, login.html and
   accept-invitation.html are NOT included, so they simply do not exist in
   this build's dist/ output. There is nothing to serve at those paths even
   before worker/phase1.js's explicit 404 handling runs.

   Build with:  npx vite build --config vite.config.phase1.js
   (or:         npm run build:phase1) */

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { host: '0.0.0.0', allowedHosts: true },
  preview: { host: '0.0.0.0', allowedHosts: true },
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        privacy: 'privacy.html',
        terms: 'terms.html',
      },
    },
  },
});
