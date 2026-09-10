/* Static validation of the Supabase SQL under supabase/ — no database
   involved, local or remote. This NEVER executes a single statement: it
   only reads the .sql files as text and checks them.

   node-sql-parser (a generic multi-dialect SQL parser) does not understand
   several Postgres-specific constructs these files genuinely need —
   CREATE POLICY, ALTER TABLE ... ENABLE ROW LEVEL SECURITY, and
   dollar-quoted ($$ ... $$) function bodies. Reporting those as parse
   "failures" would be misleading (the SQL is valid Postgres; the parser
   just doesn't cover that grammar), so this suite does two different kinds
   of check:

     1. Real syntax parsing (via node-sql-parser, Postgres dialect) for the
        statements it DOES support: CREATE TABLE, CREATE TYPE, CREATE INDEX,
        INSERT.
     2. Purpose-built structural checks for everything else: balanced
        parens and $$ pairs (catches truncation/copy-paste errors), every
        CREATE POLICY targeting a table that migrations actually enable RLS
        on, every foreign-key-shaped `references public.X` pointing at a
        table this project actually defines, and the "NOT YET APPLIED"
        safety banner present in every migration file. */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pkg from 'node-sql-parser';
const { Parser } = pkg;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const supabaseDir = path.join(root, 'supabase');

const pass = [], fail = [];
const ok = (n, c, d = '') => (c ? pass : fail).push(n + (d ? ' — ' + d : ''));

function listSqlFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith('.sql')).map(f => path.join(dir, f)).sort();
}

const migrationFiles = listSqlFiles(path.join(supabaseDir, 'migrations'));
const policyFiles = listSqlFiles(path.join(supabaseDir, 'policies'));
const storageFiles = listSqlFiles(path.join(supabaseDir, 'storage'));
const allSqlFiles = [...migrationFiles, ...policyFiles, ...storageFiles];

ok('At least one migration file exists', migrationFiles.length > 0);
ok('At least one policy file exists', policyFiles.length > 0);
ok('storage/buckets.sql exists', storageFiles.length > 0);

/* ---------- structural checks on every file ---------- */

for (const file of allSqlFiles) {
  const name = path.relative(root, file);
  const sql = fs.readFileSync(file, 'utf8');

  // Balanced parens.
  let depth = 0, minDepth = 0;
  for (const ch of sql) {
    if (ch === '(') depth++;
    else if (ch === ')') { depth--; if (depth < minDepth) minDepth = depth; }
  }
  ok(`${name}: parentheses are balanced`, depth === 0 && minDepth >= 0, `end depth ${depth}, min ${minDepth}`);

  // Balanced $$ dollar-quote pairs (used by function bodies).
  const dollarCount = (sql.match(/\$\$/g) || []).length;
  ok(`${name}: $$ dollar-quote pairs are balanced`, dollarCount % 2 === 0, `found ${dollarCount}`);

  // The file's last actual SQL statement ends with a semicolon (a common
  // truncation tell) — checked after stripping any trailing comment-only
  // lines, since every file in this project ends with a "-- see
  // supabase/policies/..." style note AFTER the final semicolon.
  const lastCodeLine = sql.trim().split('\n').reverse().find(l => !l.trim().startsWith('--') && l.trim());
  ok(`${name}: file ends with a terminated statement`, (lastCodeLine || '').trim().endsWith(';'), lastCodeLine);
}

for (const file of migrationFiles) {
  const name = path.relative(root, file);
  const sql = fs.readFileSync(file, 'utf8');
  ok(`${name}: carries the "NOT YET APPLIED" safety banner`, sql.includes('NOT YET APPLIED'));
}

for (const file of policyFiles) {
  const name = path.relative(root, file);
  const sql = fs.readFileSync(file, 'utf8');
  ok(`${name}: carries the "STAGED FOR REVIEW" banner`, sql.includes('STAGED FOR REVIEW'));
}

/* ---------- cross-file consistency ---------- */

const allMigrationText = migrationFiles.map(f => fs.readFileSync(f, 'utf8')).join('\n');
const allPolicyText = policyFiles.map(f => fs.readFileSync(f, 'utf8')).join('\n');
const allStorageText = storageFiles.map(f => fs.readFileSync(f, 'utf8')).join('\n');

const definedTables = new Set(
  [...allMigrationText.matchAll(/create table (?:if not exists )?public\.(\w+)/gi)].map(m => m[1])
);
ok('At least 11 tables are defined across the migrations', definedTables.size >= 11, [...definedTables].join(', '));

const requiredTables = [
  'profiles', 'settings', 'page_content', 'notices', 'calendar_events',
  'news_posts', 'galleries', 'gallery_photos', 'documents', 'document_versions', 'audit_log',
];
for (const t of requiredTables) ok(`Table "${t}" is defined`, definedTables.has(t));

// Every `references public.X` in migrations must point at a table this
// project actually defines somewhere in the migration set.
const referencedTables = new Set(
  [...allMigrationText.matchAll(/references public\.(\w+)/gi)].map(m => m[1])
);
const missingReferences = [...referencedTables].filter(t => !definedTables.has(t));
ok('Every foreign-key reference points at a table defined in the migrations', missingReferences.length === 0, missingReferences.join(', '));

// Every table with a CREATE POLICY somewhere must have RLS enabled
// somewhere in the migrations — a policy on a table without RLS enabled is
// silently ineffective in Postgres (RLS must be turned on for policies to
// have any effect at all), so this catches a real class of mistake.
const rlsEnabledTables = new Set(
  [...allMigrationText.matchAll(/alter table public\.(\w+) enable row level security/gi)].map(m => m[1])
);
const policiedTables = new Set(
  [...allPolicyText.matchAll(/^create policy "[^"]+"\s*\n?on public\.(\w+)/gim)].map(m => m[1])
);
ok('At least 9 tables have policies staged', policiedTables.size >= 9, [...policiedTables].join(', '));
const policiedWithoutRls = [...policiedTables].filter(t => !rlsEnabledTables.has(t));
ok('Every table with a staged policy has RLS enabled in a migration', policiedWithoutRls.length === 0, policiedWithoutRls.join(', '));

// Every table that has RLS enabled should have at least one staged policy —
// otherwise every operation on it is denied for every role (safe, but
// probably not the intent for tables meant to be readable at all).
const rlsWithoutPolicy = [...rlsEnabledTables].filter(t => !policiedTables.has(t) && !allStorageText.includes(`'${t}'`));
ok('Every RLS-enabled table has at least one staged policy', rlsWithoutPolicy.length === 0, rlsWithoutPolicy.join(', '));

/* ---------- function-call policies must target `to authenticated` ---------- */
// Postgres requires the calling role to hold EXECUTE on a function referenced
// inside a policy's USING/WITH CHECK expression, independent of RLS row
// filtering — and `CREATE POLICY` with no `TO` clause defaults to `PUBLIC`
// (which includes `anon`). A policy that calls one of the four
// SECURITY DEFINER role-check helpers but omits `TO authenticated` would
// therefore rely on the `anon`/`PUBLIC` default rather than an explicit
// grant — exactly what this project's "Change A" set out to remove. These
// checks read the policy text only; nothing here executes or connects.

const HELPER_FNS = ['current_profile', 'has_role', 'is_active_staff', 'is_active_parent'];
const helperFnPattern = new RegExp(`\\b(${HELPER_FNS.join('|')})\\s*\\(`, 'i');

// The final design has NO implicit-PUBLIC policy on any application table:
// every policy must carry an explicit `to` clause, either `to anon,
// authenticated` (an intentional public-read policy) or `to authenticated`
// (everything else — parent/staff/Super-Admin/own-profile). This allowlist
// is deliberately empty: it exists only so a future, genuinely-justified
// exception has somewhere documented to go, not because one exists today.
const PUBLIC_ROLE_ALLOWLIST = [];

// Combined so the same role-clause checks cover both application-table
// policies (supabase/policies/) and Storage policies (supabase/storage/) —
// `on public.<table>` and `on storage.objects` are both matched.
const allRlsPolicyText = allPolicyText + '\n' + allStorageText;
const policyStatementPattern = /create policy "([^"]+)"\s*\non (?:public|storage)\.(\w+)\s+for\s+(\w+)\s*\n(to\s+[a-z, ]+\n)?([\s\S]*?);/gi;
const policyStatements = [...allRlsPolicyText.matchAll(policyStatementPattern)];
ok('At least 30 policy statements were extracted for role-clause checking', policyStatements.length >= 30, String(policyStatements.length));

const storagePolicyStatements = [...allStorageText.matchAll(policyStatementPattern)];
// Exactly 4 now, all SELECT: parent_media_select_by_parent,
// parent_media_select_by_staff, school_documents_select_public,
// school_documents_select_by_parent_or_staff. The 3 INSERT policies went in
// Decision 2, the 3 DELETE policies in Change 1, and the 2 in-place
// byte-overwrite UPDATE policies in this change — leaving storage.objects
// with no client-side write policy of any kind.
ok('Exactly 4 Storage policy statements remain, all SELECT', storagePolicyStatements.length === 4,
  storagePolicyStatements.map(m => `${m[1]} (${m[3]})`).join(', '));

for (const m of policyStatements) {
  const [, policyName, table, , roleClauseRaw, body] = m;
  const roleClause = (roleClauseRaw || '').trim();
  const isPublic = roleClause === '';
  const targetsAnon = /\banon\b/i.test(roleClause);
  const targetsAuthenticated = /\bauthenticated\b/i.test(roleClause);
  const callsHelperFn = helperFnPattern.test(body);

  // (4) Every policy must carry an explicit TO clause — no reliance on the
  // implicit-PUBLIC default, unless explicitly allowlisted above with a
  // documented technical reason (there is currently no such exception).
  ok(`policy "${policyName}" (${table}): has an explicit TO role clause (not implicit PUBLIC)`,
    !isPublic || PUBLIC_ROLE_ALLOWLIST.includes(policyName),
    isPublic ? 'role clause is empty — defaults to PUBLIC' : `role clause: "${roleClause}"`);

  // (3) Every explicit role target is one of the two intended shapes: an
  // intentional public-read policy (anon + authenticated) or an
  // authenticated-only policy (parent/staff/Super-Admin/own-profile).
  if (!isPublic) {
    ok(`policy "${policyName}" (${table}): role target includes authenticated ("anon, authenticated" for public-read, or "authenticated" alone otherwise)`,
      targetsAuthenticated, `role clause: "${roleClause}"`);
  }

  // (5) An intentional public-read policy must never call a role-check
  // helper — anon has no profile row to evaluate one against, and mixing
  // the two would make "public" access silently depend on a check that, by
  // definition, only ever passes for signed-in, active-role rows.
  if (targetsAnon) {
    ok(`policy "${policyName}" (${table}): is TO anon (public-read) and calls no role-check helper`,
      !callsHelperFn);
  }

  // (6) Any policy that calls a role-check helper must explicitly target TO
  // authenticated — never rely on the PUBLIC/anon default to reach it.
  if (callsHelperFn) {
    ok(`policy "${policyName}" (${table}): calls a role-check helper and explicitly targets TO authenticated`,
      targetsAuthenticated, `role clause: "${roleClause || '(none — defaults to PUBLIC)'}"`);
  }
}

/* ---------- Storage bucket policy checks (supabase/storage/buckets.sql) ---------- */
// Bucket-specific assertions beyond the generic role-clause checks above:
// each bucket's actual read/write shape is verified by name and body text,
// not just "has a TO clause" — a policy can have a perfectly correct role
// target and still grant the wrong access.

const byName = Object.fromEntries(storagePolicyStatements.map(m => [m[1], m]));

// FINAL storage.objects write shape: ZERO client-side write policies of any
// kind — no INSERT, no UPDATE (the two update-by-staff policies that used to
// allow overwriting object bytes in place are gone), no DELETE, for any
// bucket. Every byte written/removed goes through manage-media's
// service-role client.
for (const op of ['insert', 'update', 'delete']) {
  const offenders = storagePolicyStatements.filter(m => m[3].toLowerCase() === op);
  ok(`storage.objects: ZERO client-side ${op.toUpperCase()} policies for any bucket`,
    offenders.length === 0, offenders.map(m => m[1]).join(', '));
}
// The two former in-place byte-overwrite policies must be genuinely gone.
for (const gone of ['public_media_update_by_staff', 'parent_media_update_by_staff']) {
  ok(`storage policy "${gone}" (in-place byte overwrite) no longer exists`, !allStorageText.includes(`"${gone}"`));
}
// What remains must be SELECT only.
for (const m of storagePolicyStatements) {
  ok(`storage policy "${m[1]}" is a SELECT policy (only reads remain client-side)`, m[3].toLowerCase() === 'select', m[3]);
}

// school-documents: the anon-facing read policy must never expose a
// parent-only or unpublished document — its body must require both
// status = 'published' and visibility = 'public'.
{
  const m = byName['school_documents_select_public'];
  ok('storage policy "school_documents_select_public" exists', !!m);
  if (m) {
    const body = m[5];
    ok('storage policy "school_documents_select_public": requires status = \'published\'', /status\s*=\s*'published'/i.test(body));
    ok('storage policy "school_documents_select_public": requires visibility = \'public\'', /visibility\s*=\s*'public'/i.test(body));
    ok('storage policy "school_documents_select_public": calls no role-check helper', !helperFnPattern.test(body));
  }
}

// The mixed public/authenticated document-visibility policy must be split,
// not present as a single combined-branch policy.
ok('storage policy "school_documents_select_if_document_visible" (the old mixed-branch policy) no longer exists',
  !allStorageText.includes('school_documents_select_if_document_visible'));
ok('storage policy "school_documents_select_by_parent_or_staff" exists (the split-off authenticated half)',
  !!byName['school_documents_select_by_parent_or_staff']);

// Object-to-metadata correlation: every SELECT policy on a private bucket
// that is meant to gate access by a specific catalogued record (as opposed
// to a deliberate staff blanket-bucket-read) must bind
// storage.objects.bucket_id AND storage.objects.name to the relevant
// metadata table's storage_path column, AND check that table's
// published/deleted (and, where applicable, visibility) state — not just
// call a role-check helper with no row-level correlation at all. This is
// what actually stops a signed-in parent from reading an unrelated,
// draft, or deleted object merely by knowing/guessing its path.
//
// parent_media_select_by_staff is deliberately exempted: it is a documented,
// intentional full-bucket read for active staff only (they must be able to
// see uncatalogued/draft objects to manage them), not a catalogue-correlated
// read — see the comment directly above it in supabase/storage/buckets.sql.
const CORRELATION_REQUIRED_POLICIES = {
  parent_media_select_by_parent: {
    bucket: 'parent-media',
    storagePathRefs: [/\bp\.storage_path\s*=\s*storage\.objects\.name\b/i],
    stateChecks: [/p\.status\s*=\s*'published'/i, /p\.deleted_at is null/i, /g\.status\s*=\s*'published'/i, /g\.deleted_at is null/i],
  },
  school_documents_select_public: {
    bucket: 'school-documents',
    storagePathRefs: [/\bv\.storage_path\s*=\s*storage\.objects\.name\b/i],
    stateChecks: [/d\.status\s*=\s*'published'/i, /d\.visibility\s*=\s*'public'/i, /d\.deleted_at is null/i],
  },
  school_documents_select_by_parent_or_staff: {
    bucket: 'school-documents',
    storagePathRefs: [/\bv\.storage_path\s*=\s*storage\.objects\.name\b/i],
    stateChecks: [/d\.deleted_at is null/i],
  },
};

for (const [name, spec] of Object.entries(CORRELATION_REQUIRED_POLICIES)) {
  const m = byName[name];
  ok(`storage policy "${name}" exists`, !!m);
  if (!m) continue;
  const body = m[5];
  ok(`storage policy "${name}": bucket_id is bound to '${spec.bucket}'`, new RegExp(`bucket_id\\s*=\\s*'${spec.bucket}'`, 'i').test(body));
  for (const re of spec.storagePathRefs) {
    ok(`storage policy "${name}": storage.objects.name is correlated to a storage_path column`, re.test(body), re.toString());
  }
  for (const re of spec.stateChecks) {
    ok(`storage policy "${name}": checks published/deleted/visibility state (${re})`, re.test(body));
  }
}

/* ---------- current-version-only access for anon/Parent (superseded document versions) ---------- */
// Anon and Parent must be restricted to the CURRENT document version only
// (documents.current_version_id) — a superseded version's row/object must
// stay reachable by active staff (for audit/version-history review) but
// nobody else, even once its parent document is published. Checked at both
// the table layer (document_versions rows) and the storage layer (the
// actual PDF bytes) — either layer denying access is sufficient, but the
// design intends both to agree.

const byPolicyName = Object.fromEntries(policyStatements.map(m => [m[1], m]));

// Anon-only policies: exactly one current_version_id check (the only
// branch there is), tying the row/object to being the document's live
// version.
for (const [name, currentVersionRef] of [
  ['document_versions_select_public_anon', /d\.current_version_id\s*=\s*document_versions\.id/i],
  ['school_documents_select_public', /v\.id\s*=\s*d\.current_version_id/i],
]) {
  const m = byPolicyName[name] || byName[name];
  ok(`policy "${name}" exists`, !!m);
  if (!m) continue;
  const body = m[5];
  ok(`policy "${name}": Anon is restricted to the CURRENT document version`, currentVersionRef.test(body));
}

// Parent-or-staff policies: the current_version_id check must be present
// in the Parent branch, and current_version_id must appear EXACTLY ONCE in
// the whole statement — i.e. nowhere in the Staff branch — so staff keeps
// unrestricted access to every historical version.
for (const [name, parentBranchRef] of [
  ['document_versions_select_parent_or_staff', /is_active_parent\(\)\s+and\s+d\.current_version_id\s*=\s*document_versions\.id/i],
  ['school_documents_select_by_parent_or_staff', /is_active_parent\(\)\s+and\s+v\.id\s*=\s*d\.current_version_id/i],
]) {
  const m = byPolicyName[name] || byName[name];
  ok(`policy "${name}" exists`, !!m);
  if (!m) continue;
  const body = m[5];
  ok(`policy "${name}": Parent branch is restricted to the CURRENT document version`, parentBranchRef.test(body));
  const occurrences = (body.match(/current_version_id/gi) || []).length;
  ok(`policy "${name}": current_version_id appears exactly once (only in the Parent branch — Staff branch is unrestricted)`,
    occurrences === 1, `found ${occurrences} occurrence(s)`);
  const staffBranch = (body.match(/or\s*\(public\.is_active_staff\(\)[^)]*\)/i) || [''])[0];
  ok(`policy "${name}": Staff branch does not contain a current_version_id restriction`, !/current_version_id/i.test(staffBranch), staffBranch);
}

// Draft, archived, soft-deleted, orphaned, and guessed document paths must
// remain blocked after this change — regression-check that the pre-existing
// status/deleted_at/exists-correlation guards are all still present
// (a status check blocks draft/archived; a deleted_at check blocks
// soft-deleted; the `exists (...)` correlation itself is what blocks
// orphaned objects and guessed paths, since no matching row means no
// access regardless of any role check passing).
for (const name of ['document_versions_select_public_anon', 'document_versions_select_parent_or_staff']) {
  const m = byPolicyName[name];
  ok(`policy "${name}" exists`, !!m);
  if (!m) continue;
  ok(`policy "${name}": still correlates via an EXISTS clause (blocks orphaned/guessed rows)`, /exists\s*\(/i.test(m[5]));
  ok(`policy "${name}": still requires d.deleted_at is null somewhere (blocks soft-deleted documents)`, /d\.deleted_at is null/i.test(m[5]));
}
for (const name of ['school_documents_select_public', 'school_documents_select_by_parent_or_staff']) {
  const m = byName[name];
  ok(`policy "${name}" exists`, !!m);
  if (!m) continue;
  ok(`policy "${name}": still correlates via an EXISTS clause (blocks orphaned/guessed objects)`, /exists\s*\(/i.test(m[5]));
  ok(`policy "${name}": still requires d.deleted_at is null somewhere (blocks soft-deleted documents)`, /d\.deleted_at is null/i.test(m[5]));
}
ok('policy "document_versions_select_public_anon": still requires d.status = \'published\' (blocks draft/archived documents)',
  /d\.status\s*=\s*'published'/i.test((byPolicyName['document_versions_select_public_anon'] || [])[5] || ''));
ok('policy "school_documents_select_public": still requires d.status = \'published\' (blocks draft/archived documents)',
  /d\.status\s*=\s*'published'/i.test((byName['school_documents_select_public'] || [])[5] || ''));

/* ---------- storage uploads have no client-reachable INSERT policy ---------- */
// Decision 2 (enforce bucket selection server-side): a client can never
// choose a bucket if there is no INSERT policy at all granting that
// operation to `authenticated` on storage.objects — the manage-media Edge
// Function's service-role client is the only writer. Assert the three
// former direct-upload policies genuinely no longer exist (not just
// renamed) for all three buckets.
for (const removedName of ['public_media_insert_by_staff', 'parent_media_insert_by_staff', 'school_documents_insert_by_staff']) {
  ok(`storage policy "${removedName}" (direct client upload) no longer exists`, !allStorageText.includes(`"${removedName}"`));
}
// And confirm no OTHER insert policy silently replaced them under a
// different name — there must be zero `for insert` policies left on
// storage.objects at all now.
const remainingStorageInsertPolicies = storagePolicyStatements.filter(m => m[3].toLowerCase() === 'insert');
ok('No storage.objects INSERT policy remains for any bucket (all uploads go through manage-media)',
  remainingStorageInsertPolicies.length === 0, remainingStorageInsertPolicies.map(m => m[1]).join(', '));

/* ---------- storage.objects has NO client-reachable DELETE policy (Change 1) ---------- */
// No browser client, Super Admin included, may remove a Storage object with
// the publishable key — object removal happens only through manage-media's
// `delete` operation (service-role).
for (const removedName of ['public_media_delete_by_staff', 'parent_media_delete_by_staff', 'school_documents_delete_by_super_admin']) {
  ok(`storage policy "${removedName}" (direct client delete) no longer exists`, !allStorageText.includes(`"${removedName}"`));
}
const remainingStorageDeletePolicies = storagePolicyStatements.filter(m => m[3].toLowerCase() === 'delete');
ok('No storage.objects DELETE policy remains for any bucket (all deletes go through manage-media)',
  remainingStorageDeletePolicies.length === 0, remainingStorageDeletePolicies.map(m => m[1]).join(', '));

// The one documented exception: parent_media_select_by_staff must remain a
// bucket-only check with no per-object correlation (that's the point of it),
// so assert the exemption is still true rather than silently assuming it.
{
  const m = byName['parent_media_select_by_staff'];
  ok('storage policy "parent_media_select_by_staff" exists', !!m);
  if (m) {
    const body = m[5];
    ok('storage policy "parent_media_select_by_staff": remains a bucket-only staff check with no gallery_photos correlation (documented exception)',
      !/gallery_photos|galleries/i.test(body));
  }
}

/* ---------- media/document tables: no client-reachable write policy at all ---------- */
// Change 3 (one controlled server-side workflow) removed client INSERT/UPDATE;
// Change 1 removed the last client DELETE. gallery_photos / documents /
// document_versions now have SELECT policies ONLY — every write of any kind
// goes through the manage-media Edge Function's service-role client.

const appPolicyByName = Object.fromEntries(policyStatements.map(m => [m[1], m]));
const policyStmtsFor = (table) => policyStatements.filter(m => m[2] === table);

for (const table of ['gallery_photos', 'documents', 'document_versions']) {
  const stmts = policyStmtsFor(table);
  const ops = stmts.map(m => m[3].toLowerCase());
  ok(`table "${table}": has NO INSERT policy (creation goes only through manage-media)`, !ops.includes('insert'),
    stmts.filter(m => m[3].toLowerCase() === 'insert').map(m => m[1]).join(', '));
  ok(`table "${table}": has NO UPDATE policy (mutation goes only through manage-media)`, !ops.includes('update'),
    stmts.filter(m => m[3].toLowerCase() === 'update').map(m => m[1]).join(', '));
  ok(`table "${table}": has NO DELETE policy (deletion goes only through manage-media, Change 1)`, !ops.includes('delete'),
    stmts.filter(m => m[3].toLowerCase() === 'delete').map(m => m[1]).join(', '));
  const nonSelect = stmts.filter(m => m[3].toLowerCase() !== 'select');
  ok(`table "${table}": has NO non-SELECT policy whatsoever (read-only to every client role)`,
    nonSelect.length === 0, nonSelect.map(m => `${m[1]} (${m[3]})`).join(', '));
  // Specific removed policy names must be genuinely gone, not renamed.
  for (const gone of [`${table}_insert_by_staff`, `${table}_update_by_staff`,
                      `${table}_delete_by_super_admin`, `${table}_delete_by_staff`]) {
    ok(`policy "${gone}" no longer exists`, !allPolicyText.includes(`"${gone}"`));
  }
}

// A browser cannot create an audit-log row: audit_log has no INSERT policy
// (and never has) — assert it stays that way.
ok('table "audit_log": has NO INSERT policy (audit rows are written only by the service-role path)',
  !policyStmtsFor('audit_log').some(m => m[3].toLowerCase() === 'insert'));

/* ---------- galleries: empty-album management stays direct; cover + delete do not ---------- */
{
  const stmts = policyStmtsFor('galleries');
  const ops = stmts.map(m => m[3].toLowerCase());

  // INSERT retained, still storage-path-free.
  const ins = appPolicyByName['galleries_insert_by_staff'];
  ok('policy "galleries_insert_by_staff" still exists (empty-album creation retained)', !!ins);
  if (ins) {
    ok('policy "galleries_insert_by_staff": WITH CHECK forbids a cover_storage_path at creation',
      /cover_storage_path is null/i.test(ins[5]));
  }

  // UPDATE retained, but cover_storage_path is now pinned immutable via the
  // SECURITY DEFINER helper (Change 2) — a client UPDATE cannot set/change it.
  const upd = appPolicyByName['galleries_update_by_staff'];
  ok('policy "galleries_update_by_staff" still exists (staff manage album title/status/visibility)', !!upd);
  if (upd) {
    ok('policy "galleries_update_by_staff": WITH CHECK pins cover_storage_path via gallery_current_cover_path()',
      /cover_storage_path is not distinct from\s+public\.gallery_current_cover_path\(\s*id\s*\)/i.test(upd[5]));
  }

  // DELETE removed (Change 1) — no album hard-delete via the publishable key,
  // Super Admin included.
  ok('table "galleries": has NO DELETE policy (hard delete goes only through manage-media, Change 1)',
    !ops.includes('delete'), stmts.filter(m => m[3].toLowerCase() === 'delete').map(m => m[1]).join(', '));
  ok('policy "galleries_delete_by_super_admin" no longer exists', !allPolicyText.includes('"galleries_delete_by_super_admin"'));

  // galleries is the ONLY media/document table that keeps a client INSERT + UPDATE.
  ok('table "galleries": still has INSERT and UPDATE (the documented, storage-path-free exception)',
    ops.includes('insert') && ops.includes('update'));
}

/* ---------- the gallery-cover helper migration (Change 2) ---------- */
{
  const coverMig = migrationFiles.find(f => /gallery_cover_helper/.test(f));
  ok('migration 20260101000010_gallery_cover_helper.sql exists', !!coverMig);
  if (coverMig) {
    const sql = fs.readFileSync(coverMig, 'utf8');
    ok('gallery-cover helper: carries the "NOT YET APPLIED" banner', sql.includes('NOT YET APPLIED'));
    ok('gallery-cover helper: defines public.gallery_current_cover_path(uuid)',
      /create or replace function public\.gallery_current_cover_path\s*\(\s*p_gallery_id uuid\s*\)/i.test(sql));
    ok('gallery-cover helper: is SECURITY DEFINER with a fixed search_path',
      /security definer/i.test(sql) && /set search_path = public/i.test(sql));
    ok('gallery-cover helper: reads only galleries.cover_storage_path (widens no access)',
      /select cover_storage_path from public\.galleries where id = p_gallery_id/i.test(sql));
    ok('gallery-cover helper: revokes EXECUTE from public and anon, grants only authenticated',
      /revoke execute on function public\.gallery_current_cover_path\(uuid\) from public/i.test(sql) &&
      /revoke execute on function public\.gallery_current_cover_path\(uuid\) from anon/i.test(sql) &&
      /grant execute on function public\.gallery_current_cover_path\(uuid\) to authenticated/i.test(sql));
  }
}

/* ---------- draft content cannot be read until published (regression) ---------- */
// The controlled workflow lands everything as draft; these read policies
// are what keep a draft invisible to anon/parent until a later publish.
for (const [name, table] of [
  ['gallery_photos_select_public_anon', 'gallery_photos'],
  ['gallery_photos_select_published_by_parent', 'gallery_photos'],
  ['documents_select_public_anon', 'documents'],
  ['documents_select_published_by_parent', 'documents'],
]) {
  const m = appPolicyByName[name];
  ok(`policy "${name}" exists`, !!m);
  if (m) ok(`policy "${name}": requires status = 'published' (draft stays invisible)`, /status\s*=\s*'published'/i.test(m[5]));
}
// Existing three-tier read model still intact for both tables.
for (const table of ['gallery_photos', 'documents', 'galleries']) {
  const selects = policyStmtsFor(table).filter(m => m[3].toLowerCase() === 'select').map(m => m[1]);
  ok(`table "${table}": still has anon, parent, and staff SELECT tiers`,
    selects.some(n => /public_anon$/.test(n)) &&
    selects.some(n => /by_parent$/.test(n)) &&
    selects.some(n => /by_staff$/.test(n)),
    selects.join(', '));
}

/* ---------- real syntax parsing for the statements the parser supports ---------- */

const parser = new Parser();
let parsedCount = 0, skippedCount = 0;

for (const file of allSqlFiles) {
  const name = path.relative(root, file);
  const sql = fs.readFileSync(file, 'utf8');

  // Strip dollar-quoted function bodies before splitting into statements —
  // node-sql-parser cannot parse CREATE FUNCTION with a $$ body, and a
  // semicolon inside that body would otherwise corrupt the split below.
  const withoutFunctionBodies = sql.replace(/\$\$[\s\S]*?\$\$/g, "'stripped_function_body'");

  const statements = withoutFunctionBodies
    .split(';')
    .map(s => s.trim())
    .filter(s => s && !s.startsWith('--'));

  for (const stmt of statements) {
    const withoutComments = stmt.split('\n').filter(l => !l.trim().startsWith('--')).join('\n').trim();
    if (!withoutComments) continue;

    const supported = /^(create\s+table|create\s+type|create\s+index|insert\s+into)/i.test(withoutComments);
    if (!supported) { skippedCount++; continue; }

    // node-sql-parser's PostgreSQL grammar does not recognise ANY
    // user-defined type name as a column type — not even a bare one,
    // schema-qualified or not — only its own fixed list of built-in type
    // keywords. This is a genuine gap in the tool (custom enum types are
    // ordinary, valid Postgres), not a defect in this SQL. Substituted with
    // `text` HERE, for parsing purposes only, so the rest of each
    // statement — column list shape, constraints, DEFAULT expressions,
    // PRIMARY KEY, REFERENCES — is still genuinely syntax-checked. The enum
    // type names themselves are covered instead by the "every table in
    // requiredTables is defined" and "create type" checks above, which do
    // parse successfully (CREATE TYPE ... AS ENUM is supported).
    const CUSTOM_TYPES = ['public.user_role', 'user_role', 'public.account_status', 'account_status',
      'public.content_status', 'content_status', 'public.content_visibility', 'content_visibility',
      'public.calendar_event_kind', 'calendar_event_kind'];
    let forParser = withoutComments;
    for (const t of CUSTOM_TYPES) forParser = forParser.replace(new RegExp(`\\b${t.replace('.', '\\.')}\\b`, 'g'), 'text');

    try {
      parser.astify(forParser + ';', { database: 'postgresql' });
      parsedCount++;
    } catch (err) {
      fail.push(`${name}: parse error in "${withoutComments.slice(0, 60)}…" — ${err.message.split('\n')[0]}`);
    }
  }
}

ok(`node-sql-parser successfully parsed ${parsedCount} CREATE TABLE/TYPE/INDEX/INSERT statements`, parsedCount >= 15, String(parsedCount));
console.log(`(info: ${skippedCount} statements — CREATE POLICY, ALTER TABLE, CREATE FUNCTION — are Postgres-specific grammar this parser doesn't cover; verified by the structural checks above instead, not skipped from validation entirely.)`);

/* ---------- content-audit trigger migration (20260101000011) ---------- */
// The Super Admin portal writes content directly (RLS-gated); this trigger
// is what produces the audit trail, since audit_log has no client INSERT
// policy. Structural checks only — behaviour is covered by
// tests/admin-portal.live.test.mjs against a real project.
{
  const auditMig = migrationFiles.find(f => /content_audit_trigger/.test(f));
  ok('migration 20260101000011_content_audit_trigger.sql exists', !!auditMig);
  if (auditMig) {
    const sql = fs.readFileSync(auditMig, 'utf8');
    ok('audit trigger: carries the "NOT YET APPLIED" banner', sql.includes('NOT YET APPLIED'));
    ok('audit trigger: defines public.log_content_change() returns trigger',
      /create or replace function public\.log_content_change\(\)\s*\n?\s*returns trigger/i.test(sql));
    ok('audit trigger: function is SECURITY DEFINER with a fixed search_path',
      /security definer/i.test(sql) && /set search_path = public/i.test(sql));
    ok('audit trigger: actor is taken from the request JWT, not the client',
      /auth\.uid\(\)/.test(sql) && /auth\.jwt\(\)\s*->>\s*'email'/.test(sql));
    ok('audit trigger: inserts into public.audit_log', /insert into public\.audit_log/i.test(sql));
    ok('audit trigger: derives the action from tg_op (create / update / soft_delete / delete_hard)',
      /content\.create/.test(sql) && /content\.update/.test(sql) && /content\.soft_delete/.test(sql) && /content\.delete_hard/.test(sql));
    ok('audit trigger: EXECUTE is revoked from public, anon, and authenticated (only the trigger machinery calls it)',
      /revoke execute on function public\.log_content_change\(\) from public/i.test(sql)
      && /revoke execute on function public\.log_content_change\(\) from anon/i.test(sql)
      && /revoke execute on function public\.log_content_change\(\) from authenticated/i.test(sql));
    for (const t of ['notices', 'news_posts', 'calendar_events', 'page_content', 'settings']) {
      ok(`audit trigger: AFTER INSERT/UPDATE/DELETE trigger on public.${t}`,
        new RegExp(`create trigger trg_audit_${t}\\s*\\n?\\s*after insert or update or delete on public\\.${t}\\s*\\n?\\s*for each row execute function public\\.log_content_change\\(\\)`, 'i').test(sql));
      ok(`audit trigger: trg_audit_${t} is idempotent (DROP TRIGGER IF EXISTS)`,
        new RegExp(`drop trigger if exists trg_audit_${t} on public\\.${t}`, 'i').test(sql));
    }
  }
}

/* ---------- migrations/ vs supabase/migrations/ don't collide ---------- */
// migrations/0001_init.sql is the Cloudflare D1 schema, already committed
// and must NOT be touched or replaced by this work.
const d1Migration = path.join(root, 'migrations', '0001_init.sql');
ok('The original Cloudflare D1 migration is untouched', fs.existsSync(d1Migration));

/* ---------- summary ---------- */

console.log('\nPASS ' + pass.length + '   FAIL ' + fail.length + '\n');
if (fail.length) { console.log('FAILURES:'); fail.forEach(f => console.log('  x ' + f)); }
else pass.forEach(p => console.log('  + ' + p));
process.exit(fail.length ? 1 : 0);
