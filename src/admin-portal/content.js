/* Pure content-type descriptors + status-transition helpers for the Super
   Admin portal. No env, no DOM, no supabase import — unit-tested directly
   (tests/admin-portal.test.mjs).

   Every `table` here MUST match a table that already exists in
   supabase/migrations/* and has RLS policies in supabase/policies/*. This
   file adds NO new tables, columns, or permissions — it only describes the
   subset of existing columns the minimal editor exposes. */

/** Field kinds the form renderer understands. */
// 'text'      single-line
// 'textarea'  multi-line plain text (NOT rich text — see the sanitise note
//             in supabase/migrations/20260101000002; the minimal editor
//             stores plain text only and the public site renders it as text)
// 'date'      yyyy-mm-dd
// 'select'    one of `options`
// 'json'      a jsonb value, edited as pretty-printed JSON text

export const STATUS_OPTIONS = ['draft', 'published', 'archived'];
export const VISIBILITY_OPTIONS = ['public', 'parents'];
export const CALENDAR_KINDS = ['opening', 'closing', 'holiday', 'event', 'reminder'];

const ARTICLE_FIELDS = [
  { name: 'title', kind: 'text', required: true },
  { name: 'summary', kind: 'textarea' },
  { name: 'body', kind: 'textarea' },
  { name: 'category', kind: 'text' },
  { name: 'status', kind: 'select', options: STATUS_OPTIONS },
  { name: 'visibility', kind: 'select', options: VISIBILITY_OPTIONS },
];

export const CONTENT_TYPES = {
  notices: {
    table: 'notices',
    label: 'Notices',
    shape: 'row',
    idColumn: 'id',
    orderBy: { column: 'updated_at', ascending: false },
    fields: ARTICLE_FIELDS,
    canPublish: true,
    canArchive: true,
    canSoftDelete: true,
    canHardDelete: true, // notices_delete_by_super_admin
  },
  news_posts: {
    table: 'news_posts',
    label: 'News posts',
    shape: 'row',
    idColumn: 'id',
    orderBy: { column: 'updated_at', ascending: false },
    fields: ARTICLE_FIELDS,
    canPublish: true,
    canArchive: true,
    canSoftDelete: true,
    canHardDelete: true,
  },
  calendar_events: {
    table: 'calendar_events',
    label: 'Calendar events',
    shape: 'row',
    idColumn: 'id',
    orderBy: { column: 'start_date', ascending: true },
    fields: [
      { name: 'title', kind: 'text', required: true },
      { name: 'kind', kind: 'select', options: CALENDAR_KINDS },
      { name: 'summary', kind: 'textarea' },
      { name: 'category', kind: 'text' },
      { name: 'start_date', kind: 'date' },
      { name: 'end_date', kind: 'date' },
      { name: 'status', kind: 'select', options: STATUS_OPTIONS },
      { name: 'visibility', kind: 'select', options: VISIBILITY_OPTIONS },
    ],
    canPublish: true,
    canArchive: true,
    canSoftDelete: true,
    canHardDelete: true,
  },
  page_content: {
    table: 'page_content',
    label: 'Page content',
    shape: 'kv',
    idColumn: 'key',
    orderBy: { column: 'key', ascending: true },
    fields: [
      { name: 'key', kind: 'text', required: true, immutableOnEdit: true },
      { name: 'value', kind: 'json', required: true },
      { name: 'status', kind: 'select', options: ['draft', 'published'] },
    ],
    canPublish: true,   // status column only: 'published' <-> 'draft'
    canArchive: false,
    canSoftDelete: false,
    canHardDelete: false,
  },
  settings: {
    table: 'settings',
    label: 'Site settings',
    shape: 'kv',
    idColumn: 'key',
    orderBy: { column: 'key', ascending: true },
    fields: [
      { name: 'key', kind: 'text', required: true, immutableOnEdit: true },
      { name: 'value', kind: 'json', required: true },
    ],
    canPublish: false,  // no status column on settings
    canArchive: false,
    canSoftDelete: false,
    canHardDelete: false,
  },
};

export const CONTENT_TYPE_KEYS = Object.keys(CONTENT_TYPES);

/* ---- status-transition patches (for 'row'-shaped types) ---------------- */

export function publishPatch(now = new Date()) {
  return { status: 'published', published_at: now.toISOString() };
}
export function unpublishPatch() {
  return { status: 'draft', published_at: null };
}
export function archivePatch(now = new Date()) {
  return { status: 'archived', archived_at: now.toISOString() };
}
/** Soft delete: hide from staff+public without a hard DELETE. Recoverable
    by clearing deleted_at directly in the database. */
export function softDeletePatch(now = new Date()) {
  return { status: 'archived', deleted_at: now.toISOString() };
}

/** page_content has a status column but no *_at timestamps. */
export function kvPublishPatch() { return { status: 'published' }; }
export function kvUnpublishPatch() { return { status: 'draft' }; }

/* ---- form value coercion --------------------------------------------- */

/** Parse the JSON textarea for a 'json' field. Throws on invalid JSON so
    the caller can show an inline error rather than sending garbage. */
export function parseJsonField(text) {
  const trimmed = String(text ?? '').trim();
  if (trimmed === '') throw new Error('Value is required.');
  return JSON.parse(trimmed);
}

/** Build the row object to send for an insert/update from raw form values,
    dropping empty optional strings and coercing 'json' fields. */
export function buildRow(typeKey, formValues) {
  const type = CONTENT_TYPES[typeKey];
  if (!type) throw new Error(`Unknown content type: ${typeKey}`);
  const row = {};
  for (const field of type.fields) {
    const raw = formValues[field.name];
    if (field.kind === 'json') {
      row[field.name] = parseJsonField(raw);
      continue;
    }
    const val = raw == null ? '' : String(raw).trim();
    if (val === '') {
      if (field.required) throw new Error(`${field.name} is required.`);
      // leave unset so the column default applies
      continue;
    }
    row[field.name] = val;
  }
  return row;
}
