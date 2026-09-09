/* Benchmarks the password-hashing cost at the currently configured iteration
   count. Run under Node (same WebCrypto module the account-system tests use):

     node tests/bench-hash.mjs

   Caveat: this measures Node's WebCrypto on this machine, not Cloudflare
   Workers' actual CPU budget. It is a useful relative signal (did the cost
   change proportionally to the iteration count?) but not a substitute for
   measuring on a real Worker before launch — see the note in the report this
   script was written for. */

import {
  hashPassword, verifyPassword, needsRehash, DUMMY_HASH,
  CURRENT_ITERATIONS, HASH_ALGORITHM, HASH_FORMAT_VERSION,
} from '../worker/lib/crypto.js';

console.log('Algorithm:', HASH_ALGORITHM, '  Format version:', HASH_FORMAT_VERSION, '  Iterations:', CURRENT_ITERATIONS);
console.log('Runtime:', process.version, '(Node/WebCrypto)\n');

const N = 8;
const password = 'a-representative-parent-password-1!';

await hashPassword(password); // warm up (JIT, module init) before timing

const hashTimes = [];
let lastHash;
for (let i = 0; i < N; i++) {
  const t0 = performance.now();
  lastHash = await hashPassword(password);
  hashTimes.push(performance.now() - t0);
}

const verifyOkTimes = [];
for (let i = 0; i < N; i++) {
  const t0 = performance.now();
  const ok = await verifyPassword(password, lastHash);
  verifyOkTimes.push(performance.now() - t0);
  if (!ok) throw new Error('verify failed unexpectedly');
}

const verifyBadTimes = [];
for (let i = 0; i < N; i++) {
  const t0 = performance.now();
  const ok = await verifyPassword('wrong-password-attempt', lastHash);
  verifyBadTimes.push(performance.now() - t0);
  if (ok) throw new Error('verify should have failed');
}

const verifyDummyTimes = [];
for (let i = 0; i < N; i++) {
  const t0 = performance.now();
  const ok = await verifyPassword(password, DUMMY_HASH);
  verifyDummyTimes.push(performance.now() - t0);
  if (ok) throw new Error('dummy hash should never verify true');
}

const stats = arr => {
  const sorted = [...arr].sort((a, b) => a - b);
  const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
  return { min: sorted[0], max: sorted[sorted.length - 1], avg, median: sorted[Math.floor(sorted.length / 2)] };
};
const report = (label, arr) => {
  const s = stats(arr);
  console.log(`${label}: min=${s.min.toFixed(1)}ms  median=${s.median.toFixed(1)}ms  avg=${s.avg.toFixed(1)}ms  max=${s.max.toFixed(1)}ms  (n=${N})`);
};

report('hashPassword (new hash, current iter)    ', hashTimes);
report('verifyPassword (correct password)        ', verifyOkTimes);
report('verifyPassword (wrong password, real row)', verifyBadTimes);
report('verifyPassword (DUMMY_HASH, no such row) ', verifyDummyTimes);

const oldFormatHash = 'pbkdf2$sha256$210000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
console.log('\nneedsRehash(pre-upgrade 210k-iteration hash):', needsRehash(oldFormatHash), '(expect true)');
console.log('needsRehash(current-config hash):            ', needsRehash(lastHash), '(expect false)');
