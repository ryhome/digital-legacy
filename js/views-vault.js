// D: home. E: write. G: backup and restore. H: settings. I: guide.

import { announce, h } from './dom.js';
import {
  backupFilename, followDevice, followingDevice, formatSize, getLocale, setLocale, t,
} from './i18n.js';
import {
  backupBanner, btn, card, caution, confirmSheet, header, irreversible, kv, note, sealedRow, segmented,
} from './ui.js';
import { heldWords, release } from './held.js';
import { passphraseField } from './phrase-entry.js';
import * as keys from './keys.js';
import * as db from './db.js';
import {
  APP_VERSION, applyRelock, applyTheme, checkForUpdate, go, isDesktop, loadVault, lock,
  markBackedUp, openVault, releaseShort, render, state, unsavedCount,
} from './app.js';
import { BUCKETS, fromB64, hex, randomBytes, toB64 } from './codec.js';
import { sealEntry } from './vault.js';

// ---------------------------------------------------------------- D: home

export function homeView() {
  const meta = state.meta;
  const entries = state.entries.slice().sort((a, b) => b.seq - a.seq);
  const empty = entries.length === 0;

  const rows = empty
    ? card('note', t('home.nothing.t'), t('home.nothing.b'))
    : h('div.list', { role: 'list' },
      entries.map((e) => sealedRow(e, { bad: state.damaged.includes(e.seq) })));

  return h('div.screen.stack-lg',
    h('div.row',
      h('div.grow',
        h('h1.t-title', t('app.name')),
        h('div.mo.t-caption', meta ? meta.fingerprint : '')),
      h('span.t-caption', state.persisted ? t('home.persisted') : t('home.notpersisted'))),

    state.swWaiting
      ? caution(t('update.title'), h('button.btn--link', { type: 'button', onclick: () => go('update') }, t('update.approve')))
      : null,

    backupBanner(meta && meta.lastBackupAt, unsavedCount(), () => go('backup')),

    !state.persisted ? h('div.stack', { style: { gap: '8px' } },
      h('p.t-small', t('home.persist.body')),
      btn(t('home.persist.ask'), {
        kind: 'quiet',
        onclick: async () => { state.persisted = await db.persist(); render(); },
      })) : null,

    h('div.t-heading', empty ? t('home.nothing.t')
      : entries.length === 1 ? t('home.count.one') : t('home.count', { n: entries.length })),
    !empty ? h('p.t-small', t('home.nopreview')) : null,
    rows,

    h('div.pin-bottom',
      btn(t('home.write'), { kind: 'primary', onclick: () => go('write') }),
      btn(t('home.unlock'), { disabled: empty, onclick: () => go('unlock') }),
      h('div.row',
        btn(t('home.backup'), { disabled: empty, class: 'btn--small', onclick: () => go('backup') }),
        btn(t('home.restore'), { class: 'btn--small', onclick: () => go('restore') }),
        btn(t('home.settings'), { class: 'btn--small', onclick: () => go('settings') })),
      empty ? h('p.t-caption', t('home.emptydisabled')) : null,
      btn(t('home.vaults'), { kind: 'quiet', onclick: () => go('vaults') })));
}

// ---------------------------------------------------------------- E: write

export function writeView() {
  let label = '';
  let message = '';

  const count = h('span.t-caption');
  const sizeRow = h('div.row', { style: { gap: '6px' } });
  const err = h('div', { hidden: true });
  const seal = btn(t('write.seal'), { kind: 'primary', disabled: true, onclick: () => submit() });

  const byteLen = () => new TextEncoder().encode(label).length + new TextEncoder().encode(message).length;
  const bucketOf = () => BUCKETS.find((b) => b >= 19 + byteLen());

  const repaint = () => {
    count.textContent = t('write.chars', { n: [...message].length });
    const b = bucketOf();
    sizeRow.replaceChildren(
      h('span.t-caption', t('write.storedsize')),
      ...BUCKETS.map((x) => h('span.t-caption', {
        style: {
          fontWeight: x === b ? '700' : '400',
          color: x === b ? 'var(--ink)' : 'var(--ink-3)',
          padding: '2px 8px', borderRadius: '999px',
          border: `1px solid ${x === b ? 'var(--accent)' : 'transparent'}`,
        },
      }, formatSize(x))));
    err.hidden = !!b;
    if (!b) err.replaceChildren(caution(null, t('write.toolong')));
    seal.disabled = !b || message.trim() === '';
  };

  const submit = async () => {
    seal.disabled = true;
    const seq = state.entries.reduce((m, e) => Math.max(m, e.seq), 0) + 1;
    // Writing never asks for the phrase: sealing needs only the vault's public keys.
    const row = await sealEntry({
      pkC: state.meta.pkC, pkPq: state.meta.pkPq,
      seq, timestamp: Date.now(), label: label.trim(), message,
    });
    await db.putEntry(state.meta.id, row);
    await loadVault();
    label = ''; message = '';
    go('sealed', { seq });
  };

  const body = h('textarea.textarea', {
    'aria-label': t('write.title'), autocapitalize: 'sentences', spellcheck: 'true',
    oninput: (e) => { message = e.target.value; repaint(); },
  });

  repaint();

  return h('div.screen.stack-lg',
    h('div.row',
      h('button.btn--link', { type: 'button', onclick: () => go('home') }, t('common.cancel')),
      h('h1.t-title.grow', { style: { textAlign: 'center' } }, t('write.title')),
      h('div', { style: { minWidth: '60px' } })),
    h('div.field',
      h('label.field__label', `${t('write.for')} ${t('write.for.optional')}`),
      h('input.input', {
        type: 'text', autocomplete: 'off', name: '',
        oninput: (e) => { label = e.target.value; repaint(); },
      }),
      h('p.t-caption', t('write.for.note'))),
    body,
    h('div.row', count, h('div.grow'), sizeRow),
    err,
    h('p.t-small', t('write.padnote')),
    getLocale() === 'th' ? h('p.t-caption', t('write.thaicount')) : null,
    h('div.pin-bottom', seal));
}

export function sealedView({ seq }) {
  const row = state.entries.find((e) => e.seq === seq);
  const days = state.meta.lastBackupAt
    ? Math.floor((Date.now() - state.meta.lastBackupAt) / 86400000) : null;
  return h('div.screen.stack-lg',
    h('h1.t-display', t('write.sealed.title')),
    h('p.t-body', t('write.sealed.body', { n: seq })),
    row ? h('div.list', sealedRow(row)) : null,
    caution(null, days === null ? t('write.sealed.never') : t('write.sealed.stale', { n: days })),
    btn(t('write.backupnow'), { kind: 'primary', onclick: () => go('backup') }),
    btn(t('write.another'), { onclick: () => go('write') }),
    btn(t('common.done'), { kind: 'quiet', onclick: () => go('home') }));
}

// ---------------------------------------------------------------- G: backup

const b64 = (u8) => toB64(u8);

export function exportBlob() {
  const m = state.meta;
  return {
    v: 1,
    kind: 'dying-message-vault',
    fingerprint: m.fingerprint,
    meta: {
      v: 1, createdAt: m.createdAt, fingerprint: m.fingerprint, norm: 'NFKD',
      hasPassphrase: !!m.hasPassphrase,
      pkC: b64(m.pkC), pkPq: b64(m.pkPq),
      kdf: { algo: m.kdf.algo, m: m.kdf.m, t: m.kdf.t, p: m.kdf.p, salt: b64(m.kdf.salt) },
    },
    entries: state.entries.map((e) => ({
      id: b64(e.id), seq: e.seq, day: e.day,
      ephPub: b64(e.ephPub), ctPq: b64(e.ctPq), nonce: b64(e.nonce), ct: b64(e.ct),
    })),
  };
}

export function backupView({ first } = {}) {
  const json = JSON.stringify(exportBlob());
  const name = backupFilename(state.meta.fingerprint);
  const bytes = new TextEncoder().encode(json);
  const file = new File([bytes], name, { type: 'application/json' });
  // A desktop share sheet (macOS above all) offers Mail and AirDrop and no way to save a file,
  // so a desktop always downloads. A phone shares first and keeps Download as the way out
  // when a share target fails.
  const canShare = !isDesktop() && !!(navigator.canShare && navigator.canShare({ files: [file] }));
  const status = h('div', { hidden: true });

  const done = async () => {
    await markBackedUp();
    status.hidden = false;
    status.replaceChildren(note(null, t('backup.saved')));
    announce(t('backup.saved'));
  };

  const save = async (viaShare) => {
    state.shareInFlight = true;     // a share sheet or save dialog must not trigger blanking
    try {
      if (viaShare) {
        await navigator.share({ files: [file], title: name });
      } else {
        const url = URL.createObjectURL(file);
        const a = h('a', { href: url, download: name, rel: 'noopener' });
        document.body.append(a);
        a.click();
        // Removing the anchor in the same tick cancels the download in some Chromium builds.
        setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 10000);
      }
      await done();
    } catch (err) {
      if (err && err.name === 'AbortError') return;
      status.hidden = false;
      status.replaceChildren(caution(null, t('backup.failed')));
    } finally {
      state.shareInFlight = false;
    }
  };

  const n = state.entries.length;
  return h('div.screen.stack-lg',
    header(t('backup.title'), () => go(first ? 'home' : 'home')),
    h('h2.t-title', t('backup.headline')),
    h('p.t-body', t('backup.body')),
    h('div.card.stack', { style: { gap: '4px' } },
      h('div.mo', { style: { fontSize: '15px', wordBreak: 'break-all' } }, name),
      h('div.entry__meta', n === 1
        ? t('backup.filemeta.one', { size: formatSize(bytes.length) })
        : t('backup.filemeta', { size: formatSize(bytes.length), n }))),
    h('p.t-small', t('backup.fpname')),
    caution(null, t('backup.where')),
    status,
    btn(canShare ? t('backup.share') : t('backup.download'), { kind: 'primary', onclick: () => save(canShare) }),
    canShare ? btn(t('backup.download'), { onclick: () => save(false) }) : null,
    h('p.t-caption', t('backup.sharenote')));
}

// ---------------------------------------------------------------- G2: restore

function parseBackup(text) {
  const o = JSON.parse(text);
  if (!o || o.kind !== 'dying-message-vault' || o.v !== 1) throw new Error('not a backup');
  const meta = {
    id: hex(randomBytes(8)), v: 1, createdAt: o.meta.createdAt, fingerprint: o.meta.fingerprint,
    norm: 'NFKD', hasPassphrase: !!o.meta.hasPassphrase,
    pkC: fromB64(o.meta.pkC, 32), pkPq: fromB64(o.meta.pkPq, 1184),
    kdf: {
      algo: o.meta.kdf.algo, m: o.meta.kdf.m, t: o.meta.kdf.t, p: o.meta.kdf.p,
      salt: fromB64(o.meta.kdf.salt, 16),
    },
    lastBackupAt: null, backedUpSeq: 0,
  };
  if (!db.metaLooksValid(meta)) throw new Error('bad meta');
  const entries = o.entries.map((e) => {
    const row = {
      id: fromB64(e.id, 16), seq: e.seq, day: e.day,
      ephPub: fromB64(e.ephPub, 32), ctPq: fromB64(e.ctPq, 1088),
      nonce: fromB64(e.nonce, 12), ct: fromB64(e.ct),
    };
    if (!db.entryLooksValid(row)) throw new Error('bad entry');
    return row;
  });
  return { meta, entries };
}

export function restoreView({ from } = {}) {
  const out = h('div');

  const pick = h('input', {
    type: 'file', accept: '.dmv,application/json', style: { display: 'none' },
    onchange: async (e) => {
      const f = e.target.files && e.target.files[0];
      state.shareInFlight = false;
      if (!f) return;
      try {
        const parsed = parseBackup(await f.text());
        out.replaceChildren(await outcome(parsed));
      } catch {
        out.replaceChildren(irreversible(null, t('restore.bad')));
      }
    },
  });

  return h('div.screen.stack-lg',
    header(t('restore.title'), () => go(['genesis', 'vaults'].includes(from) ? from : 'home')),
    h('h2.t-title', t('restore.choose')),
    h('p.t-body', t('restore.nophrase')),
    pick,
    btn(t('restore.pick'), {
      kind: 'primary',
      onclick: () => { state.shareInFlight = true; pick.click(); },
    }),
    h('p.t-caption', { style: { textAlign: 'center' } }, t('restore.pick.s')),
    out,
    h('div.t-heading', t('restore.checks')),
    h('ul.t-body', [1, 2, 3, 4].map((n) => h('li', t('restore.c' + n)))),
    note(null, t('restore.safe')),
    h('p.t-small', t('restore.multidevice')));
}

async function outcome({ meta, entries }) {
  const known = state.vaults.find((v) => v.fingerprint === meta.fingerprint);

  // A vault this device has never seen becomes another vault here — if there is room.
  if (!known) {
    const summary = h('div.card.mo', t('restore.new.meta', { fp: meta.fingerprint, n: entries.length }));
    if (state.vaults.length >= db.MAX_VAULTS) {
      return h('div.stack',
        irreversible(t('restore.full.t'), t('restore.full.b', { n: db.MAX_VAULTS })), summary);
    }
    return h('div.stack',
      card('note', t('restore.new.t'), t('restore.new.b')),
      summary,
      btn(t('restore.new.go'), {
        kind: 'primary',
        onclick: async () => {
          await db.putMeta(meta);
          await db.putEntries(meta.id, entries);
          await db.persist();
          announce(t('restore.added', { n: entries.length }));
          openVault(meta.id);
        },
      }));
  }

  // Same vault: union by id. Nothing already here is replaced.
  const have = new Set((await db.allEntries(known.id)).map((e) => hex(e.id)));
  const fresh = entries.filter((e) => !have.has(hex(e.id)));
  const title = fresh.length === 0 ? t('restore.same.t.none')
    : fresh.length === 1 ? t('restore.same.t.one') : t('restore.same.t', { n: fresh.length });

  return h('div.stack',
    card('note', title, t('restore.same.b', { new: fresh.length, old: entries.length - fresh.length })),
    h('div.list', entries.slice().sort((a, b) => b.seq - a.seq).map((e) => {
      const isNew = !have.has(hex(e.id));
      return h('div.row', { style: { padding: '12px 16px' } },
        h('span.mo.entry__n', String(e.seq)),
        h('span.entry__meta', isNew ? t('restore.same.new') : t('restore.same.old')));
    })),
    btn(t('restore.same.go'), {
      kind: 'primary', disabled: fresh.length === 0,
      onclick: async () => {
        await db.putEntries(known.id, fresh);
        announce(fresh.length === 1 ? t('restore.added.one') : t('restore.added', { n: fresh.length }));
        openVault(known.id);
      },
    }));
}

// ---------------------------------------------------------------- H: settings

export function settingsView() {
  const meta = state.meta;
  const backedUpToday = meta && meta.lastBackupAt
    && new Date(meta.lastBackupAt).toDateString() === new Date().toDateString();

  const relockOptions = [
    { value: 60, label: t('set.relock.1') },
    { value: 120, label: t('set.relock.2') },
    { value: 300, label: t('set.relock.5') },
    { value: 0, label: t('set.relock.manual') },
  ];

  return h('div.screen.stack-lg',
    header(t('set.title'), () => go('home')),

    h('div.t-step', t('set.app')),
    h('div.card.stack',
      h('div', h('div.t-heading', t('set.relock')), h('p.t-caption', t('set.relock.s'))),
      segmented(relockOptions, state.prefs.relock, (v) => { applyRelock(v); render(); }, t('set.relock')),
      state.prefs.relock === 0 ? h('p.t-caption', t('set.relock.manual.note')) : null),
    h('div.card.stack',
      h('div', h('div.t-heading', t('set.language')), h('p.t-caption', t('set.language.s'))),
      segmented([{ value: 'en', label: 'English' }, { value: 'th', label: 'ไทย' }],
        getLocale(), (v) => { setLocale(v); render(); }, t('set.language')),
      h('label.ack',
        h('input', { type: 'checkbox', checked: followingDevice(), onchange: (e) => { if (e.target.checked) followDevice(); else setLocale(getLocale()); render(); } }),
        h('span', h('span.ack__b', t('lang.follow')))),
      h('p.t-caption', t('lang.heirs'))),
    h('div.card.stack',
      h('div', h('div.t-heading', t('set.theme')), h('p.t-caption', t('set.theme.s'))),
      segmented([
        { value: 'auto', label: t('set.theme.auto') },
        { value: 'light', label: t('set.theme.light') },
        { value: 'dark', label: t('set.theme.dark') },
      ], state.prefs.theme, (v) => { applyTheme(v); render(); }, t('set.theme'))),

    h('div.t-step', t('set.vault')),
    h('div.card.stack', { style: { gap: '6px' } },
      h('div.t-caption', t('set.fp')),
      h('div.fp', meta ? meta.fingerprint : '')),
    h('div.card.stack',
      h('div', h('div.t-heading', t('set.print')), h('p.t-caption', t('set.print.s'))),
      btn(t('set.print'), { class: 'btn--small', onclick: () => go('unlock', { then: 'print' }) })),
    h('div.card.stack',
      h('div', h('div.t-heading', t('set.rekey')), h('p.t-caption', t('set.rekey.s'))),
      h('p.t-small', t('set.rekey.b')),
      btn(t('set.rekey'), {
        class: 'btn--small', disabled: !backedUpToday,
        onclick: () => go('unlock', { then: 'rekey' }),
      }),
      !backedUpToday ? h('p.t-caption.t-caution', t('set.rekey.needbackup')) : null),

    h('div.t-step', t('set.version')),
    h('div.card.stack', { style: { gap: '8px' } },
      kv(t('set.version.app'), APP_VERSION, true),
      kv(t('set.version.hash'), releaseShort(), true),
      btn(t('diag.open'), { class: 'btn--small', onclick: () => go('diag', { from: 'settings' }) }),
      btn(t('set.checkupdate'), {
        class: 'btn--small',
        onclick: async () => { await checkForUpdate(); go('update'); },
      })),

    h('div.t-step.t-danger', t('set.irreversible')),
    h('div.card.stack',
      h('div', h('div.t-heading.t-danger', t('set.remove')), h('p.t-small', t('set.remove.b'))),
      btn(t('set.remove'), { kind: 'danger', onclick: () => go('confirm-remove') })),

    btn(t('common.guide'), { kind: 'quiet', onclick: () => go('guide') }));
}

export function confirmRemoveView() {
  return h('div.screen', { style: { justifyContent: 'center' } },
    confirmSheet({
      title: t('confirm.remove.vault.t'),
      body: t('confirm.remove.vault.b'),
      phrase: state.meta.fingerprint,
      goLabel: t('confirm.remove.vault.go'),
      onGo: async () => {
        lock({ silent: true });
        await db.removeVault(state.meta.id);
        try { localStorage.removeItem('dm.vault'); } catch { /* ignore */ }
        state.meta = null;
        state.entries = [];
        location.reload();
      },
      onCancel: () => go('settings'),
    }));
}

// ---------------------------------------------------------------- re-key

export function rekeyView() {
  let a = '';
  let b = '';
  const status = h('div', { hidden: true });
  const go_ = btn(t('set.rekey.go'), { kind: 'primary', disabled: true, onclick: () => run() });

  const repaint = () => { go_.disabled = !(a.length >= 12 || a.length === 0) || a !== b; };

  const run = async () => {
    go_.disabled = true;
    const words = heldWords();
    if (!words) { go('settings'); return; }
    try {
      const res = await keys.call({ t: 'rekey', words, passphrase: a, entries: state.entries });
      const meta = {
        ...state.meta, pkC: res.pkC, pkPq: res.pkPq,
        fingerprint: res.fingerprint, kdf: res.kdf,
        hasPassphrase: a.length > 0, lastBackupAt: null, backedUpSeq: 0,
      };
      await db.replaceAll(meta, res.entries);
      await loadVault();
      status.hidden = false;
      status.replaceChildren(note(null, t('set.rekey.done', { fp: res.fingerprint })));
    } catch {
      status.hidden = false;
      status.replaceChildren(irreversible(null, t('backup.failed')));
    } finally {
      release();
      lock({ silent: true });
    }
  };

  const field = (label, set) => {
    const f = passphraseField(label, (v) => { set(v); repaint(); });
    return h('div.field', h('label.field__label', label), ...f.parts);
  };

  return h('div.screen.stack-lg',
    header(t('set.rekey'), () => { release(); lock({ silent: true }); go('settings'); }),
    h('p.t-body', t('set.rekey.b')),
    field(t('set.rekey.new'), (v) => { a = v; }),
    field(t('set.rekey.confirm'), (v) => { b = v; }),
    note(null, t('pass.nfkd')),
    status,
    go_);
}

// ---------------------------------------------------------------- I: guide

const section = (title, ...body) => h('section.stack', { style: { gap: '10px' } },
  h('h2.t-title', title), ...body);

const numbered = (items) => h('div.stack',
  items.map((b, i) => h('div.card.row', { style: { alignItems: 'flex-start' } },
    h('span.mo', { style: { color: 'var(--ink-3)', minWidth: '18px' } }, String(i + 1)),
    h('p.t-body', b))));

const titled = (items) => h('div.stack',
  items.map((x) => h('div.card', h('div.t-heading', x.t), h('p.t-small', x.b))));

export function guideView({ from, section: jump } = {}) {
  const node = h('div.screen.stack-lg',
    header(t('guide.title'), () => go(from === 'genesis' ? 'genesis' : 'home')),

    section(t('guide.what.t'),
      h('p.t-body', t('guide.what.b1')),
      h('p.t-body', t('guide.what.b2')),
      h('p.t-body', t('guide.what.b3'))),

    section(t('guide.cannot.t'),
      h('p.t-body', t('guide.cannot.b')),
      h('ul.t-body', [1, 2, 3, 4, 5].map((n) => h('li', t('guide.cannot.' + n))))),

    section(t('guide.keep.t'),
      h('p.t-body', t('guide.keep.b')),
      titled([1, 2, 3, 4].map((n) => ({ t: t(`guide.keep.${n}.t`), b: t(`guide.keep.${n}.b`) }))),
      irreversible(null, t('guide.keep.never'))),

    section(t('guide.split.t'),
      h('p.t-body', t('guide.split.b1')),
      h('p.t-body', t('guide.split.b2')),
      caution(null, t('guide.split.b3'))),

    section(t('guide.multi.t'),
      h('p.t-body', t('guide.multi.b')),
      numbered([1, 2, 3].map((n) => t('guide.multi.' + n))),
      h('p.t-small', t('guide.multi.after'))),

    section(t('guide.heirs.t'),
      h('p.t-body', t('guide.heirs.b')),
      titled([1, 2, 3, 4, 5].map((n) => ({ t: t(`guide.heirs.${n}.t`), b: t(`guide.heirs.${n}.b`) }))),
      note(null, t('guide.heirs.wait'))),

    h('section.stack', { id: 'stuck', style: { gap: '10px' } },
      h('h2.t-title', t('guide.stuck.t')),
      h('p.t-body', t('guide.stuck.b')),
      numbered([1, 2, 3, 4, 5].map((n) => t('guide.stuck.' + n)))),

    h('p.t-small', t('guide.foot')),
    h('p.t-caption.mo', { style: { textAlign: 'center' } },
      `${APP_VERSION} · ${releaseShort()} · ${t('app.origin')}`));

  if (jump === 'stuck') setTimeout(() => node.querySelector('#stuck').scrollIntoView(), 0);
  return node;
}
