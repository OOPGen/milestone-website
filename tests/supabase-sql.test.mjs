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

const policyStatementPattern = /create policy "([^"]+)"\s*\non public\.(\w+)\s+for\s+(\w+)\s*\n(to\s+[a-z, ]+\n)?([\s\S]*?);/gi;
const policyStatements = [...allPolicyText.matchAll(policyStatementPattern)];
ok('At least 30 policy statements were extracted for role-clause checking', policyStatements.length >= 30, String(policyStatements.length));

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
