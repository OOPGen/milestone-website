/* Staff dashboard: content management and account management.

   Every function starts with authorize(env, request, capability) and returns
   its error immediately on failure — there is no code path here that acts
   before that check runs. */

import {
  ok, badRequest, notFound, notConfigured, str, nowIso, sanitizeRichText,
} from '../lib/http.js';
import { authorize, destroyAllSessionsFor } from '../lib/auth.js';
import { newId, generateToken, hashToken } from '../lib/crypto.js';
import { writeAudit } from '../lib/audit.js';
import {
  can, canManageUser, canAssignRole, isGrantable, ROLES,
} from '../lib/permissions.js';

const CONTENT_TYPES = new Set(['notice', 'news', 'event', 'term_date', 'album']);
const VISIBILITIES = new Set(['public', 'parents']);
const STATUSES = new Set(['draft', 'published', 'archived']);
const EMAIL_RE = /^[^\s@,;:<>()[\]\\]+@[^\s@.,;:<>()[\]\\]+(\.[^\s@.,;:<>()[\]\\]+)+$/;

function publicUser(u) {
  return { id: u.id, email: u.email, name: u.name, role: u.role, status: u.status,
    lastLoginAt: u.last_login_at, createdAt: u.created_at };
}

/* ---------------------------------------------------------------------------
   Content: notices, news, events, term dates, albums
   --------------------------------------------------------------------------- */

export async function listAdminContent(request, env, type) {
  if (!env.DB) return notConfigured();
  const auth = await authorize(env, request, 'content.read.parent');
  if (auth.error) return auth;
  if (!CONTENT_TYPES.has(type)) return badRequest('Unknown content type.');

  const { results } = await env.DB.prepare(
    `SELECT id, type, kind, title, summary, category, start_date, end_date,
            status, visibility, created_by, updated_by, published_at, archived_at
       FROM content_items WHERE type = ? AND deleted_at IS NULL
       ORDER BY updated_at DESC LIMIT 300`
  ).bind(type).all();
  return ok({ items: results });
}

export async function createContent(request, env, type, body) {
  if (!env.DB) return notConfigured();
  const auth = await authorize(env, request, 'content.create');
  if (auth.error) return auth;
  if (!CONTENT_TYPES.has(type)) return badRequest('Unknown content type.');

  const title = str(body.title);
  if (!title) return badRequest('Title is required.', { title: 'Title is required.' });
  const visibility = VISIBILITIES.has(body.visibility) ? body.visibility : 'parents';
  const kind = ['opening', 'closing', 'holiday', 'event', 'reminder'].includes(body.kind)
    ? body.kind : (type === 'term_date' ? 'event' : null);

  const id = newId('cnt_');
  await env.DB.prepare(
    `INSERT INTO content_items
       (id, type, kind, title, slug, summary, body, category, start_date, end_date,
        cover_asset_id, status, visibility, created_by, updated_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?)`
  ).bind(
    id, type, kind, title, str(body.slug) || null, str(body.summary),
    sanitizeRichText(str(body.body)), str(body.category),
    str(body.startDate) || null, str(body.endDate) || null,
    str(body.coverAssetId) || null, visibility,
    auth.user.id, auth.user.id, nowIso(), nowIso()
  ).run();

  await writeAudit(env, request, {
    actor: auth.user, action: 'content.create', entityType: type, entityId: id,
    details: { title },
  });
  return ok({ id });
}

export async function updateContent(request, env, id, body) {
  if (!env.DB) return notConfigured();
  const auth = await authorize(env, request, 'content.update');
  if (auth.error) return auth;

  const existing = await env.DB.prepare(
    'SELECT id, type FROM content_items WHERE id = ? AND deleted_at IS NULL'
  ).bind(id).first();
  if (!existing) return notFound();

  const fields = [];
  const values = [];
  const set = (col, val) => { fields.push(`${col} = ?`); values.push(val); };

  if (body.title !== undefined) set('title', str(body.title));
  if (body.summary !== undefined) set('summary', str(body.summary));
  if (body.body !== undefined) set('body', sanitizeRichText(str(body.body)));
  if (body.category !== undefined) set('category', str(body.category));
  if (body.startDate !== undefined) set('start_date', str(body.startDate) || null);
  if (body.endDate !== undefined) set('end_date', str(body.endDate) || null);
  if (body.coverAssetId !== undefined) set('cover_asset_id', str(body.coverAssetId) || null);
  if (body.visibility !== undefined && VISIBILITIES.has(body.visibility)) set('visibility', body.visibility);
  if (body.kind !== undefined && ['opening', 'closing', 'holiday', 'event', 'reminder'].includes(body.kind))
    set('kind', body.kind);

  if (!fields.length) return badRequest('No changes provided.');
  set('updated_by', auth.user.id);
  set('updated_at', nowIso());
  values.push(id);

  await env.DB.prepare(`UPDATE content_items SET ${fields.join(', ')} WHERE id = ?`)
    .bind(...values).run();
  await writeAudit(env, request, {
    actor: auth.user, action: 'content.update', entityType: existing.type, entityId: id,
  });
  return ok({});
}

async function setContentStatus(request, env, id, status, capability, action) {
  if (!env.DB) return notConfigured();
  const auth = await authorize(env, request, capability);
  if (auth.error) return auth;

  const existing = await env.DB.prepare(
    'SELECT id, type FROM content_items WHERE id = ? AND deleted_at IS NULL'
  ).bind(id).first();
  if (!existing) return notFound();

  const extra = status === 'published' ? ', published_at = ?' : status === 'archived' ? ', archived_at = ?' : '';
  const params = [status, auth.user.id, nowIso()];
  if (extra) params.push(nowIso());
  params.push(id);

  await env.DB.prepare(
    `UPDATE content_items SET status = ?, updated_by = ?, updated_at = ?${extra} WHERE id = ?`
  ).bind(...params).run();
  await writeAudit(env, request, {
    actor: auth.user, action, entityType: existing.type, entityId: id,
  });
  return ok({});
}

export const publishContent = (request, env, id) =>
  setContentStatus(request, env, id, 'published', 'content.publish', 'content.publish');
export const unpublishContent = (request, env, id) =>
  setContentStatus(request, env, id, 'draft', 'content.publish', 'content.unpublish');
export const archiveContent = (request, env, id) =>
  setContentStatus(request, env, id, 'archived', 'content.archive', 'content.archive');

/** Hard delete is Super Admin only, still audited, and reserved for genuine mistakes. */
export async function hardDeleteContent(request, env, id) {
  if (!env.DB) return notConfigured();
  const auth = await authorize(env, request, 'content.delete.hard');
  if (auth.error) return auth;

  const existing = await env.DB.prepare(
    'SELECT id, type, title FROM content_items WHERE id = ?'
  ).bind(id).first();
  if (!existing) return notFound();

  await env.DB.prepare('DELETE FROM content_items WHERE id = ?').bind(id).run();
  await writeAudit(env, request, {
    actor: auth.user, action: 'content.delete_hard', entityType: existing.type, entityId: id,
    details: { title: existing.title },
  });
  return ok({});
}

/* Soft delete (used by the "archive/soft-delete" requirement for gallery
   photos and other minor rows that aren't full content_items). */
export async function softDeleteContent(request, env, id) {
  if (!env.DB) return notConfigured();
  const auth = await authorize(env, request, 'content.archive');
  if (auth.error) return auth;
  const existing = await env.DB.prepare(
    'SELECT id, type FROM content_items WHERE id = ? AND deleted_at IS NULL'
  ).bind(id).first();
  if (!existing) return notFound();
  await env.DB.prepare('UPDATE content_items SET deleted_at = ?, updated_by = ?, updated_at = ? WHERE id = ?')
    .bind(nowIso(), auth.user.id, nowIso(), id).run();
  await writeAudit(env, request, {
    actor: auth.user, action: 'content.soft_delete', entityType: existing.type, entityId: id,
  });
  return ok({});
}

/* ---------------------------------------------------------------------------
   Gallery photos within an album (the album itself is a content_items row of
   type 'album', managed by the generic content endpoints above).
   --------------------------------------------------------------------------- */

export async function listAdminAlbumPhotos(request, env, albumId) {
  if (!env.DB) return notConfigured();
  const auth = await authorize(env, request, 'media.upload');
  if (auth.error) return auth;
  const album = await env.DB.prepare(
    "SELECT id FROM content_items WHERE id = ? AND type = 'album' AND deleted_at IS NULL"
  ).bind(albumId).first();
  if (!album) return notFound();

  const { results } = await env.DB.prepare(
    `SELECT p.id, p.caption, p.sort_order, p.status, a.id AS asset_id, a.width, a.height, a.visibility
       FROM gallery_photos p JOIN assets a ON a.id = p.asset_id
      WHERE p.album_id = ? AND p.deleted_at IS NULL
      ORDER BY p.sort_order ASC`
  ).bind(albumId).all();
  return ok({ photos: results });
}

export async function addAlbumPhoto(request, env, albumId, body) {
  if (!env.DB) return notConfigured();
  const auth = await authorize(env, request, 'media.upload');
  if (auth.error) return auth;
  const album = await env.DB.prepare(
    "SELECT id FROM content_items WHERE id = ? AND type = 'album' AND deleted_at IS NULL"
  ).bind(albumId).first();
  if (!album) return notFound();

  const assetId = str(body.assetId);
  if (!assetId) return badRequest('An uploaded photo asset is required.');
  const asset = await env.DB.prepare(
    "SELECT id, content_type FROM assets WHERE id = ? AND deleted_at IS NULL"
  ).bind(assetId).first();
  if (!asset || !asset.content_type.startsWith('image/'))
    return badRequest('That asset is not an image.');

  const orderRow = await env.DB.prepare(
    'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM gallery_photos WHERE album_id = ?'
  ).bind(albumId).first();

  const photoId = newId('pho_');
  await env.DB.prepare(
    `INSERT INTO gallery_photos (id, album_id, asset_id, caption, sort_order, status, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, 'published', ?, ?)`
  ).bind(photoId, albumId, assetId, str(body.caption), orderRow.next, auth.user.id, nowIso()).run();

  await writeAudit(env, request, {
    actor: auth.user, action: 'gallery.photo_added', entityType: 'gallery_photo', entityId: photoId,
    details: { albumId },
  });
  return ok({ id: photoId });
}

export async function setAlbumPhotoStatus(request, env, photoId, status) {
  if (!env.DB) return notConfigured();
  const auth = await authorize(env, request, 'media.archive');
  if (auth.error) return auth;
  if (!STATUSES.has(status)) return badRequest('Unknown status.');

  const existing = await env.DB.prepare(
    'SELECT id FROM gallery_photos WHERE id = ? AND deleted_at IS NULL'
  ).bind(photoId).first();
  if (!existing) return notFound();

  await env.DB.prepare('UPDATE gallery_photos SET status = ? WHERE id = ?')
    .bind(status, photoId).run();
  await writeAudit(env, request, {
    actor: auth.user, action: `gallery.photo_${status}`, entityType: 'gallery_photo', entityId: photoId,
  });
  return ok({});
}

export async function softDeleteAlbumPhoto(request, env, photoId) {
  if (!env.DB) return notConfigured();
  const auth = await authorize(env, request, 'media.archive');
  if (auth.error) return auth;
  const existing = await env.DB.prepare(
    'SELECT id FROM gallery_photos WHERE id = ? AND deleted_at IS NULL'
  ).bind(photoId).first();
  if (!existing) return notFound();
  await env.DB.prepare('UPDATE gallery_photos SET deleted_at = ? WHERE id = ?')
    .bind(nowIso(), photoId).run();
  await writeAudit(env, request, {
    actor: auth.user, action: 'gallery.photo_removed', entityType: 'gallery_photo', entityId: photoId,
  });
  return ok({});
}

/* ---------------------------------------------------------------------------
   Documents
   --------------------------------------------------------------------------- */

export async function listAdminDocuments(request, env) {
  if (!env.DB) return notConfigured();
  const auth = await authorize(env, request, 'documents.manage');
  if (auth.error) return auth;
  const { results } = await env.DB.prepare(
    `SELECT id, title, category, description, doc_date, visibility, status,
            current_version_id, created_by, updated_by
       FROM documents WHERE deleted_at IS NULL ORDER BY updated_at DESC`
  ).all();
  return ok({ documents: results });
}

/** Registers a document version against an already-uploaded asset. */
export async function createDocumentVersion(request, env, body) {
  if (!env.DB) return notConfigured();
  const auth = await authorize(env, request, 'documents.manage');
  if (auth.error) return auth;

  const assetId = str(body.assetId);
  if (!assetId) return badRequest('An uploaded file asset is required.');
  const asset = await env.DB.prepare(
    "SELECT id, content_type FROM assets WHERE id = ? AND deleted_at IS NULL"
  ).bind(assetId).first();
  if (!asset) return notFound();
  if (asset.content_type !== 'application/pdf')
    return badRequest('Only PDF documents are supported in this version.');

  let documentId = str(body.documentId);
  const title = str(body.title);

  if (!documentId) {
    if (!title) return badRequest('Title is required for a new document.');
    documentId = newId('doc_');
    await env.DB.prepare(
      `INSERT INTO documents
         (id, title, category, description, doc_date, visibility, status,
          created_by, updated_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)`
    ).bind(
      documentId, title, str(body.category), str(body.description),
      str(body.docDate) || null, VISIBILITIES.has(body.visibility) ? body.visibility : 'parents',
      auth.user.id, auth.user.id, nowIso(), nowIso()
    ).run();
  } else {
    const existing = await env.DB.prepare(
      'SELECT id FROM documents WHERE id = ? AND deleted_at IS NULL'
    ).bind(documentId).first();
    if (!existing) return notFound();
  }

  const versionRow = await env.DB.prepare(
    'SELECT COALESCE(MAX(version), 0) + 1 AS next FROM document_versions WHERE document_id = ?'
  ).bind(documentId).first();
  const version = versionRow.next;
  const versionId = newId('dvr_');

  await env.DB.prepare(
    `INSERT INTO document_versions (id, document_id, asset_id, version, note, uploaded_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(versionId, documentId, assetId, version, str(body.note), auth.user.id, nowIso()).run();

  await env.DB.prepare(
    'UPDATE documents SET current_version_id = ?, updated_by = ?, updated_at = ? WHERE id = ?'
  ).bind(versionId, auth.user.id, nowIso(), documentId).run();

  await writeAudit(env, request, {
    actor: auth.user, action: 'documents.version_added', entityType: 'document', entityId: documentId,
    details: { version },
  });
  return ok({ documentId, versionId, version });
}

export async function setDocumentStatus(request, env, id, status) {
  if (!env.DB) return notConfigured();
  const auth = await authorize(env, request, 'documents.manage');
  if (auth.error) return auth;
  if (!STATUSES.has(status)) return badRequest('Unknown status.');

  const existing = await env.DB.prepare(
    'SELECT id FROM documents WHERE id = ? AND deleted_at IS NULL'
  ).bind(id).first();
  if (!existing) return notFound();

  const extra = status === 'published' ? ', published_at = ?' : status === 'archived' ? ', archived_at = ?' : '';
  const params = [status, auth.user.id, nowIso()];
  if (extra) params.push(nowIso());
  params.push(id);
  await env.DB.prepare(
    `UPDATE documents SET status = ?, updated_by = ?, updated_at = ?${extra} WHERE id = ?`
  ).bind(...params).run();

  await writeAudit(env, request, {
    actor: auth.user, action: `documents.${status}`, entityType: 'document', entityId: id,
  });
  return ok({});
}

/* ---------------------------------------------------------------------------
   Site content and settings (structured fields only — no raw HTML editor)
   --------------------------------------------------------------------------- */

const SITE_CONTENT_KEYS = new Set([
  'home.announcement', 'home.hero.headline', 'home.hero.body',
  'about.body', 'admissions.body', 'contact.details',
]);

/** All current site-content values, for prefilling the admin editor (distinct
    from the public route, which returns only published/public-facing rows). */
export async function listAdminSiteContent(request, env) {
  if (!env.DB) return notConfigured();
  const auth = await authorize(env, request, 'pages.edit');
  if (auth.error) return auth;
  const { results } = await env.DB.prepare(
    'SELECT key, value_json, status, updated_by, updated_at FROM site_content'
  ).all();
  const content = {};
  for (const row of results) {
    try { content[row.key] = JSON.parse(row.value_json); } catch { /* skip malformed */ }
  }
  return ok({ content });
}

export async function updateSiteContent(request, env, key, body) {
  if (!env.DB) return notConfigured();
  const auth = await authorize(env, request, 'pages.edit');
  if (auth.error) return auth;
  if (!SITE_CONTENT_KEYS.has(key)) return badRequest('Unknown content key.');
  if (key === 'contact.details' && !can(auth.user, 'contacts.edit'))
    return { error: 'forbidden' };

  const value = body?.value;
  if (value === undefined) return badRequest('A value is required.');

  await env.DB.prepare(
    `INSERT INTO site_content (key, value_json, status, updated_by, updated_at)
     VALUES (?, ?, 'published', ?, ?)
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json,
       updated_by = excluded.updated_by, updated_at = excluded.updated_at`
  ).bind(key, JSON.stringify(value), auth.user.id, nowIso()).run();

  await writeAudit(env, request, {
    actor: auth.user, action: 'pages.update', entityType: 'site_content', entityId: key,
  });
  return ok({});
}

/* ---------------------------------------------------------------------------
   Accounts: parents and staff
   --------------------------------------------------------------------------- */

async function inviteUser(request, env, role, body) {
  const capability = role === 'PARENT' ? 'parents.manage' : 'staff.manage';
  const auth = await authorize(env, request, capability);
  if (auth.error) return auth;
  if (!canAssignRole(auth.user, role)) return { error: 'forbidden' };

  const email = str(body.email).toLowerCase();
  if (!EMAIL_RE.test(email)) return badRequest('Please enter a valid email address.');
  const name = str(body.name).slice(0, 120);

  const dupe = await env.DB.prepare('SELECT id FROM users WHERE email_lower = ?').bind(email).first();
  if (dupe) return badRequest('An account with this email already exists.');

  const userId = newId('usr_');
  await env.DB.prepare(
    `INSERT INTO users (id, email, email_lower, name, role, status, extra_permissions, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'invited', '[]', ?, ?, ?)`
  ).bind(userId, body.email, email, name, role, auth.user.id, nowIso(), nowIso()).run();

  const token = await generateToken();
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days
  await env.DB.prepare(
    `INSERT INTO invitations (id, email_lower, user_id, role, token_hash, expires_at, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(newId('inv_'), email, userId, role, await hashToken(token), expires, auth.user.id, nowIso()).run();

  await writeAudit(env, request, {
    actor: auth.user, action: role === 'PARENT' ? 'parents.invited' : 'staff.invited',
    entityType: 'user', entityId: userId, details: { email, role },
  });

  // The raw token is returned once, for the inviter to send over a channel the
  // recipient controls. It is never stored and is not retrievable again.
  return ok({ userId, invitationToken: token, expiresAt: expires });
}

export const inviteParent = (request, env, body) => inviteUser(request, env, 'PARENT', body);
export const inviteStaff = (request, env, body) =>
  inviteUser(request, env, str(body?.role) === 'SUPER_ADMIN' ? 'SUPER_ADMIN' : 'STAFF_ADMIN', body);

async function listUsers(request, env, role) {
  const capability = role === 'PARENT' ? 'parents.manage' : 'staff.manage';
  const auth = await authorize(env, request, capability);
  if (auth.error) return auth;
  const roleFilter = role === 'PARENT' ? ['PARENT'] : ['SUPER_ADMIN', 'STAFF_ADMIN'];
  const placeholders = roleFilter.map(() => '?').join(',');
  const { results } = await env.DB.prepare(
    `SELECT id, email, name, role, status, last_login_at, created_at
       FROM users WHERE role IN (${placeholders}) ORDER BY created_at DESC`
  ).bind(...roleFilter).all();
  return ok({ users: results.map(publicUser) });
}

export const listParentAccounts = (request, env) => listUsers(request, env, 'PARENT');
export const listStaffAccounts = (request, env) => listUsers(request, env, 'STAFF');

export async function setAccountStatus(request, env, userId, status) {
  if (!env.DB) return notConfigured();
  if (!['active', 'deactivated'].includes(status)) return badRequest('Unknown status.');

  const target = await env.DB.prepare('SELECT id, role, status FROM users WHERE id = ?')
    .bind(userId).first();
  if (!target) return notFound();

  const capability = target.role === 'PARENT' ? 'parents.manage' : 'staff.manage';
  const auth = await authorize(env, request, capability);
  if (auth.error) return auth;
  if (!canManageUser(auth.user, target.role)) return { error: 'forbidden' };

  // A user cannot deactivate themselves, and the last active Super Admin
  // cannot be deactivated — both would be a lock-out.
  if (status === 'deactivated') {
    if (userId === auth.user.id) return badRequest('You cannot deactivate your own account.');
    if (target.role === 'SUPER_ADMIN') {
      const activeSupers = await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM users WHERE role = 'SUPER_ADMIN' AND status = 'active' AND id != ?"
      ).bind(userId).first();
      if ((activeSupers?.n || 0) < 1)
        return badRequest('At least one active Super Admin must remain.');
    }
  }

  await env.DB.prepare('UPDATE users SET status = ?, updated_at = ? WHERE id = ?')
    .bind(status, nowIso(), userId).run();
  if (status === 'deactivated') await destroyAllSessionsFor(env, userId);

  await writeAudit(env, request, {
    actor: auth.user, action: status === 'active' ? 'account.reactivated' : 'account.deactivated',
    entityType: 'user', entityId: userId,
  });
  return ok({});
}

/** Grants or revokes the one delegable capability (contacts.edit). Super Admin only. */
export async function setExtraPermission(request, env, userId, capability, grant) {
  if (!env.DB) return notConfigured();
  const auth = await authorize(env, request, 'roles.assign');
  if (auth.error) return auth;
  if (!isGrantable(capability)) return badRequest('That permission cannot be delegated.');

  const target = await env.DB.prepare('SELECT id, role, extra_permissions FROM users WHERE id = ?')
    .bind(userId).first();
  if (!target || target.role !== 'STAFF_ADMIN')
    return badRequest('That permission can only be granted to a Staff Admin.');

  let extra = [];
  try { extra = JSON.parse(target.extra_permissions || '[]'); } catch { extra = []; }
  extra = grant ? Array.from(new Set([...extra, capability])) : extra.filter(c => c !== capability);

  await env.DB.prepare('UPDATE users SET extra_permissions = ?, updated_at = ? WHERE id = ?')
    .bind(JSON.stringify(extra), nowIso(), userId).run();

  await writeAudit(env, request, {
    actor: auth.user, action: grant ? 'permission.granted' : 'permission.revoked',
    entityType: 'user', entityId: userId, details: { capability },
  });
  return ok({});
}

/* ---------------------------------------------------------------------------
   Audit log — Super Admin only
   --------------------------------------------------------------------------- */

export async function listAuditLog(request, env, cursor) {
  if (!env.DB) return notConfigured();
  const auth = await authorize(env, request, 'audit.read');
  if (auth.error) return auth;

  const limit = 50;
  const rows = cursor
    ? await env.DB.prepare(
        `SELECT id, actor_email, action, entity_type, entity_id, summary, ip, created_at
           FROM audit_log WHERE id < ? ORDER BY id DESC LIMIT ?`
      ).bind(Number(cursor), limit).all()
    : await env.DB.prepare(
        `SELECT id, actor_email, action, entity_type, entity_id, summary, ip, created_at
           FROM audit_log ORDER BY id DESC LIMIT ?`
      ).bind(limit).all();

  const results = rows.results;
  return ok({
    entries: results,
    nextCursor: results.length === limit ? results[results.length - 1].id : null,
  });
}
