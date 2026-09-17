// The whole cryptosystem, in one file, shared by the main thread and the key worker.
//
//   mnemonic (NFKD) + passphrase (NFKD)
//     -> seed   = PBKDF2-HMAC-SHA512(mnemonic, "mnemonic"+passphrase, 2048, 64)   [BIP39]
//       -> master = Argon2id(seed, meta.kdf.salt, m/t/p from meta.kdf)
//         -> HKDF-SHA256(master, "dm/v1/x25519",   32) -> X25519 private key
//         -> HKDF-SHA256(master, "dm/v1/mlkem768", 64) -> ML-KEM-768 keygen seed
//
// Every entry is a hybrid sealed box: it stays secret if EITHER X25519 or ML-KEM-768 holds.
// Writing needs only the public keys, so the seed is never in memory on the write path.

import { argon2id, hkdf, pbkdf2, sha256, sha512, x25519, ml_kem768, wordlist }
  from '../vendor/noble.js';
import {
  concat, entryAAD, equal, hex, packPlaintext, randomBytes, unpackPlaintext, utf8, zero,
} from './codec.js';

export { wordlist };

const LBL_X = utf8('dm/v1/x25519');
const LBL_PQ = utf8('dm/v1/mlkem768');
const LBL_ENTRY = utf8('dm/v1/entry');
const EMPTY = new Uint8Array(0);

export const KDF_DEFAULTS = { algo: 'argon2id', m: 131072, t: 3, p: 1 };
export const KDF_FALLBACK_M = 65536;   // only if 128 MiB will not allocate on the device

// ---------------------------------------------------------------- BIP39

const INDEX = new Map(wordlist.map((w, i) => [w, i]));
export const wordIndex = (w) => (INDEX.has(w) ? INDEX.get(w) : -1);
export const isWord = (w) => INDEX.has(w);

/** 256 bits of entropy -> 24 words with the BIP39 checksum. */
export async function generateWords() {
  const ent = randomBytes(32);
  try {
    return await wordsFromEntropy(ent);
  } finally {
    zero(ent);
  }
}

export async function wordsFromEntropy(ent) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', ent));
  const bits = [];
  for (const b of ent) for (let i = 7; i >= 0; i--) bits.push((b >> i) & 1);
  for (let i = 0; i < ent.length / 4; i++) bits.push((digest[i >> 3] >> (7 - (i & 7))) & 1);
  const out = [];
  for (let i = 0; i < bits.length; i += 11) {
    let n = 0;
    for (let j = 0; j < 11; j++) n = (n << 1) | bits[i + j];
    out.push(wordlist[n]);
  }
  zero(digest);
  return out;
}

/** True when the 24 words carry a valid BIP39 checksum. */
export async function checksumOk(words) {
  if (words.length !== 24 || !words.every(isWord)) return false;
  const bits = [];
  for (const w of words) {
    const n = INDEX.get(w);
    for (let i = 10; i >= 0; i--) bits.push((n >> i) & 1);
  }
  const ent = new Uint8Array(32);
  for (let i = 0; i < 256; i++) ent[i >> 3] |= bits[i] << (7 - (i & 7));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', ent));
  let ok = true;
  for (let i = 0; i < 8; i++) ok = ok && bits[256 + i] === ((digest[i >> 3] >> (7 - (i & 7))) & 1);
  zero(ent, digest);
  return ok;
}

// ---------------------------------------------------------------- key schedule

/** BIP39 seed. Caller owns the result and must zero it. */
export function bip39Seed(words, passphrase) {
  const mnemonic = utf8(words.join(' ').normalize('NFKD'));
  const salt = utf8(('mnemonic' + (passphrase || '')).normalize('NFKD'));
  try {
    return pbkdf2(sha512, mnemonic, salt, { c: 2048, dkLen: 64 });
  } finally {
    zero(mnemonic, salt);
  }
}

export function argon2Master(seed, kdf, onProgress) {
  return argon2id(seed, kdf.salt, {
    m: kdf.m, t: kdf.t, p: kdf.p, dkLen: 32, version: 0x13,
    maxmem: (kdf.m + 1024) * 1024,
    onProgress,
  });
}

/** master -> the two private keys plus their public halves. Caller must call wipeKeys(). */
export function keysFromMaster(master) {
  const xPriv = hkdf(sha256, master, EMPTY, LBL_X, 32);
  const pqSeed = hkdf(sha256, master, EMPTY, LBL_PQ, 64);
  try {
    const pq = ml_kem768.keygen(pqSeed);
    return {
      xPriv,
      pkC: x25519.getPublicKey(xPriv),
      pqSk: pq.secretKey,
      pkPq: pq.publicKey,
    };
  } finally {
    zero(pqSeed);
  }
}

export function wipeKeys(keys) {
  if (!keys) return;
  zero(keys.xPriv, keys.pqSk);
  keys.xPriv = keys.pqSk = null;
}

/** Display-only vault identity. Reveals nothing: it is a hash of public keys. */
export function fingerprint(pkC, pkPq) {
  const h = hex(sha256(concat(pkC, pkPq))).slice(0, 12);
  return `${h.slice(0, 4)}-${h.slice(4, 8)}-${h.slice(8, 12)}`;
}

// ---------------------------------------------------------------- per-entry sealed box

function entryKeyMaterial(ephPub, ctPq, pkC, pkPq, ssC, ssPq) {
  const info = concat(LBL_ENTRY, ephPub, ctPq, pkC, pkPq);
  const ikm = concat(ssC, ssPq);
  try {
    return hkdf(sha256, ikm, EMPTY, info, 32);
  } finally {
    zero(ikm, info);
  }
}

async function aesKey(raw) {
  // extractable: false — once imported, the key cannot be read back out of WebCrypto.
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/**
 * Write path. Needs only the vault's public keys, so it runs with no seed in memory.
 * Returns the stored entry record.
 */
export async function sealEntry({ pkC, pkPq, seq, timestamp, label, message }) {
  const id = randomBytes(16);
  const day = Math.floor(timestamp / 86400000);
  const { cipherText: ctPq, sharedSecret: ssPq } = ml_kem768.encapsulate(pkPq);
  const ephPriv = x25519.utils.randomSecretKey();
  let ssC = null, keyRaw = null, pt = null;
  try {
    const ephPub = x25519.getPublicKey(ephPriv);
    ssC = x25519.getSharedSecret(ephPriv, pkC);
    keyRaw = entryKeyMaterial(ephPub, ctPq, pkC, pkPq, ssC, ssPq);
    const key = await aesKey(keyRaw);
    const nonce = randomBytes(12);
    pt = packPlaintext({ timestamp, label, message });
    const ct = new Uint8Array(await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce, additionalData: entryAAD({ id, seq, day }), tagLength: 128 },
      key, pt,
    ));
    return { id, seq, day, ephPub, ctPq, nonce, ct };
  } finally {
    zero(ephPriv, ssC, ssPq, keyRaw, pt);
  }
}

/** Read path. Needs the private keys, so this only ever runs inside the key worker. */
export async function openEntry(entry, keys) {
  let ssPq = null, ssC = null, keyRaw = null, pt = null;
  try {
    ssPq = ml_kem768.decapsulate(entry.ctPq, keys.pqSk);
    ssC = x25519.getSharedSecret(keys.xPriv, entry.ephPub);
    keyRaw = entryKeyMaterial(entry.ephPub, entry.ctPq, keys.pkC, keys.pkPq, ssC, ssPq);
    const key = await aesKey(keyRaw);
    pt = new Uint8Array(await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: entry.nonce,
        additionalData: entryAAD(entry), tagLength: 128 },
      key, entry.ct,
    ));
    return unpackPlaintext(pt);
  } finally {
    zero(ssPq, ssC, keyRaw, pt);
  }
}

/** RFC 9106 Argon2id test vector — run once at boot so a broken build fails loudly. */
export function argon2SelfTest() {
  const out = argon2id(new Uint8Array(32).fill(1), new Uint8Array(16).fill(2), {
    t: 3, m: 32, p: 4, dkLen: 32, version: 0x13,
    key: new Uint8Array(8).fill(3), personalization: new Uint8Array(12).fill(4),
  });
  return hex(out) === '0d640df58d78766c08c037a34a8b53c9d01ef0452d75b65eb52520e96b01e659';
}

export { equal };
