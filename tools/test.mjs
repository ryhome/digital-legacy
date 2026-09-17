import * as V from '../js/vault.js';
import { zero } from '../js/codec.js';

const words = await V.generateWords();
console.assert(words.length === 24, '24 words');
console.assert(await V.checksumOk(words), 'checksum valid');
const bad = words.slice(); bad[5] = bad[5] === 'zoo' ? 'abandon' : 'zoo';
console.assert(!(await V.checksumOk(bad)), 'tampered checksum rejected');

const kdf = { ...V.KDF_DEFAULTS, m: 8192, t: 1, salt: new Uint8Array(16).fill(9) };
const seed = V.bip39Seed(words, 'a passphrase');
const master = V.argon2Master(seed, kdf);
const keys = V.keysFromMaster(master);
console.log('pkC', keys.pkC.length, 'pkPq', keys.pkPq.length, V.fingerprint(keys.pkC, keys.pkPq));

// determinism
const m2 = V.argon2Master(V.bip39Seed(words, 'a passphrase'), kdf);
const k2 = V.keysFromMaster(m2);
console.assert(V.equal(keys.pkC, k2.pkC) && V.equal(keys.pkPq, k2.pkPq), 'deterministic');

// wrong passphrase -> different keys
const k3 = V.keysFromMaster(V.argon2Master(V.bip39Seed(words, 'a passphras'), kdf));
console.assert(!V.equal(keys.pkC, k3.pkC), 'passphrase matters');

// seal / open round trip
const ts = Date.now();
const e = await V.sealEntry({ pkC: keys.pkC, pkPq: keys.pkPq, seq: 4, timestamp: ts,
  label: 'For Nok, and only Nok', message: 'ข้อความ — the boat story.' });
console.log('entry', e.ephPub.length, e.ctPq.length, e.nonce.length, e.ct.length);
console.assert(e.ct.length === 1024 + 16, 'padded to 1 KB bucket + tag, got ' + e.ct.length);
const got = await V.openEntry({ ...e, pkC: keys.pkC }, keys);
console.assert(got.message === 'ข้อความ — the boat story.', 'message round trip');
console.assert(got.label === 'For Nok, and only Nok', 'label round trip');
console.assert(got.timestamp === ts, 'timestamp round trip');

// AAD is load-bearing: flipping seq must fail
let threw = false;
try { await V.openEntry({ ...e, seq: 5 }, keys); } catch { threw = true; }
console.assert(threw, 'seq tamper rejected');
threw = false;
try { await V.openEntry({ ...e, day: e.day + 1 }, keys); } catch { threw = true; }
console.assert(threw, 'day tamper rejected');
threw = false;
const ct2 = e.ct.slice(); ct2[10] ^= 1;
try { await V.openEntry({ ...e, ct: ct2 }, keys); } catch { threw = true; }
console.assert(threw, 'ciphertext tamper rejected');

// wrong key cannot open
threw = false;
try { await V.openEntry(e, k3); } catch { threw = true; }
console.assert(threw, 'wrong vault key rejected');

// buckets
for (const [len, want] of [[0, 1024], [1005, 1024], [1006, 4096], [4077, 4096], [4078, 16384], [16365, 16384]]) {
  const x = await V.sealEntry({ pkC: keys.pkC, pkPq: keys.pkPq, seq: 1, timestamp: ts,
    label: '', message: 'x'.repeat(len) });
  console.assert(x.ct.length === want + 16, `bucket ${len} -> ${want}, got ${x.ct.length - 16}`);
}
console.assert(V.argon2SelfTest(), 'RFC 9106 argon2id vector');
zero(seed, master); V.wipeKeys(keys);

// Over the top bucket is refused rather than silently leaking length in a new size.
let over = false;
try {
  await V.sealEntry({ pkC: keys.pkC, pkPq: keys.pkPq, seq: 1, timestamp: ts, label: '', message: 'x'.repeat(16366) });
} catch { over = true; }
console.assert(over, 'oversize message refused');

console.log('vault.js self-check OK');
