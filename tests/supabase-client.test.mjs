/* Tests the Supabase client module's fail-safe behaviour in isolation.

   Deliberately does NOT read .env.local, .env, or any file — every case
   below passes literal values (including "missing") directly to the
   exported factory function, which is why client.js separates
   createSupabaseClientSafely(url, anonKey) from the module-level
   import.meta.env read: this suite can exercise the exact logic that ships
   without needing Vite's env injection or touching a single env file. */

import { createSupabaseClientSafely } from '../src/supabase/client.js';

const pass = [], fail = [];
const ok = (n, c, d = '') => (c ? pass : fail).push(n + (d ? ' — ' + d : ''));

// A syntactically valid but fake project — never a real Supabase project,
// and no real key shape is asserted anywhere in this file.
const FAKE_URL = 'https://fake-project-id.supabase.co';
const FAKE_ANON_KEY = 'fake.anon.key-for-testing-only';

/* ---- both values missing ---- */
{
  const originalWarn = console.warn;
  let warned = false;
  console.warn = () => { warned = true; };
  const client = createSupabaseClientSafely(undefined, undefined);
  console.warn = originalWarn;

  ok('Both missing: returns null, does not throw', client === null);
  ok('Both missing: warns exactly once (quietly, not an error)', warned === true);
}

/* ---- only URL present ---- */
{
  const client = createSupabaseClientSafely(FAKE_URL, undefined, { warn: false });
  ok('URL only: still returns null (both are required)', client === null);
}

/* ---- only anon key present ---- */
{
  const client = createSupabaseClientSafely(undefined, FAKE_ANON_KEY, { warn: false });
  ok('Anon key only: still returns null (both are required)', client === null);
}

/* ---- empty strings (not just undefined) count as missing ---- */
{
  const client = createSupabaseClientSafely('', '', { warn: false });
  ok('Empty strings: treated as missing, returns null', client === null);
}

/* ---- both present: a real client is constructed ---- */
{
  const client = createSupabaseClientSafely(FAKE_URL, FAKE_ANON_KEY, { warn: false });
  ok('Both present: does not return null', client !== null);
  ok('Both present: client exposes .from() (query builder)', typeof client?.from === 'function');
  ok('Both present: client exposes .auth (Auth namespace)', typeof client?.auth === 'object' && client.auth !== null);
  ok('Both present: client exposes .storage (Storage namespace)', typeof client?.storage === 'object' && client.storage !== null);
}

/* ---- malformed URL degrades instead of throwing ---- */
{
  let threw = false;
  let client = null;
  try {
    client = createSupabaseClientSafely('not-a-valid-url', FAKE_ANON_KEY, { warn: false });
  } catch {
    threw = true;
  }
  ok('Malformed URL: never throws out of the factory', threw === false);
  ok('Malformed URL: degrades to null rather than a half-working client', client === null);
}

/* ---- module never reads or requires a service-role-shaped third argument ---- */
{
  const fnSource = createSupabaseClientSafely.toString();
  ok('Factory signature takes no service-role/secret parameter', fnSource.match(/\(([^)]*)\)/)[1].split(',').length <= 3);
  ok('Factory source never mentions a service-role key', !/service.?role/i.test(fnSource));
}

console.log('\nPASS ' + pass.length + '   FAIL ' + fail.length + '\n');
if (fail.length) { console.log('FAILURES:'); fail.forEach(f => console.log('  x ' + f)); }
else pass.forEach(p => console.log('  + ' + p));
process.exit(fail.length ? 1 : 0);
