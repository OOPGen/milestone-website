/* Media upload: gallery photos and PDF documents.

   Validates file type, size, and (for images) dimensions before anything is
   written to R2. Optimisation of public images (resize/reencode) is deferred
   to a real Cloudflare account — see ACCOUNT-SYSTEM-PLAN.md section 8 — so
   this route validates and stores as-is for now. */

import { ok, badRequest, notConfigured, str, nowIso } from '../lib/http.js';
import { authorize } from '../lib/auth.js';
import { newId } from '../lib/crypto.js';
import { writeAudit } from '../lib/audit.js';

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_PDF_BYTES = 20 * 1024 * 1024;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_DIMENSION = 6000;
const MIN_DIMENSION = 40;

/** Reads width/height from PNG/JPEG headers without a decoding library. */
function readImageDimensions(bytes, contentType) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (contentType === 'image/png' && bytes.length > 24 &&
      bytes[0] === 0x89 && bytes[1] === 0x50) {
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (contentType === 'image/jpeg') {
    let offset = 2;
    while (offset < bytes.length - 8) {
      if (bytes[offset] !== 0xFF) break;
      const marker = bytes[offset + 1];
      if (marker >= 0xC0 && marker <= 0xC3) {
        return { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) };
      }
      offset += 2 + view.getUint16(offset + 2);
    }
  }
  return null; // WebP and anything unrecognised: skip dimension validation
}

export async function uploadMedia(request, env) {
  if (!env.DB || !env.MEDIA) return notConfigured();
  const auth = await authorize(env, request, 'media.upload');
  if (auth.error) return auth;

  const contentType = request.headers.get('Content-Type') || '';
  if (!contentType.startsWith('multipart/form-data'))
    return badRequest('Expected a multipart file upload.');

  let form;
  try { form = await request.formData(); } catch { return badRequest('Could not read the upload.'); }

  const file = form.get('file');
  if (!(file instanceof File)) return badRequest('No file was provided.');

  const visibility = form.get('visibility') === 'public' ? 'public' : 'parents';
  const isImage = IMAGE_TYPES.has(file.type);
  const isPdf = file.type === 'application/pdf';
  if (!isImage && !isPdf)
    return badRequest('Only JPEG, PNG, WebP images or PDF documents are accepted.');

  const maxBytes = isPdf ? MAX_PDF_BYTES : MAX_IMAGE_BYTES;
  if (file.size > maxBytes)
    return badRequest(`File is too large (max ${Math.round(maxBytes / 1024 / 1024)}MB).`);
  if (file.size === 0) return badRequest('The file is empty.');

  const bytes = new Uint8Array(await file.arrayBuffer());
  let width = null, height = null;

  if (isImage) {
    const dims = readImageDimensions(bytes, file.type);
    if (dims) {
      ({ width, height } = dims);
      if (width > MAX_DIMENSION || height > MAX_DIMENSION)
        return badRequest(`Image is too large (max ${MAX_DIMENSION}px on a side).`);
      if (width < MIN_DIMENSION || height < MIN_DIMENSION)
        return badRequest('Image is too small to publish.');
    }
  }

  const assetId = newId('ast_');
  const ext = isPdf ? 'pdf' : file.type.split('/')[1];
  const r2Key = `${visibility}/${assetId}.${ext}`;

  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const checksum = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');

  await env.MEDIA.put(r2Key, bytes, { httpMetadata: { contentType: file.type } });

  await env.DB.prepare(
    `INSERT INTO assets (id, r2_key, filename, content_type, size_bytes, width, height,
                          visibility, checksum, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    assetId, r2Key, str(file.name).slice(0, 200) || 'upload', file.type, file.size,
    width, height, visibility, checksum, auth.user.id, nowIso()
  ).run();

  await writeAudit(env, request, {
    actor: auth.user, action: isPdf ? 'documents.uploaded' : 'gallery.uploaded',
    entityType: 'asset', entityId: assetId,
    details: { filename: file.name, size: file.size, visibility },
  });

  return ok({ asset: { id: assetId, width, height, visibility, contentType: file.type } });
}
