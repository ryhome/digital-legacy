// Byte plumbing shared by the main thread and the key worker:
// zeroing, constant-time compare, base64, the sealed-entry AAD and the padded plaintext frame.

export const BUCKETS = [1024, 4096, 16384];
export const PT_VERSION = 1;
export const ENTRY_VERSION = 1;

export function zero(...arrays) {
  for (const a of arrays) {
    if (!a) continue;
    if (a instanceof Uint8Array) a.fill(0);
    else if (a instanceof ArrayBuffer) new Uint8Array(a).fill(0);
    else if (Array.isArray(a)) zero(...a);
  }
}

/** Constant-time equality. Used for every public-key and fingerprint comparison. */
export function equal(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

export function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

export const utf8 = (s) => new TextEncoder().encode(s);
export const fromUtf8 = (b) => new TextDecoder('utf-8', { fatal: true }).decode(b);

export function randomBytes(n) {
  return crypto.getRandomValues(new Uint8Array(n));
}

export function toB64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromB64(str, expectLen) {
  if (typeof str !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(str)) throw new Error('bad base64');
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  if (expectLen !== undefined && out.length !== expectLen) throw new Error('bad length');
  return out;
}

export function hex(u8) {
  return Array.from(u8, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Additional authenticated data: the whole unencrypted header, so none of it can be edited. */
export function entryAAD({ id, seq, day }) {
  const aad = new Uint8Array(1 + 16 + 4 + 4);
  const dv = new DataView(aad.buffer);
  aad[0] = ENTRY_VERSION;
  aad.set(id, 1);
  dv.setUint32(17, seq, false);
  dv.setUint32(21, day >>> 0, false);
  return aad;
}

export function bucketFor(payloadLen) {
  const need = 4 + payloadLen;
  const b = BUCKETS.find((x) => x >= need);
  if (b === undefined) throw new Error('too long');
  return b;
}

/**
 * Plaintext frame, padded so the ciphertext length says nothing but the bucket:
 *   u32be payloadLen | u8 fmt | u64be timestampMs | u16be labelLen | u32be msgLen
 *   | label | message | zero padding
 */
export function packPlaintext({ timestamp, label, message }) {
  const lab = utf8(label || '');
  const msg = utf8(message || '');
  if (lab.length > 0xffff) throw new Error('label too long');
  const payloadLen = 1 + 8 + 2 + 4 + lab.length + msg.length;
  const size = bucketFor(payloadLen);
  const out = new Uint8Array(size);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, payloadLen, false);
  out[4] = PT_VERSION;
  dv.setBigUint64(5, BigInt(timestamp), false);
  dv.setUint16(13, lab.length, false);
  dv.setUint32(15, msg.length, false);
  out.set(lab, 19);
  out.set(msg, 19 + lab.length);
  zero(lab, msg);
  return out;
}

export function unpackPlaintext(pt) {
  if (pt.length < 19) throw new Error('short plaintext');
  const dv = new DataView(pt.buffer, pt.byteOffset, pt.byteLength);
  const payloadLen = dv.getUint32(0, false);
  if (payloadLen < 15 || 4 + payloadLen > pt.length) throw new Error('bad frame');
  if (pt[4] !== PT_VERSION) throw new Error('unknown plaintext version');
  const timestamp = Number(dv.getBigUint64(5, false));
  const labLen = dv.getUint16(13, false);
  const msgLen = dv.getUint32(15, false);
  if (19 + labLen + msgLen !== 4 + payloadLen) throw new Error('bad lengths');
  return {
    timestamp,
    label: fromUtf8(pt.subarray(19, 19 + labLen)),
    message: fromUtf8(pt.subarray(19 + labLen, 19 + labLen + msgLen)),
  };
}

/** Days since the Unix epoch — the only date granularity a locked vault reveals. */
export const dayOf = (ms) => Math.floor(ms / 86400000);
export const msOfDay = (day) => day * 86400000;
