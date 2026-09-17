// A live report of every condition that decides whether this app can be installed and whether
// the vault it holds will survive. There is no server and no telemetry, so this screen is the
// only way a fault can be seen — it is reachable from Settings and from the install gate.

import { h } from './dom.js';
import { t } from './i18n.js';
import { btn, header } from './ui.js';
import * as db from './db.js';
import { APP_VERSION, RELEASE_HASH, go, isStandalone, platform, state } from './app.js';

const YES = 'yes';
const NO = 'no';

async function collect() {
  const rows = [];
  const add = (k, v, ok) => rows.push({ k, v: String(v), ok });

  // --- can this page host a vault at all
  add('URL', location.origin, location.protocol === 'https:');
  add('Secure context', window.isSecureContext ? YES : NO, window.isSecureContext);
  const modes = ['standalone', 'fullscreen', 'minimal-ui', 'window-controls-overlay']
    .filter((m) => matchMedia(`(display-mode: ${m})`).matches);
  add('Display mode', modes.length ? modes.join(', ') : 'browser tab', modes.length > 0);
  add('Runs as installed app', isStandalone() ? YES : NO, isStandalone());
  add('Platform', platform(), null);

  // --- installability inputs
  const early = window.__dmInstall || {};
  add('Install prompt offered', state.installPrompt ? YES : NO, !!state.installPrompt);
  add('Prompt event fired', early.fired ? `yes, at ${early.at} ms` : NO, !!early.fired);
  add('Already installed', early.installed ? YES : NO, null);
  if ('serviceWorker' in navigator) {
    const regs = await navigator.serviceWorker.getRegistrations();
    add('Service worker', regs.length ? `${regs.length} registered` : 'none registered', regs.length > 0);
    add('Controlled by worker', navigator.serviceWorker.controller ? YES : NO,
      !!navigator.serviceWorker.controller);
    const reg = regs[0];
    if (reg) {
      add('Worker state', ['installing', 'waiting', 'active'].filter((k) => reg[k]).join(', ') || 'none',
        !!reg.active);
      add('Newer worker held back', reg.waiting ? YES : NO, !reg.waiting);
    }
  } else {
    add('Service worker', 'unavailable (needs https)', false);
  }
  add('Worker error', state.swError || 'none', !state.swError);
  for (const icon of ['icon-192', 'icon-512', 'icon-maskable-512']) {
    const ok = await new Promise((r) => {
      const i = new Image();
      i.onload = () => r(i.naturalWidth > 0);
      i.onerror = () => r(false);
      i.src = `./icons/${icon}.png`;
    });
    add(`Icon ${icon}`, ok ? 'loads' : 'MISSING', ok);
  }

  // --- will anything written here survive
  add('navigator.storage', navigator.storage ? 'available' : 'unavailable', !!navigator.storage);
  let persisted = false;
  try { persisted = navigator.storage && await navigator.storage.persisted(); } catch { /* ignore */ }
  add('Storage persisted', persisted ? YES : NO, persisted);
  if (navigator.storage && navigator.storage.estimate) {
    try {
      const e = await navigator.storage.estimate();
      add('Storage used', `${Math.round((e.usage || 0) / 1024)} KB of ${Math.round((e.quota || 0) / 1048576)} MB`, null);
    } catch { /* ignore */ }
  }

  // --- what is actually stored right now
  try {
    const vaults = await db.allMeta();
    add('Vaults', `${vaults.length} of ${db.MAX_VAULTS}`, null);
    if (!vaults.length) add('Vault record', 'NONE', false);
    for (const meta of vaults) {
      const entries = await db.allEntries(meta.id);
      const valid = db.metaLooksValid(meta);
      add('Vault record', meta.fingerprint, true);
      add('Sealed messages', entries.length, null);
      add('Vault record valid', valid ? YES : NO, valid);
      add('Last backup', meta.lastBackupAt
        ? new Date(meta.lastBackupAt).toISOString().slice(0, 10) : 'never', null);
    }
  } catch (err) {
    add('IndexedDB', `FAILED: ${err.message}`, false);
  }

  add('App version', APP_VERSION, null);
  add('Release hash', RELEASE_HASH.slice(0, 16), null);
  add('User agent', navigator.userAgent, null);
  return rows;
}

export function diagView({ from } = {}) {
  const list = h('div.stack', { style: { gap: '0' } });
  const node = h('div.screen.stack-lg',
    header(t('diag.title'), () => go(from === 'install' ? 'install' : 'settings')),
    h('p.t-body', t('diag.body')),
    list,
    h('p.t-caption', t('diag.share')),
    btn(t('common.checkagain'), { onclick: () => go('diag', { from }) }));

  collect().then((rows) => {
    list.replaceChildren(...rows.map((r) => h('div.row', {
      style: {
        padding: '9px 0', borderBottom: '1px solid var(--rule)',
        alignItems: 'flex-start', gap: '10px',
      },
    },
    h('span.t-caption', { style: { minWidth: '44%', flexShrink: '0' } }, r.k),
    h('span.mo', {
      style: {
        fontSize: '12.5px', wordBreak: 'break-all', userSelect: 'text',
        color: r.ok === false ? 'var(--danger)' : r.ok === true ? 'var(--good)' : 'var(--ink)',
      },
    }, r.v))));
  });

  return node;
}
