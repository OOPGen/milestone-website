/* Authorised asset streaming.

   Parent-only files are NEVER given a public R2 URL — every download, of any
   visibility, goes through here so a session and its capability are checked
   on every request. A public asset id still requires no session; a
   parents-only asset id returns 404 (not 403) to anyone without
   'content.read.parent' / 'documents.download.parent', so an unauthenticated
   guess cannot even learn that the id exists. */

import { notConfigured, notFound, unauthorized } from '../lib/http.js';
import { getSessionUser } from '../lib/auth.js';
import { can } from '../lib/permissions.js';

export async function streamAsset(request, env, assetId) {
  if (!env.DB || !env.MEDIA) return notConfigured();

  const asset = await env.DB.prepare(
    `SELECT id, r2_key, filename, content_type, visibility FROM assets
      WHERE id = ? AND deleted_at IS NULL`
  ).bind(assetId).first();
  if (!asset) return notFound();

  if (asset.visibility === 'parents') {
    const user = await getSessionUser(env, request);
    const allowed = user && (can(user, 'content.read.parent') || can(user, 'documents.download.parent'));
    if (!allowed) return notFound(); // not 403 — do not confirm the asset exists
  }

  const object = await env.MEDIA.get(asset.r2_key);
  if (!object) return notFound();

  return new Response(object.body, {
    headers: {
      'Content-Type': asset.content_type,
      // PDFs download (a document a parent asked to download should save, not
      // just open in-tab); images stay inline so the gallery can display them.
      'Content-Disposition': `${asset.content_type === 'application/pdf' ? 'attachment' : 'inline'}; filename="${asset.filename.replace(/"/g, '')}"`,
      'Cache-Control': asset.visibility === 'public'
        ? 'public, max-age=86400'
        : 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}
