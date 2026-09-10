/* Static validation of supabase/functions/manage-media/index.ts — the
   privileged upload/replace/publish/archive/delete Edge Function scaffold
   (Decision 2: "enforce bucket selection server-side"). Like the other
   Edge Function scaffolds in this project, it is Deno source
   (`Deno.serve`, `jsr:` imports) that is NOT deployed and NOT implemented
   (every real branch ends in a TODO comment, not executable logic) — there
   is no Deno runtime here to execute it against, and there must not be:
   this suite never calls Supabase, never touches a bucket, and never runs
   the function. It only reads the .ts file as text and checks it, the same
   discipline tests/supabase-sql.test.mjs already applies to the SQL files.

   What this proves, and what it cannot: these checks confirm the SOURCE
   TEXT contains the intended bucket-derivation map, the intended
   role/authorisation gates, and no service-role key outside this
   server-only file. They cannot prove the (not-yet-written) TODO'd
   implementation behaves correctly at runtime — that requires an
   integration test against a real (or emulated) Supabase project, which is
   explicitly out of scope until this design is applied and reviewed. */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const pass = [], fail = [];
const ok = (n, c, d = '') => (c ? pass : fail).push(n + (d ? ' — ' + d : ''));

const fnPath = path.join(root, 'supabase', 'functions', 'manage-media', 'index.ts');
ok('supabase/functions/manage-media/index.ts exists', fs.existsSync(fnPath));
const src = fs.existsSync(fnPath) ? fs.readFileSync(fnPath, 'utf8') : '';

/* ---------- scaffold-only safety banner (matches the other 5 functions) ---------- */

ok('carries the "SCAFFOLD ONLY" banner', src.includes('SCAFFOLD ONLY'));
ok('carries the "Not deployed" banner', /not deployed/i.test(src));

/* ---------- bucket derivation is a fixed, exhaustive map ---------- */
// The whole point of Decision 2: there is exactly one place a bucket name
// is chosen, and it is keyed by (contentType, visibility) — never by a
// caller-supplied value.

const mapBlockMatch = src.match(/BUCKET_BY_CONTENT_AND_VISIBILITY[^{]*\{([\s\S]*?)\};/);
ok('BUCKET_BY_CONTENT_AND_VISIBILITY map is defined', !!mapBlockMatch);
const mapBlock = mapBlockMatch ? mapBlockMatch[1] : '';

const REQUIRED_MAPPINGS = [
  ["'gallery_photo:public'", "'public-media'"],
  ["'gallery_photo:parents_only'", "'parent-media'"],
  ["'document:public'", "'school-documents'"],
  ["'document:parents_only'", "'school-documents'"],
];
for (const [key, bucket] of REQUIRED_MAPPINGS) {
  const re = new RegExp(`${key}\\s*:\\s*${bucket}`);
  ok(`bucket map: ${key} -> ${bucket}`, re.test(mapBlock));
}
// Exactly 4 entries — no fifth, silently-added mapping.
const entryCount = (mapBlock.match(/:\s*'[a-z-]+',?/g) || []).length;
ok('bucket map has exactly 4 entries (no undocumented extra mapping)', entryCount === 4, `found ${entryCount}`);

// A parent-only upload (of either content type) can never resolve to
// public-media, and a document can never resolve to public-media either —
// structurally, not just "rejected by a check": there is no key for it.
ok('gallery_photo:parents_only never maps to public-media', !/'gallery_photo:parents_only'\s*:\s*'public-media'/.test(mapBlock));
ok('document:public never maps to public-media', !/'document:public'\s*:\s*'public-media'/.test(mapBlock));
ok('document:parents_only never maps to public-media', !/'document:parents_only'\s*:\s*'public-media'/.test(mapBlock));

/* ---------- a caller-supplied bucket is rejected, not merely ignored ---------- */

ok('a request body containing a "bucket" field is explicitly rejected',
  /'bucket'\s+in\s+body/.test(src) && /bucket_override_rejected/.test(src));

/* ---------- authorisation gates run before anything privileged ---------- */

ok('requires an Authorization header', /authHeader|Authorization/.test(src) && /401/.test(src));
ok('resolves the caller via auth.getUser() (never trusts a client-asserted identity)', /auth\.getUser\(\)/.test(src));
ok('reads the caller\'s own profile (role, status) before proceeding', /\.from\(['"]profiles['"]\)/.test(src) && /select\(['"]id, ?email, ?role, ?status['"]\)/.test(src));
ok('requires status === \'active\' AND role in (STAFF_ADMIN, SUPER_ADMIN) for any operation',
  /status\s*===\s*'active'/.test(src) && /STAFF_ADMIN/.test(src) && /SUPER_ADMIN/.test(src));
ok('an inactive/non-staff caller is forbidden (403), not merely warned', /isActiveStaff[\s\S]{0,80}forbidden.{0,20}403/.test(src.replace(/\n/g, ' ')));

// The 'delete' operation is further restricted to SUPER_ADMIN specifically
// — matches school_documents_delete_by_super_admin / gallery_photos_delete_by_super_admin.
ok('the delete operation additionally requires role === SUPER_ADMIN',
  /operation === 'delete'[\s\S]{0,120}SUPER_ADMIN/.test(src));

/* ---------- service-role key boundary ---------- */

ok('this function references SUPABASE_SERVICE_ROLE_KEY only via Deno.env.get (never hardcoded)',
  /Deno\.env\.get\(['"]SUPABASE_SERVICE_ROLE_KEY['"]\)/.test(src));
// The admin (service-role) client is created only AFTER the staff check —
// i.e. its declaration appears later in the file than the isActiveStaff
// check, never before.
const staffCheckIdx = src.indexOf('if (!isActiveStaff)');
const adminClientIdx = src.indexOf('SUPABASE_SERVICE_ROLE_KEY');
ok('the service-role client is created only after the active-staff check', staffCheckIdx !== -1 && adminClientIdx > staffCheckIdx);

// No frontend source file may reference a service-role key at all — this
// function (supabase/functions/) is server-only and never bundled into the
// Vite build; src/ is what actually ships to a browser.
const srcDir = path.join(root, 'src');
function listFilesRecursive(dir) {
  let out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out = out.concat(listFilesRecursive(p));
    else out.push(p);
  }
  return out;
}
const frontendFiles = fs.existsSync(srcDir) ? listFilesRecursive(srcDir) : [];
ok('at least one frontend source file was scanned', frontendFiles.length > 0, String(frontendFiles.length));
const offenders = [];
for (const f of frontendFiles) {
  // Strip comments before checking — a file is allowed to *document* the
  // constraint ("this file must never reference a service-role key", as
  // src/supabase/client.js's own header does) without that documentation
  // itself being mistaken for a violation. Only actual code is checked.
  const withoutBlockComments = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const withoutLineComments = withoutBlockComments.split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');
  if (/service[_-]?role/i.test(withoutLineComments)) offenders.push(path.relative(root, f));
}
ok('no frontend source file under src/ mentions a service-role key', offenders.length === 0, offenders.join(', '));

/* ---------- validation constants mirror worker/routes/media.js exactly ---------- */

ok('MAX_IMAGE_BYTES matches worker/routes/media.js (8 MiB)', /MAX_IMAGE_BYTES\s*=\s*8\s*\*\s*1024\s*\*\s*1024/.test(src));
ok('MAX_PDF_BYTES matches worker/routes/media.js (20 MiB)', /MAX_PDF_BYTES\s*=\s*20\s*\*\s*1024\s*\*\s*1024/.test(src));
ok('recognises exactly the same 3 image MIME types as worker/routes/media.js', /image\/jpeg/.test(src) && /image\/png/.test(src) && /image\/webp/.test(src));
ok('recognises application/pdf as the document MIME type', /application\/pdf/.test(src));

/* ---------- object path is server-generated, never from the client filename ---------- */

ok('the storage object path is built with crypto.randomUUID(), not the client-supplied filename',
  /crypto\.randomUUID\(\)/.test(src));

/* ---------- audit-log coverage for every operation ---------- */

const REQUIRED_AUDIT_ACTIONS = [
  'gallery.photo_added',     // upload (gallery photo)
  'content.create',          // upload (new document)
  'documents.version_added', // replace (existing document, new version)
  'content.update',          // publish / archive / set_gallery_cover
  'content.soft_delete',     // soft_delete (deleted_at, object left in place)
  'content.delete_hard',     // delete (Super Admin only, removes the object)
  'media.orphan_cleanup_failed', // compensating-delete failure record
  'gallery.photo_bytes_replaced', // replace_photo_bytes (in-place byte overwrite)
];
for (const action of REQUIRED_AUDIT_ACTIONS) {
  ok(`references the audit action '${action}'`, src.includes(action));
}
ok('defines a writeAuditLog() helper that writes to public.audit_log', /writeAuditLog/.test(src) && /audit_log/.test(src));

/* ---------- sole-authority operation model (Decision 3 + Changes 1/2) ---------- */
// The function must own the FULL lifecycle — create, edit, publish, archive,
// set-cover, soft-delete AND hard-delete.

const REQUIRED_OPERATIONS = ['upload', 'replace', 'publish', 'archive', 'soft_delete', 'delete', 'set_gallery_cover', 'replace_photo_bytes'];
const opsMatch = src.match(/OPERATIONS:\s*Operation\[\]\s*=\s*\[([^\]]*)\]/);
ok('an explicit OPERATIONS allow-list is defined', !!opsMatch);
for (const op of REQUIRED_OPERATIONS) {
  ok(`operation '${op}' is in the allow-list`, opsMatch ? opsMatch[1].includes(`'${op}'`) : false);
}
ok('soft_delete is allowed for any active staff, not gated to SUPER_ADMIN',
  /soft_delete[\s\S]{0,400}any active staff|any active staff[\s\S]{0,400}soft_delete/i.test(src));
ok('delete is the SOLE deletion path — no RLS DELETE policy remains anywhere',
  /no longer any RLS\s*\n?\/\/\s*DELETE path anywhere|sole deletion path|no longer ANY RLS\s+DELETE policy/i.test(src));
ok("delete still requires role === 'SUPER_ADMIN'", /operation === 'delete'[\s\S]{0,160}SUPER_ADMIN/.test(src));

// It is the single writer for each of these — asserted by the header's
// explicit enumeration so a future reader cannot miss the contract.
for (const phrase of [
  /generates? Storage object paths/i,
  /uploads? Storage objects/i,
  /overwrites? an existing Storage object's BYTES/i,
  /inserts? gallery_photos rows/i,
  /creates? documents rows/i,
  /creates? document_versions rows/i,
  /advances? documents\.current_version_id/i,
  /sets? public\.galleries\.cover_storage_path/i,
  /hard-deletes?[\s\S]{0,80}Storage objects/i,
  /records? audit_log events/i,
]) {
  ok(`header enumerates sole-authority duty: ${phrase}`, phrase.test(src));
}

// Header must state there is now NO client-side write path to storage.objects
// at all — not INSERT, not UPDATE, not DELETE.
ok('header states storage.objects has no client-side INSERT/UPDATE/DELETE for any bucket',
  /INSERT \/ UPDATE \/ DELETE storage\.objects in ANY of the three buckets/i.test(src));
ok('header notes the two former in-place byte-overwrite policies are gone',
  /update-by-staff policies[\s\S]{0,40}overwriting object bytes in place/i.test(src));

/* ---------- set_gallery_cover: id in, path derived server-side (Change 2) ---------- */

ok('rejects a caller-supplied raw storage path (storagePath / coverStoragePath)',
  /'storagePath' in body \|\| 'coverStoragePath' in body/.test(src) && /storage_path_override_rejected/.test(src));

const coverBranch = (src.match(/if \(operation === 'set_gallery_cover'\)\s*\{([\s\S]*?)\n  \}/) || [,''])[1];
ok('has a dedicated set_gallery_cover branch', coverBranch.length > 0);
for (const [label, re] of [
  ['takes a galleryPhotoId, not a path', /galleryPhotoId/],
  ['supports clearing the cover (galleryPhotoId = null)', /null.*clear|clear.*null|= null/i],
  ['verifies the photo belongs to the specified gallery', /gallery_id === body\.galleryId|photo_wrong_gallery/],
  ['verifies the photo exists', /photo_not_found/],
  ['verifies the photo is not soft-deleted', /deleted_at is null|photo_deleted/],
  ['verifies the photo is eligible (published)', /status === 'published'|photo_not_eligible/],
  ['derives the stored path from the verified row, server-side', /photo\.storage_path/],
  ['writes it via a controlled RPC', /manage_media_set_gallery_cover/],
  ['writes an audit event', /writeAuditLog[\s\S]{0,200}gallery/i],
  ['leaves cover NULL when there is no eligible photo', /stays \/ becomes NULL|stays\/becomes NULL|remain NULL/i],
]) {
  ok(`set_gallery_cover: ${label}`, re.test(coverBranch) || re.test(src));
}

/* ---------- replace_photo_bytes: id + file only, bucket/path derived (this change) ---------- */

ok('rejects a caller-supplied visibility on replace_photo_bytes',
  /operation === 'replace_photo_bytes' && 'visibility' in body/.test(src) && /visibility_override_rejected/.test(src));
ok('a second bucket map keyed by DB visibility exists for existing-photo byte replacement',
  /PHOTO_BUCKET_BY_DB_VISIBILITY[\s\S]{0,120}'public'\s*:\s*'public-media'[\s\S]{0,60}'parents'\s*:\s*'parent-media'/.test(src));
// No key in that map can take a parents-only photo to public-media.
{
  const m = src.match(/PHOTO_BUCKET_BY_DB_VISIBILITY[^{]*\{([\s\S]*?)\};/);
  const block = m ? m[1] : '';
  ok('PHOTO_BUCKET_BY_DB_VISIBILITY never maps parents -> public-media', !/'parents'\s*:\s*'public-media'/.test(block));
  ok('PHOTO_BUCKET_BY_DB_VISIBILITY has exactly 2 entries', (block.match(/:\s*'[a-z-]+',?/g) || []).length === 2);
}

const rpbBranch = (src.match(/if \(operation === 'replace_photo_bytes'\)\s*\{([\s\S]*?)\n  \}\n\n  return json/) || [,''])[1]
  || (src.match(/replace_photo_bytes'\)\s*\{([\s\S]*?)\n  \}/) || [,''])[1];
ok('has a dedicated replace_photo_bytes branch', rpbBranch.length > 200);
for (const [label, re] of [
  ['client provides only galleryPhotoId + the file', /body\.galleryPhotoId/],
  ['no extra role beyond active staff (NOT Super-Admin-only)', /not Super-Admin-only|needs\s+no extra role/i],
  ['loads the gallery_photos row server-side', /from\('gallery_photos'\)/],
  ['confirms the photo exists', /photo_not_found/],
  ['confirms the photo is not soft-deleted', /photo_deleted/],
  ['confirms the stored path is present', /photo_has_no_object|storage_path is a non-empty/i],
  ['loads the parent gallery server-side', /from\('galleries'\)/],
  ['confirms the gallery is not deleted', /gallery_deleted/],
  ['derives the bucket from the gallery visibility, not the client', /PHOTO_BUCKET_BY_DB_VISIBILITY\[gallery\.visibility\]/],
  ['refuses a path-vs-visibility mismatch rather than cross-bucket write', /path_visibility_mismatch/],
  ['validates image MIME + max size', /IMAGE_MIME_TO_EXT[\s\S]{0,120}MAX_IMAGE_BYTES/],
  ['overwrites bytes at the SAME existing path', /\.update\(photo\.storage_path|upsert:\s*true/],
  ['does NOT modify database metadata on storage failure (req 10)', /NO database row\s*\n?\s*\/\/\s*is touched|touch no database row/i],
  ['needs NO database transaction — bytes only (req 11)', /needs\s+NO database transaction at all|no metadata write follows/i],
  ['emits the required audit event', /gallery\.photo_bytes_replaced/],
  ['identity/path-changing replacement is a separate future workflow (req 12)', /deliberately NOT this operation|separate controlled workflow/i],
]) {
  ok(`replace_photo_bytes: ${label}`, re.test(rpbBranch) || re.test(src));
}
ok('FAILURE / CLEANUP MATRIX has a replace_photo_bytes section',
  /-- replace_photo_bytes ---/.test(src));

/* ---------- atomicity is described honestly (Decision 3, req 5) ---------- */

ok('states plainly that true cross-service atomicity is NOT available',
  /CANNOT provide true cross-service atomicity/i.test(src));
ok('describes the DB side as atomic via a single SECURITY DEFINER RPC per operation',
  /SECURITY DEFINER/i.test(src) && /manage_media_/.test(src) && /one (statement\/)?txn|one txn|single .* function/i.test(src));
ok('describes upload-first, then DB, then compensating delete on DB failure',
  /upload-first/i.test(src) && /compensat/i.test(src) && /\.remove\(\[objectPath\]\)/.test(src));
ok('never publishes in the same step as upload (draft-first, separate publish op)',
  /Nothing is ever published in the same step it is uploaded/i.test(src));
ok('the publish op re-verifies the Storage object exists before flipping status',
  /object actually exists[\s\S]{0,200}publish|refuse to\s+publish|object_missing/i.test(src));
ok('carries an explicit FAILURE / CLEANUP MATRIX', /FAILURE \/ CLEANUP MATRIX/.test(src));
ok('names the residual non-atomicity risk (orphaned object, never orphaned visible record)',
  /RESIDUAL NON-ATOMICITY/i.test(src) && /orphaned OBJECT \(never an orphaned visible RECORD\)/i.test(src));

/* ---------- summary ---------- */

console.log('\nPASS ' + pass.length + '   FAIL ' + fail.length + '\n');
if (fail.length) { console.log('FAILURES:'); fail.forEach(f => console.log('  x ' + f)); }
else pass.forEach(p => console.log('  + ' + p));
process.exit(fail.length ? 1 : 0);
