// Boot, routing, the install gate, background blanking and locking.
//
// Two rules this file exists to keep:
//   1. Nothing renders until the app is running as an installed app with working storage.
//   2. The moment the app leaves the foreground, decrypted content is removed from the DOM
//      and the key worker is terminated. Not hidden, not blurred — removed.

import { announce, clear, h } from './dom.js';
import { getLocale, initLocale, t } from './i18n.js';
import * as db from './db.js';
import * as keys from './keys.js';
import { APP_VERSION, RELEASE_HASH, releaseShort } from './version.js';

export const state = {
  route: 'boot',
  params: {},
  vaults: [],             // every vault record on this device, oldest first
  meta: null,             // the current one, or null until one is chosen
  entries: [],
  damaged: [],
  session: null,          // { items, openedAt, expiresAt, extensions }
  prefs: { relock: 120, theme: 'auto' },
  persisted: false,
  swWaiting: null,
  shareInFlight: false,
  diag: [],
  installPrompt: null,
  installPromptFired: false,
  browserVaultSeen: false,
  iconsOk: undefined,
  swError: null,
};

const VIEWS = {};
export const registerViews = (map) => Object.assign(VIEWS, map);

// Anything holding a secret registers a cleanup here; lock() runs all of them.
const cleanups = [];
export const onLock = (fn) => cleanups.push(fn);

let root = null;
let blankEl = null;
let relockTimer = null;

// ---------------------------------------------------------------- environment

/** Installed-app detection. A vault created in a tab is stranded, so the tab renders nothing else. */
export function isStandalone() {
  const modes = ['standalone', 'fullscreen', 'minimal-ui', 'window-controls-overlay'];
  if (modes.some((m) => matchMedia(`(display-mode: ${m})`).matches)) return true;
  if (navigator.standalone === true) return true;
  // Local development only: 127.0.0.1 and localhost are never the production origin.
  return ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
}

export function platform() {
  const ua = navigator.userAgent;
  const iOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (iOS) {
    const safari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
    return safari ? 'ios' : 'ios-other';
  }
  if (/Android/.test(ua)) return 'android';
  return 'desktop';
}

export const isDesktop = () => platform() === 'desktop';

// ---------------------------------------------------------------- theme

export function applyTheme(pref) {
  state.prefs.theme = pref;
  document.documentElement.dataset.theme = pref;
  try { localStorage.setItem('dm.theme', pref); } catch { /* ignore */ }
}

export function applyRelock(secs) {
  state.prefs.relock = secs;
  try { localStorage.setItem('dm.relock', String(secs)); } catch { /* ignore */ }
}

function loadPrefs() {
  try {
    const th = localStorage.getItem('dm.theme');
    if (th) state.prefs.theme = th;
    // Number(null) is 0, and 0 means "until I lock it" — the least safe option. Only an
    // explicitly stored value may change the 120 s default.
    const rl = localStorage.getItem('dm.relock');
    if (rl !== null && [60, 120, 300, 0].includes(Number(rl))) state.prefs.relock = Number(rl);
  } catch { /* storage may be blocked; defaults are fine */ }
  document.documentElement.dataset.theme = state.prefs.theme;
}

// ---------------------------------------------------------------- routing

export function go(route, params = {}) {
  state.route = route;
  state.params = params;
  render();
}

// The only two routes allowed to print, and the only two that ever fill #print.
const PRINTABLE = ['print', 'print-heir'];

export function render() {
  const view = VIEWS[state.route];
  document.body.className = 'route-' + state.route;
  if (!PRINTABLE.includes(state.route)) clearPrintSheet();
  clear(root);
  root.append(view ? view(state.params) : h('p', 'missing view: ' + state.route));
  root.scrollTop = 0;
  window.scrollTo(0, 0);
}

// ---------------------------------------------------------------- locking and blanking

/** The wipe. terminate() discards the worker heap; the DOM loses every decrypted character. */
export function lock({ silent } = {}) {
  const wasOpen = !!state.session;
  state.session = null;
  clearPrintSheet();
  for (const fn of cleanups) { try { fn(); } catch { /* a failed cleanup must not stop the rest */ } }
  clearInterval(relockTimer);
  relockTimer = null;
  keys.terminate();
  if (wasOpen) {
    clear(root);
    if (!silent) announce(t('read.locknow'));
    if (['read', 'unlock', 'print', 'rekey'].includes(state.route)) go('home');
    else render();
  }
}

export const isUnlocked = () => !!state.session;

export function startRelockTimer(onTick) {
  clearInterval(relockTimer);
  if (!state.session || state.prefs.relock === 0) return;
  relockTimer = setInterval(() => {
    if (!state.session) { clearInterval(relockTimer); return; }
    const left = Math.ceil((state.session.expiresAt - Date.now()) / 1000);
    if (left === 20 || left === 5) announce(t('read.sr.relock', { n: left }));
    if (left <= 0) { lock(); return; }
    onTick && onTick(left);
  }, 250);
}

export function extendRelock(seconds = 120) {
  if (!state.session) return;
  state.session.expiresAt += seconds * 1000;
}

/** The plate sheet holds all 24 words. It exists only while the print view is on screen. */
export function clearPrintSheet() {
  const el = document.getElementById('print');
  if (el) clear(el);
}

function paintBlank() {
  if (!blankEl) return;
  blankEl.hidden = false;
  // Remove content, do not merely cover it: a CSS blur is still in the DOM and still in a snapshot.
  clear(root);
}

function unblankOnTap() {
  blankEl.hidden = true;
  render();
}

function wireBackgrounding() {
  const leave = () => {
    paintBlank();
    lock({ silent: true });
  };
  document.addEventListener('visibilitychange', () => {
    if (document.hidden || document.visibilityState === 'hidden') {
      // On Android a share sheet or file chooser covers the page and reports it hidden. The
      // two screens that open one hold nothing decrypted, so there is nothing to blank — and
      // blanking would detach the very element the result is about to be written into.
      if (!state.shareInFlight) leave();
      return;
    }
    // A cancelled chooser never reports back, so the flag is cleared on the way in.
    state.shareInFlight = false;
    // Re-check the gate on the way back in: a PWA can be reopened in a tab.
    if (!isStandalone() && state.route !== 'install') go('install');
  });
  window.addEventListener('pagehide', leave);
  // Desktop only. On a phone, blur fires for the share sheet and the file picker.
  if (isDesktop()) window.addEventListener('blur', () => { if (!state.shareInFlight) leave(); });
  blankEl.addEventListener('click', unblankOnTap);
}

// ---------------------------------------------------------------- global keys

function wireCrashReporting() {
  let shown = false;
  const report = (err) => {
    if (shown) return;
    shown = true;
    lock({ silent: true });          // whatever failed, do not leave a key sitting in memory
    const detail = [
      String((err && err.message) || err),
      String((err && err.stack) || '').split('\n').slice(0, 8).join('\n'),
      diagnostics(),
      'route -> ' + state.route,
    ].join('\n');
    clear(root);
    root.append(h('div.screen.stack-lg',
      h('h1.t-display', t('crash.title')),
      h('p.t-body', t('crash.body')),
      h('div.card.stack', { style: { gap: '6px' } },
        h('div.t-caption', t('crash.where')),
        h('pre.mo', {
          style: { fontSize: '12px', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            color: 'var(--ink-2)', userSelect: 'text' },
        }, detail)),
      h('p.t-caption', t('crash.safe')),
      h('button.btn.btn--primary', { type: 'button', onclick: () => location.reload() },
        t('crash.reload'))));
  };
  window.addEventListener('error', (e) => report(e.error || e.message));
  window.addEventListener('unhandledrejection', (e) => report(e.reason));
}

function wireKeys() {
  window.addEventListener('keydown', (e) => {
    // Esc always means lock. It is never bound to "close dialog", so it always means one thing.
    if (e.key === 'Escape') {
      if (state.session) { e.preventDefault(); lock(); }
      return;
    }
    if ((e.metaKey || e.ctrlKey) && (e.key === 'p' || e.key === 'P') && !PRINTABLE.includes(state.route)) {
      e.preventDefault();
      announce(t('print.blocked'));
      const bar = h('div.caution', h('div', t('print.blocked')));
      root.prepend(bar);
      setTimeout(() => bar.remove(), 8000);
    }
  });
}

// ---------------------------------------------------------------- service worker

async function wireServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register('./sw.js', { scope: './', updateViaCache: 'none' });
    const watch = () => {
      // A worker only "waits" behind an existing one. With no controller this is the first
      // install, not an update — announcing it would tell someone their brand-new app is stale.
      if (reg.waiting && navigator.serviceWorker.controller) {
        state.swWaiting = reg.waiting;
        if (['home', 'vaults'].includes(state.route)) render();
      }
    };
    watch();
    reg.addEventListener('updatefound', () => {
      const sw = reg.installing;
      if (sw) sw.addEventListener('statechange', watch);
    });
    state.swRegistration = reg;

    // Is there anything for an update to endanger? A browser tab never holds a vault, and an
    // installed app before setup holds none yet. Decided before asking for the update, so the
    // answer is in hand by the time a new worker finishes installing. If storage cannot be
    // read, assume a vault is there — the cautious answer costs one extra tap, not a vault.
    const unguarded = !isStandalone()
      || await db.allMeta().then((list) => list.length === 0, () => false);

    // Always ask whether the worker on the server is newer. A stale worker serves stale code
    // from its cache, and a browser judges installability against what it is actually served.
    reg.update().catch(() => { /* offline is fine; the cached worker still serves */ });

    // With nothing to protect, waiting only keeps a stale worker in charge — of the one page
    // where installing happens, or of a setup screen that has no way to show the update
    // prompt. Once a vault exists the waiting worker needs explicit approval on the update
    // screen, which the vault list and the picker both offer.
    if (unguarded) {
      const takeOver = () => {
        if (!reg.waiting) return;
        reg.waiting.postMessage({ t: 'skip-waiting' });
      };
      takeOver();
      reg.addEventListener('updatefound', () => {
        const sw = reg.installing;
        if (sw) sw.addEventListener('statechange', takeOver);
      });
      // Reload only when a worker actually replaced another. The first worker to claim a page
      // also fires controllerchange, and reloading there would jolt every new visitor.
      const hadController = !!navigator.serviceWorker.controller;
      let reloaded = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!hadController || reloaded) return;
        reloaded = true;
        location.reload();
      });
    }
  } catch (err) {
    // Without a service worker the browser will not install the app, so this cannot stay silent.
    state.swError = String((err && err.message) || err);
    if (state.route === 'install') render();
  }
}

export async function checkForUpdate() {
  if (!state.swRegistration) return false;
  await state.swRegistration.update();
  return !!state.swRegistration.waiting;
}

export function applyUpdate() {
  if (!state.swWaiting) return;
  // A waiting worker's install handler could in principle delete IDB. Backups are the defence;
  // approval is explicit so the code holding the messages never changes silently.
  state.swWaiting.postMessage({ t: 'skip-waiting' });
  navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
}

// ---------------------------------------------------------------- vault loading

// Which vault is current is a preference, not a secret: a vault id says nothing about what
// is inside. Losing it costs one tap on the picker.
const currentId = () => { try { return localStorage.getItem('dm.vault'); } catch { return null; } };

/** Read every vault, and the entries of the current one — or of `id`, which then becomes current. */
export async function loadVault(id = currentId()) {
  state.vaults = await db.allMeta();
  state.meta = state.vaults.find((v) => v.id === id) || null;
  if (state.meta) { try { localStorage.setItem('dm.vault', id); } catch { /* ignore */ } }
  state.entries = state.meta ? await db.allEntries(state.meta.id) : [];
  state.damaged = state.entries.filter((e) => !db.entryLooksValid(e)).map((e) => e.seq);
  state.persisted = await db.persisted();
  return state.meta;
}

/** Make `id` the current vault and land on its list — or on the damage report if it needs one. */
export async function openVault(id) {
  await loadVault(id);
  if (!state.meta) { go('vaults'); return; }
  if (!db.metaLooksValid(state.meta)) { go('damaged', { metaBad: true }); return; }
  go(state.damaged.length ? 'damaged' : 'home');
}

export const unsavedCount = () => {
  if (!state.meta) return 0;
  const upTo = state.meta.backedUpSeq || 0;
  return state.entries.filter((e) => e.seq > upTo).length;
};

export async function markBackedUp() {
  const maxSeq = state.entries.reduce((m, e) => Math.max(m, e.seq), 0);
  state.meta = { ...state.meta, lastBackupAt: Date.now(), backedUpSeq: maxSeq };
  await db.putMeta(state.meta);
}

// ---------------------------------------------------------------- boot

export async function boot() {
  root = document.getElementById('app');
  blankEl = document.getElementById('blank');
  initLocale();
  loadPrefs();
  const bt = document.getElementById('blank-text');
  if (bt) bt.textContent = `${t('blank.t')} ${t('blank.b')}`;
  wireBackgrounding();
  wireCrashReporting();
  wireKeys();

  // Picked up from js/early.js, which was listening before this module existed.
  const early = window.__dmInstall || {};
  if (early.prompt) state.installPrompt = early.prompt;
  state.installPromptFired = !!early.fired;
  window.__dmOnInstallPrompt = (e) => {
    state.installPrompt = e;
    state.installPromptFired = true;
    if (state.route === 'install') render();
  };
  window.addEventListener('appinstalled', () => {
    state.installPrompt = null;
    if (state.route === 'install') render();
  });

  // Register before the gate, not after. A browser tab is the only place an install can ever
  // happen, and a browser will not offer to install a site that has no service worker — it
  // makes a bookmark shortcut instead. Registering here also means the app is already cached
  // by the time someone installs it.
  wireServiceWorker();

  if (!isStandalone()) {
    // The tab renders the install guide and nothing else — no vault, no genesis.
    state.diag.push('display-mode -> browser tab');
    go('install');
    return;
  }

  go('boot');
}

export function diagnostics() {
  return [
    `display-mode -> ${isStandalone() ? 'standalone' : 'browser'}`,
    `platform -> ${platform()}`,
    `secureContext -> ${window.isSecureContext} (${location.protocol})`,
    `navigator.storage -> ${navigator.storage ? 'available' : 'unavailable'}`,
    `storage.persisted -> ${state.persisted}`,
    `version -> ${APP_VERSION} ${releaseShort()}`,
    ...state.diag,
  ].join('\n');
}

export { APP_VERSION, RELEASE_HASH, releaseShort, getLocale, db, keys };
