// ============================================================================
// manage-media — SCAFFOLD ONLY. Not deployed. Not implemented. No real
// service-role key is present or used here.
//
// SOLE server-side authority for the entire media/document lifecycle —
// create, edit, publish, archive, set-cover, replace-photo-bytes,
// soft-delete AND hard-delete.
// After the RLS changes in supabase/policies/galleries_and_photos.sql,
// supabase/policies/documents_and_versions.sql and
// supabase/storage/buckets.sql, a browser session holding the publishable
// (anon) key has NO grant to:
//   - INSERT / UPDATE / DELETE storage.objects in ANY of the three buckets
//     (there is not a single client-side write policy left on
//     storage.objects — not even the two update-by-staff policies that used
//     to allow overwriting object bytes in place)
//   - INSERT, UPDATE or DELETE public.gallery_photos
//   - INSERT, UPDATE or DELETE public.documents
//   - INSERT or DELETE public.document_versions (and none may ever UPDATE one)
//   - UPDATE public.galleries.cover_storage_path (pinned immutable by the
//     galleries_update_by_staff WITH CHECK via
//     public.gallery_current_cover_path())
//   - DELETE public.galleries
//   - INSERT public.audit_log (no client policy has ever existed)
// so every one of the operations below is reachable ONLY through this
// function, which authenticates the caller, validates the request, and then
// performs the privileged writes with a service-role client (bypassing RLS
// the same way invite-staff / invite-parent already do). There is no
// remaining direct RLS write path to storage.objects at all — not INSERT,
// not UPDATE, not DELETE, not for Super Admin.
//
// This function is therefore the single place that:
//   - generates Storage object paths
//   - uploads Storage objects
//   - overwrites an existing Storage object's BYTES in place
//     (replace_photo_bytes — same server-derived path, nothing else changes)
//   - inserts gallery_photos rows
//   - creates documents rows (when a document is first uploaded)
//   - creates document_versions rows
//   - advances documents.current_version_id
//   - sets public.galleries.cover_storage_path (from a gallery_photo_id,
//     never a caller-supplied path)
//   - transitions status (draft -> published -> archived) for photos/documents
//   - soft-deletes (deleted_at) photos/documents
//   - hard-deletes photos / documents / albums and their Storage objects
//   - records audit_log events for all of the above
//
// What the CMS (admin dashboard) is allowed to send — and nothing else:
//   - operation      : 'upload' | 'replace' | 'publish' | 'archive'
//                      | 'soft_delete' | 'delete' | 'set_gallery_cover'
//                      | 'replace_photo_bytes'
//   - contentType    : 'gallery_photo' | 'document'  (not used by
//                      set_gallery_cover / replace_photo_bytes)
//   - visibility     : 'public' | 'parents_only'   (upload/replace only —
//                      NEVER accepted for replace_photo_bytes; the bucket
//                      there is derived from the photo's own gallery)
//   - targetRecordId : gallery id (gallery_photo) or document id (document);
//                      for 'upload' of a brand-new document this is omitted
//                      and a new documents row is created instead
//   - objectId       : the gallery_photos.id / documents.id being
//                      published/archived/soft_deleted/deleted
//   - galleryId + galleryPhotoId : set_gallery_cover only — the album to
//                      set a cover on, and the photo to use as that cover
//                      (or galleryPhotoId = null to clear the cover). A raw
//                      storage path is NEVER accepted.
//   - galleryPhotoId + the file : replace_photo_bytes only — which photo's
//                      bytes to overwrite, and the new image. The client
//                      sends NOTHING else: no bucket, no storagePath, no
//                      galleryId, no visibility, no status.
//   - (upload/replace/replace_photo_bytes) the file, as multipart/form-data
// A `bucket` field is REJECTED outright (not ignored) if present — see
// bucket_override_rejected below. "visibility" is the CMS's own vocabulary
// ('parents_only'); toDbVisibility() maps it to the DB enum ('parents') so a
// raw DB literal can never pass through unvalidated.
//
// Bucket derivation is a fixed, exhaustive map (below). There is no
// 'document:*' -> 'public-media' entry and no 'gallery_photo:parents_only'
// -> 'public-media' entry: a PDF or a parents-only photo reaching
// public-media is not "rejected by a check", it is a case the map cannot
// express.
//
// ATOMICITY — stated honestly. Supabase Storage (S3-backed object store) and
// Postgres are two independent systems with no shared transaction. This
// function CANNOT provide true cross-service atomicity and does not claim
// to. What it does provide:
//   * The DB side is atomic. All multi-row DB work for an operation runs
//     inside ONE Postgres SECURITY DEFINER function (see the RPC names in
//     each branch below, e.g. manage_media_create_document_version) called
//     with the service-role client — so "insert documents + insert
//     document_versions + set current_version_id" is all-or-nothing.
//   * The Storage<->DB boundary uses upload-first, then DB, then
//     compensating delete on DB failure. Failure windows and their handling
//     are enumerated in each branch and summarised at the bottom of this
//     file.
//   * Nothing is ever published in the same step it is uploaded. 'upload'
//     and 'replace' always land content as status='draft' (or leave an
//     existing document's status untouched); a separate 'publish' operation
//     re-verifies that BOTH the Storage object and the metadata row exist
//     (and, for a document, that current_version_id points at a version
//     whose object is present) before flipping status to 'published'.
// ============================================================================

import { createClient } from 'jsr:@supabase/supabase-js@2';

// ---- validation constants, mirrored exactly from worker/routes/media.js ----
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;   // 8 MiB
const MAX_PDF_BYTES = 20 * 1024 * 1024;    // 20 MiB
const IMAGE_MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};
const PDF_MIME_TYPE = 'application/pdf';

type ContentType = 'gallery_photo' | 'document';
type CmsVisibility = 'public' | 'parents_only';
type Operation =
  | 'upload' | 'replace' | 'publish' | 'archive'
  | 'soft_delete' | 'delete' | 'set_gallery_cover' | 'replace_photo_bytes';

// The one and only place a bucket name is decided for a NEW object.
const BUCKET_BY_CONTENT_AND_VISIBILITY: Record<string, string> = {
  'gallery_photo:public': 'public-media',
  'gallery_photo:parents_only': 'parent-media',
  'document:public': 'school-documents',
  'document:parents_only': 'school-documents',
};

// And for an EXISTING gallery photo whose bytes are being replaced, the
// bucket is derived from the photo's own gallery visibility (DB enum) — the
// exact same two targets, keyed by a value the client never supplies.
const PHOTO_BUCKET_BY_DB_VISIBILITY: Record<string, string> = {
  'public': 'public-media',
  'parents': 'parent-media',
};

// CMS vocabulary -> database enum (public.content_visibility is
// ('public', 'parents'), not ('public', 'parents_only')).
function toDbVisibility(v: CmsVisibility): 'public' | 'parents' {
  return v === 'public' ? 'public' : 'parents';
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ ok: false, error: 'unauthorized' }, 401);

  // Caller-scoped client: identifies who is calling and reads rows through
  // their OWN RLS-limited view. Never used to write. The `admin`
  // (service-role) client is created only after every check here passes.
  const caller = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  );
  const { data: userData, error: userErr } = await caller.auth.getUser();
  if (userErr || !userData?.user) return json({ ok: false, error: 'unauthorized' }, 401);

  const { data: callerProfile } = await caller
    .from('profiles')
    .select('id, email, role, status')
    .eq('id', userData.user.id)
    .single();

  const isActiveStaff = callerProfile?.status === 'active' &&
    (callerProfile.role === 'STAFF_ADMIN' || callerProfile.role === 'SUPER_ADMIN');
  if (!isActiveStaff) return json({ ok: false, error: 'forbidden' }, 403);

  // TODO (implementation): 'upload'/'replace' arrive as multipart/form-data
  // (file + these fields as form fields); the rest arrive as plain JSON.
  let body: {
    operation?: Operation;
    contentType?: ContentType;
    visibility?: CmsVisibility;
    targetRecordId?: string;
    objectId?: string;
    caption?: string;
    galleryId?: string;              // set_gallery_cover only
    galleryPhotoId?: string | null;  // set_gallery_cover / replace_photo_bytes
    bucket?: unknown;                // typed so its presence is visible below
    storagePath?: unknown;           // ditto — a caller-supplied path is refused
    coverStoragePath?: unknown;      // ditto
  };
  try {
    body = await req.json(); // TODO: multipart parsing for upload/replace/replace_photo_bytes
  } catch {
    return json({ ok: false, error: 'bad_request' }, 400);
  }

  // Reject — not silently ignore — any caller-supplied bucket name or raw
  // Storage path. The client never names a bucket and never names an object
  // path; the server derives both.
  if ('bucket' in body) return json({ ok: false, error: 'bucket_override_rejected' }, 400);
  if ('storagePath' in body || 'coverStoragePath' in body) {
    return json({ ok: false, error: 'storage_path_override_rejected' }, 400);
  }

  const operation = body.operation;
  const contentType = body.contentType;
  const OPERATIONS: Operation[] = [
    'upload', 'replace', 'publish', 'archive',
    'soft_delete', 'delete', 'set_gallery_cover', 'replace_photo_bytes',
  ];
  if (!operation || !OPERATIONS.includes(operation)) {
    return json({ ok: false, error: 'invalid_operation' }, 400);
  }

  // For replace_photo_bytes the client must NOT send a visibility (or a
  // bucket / path, already rejected above) — the bucket and path are both
  // derived from the trusted gallery_photos / galleries rows. Reject an
  // attempted override rather than ignore it.
  if (operation === 'replace_photo_bytes' && 'visibility' in body) {
    return json({ ok: false, error: 'visibility_override_rejected' }, 400);
  }

  // contentType is required for every operation EXCEPT set_gallery_cover and
  // replace_photo_bytes (which operate on a photo id, not a content-type
  // stream).
  const CONTENT_TYPE_OPTIONAL_OPS = new Set(['set_gallery_cover', 'replace_photo_bytes']);
  if (!CONTENT_TYPE_OPTIONAL_OPS.has(operation) &&
      contentType !== 'gallery_photo' && contentType !== 'document') {
    return json({ ok: false, error: 'invalid_content_type' }, 400);
  }

  // 'delete' is a real Storage-object + row removal (irreversible). It is
  // Super-Admin-only, enforced HERE in code — there is no longer ANY RLS
  // DELETE policy on gallery_photos / documents / document_versions /
  // galleries or on storage.objects for any bucket, so this function is the
  // sole deletion path and this check is the sole gate on it.
  // 'soft_delete' (sets deleted_at, leaves the object in place, recoverable)
  // is allowed for any active staff — the direct-table UPDATE that used to
  // do this has been removed, so it comes through here to be audited.
  if (operation === 'delete' && callerProfile.role !== 'SUPER_ADMIN') {
    return json({ ok: false, error: 'forbidden' }, 403);
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  // ---------------------------------------------------------------- upload
  if (operation === 'upload' || operation === 'replace') {
    if (body.visibility !== 'public' && body.visibility !== 'parents_only') {
      return json({ ok: false, error: 'invalid_visibility' }, 400);
    }
    const dbVisibility = toDbVisibility(body.visibility);
    const bucket = BUCKET_BY_CONTENT_AND_VISIBILITY[`${contentType}:${body.visibility}`];
    if (!bucket) return json({ ok: false, error: 'invalid_content_type_visibility_pair' }, 400);

    // 1. VALIDATE TARGET RECORD (caller client, RLS-respecting).
    //    gallery_photo -> body.targetRecordId is a galleries.id, which must
    //      exist, not be soft-deleted, and have visibility === dbVisibility
    //      (so a caller cannot claim 'public' for a parents-only album and
    //      have the photo land in public-media).
    //    document + 'replace' -> body.targetRecordId is a documents.id with
    //      the same existence / not-deleted / visibility-match checks.
    //    document + 'upload' (brand new) -> no targetRecordId; a new
    //      documents row is created in step 3 with visibility = dbVisibility
    //      and status = 'draft'.
    //
    //   const table = contentType === 'gallery_photo' ? 'galleries' : 'documents';
    //   if (body.targetRecordId) {
    //     const { data: target } = await caller.from(table)
    //       .select('id, visibility, deleted_at').eq('id', body.targetRecordId).single();
    //     if (!target || target.deleted_at) return json({ ok:false, error:'target_not_found' }, 404);
    //     if (target.visibility !== dbVisibility) return json({ ok:false, error:'visibility_mismatch' }, 409);
    //   }

    // 2. VALIDATE FILE (type + size), mirroring worker/routes/media.js.
    //   const isImage = contentType === 'gallery_photo';
    //   const mimeType = file.type;
    //   if (isImage && !(mimeType in IMAGE_MIME_TO_EXT)) return json({ ok:false, error:'unsupported_image_type' }, 415);
    //   if (!isImage && mimeType !== PDF_MIME_TYPE)       return json({ ok:false, error:'unsupported_document_type' }, 415);
    //   const maxBytes = isImage ? MAX_IMAGE_BYTES : MAX_PDF_BYTES;
    //   if (file.size === 0 || file.size > maxBytes) return json({ ok:false, error:'invalid_file_size' }, 413);

    // 3. GENERATE OBJECT PATH server-side — the client filename is NEVER
    //    used to build a path (only, optionally, sanitised to a display
    //    caption/note capped at 200 chars, like worker/routes/media.js's
    //    str(file.name).slice(0, 200)).
    //   const ext = isImage ? IMAGE_MIME_TO_EXT[mimeType] : 'pdf';
    //   const objectPath = `${dbVisibility}/${crypto.randomUUID()}.${ext}`;

    // 4. UPLOAD OBJECT FIRST (service-role), non-destructive:
    //   const up = await admin.storage.from(bucket)
    //     .upload(objectPath, bytes, { contentType: mimeType, upsert: false });
    //   if (up.error) return json({ ok:false, error:'storage_upload_failed' }, 502);
    //   // At this point exactly one thing exists: the object. No metadata yet.

    // 5. DB WRITE, atomic, via ONE SECURITY DEFINER RPC (service-role):
    //    gallery_photo:
    //      manage_media_add_gallery_photo(p_gallery_id, p_storage_path,
    //        p_caption, p_actor) -> inserts gallery_photos(status='draft')
    //        and returns the new id, in one statement/txn.
    //    document + 'upload' (new document):
    //      manage_media_create_document_with_version(p_title, p_category,
    //        p_visibility, p_storage_path, p_actor) -> inserts documents
    //        (status='draft'), inserts document_versions(version=1),
    //        sets documents.current_version_id, all in one txn; returns ids.
    //    document + 'replace':
    //      manage_media_add_document_version(p_document_id, p_storage_path,
    //        p_actor) -> inserts document_versions(version = max+1), sets
    //        documents.current_version_id, one txn; returns the new version id.
    //
    //   const rpc = await admin.rpc(<name>, <args>);
    //   if (rpc.error) {
    //     // 5a. COMPENSATE: the object from step 4 now has no metadata.
    //     const rm = await admin.storage.from(bucket).remove([objectPath]);
    //     if (rm.error) {
    //       // 5b. Cleanup itself failed -> record it for a later sweep,
    //       //     never leave this silent. The object is unreachable by any
    //       //     read policy (every read requires a matching metadata row),
    //       //     so it is invisible and harmless but wastes storage.
    //       await writeAuditLog(admin, { actorId: callerProfile.id, actorEmail: callerProfile.email,
    //         action: 'media.orphan_cleanup_failed', entityType: 'storage_object',
    //         entityId: `${bucket}/${objectPath}`, summary: 'upload ok, metadata failed, object delete failed' });
    //     }
    //     return json({ ok:false, error:'metadata_write_failed' }, 502);
    //   }

    // 6. AUDIT (service-role). A failure here does NOT roll back: the
    //    content exists and is valid draft; a missing audit row is the
    //    lesser evil than destroying good content. Return ok with a warning.
    //   await writeAuditLog(admin, { actorId: callerProfile.id, actorEmail: callerProfile.email,
    //     action: contentType === 'gallery_photo' ? 'gallery.photo_added'
    //           : operation === 'upload' ? 'content.create' : 'documents.version_added',
    //     entityType: contentType === 'gallery_photo' ? 'gallery_photo' : 'document',
    //     entityId: <new id>, summary: `${contentType} ${operation} into ${bucket} (draft)` });

    // 7. Result: content exists as DRAFT. Not visible to anon/parent yet.
    //    Publishing is a separate 'publish' call.
  }

  // --------------------------------------------------------------- publish
  if (operation === 'publish') {
    // Re-verify BOTH layers before making anything visible:
    //   1. Load the row (gallery_photos.id / documents.id = body.objectId)
    //      with the admin client; 404 if missing or already deleted_at.
    //   2. Resolve the storage_path that must be live:
    //        gallery_photo -> gallery_photos.storage_path
    //        document      -> document_versions.storage_path WHERE
    //                         document_versions.id = documents.current_version_id
    //      404 / 409 if current_version_id is null (nothing uploaded yet).
    //   3. Confirm the object actually exists:
    //        admin.storage.from(bucket).list(dirname(storage_path)) or a
    //        HEAD via createSignedUrl — if the object is missing, refuse to
    //        publish (error 'object_missing'); this is the check that stops
    //        a draft row whose upload silently failed from ever going live.
    //   4. Only then: update status='published', published_at=now() via a
    //      manage_media_set_status(p_table, p_id, 'published', p_actor) RPC.
    //   5. writeAuditLog(admin, { ..., action: 'content.update',
    //        summary: 'status -> published' }).
  }

  // --------------------------------------------------------------- archive
  if (operation === 'archive') {
    // update status='archived', archived_at=now() via
    // manage_media_set_status(...); writeAuditLog action 'content.update',
    // summary 'status -> archived'. No Storage change. Reversible by a
    // later 'publish'.
  }

  // ----------------------------------------------------------- soft_delete
  if (operation === 'soft_delete') {
    // set deleted_at=now() via manage_media_set_status(...); the Storage
    // object is LEFT in place (recoverable). writeAuditLog action
    // 'content.soft_delete'. Any active staff (not just Super Admin) —
    // this replaces the direct-table UPDATE that previously did it
    // un-audited.
  }

  // ---------------------------------------------------------------- delete
  if (operation === 'delete') {
    // Hard, irreversible. Super-Admin only (checked above). This is the ONLY
    // deletion path in the whole system — no RLS DELETE policy exists on any
    // media/document table or on storage.objects, so a browser client
    // (Super Admin included) cannot reach this by any other route.
    //   1. Load the row (gallery_photos.id / documents.id = body.objectId)
    //      with the admin client; 404 if missing. contentType tells us which
    //      table. (An album delete — contentType omitted, galleryId given —
    //      cascades to its gallery_photos via manage_media_hard_delete.)
    //   2. Resolve EVERY storage_path the row owns: a gallery_photo has one;
    //      a document has one per document_versions row (superseded versions
    //      included).
    //   3. admin.storage.from(bucket).remove([...paths]).
    //   4. Delete the metadata row(s) via
    //      manage_media_hard_delete(p_table, p_id, p_actor) — one txn; nulls
    //      documents.current_version_id first to satisfy the FK, cascades
    //      document_versions / gallery_photos.
    //   5. If step 3 left any object behind, still delete the rows, then
    //      writeAuditLog action 'media.orphan_cleanup_failed' per leftover
    //      path (the object is now unreachable by every read policy — wasted
    //      bytes only; a sweep job reclaims it).
    //   6. writeAuditLog action 'content.delete_hard'.
  }

  // ------------------------------------------------------- set_gallery_cover
  if (operation === 'set_gallery_cover') {
    // Set (or clear) public.galleries.cover_storage_path. The client sends
    // galleryId + galleryPhotoId (or galleryPhotoId = null to clear) — NEVER
    // a path. galleries_update_by_staff's WITH CHECK pins cover_storage_path
    // immutable for a client UPDATE, so this is the only way it ever changes.
    // Any active staff may do it.
    //   1. Require body.galleryId. Load the album with the admin client;
    //      404 if missing or deleted_at is set.
    //   2. If body.galleryPhotoId is null -> clear:
    //        manage_media_set_gallery_cover(p_gallery_id, NULL, p_actor)
    //        sets cover_storage_path = NULL. Go to step 5.
    //   3. Otherwise load the photo (gallery_photos.id = body.galleryPhotoId)
    //      with the admin client and VERIFY, all server-side:
    //        - it exists                                  (else 404 photo_not_found)
    //        - photo.gallery_id === body.galleryId        (else 409 photo_wrong_gallery)
    //        - photo.deleted_at is null                   (else 409 photo_deleted)
    //        - photo.status === 'published'               (else 409 photo_not_eligible)
    //          i.e. a draft/pending photo cannot be a cover — same
    //          "nothing visible until the workflow completes" rule
    //        - (belt-and-braces) photo.storage_path is non-empty
    //   4. DERIVE the path server-side from the verified row —
    //      photo.storage_path — and write it:
    //        manage_media_set_gallery_cover(p_gallery_id,
    //          <photo.storage_path>, p_actor)
    //      The caller's input never contributes a path or a bucket.
    //   5. writeAuditLog(admin, { action: 'content.update',
    //        entityType: 'gallery', entityId: body.galleryId,
    //        summary: body.galleryPhotoId ? 'cover set' : 'cover cleared' }).
    //   6. If a gallery has no eligible photo, cover_storage_path simply
    //      stays / becomes NULL — never a stale or guessed value.
  }

  // --------------------------------------------------- replace_photo_bytes
  if (operation === 'replace_photo_bytes') {
    // Overwrite the BYTES of an existing gallery photo's object, in place,
    // at its own already-stored path. NOTHING else changes: not the storage
    // path, not gallery_id, not visibility, not status, not caption, not
    // sort_order, not any cover_storage_path that points at it. The client
    // sends only body.galleryPhotoId + the replacement file — no bucket, no
    // storagePath, no coverStoragePath, no galleryId, no visibility, no
    // status (a `visibility` field is rejected up front with
    // visibility_override_rejected; bucket / storagePath / coverStoragePath
    // are rejected with the generic overrides above).
    //
    //   1. AUTHORISE: active Staff Admin or Super Admin (already checked by
    //      the isActiveStaff gate near the top — replace_photo_bytes needs
    //      no extra role beyond that; it is not Super-Admin-only).
    //
    //   2. LOAD THE PHOTO server-side with the admin client and CONFIRM:
    //        const { data: photo } = await admin.from('gallery_photos')
    //          .select('id, gallery_id, storage_path, deleted_at')
    //          .eq('id', body.galleryPhotoId).single();
    //        - photo exists                       (else 404 photo_not_found)
    //        - photo.deleted_at is null           (else 409 photo_deleted)
    //        - photo.storage_path is a non-empty string
    //                                             (else 409 photo_has_no_object)
    //
    //   3. LOAD ITS GALLERY server-side and CONFIRM:
    //        const { data: gallery } = await admin.from('galleries')
    //          .select('id, visibility, deleted_at')
    //          .eq('id', photo.gallery_id).single();
    //        - gallery exists                     (else 409 gallery_not_found)
    //        - gallery.deleted_at is null         (else 409 gallery_deleted)
    //
    //   4. DERIVE THE BUCKET from the gallery's own visibility — never from
    //      anything the client sent:
    //        const bucket = PHOTO_BUCKET_BY_DB_VISIBILITY[gallery.visibility];
    //        // 'public'  -> 'public-media'
    //        // 'parents' -> 'parent-media'
    //        if (!bucket) return json({ ok:false, error:'unmappable_visibility' }, 409);
    //      A parents-only photo therefore can NEVER be written into
    //      public-media through this operation: the map has no entry that
    //      would take it there, and the client cannot influence the key.
    //      (Belt-and-braces: assert the photo.storage_path prefix is
    //      consistent with `${gallery.visibility === 'public' ? 'public' :
    //      'parents'}/` — if a legacy row's path and its gallery's
    //      visibility disagree, refuse with path_visibility_mismatch rather
    //      than write to a bucket the row does not already live in.)
    //
    //   5. VALIDATE THE NEW FILE, mirroring worker/routes/media.js:
    //        - mimeType in IMAGE_MIME_TO_EXT   (else 415 unsupported_image_type)
    //        - 0 < file.size <= MAX_IMAGE_BYTES (else 413 invalid_file_size)
    //      No PDF / document path here — this operation is images only.
    //
    //   6. OVERWRITE BYTES at the SAME path (upsert, no path change):
    //        const up = await admin.storage.from(bucket)
    //          .update(photo.storage_path, bytes, { contentType: mimeType });
    //        // (or .upload(path, bytes, { upsert: true }))
    //        if (up.error) return json({ ok:false, error:'storage_replace_failed' }, 502);
    //      NOTE: no metadata write follows. Because only bytes changed and
    //      the path is identical, there is nothing in gallery_photos /
    //      galleries to update — so this operation needs NO database
    //      transaction at all. (10) If the object write fails, we simply
    //      return the error and touch no database row.
    //
    //   7. AUDIT (service-role): writeAuditLog(admin, {
    //        actorId: callerProfile.id, actorEmail: callerProfile.email,
    //        action: 'gallery.photo_bytes_replaced', entityType: 'gallery_photo',
    //        entityId: photo.id,
    //        summary: `bytes replaced in ${bucket} at ${photo.storage_path}` });
    //      An audit-insert failure returns ok + warning (the bytes are
    //      already validly replaced; destroying the new image to fix a
    //      missing log line would be worse).
    //
    // (12) A "replace that changes the file's identity/path" — e.g. a
    // different format, or a policy that every replacement gets a fresh
    // UUID for cache-busting — is deliberately NOT this operation. That is a
    // future separate controlled workflow: upload a new object at a new
    // server-generated path, update gallery_photos.storage_path in one RPC,
    // fix any cover_storage_path that pointed at the old path, delete the
    // old object, audit 'gallery.photo_replaced'. It needs a DB transaction;
    // replace_photo_bytes does not.
  }

  return json({ ok: false, error: 'not_implemented' }, 501);
});

// TODO (implementation): mirrors worker/lib/audit.js's writeAudit(). Insert
// into public.audit_log via the admin (service-role) client ONLY — no
// client-side INSERT policy exists on audit_log, so this is the sole write
// path, matching the Cloudflare design's append-only, server-only rule.
async function writeAuditLog(
  admin: ReturnType<typeof createClient>,
  entry: { actorId: string; actorEmail: string | null; action: string; entityType: string; entityId: string; summary?: string }
) {
  // await admin.from('audit_log').insert({ actor_id: entry.actorId, actor_email: entry.actorEmail,
  //   action: entry.action, entity_type: entry.entityType, entity_id: entry.entityId,
  //   summary: entry.summary ?? '' });
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

// ============================================================================
// FAILURE / CLEANUP MATRIX
//
// -- upload & replace --------------------------------------------------------
//  step that fails            state left behind                 handling
//  -----------------------    -----------------------------      ---------------------------
//  auth / validation          nothing written                   return 4xx, no side effects
//  4. storage upload          nothing written                   return 502, no side effects
//  5. DB RPC (atomic)         object exists, no metadata         5a: delete the object
//  5a. compensating delete    object exists, no metadata,        5b: audit 'media.orphan_
//                             metadata still absent                  cleanup_failed' + sweep;
//                                                                    object is unreachable by
//                                                                    every read policy, so it
//                                                                    is invisible, just wasted
//                                                                    bytes
//  6. audit insert            content exists as valid DRAFT,     return ok + warning; a
//                             audit row missing                     reconciliation job can
//                                                                    backfill from Storage +
//                                                                    row timestamps
//  publish step 3 (object     draft row exists, object missing   refuse to publish
//  existence check)                                              ('object_missing'); draft
//                                                                    never becomes visible
//
// -- delete (the sole deletion path) --------------------------------------
//  step that fails            state left behind                 handling
//  -----------------------    -----------------------------      ---------------------------
//  auth (not Super Admin)     nothing written                   return 403
//  1. row load                nothing written                   return 404
//  3. storage remove          some objects still present,        proceed to step 4 anyway
//     (partial)               rows not yet deleted                  (do not leave half a
//                                                                    delete); then per
//                                                                    leftover path audit
//                                                                    'media.orphan_cleanup_
//                                                                    failed'
//  4. DB RPC (atomic)         objects already removed, rows      return 502; the rows are
//                             still present                         still readable/consistent
//                                                                    but their objects are
//                                                                    gone -> reads 404 the
//                                                                    file. audit
//                                                                    'media.orphan_cleanup_
//                                                                    failed' (inverse case)
//                                                                    + a retry of the RPC is
//                                                                    safe (idempotent delete)
//  6. audit insert            delete completed, audit missing    return ok + warning
//
// -- set_gallery_cover --------------------------------------------------
//  step that fails            state left behind                 handling
//  -----------------------    -----------------------------      ---------------------------
//  1. album not found         nothing written                   return 404
//  3. photo checks fail       nothing written                   return 404 / 409
//     (missing / wrong        (cover_storage_path unchanged)        as listed in the branch
//     gallery / deleted /
//     not published)
//  4. DB RPC                  cover unchanged                    return 502; retry is safe
//  5. audit insert            cover set, audit missing           return ok + warning
//  no eligible photo          cover_storage_path stays NULL      by design — never a stale
//                                                                    or guessed value
//
// -- replace_photo_bytes -----------------------------------------------
//  step that fails            state left behind                 handling
//  -----------------------    -----------------------------      ---------------------------
//  auth (not active staff)    nothing written                   return 403
//  2/3. photo/gallery checks  nothing written                   return 404 / 409
//     (missing / deleted /    (object bytes unchanged)             as listed in the branch
//     no path / gallery gone)
//  4. bucket derivation       nothing written                   return 409
//     (unmappable / path-vs-  (object bytes unchanged)             (never write to a bucket
//     visibility mismatch)                                          the row does not live in)
//  5. file validation         nothing written                   return 413 / 415
//     (type / size)           (object bytes unchanged)
//  6. storage overwrite       OLD bytes still in place at the    return 502; NO database row
//     fails                   same path, everything consistent     is touched (requirement 10)
//  7. audit insert            NEW bytes live, audit row missing  return ok + warning
//
//  There is NO database transaction in this branch: only object bytes
//  change, at an identical path, so gallery_photos / galleries have nothing
//  to update (requirement 11). The only cross-service seam is "bytes
//  written, audit row missing" (step 7) — handled by ok + warning, same as
//  everywhere else.
//
// RESIDUAL NON-ATOMICITY (documented, not hidden): across the branches that
// DO touch both systems (upload / replace / delete), Storage and Postgres
// have no shared transaction. A Storage delete can fail after the DB side
// has committed, so an orphaned OBJECT (never an orphaned visible RECORD)
// can outlive its metadata; conversely a DB failure after objects were
// removed leaves rows whose files 404. Neither is reachable as private
// content through any RLS read policy. The compensating controls are the
// 'media.orphan_cleanup_failed' audit action, idempotent retryable RPCs,
// and a periodic bucket-vs-storage_path reconciliation sweep. Deletion is
// NOT claimed to be fully cross-service atomic. replace_photo_bytes is the
// one write operation with NO such seam beyond the (best-effort, non-
// blocking) audit insert, because it changes bytes only.
// ============================================================================
