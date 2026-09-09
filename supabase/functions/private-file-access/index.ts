// ============================================================================
// private-file-access — SCAFFOLD ONLY, AND POSSIBLY UNNECESSARY.
//
// Included because the brief listed it ("if needed") — but note this
// explicitly: Supabase Storage's own RLS policies on storage.objects (see
// supabase/storage/buckets.sql) already gate parent-media and
// school-documents reads directly. A signed-in parent's own Supabase client
// can call `supabase.storage.from('parent-media').download(path)` and the
// existing bucket policies already decide yes/no — no Edge Function is
// required for the equivalent of worker/routes/files.js's streamAsset().
//
// This function is only useful if a SHORT-LIVED, SHAREABLE SIGNED URL is
// wanted instead (e.g. a link that works for 60 seconds without the
// recipient needing their own Supabase session — useful for opening a
// document in a new tab/print dialog rather than fetching it via the SDK).
// If that use case doesn't come up, do not deploy this function at all —
// fewer deployed functions is fewer things to keep secure.
//
// If it IS needed: this must still re-check the SAME visibility rule the
// bucket policy already encodes (do not assume the caller already passed
// that check) — otherwise this function becomes a way to bypass the bucket
// policy rather than a convenience on top of it.
// ============================================================================

import { createClient } from 'jsr:@supabase/supabase-js@2';

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);

  const authHeader = req.headers.get('Authorization'); // may be absent — a public file needs no session
  const caller = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    authHeader ? { global: { headers: { Authorization: authHeader } } } : undefined
  );

  let body: { bucket?: string; path?: string };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: 'bad_request' }, 400);
  }
  if (!body.bucket || !body.path) return json({ ok: false, error: 'bad_request' }, 400);

  // TODO (implementation, only if this function is actually deployed):
  //   1. Re-derive visibility the same way the matching bucket policy does
  //      (join document_versions -> documents, or check the owning
  //      gallery's visibility) using the CALLER's own client (caller, not a
  //      service-role client) — so a denied read here fails exactly the
  //      way the bucket policy would have failed it directly, not more
  //      permissively.
  //   2. Only once confirmed visible, use a service-role client to call
  //      `admin.storage.from(body.bucket).createSignedUrl(body.path, 60)`
  //      and return that URL. A signed URL is bearer-token-like — treat the
  //      response the same way worker/lib/audit.js treats anything
  //      secret-shaped: never log it, never write it into audit_log.

  return json({ ok: false, error: 'not_implemented' }, 501);
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
