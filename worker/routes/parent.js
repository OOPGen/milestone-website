/* Parent portal — read-only. Every route here requires 'content.read.parent'
   or 'documents.download.parent', which PARENT holds alongside staff roles.

   There is no route here that returns another user's record, and no route
   that accepts a content edit — that is the whole point of this file being
   separate from routes/admin.js. */

import { ok, notConfigured, notFound } from '../lib/http.js';
import { authorize } from '../lib/auth.js';

const SUMMARY_COLUMNS = `
  id, type, kind, title, slug, summary, category,
  start_date, end_date, cover_asset_id, published_at
`;

/** Parents see everything public sees, PLUS parents-only items. Never the reverse. */
export async function listParentContent(request, env, type) {
  if (!env.DB) return notConfigured();
  const auth = await authorize(env, request, 'content.read.parent');
  if (auth.error) return auth;

  const { results } = await env.DB.prepare(
    `SELECT ${SUMMARY_COLUMNS} FROM content_items
      WHERE type = ? AND status = 'published'
        AND visibility IN ('public','parents') AND deleted_at IS NULL
      ORDER BY COALESCE(start_date, published_at) DESC LIMIT 200`
  ).bind(type).all();
  return ok({ items: results });
}

export async function getParentContentItem(request, env, id) {
  if (!env.DB) return notConfigured();
  const auth = await authorize(env, request, 'content.read.parent');
  if (auth.error) return auth;

  const row = await env.DB.prepare(
    `SELECT ${SUMMARY_COLUMNS}, body FROM content_items
      WHERE id = ? AND status = 'published'
        AND visibility IN ('public','parents') AND deleted_at IS NULL`
  ).bind(id).first();
  if (!row) return notFound();
  return ok({ item: row });
}

export async function listParentAlbumPhotos(request, env, albumId) {
  if (!env.DB) return notConfigured();
  const auth = await authorize(env, request, 'content.read.parent');
  if (auth.error) return auth;

  const album = await env.DB.prepare(
    `SELECT id FROM content_items
      WHERE id = ? AND type = 'album' AND status = 'published'
        AND visibility IN ('public','parents') AND deleted_at IS NULL`
  ).bind(albumId).first();
  if (!album) return notFound();

  const { results } = await env.DB.prepare(
    `SELECT p.id, p.caption, p.sort_order, a.id AS asset_id, a.width, a.height, a.visibility
       FROM gallery_photos p JOIN assets a ON a.id = p.asset_id
      WHERE p.album_id = ? AND p.status = 'published'
        AND p.deleted_at IS NULL AND a.deleted_at IS NULL
      ORDER BY p.sort_order ASC`
  ).bind(albumId).all();
  return ok({ photos: results });
}

export async function listParentDocuments(request, env) {
  if (!env.DB) return notConfigured();
  const auth = await authorize(env, request, 'documents.download.parent');
  if (auth.error) return auth;

  // Joins through to the current version's asset id, so the client can link
  // straight to /api/files/:assetId without a second lookup.
  const { results } = await env.DB.prepare(
    `SELECT d.id, d.title, d.category, d.description, d.doc_date, d.visibility,
            v.asset_id
       FROM documents d
       LEFT JOIN document_versions v ON v.id = d.current_version_id
      WHERE d.status = 'published' AND d.visibility IN ('public','parents') AND d.deleted_at IS NULL
      ORDER BY d.doc_date DESC`
  ).all();
  return ok({ documents: results });
}
