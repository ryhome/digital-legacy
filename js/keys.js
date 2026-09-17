// Main-thread handle on the key worker. The worker is created when a derivation starts and
// terminated the moment the vault locks — terminate() is the wipe, everything else is belt.

let worker = null;
let seq = 0;
const pending = new Map();

function ensure() {
  if (worker) return worker;
  worker = new Worker('./js/keyworker.js', { type: 'module', name: 'dm-keys' });
  worker.onmessage = (ev) => {
    const { rid, t } = ev.data || {};
    const p = pending.get(rid);
    if (!p) return;
    if (t === 'progress') { if (p.onProgress) p.onProgress(ev.data); return; }
    pending.delete(rid);
    if (t === 'err') p.reject(new Error(ev.data.message));
    else p.resolve(ev.data);
  };
  worker.onerror = (ev) => {
    const err = new Error(ev.message || 'key worker failed');
    for (const p of pending.values()) p.reject(err);
    pending.clear();
    terminate();
  };
  return worker;
}

const TIMEOUT_MS = 180000;   // far beyond any honest derivation, short of hanging for ever

export function call(msg, onProgress) {
  const w = ensure();
  const rid = ++seq;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (!pending.has(rid)) return;
      pending.delete(rid);
      terminate();
      reject(new Error('the key worker stopped responding'));
    }, TIMEOUT_MS);
    const done = (fn) => (v) => { clearTimeout(timer); fn(v); };
    pending.set(rid, { resolve: done(resolve), reject: done(reject), onProgress });
    w.postMessage({ ...msg, rid });
  });
}

/** Lock. Discards the worker heap outright, which is the only wipe that is not best-effort. */
export function terminate() {
  if (!worker) return;
  worker.terminate();
  worker = null;
  for (const p of pending.values()) p.reject(new Error('locked'));
  pending.clear();
}

