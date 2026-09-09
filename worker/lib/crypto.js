/* Password hashing and token generation.

   Workers have no native bcrypt/argon2, and shipping one as WASM is a large
   dependency for a site this size. PBKDF2 is the accepted alternative and is
   available through WebCrypto, which behaves identically in workerd and in
   Node (verified — see tests/account-system.test.mjs, which runs this exact
   module under Node).

   ALGORITHM NOTE: WebCrypto's PBKDF2 always uses HMAC as its underlying PRF
   (RFC 8018 / RFC 2898) — passing `hash: 'SHA-256'` to `deriveBits` already
   means PBKDF2-HMAC-SHA256, not a different construction. Naming it
   explicitly below (ALGORITHM = 'pbkdf2-hmac-sha256') makes that precise in
   the stored format; the actual computation is unchanged from before.

   ============================================================================
   HASH FORMAT — versioned, so cost and encoding can change without breaking
   existing accounts:

     pbkdf2-hmac-sha256$v1$<iterations>$<salt-b64url>$<hash-b64url>

     algorithm   pbkdf2-hmac-sha256   fixed for v1
     version     v1                   the FORMAT (field layout/encoding),
                                       independent of iteration count — bump
                                       this if the encoding or field set ever
                                       changes, even at the same iteration count
     iterations  decimal integer      cost factor used for this specific hash
     salt        16 random bytes,     unique per password, generated fresh by
                 base64url            hashPassword() every time
     hash        32-byte derived key, output of PBKDF2-HMAC-SHA256
                 base64url

   CURRENT_ITERATIONS is the count used for every NEW hash. Existing hashes
   keep whatever iteration count they were created with — see needsRehash().
   ============================================================================ */

const ALGORITHM = 'pbkdf2-hmac-sha256';
const FORMAT_VERSION = 'v1';
const CURRENT_ITERATIONS = 600000;          // required minimum per this pass
const MIN_ACCEPTED_ITERATIONS = 100000;      // floor for any hash this code will still verify
const SALT_BYTES = 16;                       // cryptographically random, unique per password
const KEY_BITS = 256;

const b64url = buf =>
  btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const fromB64url = s => {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(b, c => c.charCodeAt(0));
};

async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']
  );
  // hash: 'SHA-256' is what makes this PBKDF2-HMAC-SHA256 (see file header).
  return crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, KEY_BITS
  );
}

/** Hashes a new password at the current algorithm/version/iteration count,
    with a fresh cryptographically random salt. Never reuses a salt. */
export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const bits = await pbkdf2(password, salt, CURRENT_ITERATIONS);
  return `${ALGORITHM}$${FORMAT_VERSION}$${CURRENT_ITERATIONS}$${b64url(salt)}$${b64url(bits)}`;
}

/* LEGACY FORMAT — from the pass before this one, before the algorithm/version
   fields existed: pbkdf2$sha256$<iterations>$<salt-b64url>$<hash-b64url>.
   Cryptographically it is the SAME primitive (PBKDF2 with the SHA-256 PRF,
   i.e. PBKDF2-HMAC-SHA256) at a lower iteration count (210,000) — only the
   stored string's shape differs, not the algorithm. Recognising it here is
   what makes the required upgrade-on-login behaviour possible: without this,
   any account hashed under the previous pass could never verify OR be
   rehashed again, because the new ALGORITHM string wouldn't match at all.
   Remove this branch once no account can plausibly still hold such a hash. */
const LEGACY_ALGORITHM = 'pbkdf2';
const LEGACY_HASH_NAME = 'sha256';

/** Parses a stored hash (current or legacy format) into its fields, or null. */
function parseHash(stored) {
  if (typeof stored !== 'string') return null;
  const parts = stored.split('$');
  if (parts.length !== 5) return null;

  if (parts[0] === ALGORITHM && parts[1] === FORMAT_VERSION) {
    const iterations = Number(parts[2]);
    if (!Number.isInteger(iterations) || iterations < MIN_ACCEPTED_ITERATIONS) return null;
    return { formatKind: 'current', iterations, saltB64: parts[3], hashB64: parts[4] };
  }
  if (parts[0] === LEGACY_ALGORITHM && parts[1] === LEGACY_HASH_NAME) {
    const iterations = Number(parts[2]);
    if (!Number.isInteger(iterations) || iterations < MIN_ACCEPTED_ITERATIONS) return null;
    return { formatKind: 'legacy', iterations, saltB64: parts[3], hashB64: parts[4] };
  }
  return null;
}

/** Constant-time comparison so timing cannot reveal how much of a hash matched. */
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/* A well-formed hash of a value nobody will ever type, used so verifyPassword
   always performs a full PBKDF2 computation even when the account being
   logged into does not exist or has no password set yet. Without this, a
   nonexistent-account login returns almost instantly while a real,
   wrong-password attempt takes as long as CURRENT_ITERATIONS costs — an
   account-enumeration side channel through response timing, on top of the
   already-identical status code and message. This constant is fixed and
   public; it is not a secret and matches no real account. */
const DUMMY_HASH =
  `${ALGORITHM}$${FORMAT_VERSION}$${CURRENT_ITERATIONS}$` +
  'AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

/**
 * Verifies a password against a stored hash. Always runs the full PBKDF2
 * computation — callers must pass DUMMY_HASH (exported below) in place of a
 * missing stored hash, never skip the call, or the timing channel reopens.
 */
export async function verifyPassword(password, stored) {
  const parsed = parseHash(stored);
  if (!parsed) {
    // Still do constant-cost work so a malformed/legacy hash doesn't create
    // its own timing tell.
    await pbkdf2(password, new Uint8Array(SALT_BYTES), MIN_ACCEPTED_ITERATIONS);
    return false;
  }
  try {
    const bits = await pbkdf2(password, fromB64url(parsed.saltB64), parsed.iterations);
    return timingSafeEqual(new Uint8Array(bits), fromB64url(parsed.hashB64));
  } catch {
    return false;
  }
}

/**
 * True if a successfully-verified hash was produced at a lower iteration
 * count (or, in the future, an older format version) than the current
 * configuration — the caller should then compute a fresh hash of the same
 * password and store that instead. Only ever upgrades: if a hash already
 * meets or exceeds CURRENT_ITERATIONS, this returns false, so a stored hash
 * is never re-derived at a WEAKER setting than it already has.
 */
export function needsRehash(stored) {
  const parsed = parseHash(stored);
  if (!parsed) return false; // unparseable — verifyPassword already rejected it, nothing to upgrade
  if (parsed.formatKind !== 'current') return true; // legacy format — always upgrade on next login
  return parsed.iterations < CURRENT_ITERATIONS;
}

export { DUMMY_HASH, CURRENT_ITERATIONS, ALGORITHM as HASH_ALGORITHM, FORMAT_VERSION as HASH_FORMAT_VERSION };

/** 32 bytes of entropy, base64url. Used for session and invitation tokens. */
export function generateToken() {
  return b64url(crypto.getRandomValues(new Uint8Array(32)));
}

/** Tokens are stored only as their SHA-256, so a database leak is not replayable. */
export async function hashToken(token) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return b64url(digest);
}

export function newId(prefix = '') {
  return prefix + b64url(crypto.getRandomValues(new Uint8Array(12)));
}
