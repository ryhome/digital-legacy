// A: install gate. B: boot states. Language confirmation.

import { h } from './dom.js';
import { t, getLocale, setLocale, detected, formatDate } from './i18n.js';
import { btn, card, caution, header, irreversible, note, steps } from './ui.js';
import {
  APP_VERSION, applyUpdate, boot, db, diagnostics, go, isDesktop, keys, loadVault, platform,
  releaseShort, render, state,
} from './app.js';

const foot = () => h('p.t-caption', { style: { textAlign: 'center' } }, t('install.foot'));

/**
 * A browser will not offer to install a site whose manifest icons it cannot load, and the only
 * symptom is a button that never becomes available. fetch() is blocked by connect-src 'none',
 * but img-src 'self' is not, so the gate checks the two icons installability actually requires.
 */
const REQUIRED_ICONS = ['./icons/icon-192.png', './icons/icon-512.png'];

function iconsPresent() {
  return Promise.all(REQUIRED_ICONS.map((src) => new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth > 0);
    img.onerror = () => resolve(false);
    img.src = src;
  }))).then((r) => r.every(Boolean));
}

function stepList(items) {
  return h('div.stack',
    items.map((s, i) => h('div.card.row', { style: { alignItems: 'flex-start' } },
      h('span.mo', { style: { fontSize: '15px', color: 'var(--ink-3)', minWidth: '18px' } }, String(i + 1)),
      h('div', h('div.t-heading', s.t), h('p.t-small', s.b)))));
}

function alreadyInstalled() {
  return h('div.card.stack', { style: { gap: '6px' } },
    h('div.t-heading', t('install.already.t')),
    h('p.t-small', isDesktop() ? t('install.already.desktop') : t('install.already.b')));
}

// ---------------------------------------------------------------- A: install gate

export function installView() {
  const p = state.params.force || platform();
  const body = h('div.screen.stack-lg');

  body.append(caution(null, t('install.strip')));

  body.append(h('div.row', { style: { gap: '14px', alignItems: 'center' } },
    h('img.appmark', {
      src: './icons/icon-192.png', width: 56, height: 56, alt: '',
      onerror: () => { state.iconsOk = false; if (state.route === 'install') render(); },
    }),
    h('div',
      h('div.t-heading', t('app.name')),
      h('div.t-caption', t('app.origin')))));

  const health = h('div');
  body.append(health);
  if (!window.isSecureContext) {
    health.append(irreversible(t('install.insecure.t'), t('install.insecure.b')));
  }
  if (state.swError) {
    health.append(irreversible(t('install.swfailed.t'),
      h('span', t('install.swfailed.b')),
      h('pre.mo', { style: { fontSize: '12px', whiteSpace: 'pre-wrap', marginTop: '8px' } },
        state.swError)));
  }
  if (state.iconsOk === false) {
    health.append(irreversible(t('install.noicons.t'), t('install.noicons.b')));
  } else if (state.iconsOk === undefined) {
    iconsPresent().then((ok) => {
      state.iconsOk = ok;
      if (!ok && state.route === 'install') render();
    });
  }

  if (state.browserVaultSeen) {
    body.append(irreversible(t('twocopies.title'), t('twocopies.body')), h('p.t-small', t('twocopies.how')));
  }

  if (p === 'ios') {
    body.append(
      h('h1.t-display', t('install.title')),
      h('p.t-body', t('install.ios.body')),
      note(null, t('install.ios.safarionly')),
      stepList([
        { t: t('install.ios.s1.t'), b: t('install.ios.s1.b') },
        { t: t('install.ios.s2.t'), b: t('install.ios.s2.b') },
        { t: t('install.ios.s3.t'), b: t('install.ios.s3.b') },
      ]));
  } else if (p === 'ios-other') {
    body.append(
      h('h1.t-display', t('install.eu.title')),
      h('p.t-body', t('install.eu.body')),
      card('caution', t('install.eu.tell.t'), t('install.eu.tell.b')),
      h('div.t-heading', t('install.eu.instead.t')),
      h('ul.t-body', [1, 2, 3].map((n) => h('li', t('install.eu.o' + n)))),
      h('p.t-small', t('install.eu.nofix')),
      btn(t('install.eu.showsafari'), { onclick: () => go('install', { force: 'ios' }) }));
  } else if (p === 'android') {
    const install = btn(t('install.android.button'), {
      kind: 'primary',
      disabled: !state.installPrompt,
      onclick: async () => {
        const e = state.installPrompt;
        if (!e) return;
        state.installPrompt = null;
        await e.prompt();
        render();
      },
    });
    body.append(
      h('h1.t-display', t('install.title')),
      h('p.t-body', t('install.android.body')),
      install,
      state.installPrompt ? null : h('p.t-caption', t('install.waiting')),
      h('p.t-caption', { style: { textAlign: 'center' } }, t('install.android.fallback')),
      stepList([
        { t: t('install.android.s1.t'), b: t('install.android.s1.b') },
        { t: t('install.android.s2.t'), b: t('install.android.s2.b') },
        { t: t('install.android.s3.t'), b: t('install.android.s3.b') },
      ]),
      caution(null, t('install.android.shortcut')));
  } else {
    body.append(
      h('h1.t-display', t('install.title')),
      h('p.t-body', t('install.desktop.body')),
      stepList([
        { t: t('install.desktop.s1.t'), b: t('install.desktop.s1.b') },
        { t: t('install.desktop.s2.t'), b: t('install.desktop.s2.b') },
        { t: t('install.desktop.s3.t'), b: t('install.desktop.s3.b') },
      ]),
      card('note', t('install.desktop.where.t'), t('install.desktop.where.b')),
      caution(t('install.desktop.safari.t'), t('install.desktop.safari.b')));
  }

  body.append(alreadyInstalled(),
    btn(t('diag.open'), { kind: 'quiet', onclick: () => go('diag', { from: 'install' }) }),
    foot());

  // If a vault was made in this tab before installing, say so here — this is the one place
  // the two storage containers are both visible to the same code.
  db.getMeta().then((m) => {
    if (m && !state.browserVaultSeen) { state.browserVaultSeen = true; render(); }
  }).catch(() => {});

  return body;
}

// ---------------------------------------------------------------- B1: boot health check

export function bootView() {
  const rows = [
    { key: 'standalone', label: t('boot.c.standalone'), state: 'done', value: t('boot.yes') },
    { key: 'secure', label: t('boot.c.secure'), state: 'wait', value: '' },
    { key: 'selftest', label: t('boot.c.selftest'), state: 'wait', value: '' },
    { key: 'storage', label: t('boot.c.storage'), state: 'busy', value: '' },
    { key: 'persist', label: t('boot.c.persist'), state: 'wait', value: '' },
    { key: 'read', label: t('boot.c.read'), state: 'wait', value: '' },
    { key: 'seals', label: t('boot.c.seals'), state: 'wait', value: '' },
  ];
  const list = h('div.card.stack');
  const paint = () => {
    list.replaceChildren(steps(rows.map((r) => ({
      state: r.state,
      label: r.value ? `${r.label} — ${r.value}` : r.label,
    }))));
  };
  paint();

  (async () => {
    const step = (key, st, value) => {
      const r = rows.find((x) => x.key === key);
      r.state = st; if (value !== undefined) r.value = value;
      paint();
    };
    if (!window.isSecureContext) { go('insecure'); return; }
    step('secure', 'done', location.protocol.replace(':', ''));

    step('selftest', 'busy');
    try {
      const st = await keys.call({ t: 'selftest' });
      if (!st.pass) { go('selftest-failed'); return; }
    } catch (err) {
      state.diag.push('selftest -> ' + err.message);
      go('selftest-failed');
      return;
    }
    keys.terminate();
    step('selftest', 'done', t('boot.yes'));

    try {
      await db.db();
      step('storage', 'done', t('boot.idb'));
    } catch (err) {
      state.diag.push(err.detail || String(err.message));
      go('nostore');
      return;
    }
    step('persist', 'busy');
    state.persisted = await db.persisted();
    step('persist', 'done', state.persisted ? t('boot.yes') : t('boot.no'));

    step('read', 'busy');
    let meta;
    try {
      meta = await loadVault();
    } catch (err) {
      state.diag.push(String(err.message));
      go('nostore');
      return;
    }
    step('read', 'done', meta ? (meta.fingerprint || '') : t('boot.no'));

    step('seals', 'busy');
    if (meta && !db.metaLooksValid(meta)) { go('damaged', { metaBad: true }); return; }
    step('seals', 'done', state.damaged.length ? String(state.damaged.length) : t('boot.deferred'));

    if (state.damaged.length) { go('damaged'); return; }
    if (!meta) { go(detected() === 'th' ? 'lang' : 'genesis'); return; }
    go('home');
  })();

  return h('div.screen.stack-lg', { style: { justifyContent: 'center' } },
    h('h1.t-display', { style: { textAlign: 'center' } }, t('app.name')),
    list,
    h('p.t-small', t('boot.explain')),
    h('p.t-caption.mo', { style: { textAlign: 'center' } }, `${APP_VERSION} · ${releaseShort()}`));
}

// ---------------------------------------------------------------- insecure origin

export function insecureView() {
  return h('div.screen.stack-lg',
    h('h1.t-display', t('insecure.title')),
    h('p.t-body', t('insecure.body')),
    h('div.t-heading', t('insecure.what')),
    h('ul.t-body', [1, 2, 3].map((n) => h('li', t('insecure.w' + n)))),
    irreversible(null, t('insecure.fix')),
    h('div.card.stack', { style: { gap: '6px' } },
      h('div.t-caption', t('nostore.diag')),
      h('pre.mo', { style: { fontSize: '12px', whiteSpace: 'pre-wrap', color: 'var(--ink-2)' } },
        diagnostics())),
    btn(t('common.checkagain'), { onclick: () => boot() }),
    h('p.t-caption', t('nostore.noway')));
}

// ---------------------------------------------------------------- self-test failure

export function selfTestFailedView() {
  return h('div.screen.stack-lg',
    h('h1.t-display', t('selftest.title')),
    h('p.t-body', t('selftest.body')),
    irreversible(null, t('selftest.what')),
    h('div.card.stack', { style: { gap: '6px' } },
      h('div.t-caption', t('nostore.diag')),
      h('pre.mo', { style: { fontSize: '12px', whiteSpace: 'pre-wrap', color: 'var(--ink-2)' } },
        diagnostics())),
    btn(t('common.checkagain'), { onclick: () => boot() }));
}

// ---------------------------------------------------------------- B2: no storage

export function noStorageView() {
  return h('div.screen.stack-lg',
    h('h1.t-display', t('nostore.title')),
    h('p.t-body', t('nostore.body')),
    h('div.t-heading', t('nostore.causes.t')),
    h('ul.t-body', [1, 2, 3, 4].map((n) => h('li', t('nostore.c' + n)))),
    note(null, t('nostore.elsewhere')),
    h('div.card.stack', { style: { gap: '6px' } },
      h('div.t-caption', t('nostore.diag')),
      h('pre.mo', { style: { fontSize: '12px', whiteSpace: 'pre-wrap', color: 'var(--ink-2)' } },
        diagnostics())),
    btn(t('common.checkagain'), { kind: 'primary', onclick: () => boot() }),
    h('p.t-caption', t('nostore.noway')));
}

// ---------------------------------------------------------------- B4: damaged

export function damagedView({ metaBad } = {}) {
  const total = state.entries.length;
  const bad = state.damaged.length;
  return h('div.screen.stack-lg',
    h('h1.t-display', t('damaged.title')),
    h('p.t-body', metaBad
      ? t('damaged.body', { bad: total, total })
      : t('damaged.body', { bad, total })),
    h('div.list', state.entries.map((e) => {
      const broken = state.damaged.includes(e.seq);
      return h('div.row', { style: { padding: '14px 16px' } },
        h('span.mo.entry__n', String(e.seq)),
        h('div.grow',
          h('div', { style: { fontSize: '15px', color: broken ? 'var(--danger)' : 'var(--ink)' } },
            broken ? t('damaged.bad') : t('damaged.ok')),
          h('div.entry__meta', formatDate((e.day || 0) * 86400000))));
    })),
    note(null, t('damaged.restorefirst')),
    irreversible(null, t('damaged.norepair')),
    btn(t('damaged.restore'), { kind: 'primary', onclick: () => go('restore') }),
    btn(t('damaged.continue'), { onclick: () => go('home') }),
    h('p.t-caption', t('damaged.stay')));
}

// ---------------------------------------------------------------- B5: update waiting

export function updateView() {
  if (!state.swWaiting) {
    return h('div.screen.stack-lg',
      header(t('update.title'), () => go('home')),
      note(null, t('update.none')),
      h('div.card.stack', { style: { gap: '6px' } },
        h('div.t-caption', t('update.running')),
        h('div.mo', APP_VERSION), h('div.mo.t-caption', releaseShort())));
  }
  return h('div.screen.stack-lg',
    h('h1.t-display', t('update.title')),
    h('p.t-body', t('update.body')),
    h('div.card.stack', { style: { gap: '10px' } },
      h('div.row', h('span.t-small.grow', t('update.running')), h('span.mo', APP_VERSION)),
      h('div.row', h('span.t-small.grow', t('update.hash')), h('span.mo', releaseShort()))),
    caution(null, t('update.verify')),
    btn(t('update.approve'), { kind: 'primary', onclick: applyUpdate }),
    btn(t('update.later'), { onclick: () => go('home') }),
    h('p.t-caption', t('update.safe')));
}

// ---------------------------------------------------------------- language confirmation

export function langView() {
  const pick = (loc) => { setLocale(loc); render(); };
  const cur = getLocale();
  return h('div.screen.stack-lg',
    h('div.t-step', t('lang.step')),
    h('h1.t-display', `${t('lang.title')} · ภาษา`),
    h('p.t-body', t('lang.body')),
    h('div.stack',
      h('button.choice', { type: 'button', 'aria-checked': String(cur === 'th'), role: 'radio', onclick: () => pick('th') },
        h('div', h('span.ack__t', 'ไทย'), h('span.ack__b', t('lang.th.s')))),
      h('button.choice', { type: 'button', 'aria-checked': String(cur === 'en'), role: 'radio', onclick: () => pick('en') },
        h('div', h('span.ack__t', 'English'), h('span.ack__b', 'อังกฤษ')))),
    h('div.card',
      h('div.mo', { style: { fontSize: '18px' } }, t('common.words24')),
      h('p.t-small', { style: { marginTop: '8px' } }, t('lang.wordsnote'))),
    btn(`${t('common.continue')} · ไปต่อ`, { kind: 'primary', onclick: () => go('genesis') }),
    h('p.t-caption', { style: { textAlign: 'center' } },
      `${t('lang.changeable')} · เปลี่ยนได้ทุกเมื่อในหน้าตั้งค่า`));
}
