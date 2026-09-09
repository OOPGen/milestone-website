/* Public, unauthenticated reads. SQL enforces visibility — the client cannot
   ask its way past it: every query here is hardcoded to
   status='published' AND visibility='public'. */

import { ok, notConfigured, notFound } from '../lib/http.js';

const SUMMARY_COLUMNS = `
  id, type, kind, title, slug, summary, category,
  start_date, end_date, cover_asset_id, published_at
`;

export async function listPublicContent(request, env, type) {
  if (!env.DB) return notConfigured();
  const { results } = await env.DB.prepare(
    `SELECT ${SUMMARY_COLUMNS} FROM content_items
      WHERE type = ? AND status = 'published' AND visibility = 'public' AND deleted_at IS NULL
      ORDER BY COALESCE(start_date, published_at) DESC LIMIT 100`
  ).bind(type).all();
  return ok({ items: results });
}

export async function getPublicContentItem(request, env, id) {
  if (!env.DB) return notConfigured();
  const row = await env.DB.prepare(
    `SELECT ${SUMMARY_COLUMNS}, body FROM content_items
      WHERE id = ? AND status = 'published' AND visibility = 'public' AND deleted_at IS NULL`
  ).bind(id).first();
  if (!row) return notFound();
  return ok({ item: row });
}

export async function listPublicAlbumPhotos(request, env, albumId) {
  if (!env.DB) return notConfigured();
  const album = await env.DB.prepare(
    `SELECT id FROM content_items
      WHERE id = ? AND type = 'album' AND status = 'published' AND visibility = 'public' AND deleted_at IS NULL`
  ).bind(albumId).first();
  if (!album) return notFound();

  const { results } = await env.DB.prepare(
    `SELECT p.id, p.caption, p.sort_order, a.id AS asset_id, a.width, a.height
       FROM gallery_photos p JOIN assets a ON a.id = p.asset_id
      WHERE p.album_id = ? AND p.status = 'published' AND a.visibility = 'public'
        AND p.deleted_at IS NULL AND a.deleted_at IS NULL
      ORDER BY p.sort_order ASC`
  ).bind(albumId).all();
  return ok({ photos: results });
}

export async function getSiteContent(request, env) {
  if (!env.DB) return notConfigured();
  const { results } = await env.DB.prepare(
    "SELECT key, value_json FROM site_content WHERE status = 'published'"
  ).all();
  const content = {};
  for (const row of results) {
    try { content[row.key] = JSON.parse(row.value_json); } catch { /* skip malformed */ }
  }
  return ok({ content });
}
