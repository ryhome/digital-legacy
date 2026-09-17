// The only place private keys ever exist.
//
// The words and passphrase are posted in, the seed is derived here, and nothing secret is
// ever posted back out — only public keys, the fingerprint, and decrypted message text the
// user has explicitly asked to read. Locking is a worker.terminate(), which discards the
// whole heap rather than trusting a fill(0) the JIT was free to optimise away.

import {
  KDF_DEFAULTS, KDF_FALLBACK_M, argon2Master, argon2SelfTest, bip39Seed, checksumOk, equal,
  fingerprint, keysFromMaster, openEntry, sealEntry, wipeKeys,
} from './vault.js';
import { hex, randomBytes, zero } from './codec.js';

let keys = null;     // { xPriv, pkC, pqSk, pkPq }
let kdfUsed = null;

const post = (msg, transfer) => self.postMessage(msg, transfer || []);

function drop() {
  wipeKeys(keys);
  keys = null;
  kdfUsed = null;
}

/** Wipe the word/passphrase strings' backing arrays where we can; strings themselves we cannot. */
function scrub(req) {
  if (Array.isArray(req.words)) req.words.fill('');
  req.words = null;
  req.passphrase = null;
}

function deriveKeys(words, passphrase, kdf, onProgress) {
  let seed = null, master = null;
  try {
    seed = bip39Seed(words, passphrase);
    try {
      master = argon2Master(seed, kdf, onProgress);
    } catch (err) {
      // 128 MiB will not allocate on some phones. Drop once, and record what was actually used
      // so the vault always re-derives with the same cost from here on.
      if (kdf.m <= KDF_FALLBACK_M) throw err;
      kdf = { ...kdf, m: KDF_FALLBACK_M };
      master = argon2Master(seed, kdf, onProgress);
    }
    return { keys: keysFromMaster(master), kdf };
  } finally {
    zero(seed, master);
  }
}

self.onmessage = async (ev) => {
  const req = ev.data || {};
  const rid = req.rid;
  try {
    switch (req.t) {
      case 'selftest':
        post({ rid, t: 'ok', pass: argon2SelfTest() });
        break;

      // Time one Argon2id pass so genesis can freeze a t that costs 3-5 s on THIS device.
      case 'bench': {
        const salt = randomBytes(16);
        let m = req.m;
        const run = (mm, t) => {
          const t0 = performance.now();
          const out = argon2Master(new Uint8Array(64), { m: mm, t, p: 1, salt });
          zero(out);
          return performance.now() - t0;
        };
        let ms;
        try {
          ms = run(m, 1);
        } catch {
          m = KDF_FALLBACK_M;
          ms = run(m, 1);
        }
        zero(salt);
        post({ rid, t: 'ok', m, msPerPass: ms });
        break;
      }

      case 'derive': {
        drop();
        const words = req.words;
        if (!(await checksumOk(words))) {
          scrub(req);
          post({ rid, t: 'ok', result: 'checksum' });
          break;
        }
        const kdf = { ...KDF_DEFAULTS, ...req.kdf };
        let last = -1;
        const onProgress = (f) => {
          const pct = Math.floor(f * 100);
          if (pct !== last) { last = pct; post({ rid, t: 'progress', phase: 'argon2', frac: f }); }
        };
        post({ rid, t: 'progress', phase: 'seed', frac: 0 });
        const out = deriveKeys(words, req.passphrase || '', kdf, onProgress);
        scrub(req);
        post({ rid, t: 'progress', phase: 'keys', frac: 1 });
        keys = out.keys;
        kdfUsed = out.kdf;
        const fp = fingerprint(keys.pkC, keys.pkPq);

        if (req.expect) {
          const match = equal(keys.pkC, req.expect.pkC) && equal(keys.pkPq, req.expect.pkPq);
          if (!match) {
            const other = fp;
            drop();
            post({ rid, t: 'ok', result: 'mismatch', otherFingerprint: other });
            break;
          }
        }
        post({
          rid, t: 'ok', result: 'ok', fingerprint: fp,
          pkC: keys.pkC.slice(), pkPq: keys.pkPq.slice(),
          kdf: { ...kdfUsed, salt: kdfUsed.salt.slice() },
        });
        break;
      }

      case 'open': {
        if (!keys) throw new Error('locked');
        const items = [];
        for (const e of req.entries) {
          try {
            const { timestamp, label, message } = await openEntry(e, keys);
            items.push({ id: hex(e.id), seq: e.seq, ok: true, timestamp, label, message, size: e.ct.length });
          } catch {
            items.push({ id: hex(e.id), seq: e.seq, ok: false, size: e.ct.length, day: e.day });
          }
        }
        items.sort((a, b) => b.seq - a.seq);
        post({ rid, t: 'ok', items });
        break;
      }

      // Verify seals without revealing anything: used by the boot health check while unlocked.
      case 'verify': {
        if (!keys) throw new Error('locked');
        const bad = [];
        for (const e of req.entries) {
          try { await openEntry(e, keys); } catch { bad.push(e.seq); }
        }
        post({ rid, t: 'ok', bad });
        break;
      }

      case 'rekey': {
        if (!keys) throw new Error('locked');
        const plain = [];
        for (const e of req.entries) plain.push({ e, pt: await openEntry(e, keys) });

        const salt = randomBytes(16);
        const kdf = { ...kdfUsed, salt };
        const out = deriveKeys(req.words, req.passphrase || '', kdf, null);
        scrub(req);
        const fresh = out.keys;
        const entries = [];
        for (const { e, pt } of plain) {
          entries.push(await sealEntry({
            pkC: fresh.pkC, pkPq: fresh.pkPq, seq: e.seq,
            timestamp: pt.timestamp, label: pt.label, message: pt.message,
          }));
        }
        for (const { pt } of plain) { pt.message = ''; pt.label = ''; }
        wipeKeys(keys);
        keys = fresh;
        kdfUsed = out.kdf;
        post({
          rid, t: 'ok', fingerprint: fingerprint(fresh.pkC, fresh.pkPq),
          pkC: fresh.pkC.slice(), pkPq: fresh.pkPq.slice(),
          kdf: { ...out.kdf, salt: out.kdf.salt.slice() }, entries,
        });
        break;
      }

      case 'wipe':
        drop();
        post({ rid, t: 'ok' });
        break;

      default:
        throw new Error('unknown op');
    }
  } catch (err) {
    post({ rid, t: 'err', message: String((err && err.message) || err) });
  }
};
