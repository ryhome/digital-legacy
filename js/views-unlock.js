// F: unlock and read. The only screens where the phrase and decrypted text exist.

import { announce, h } from './dom.js';
import { formatClock, formatDate, formatDateTime, formatSize, t } from './i18n.js';
import { btn, confirmSheet, header, irreversible, note } from './ui.js';
import { makePhraseState, phraseEntry, submitLabel, suspects } from './phrase-entry.js';
import { derivingScreen } from './deriving.js';
import { hold, release } from './held.js';
import * as keys from './keys.js';
import * as db from './db.js';
import {
  extendRelock, go, lock, loadVault, startRelockTimer, state,
} from './app.js';
import { checksumOk } from './vault.js';
import { hex } from './codec.js';

let entry = null;          // the live phrase state; cleared whenever unlock is left
let lastError = null;

export function resetUnlock() {
  if (entry) entry.clear();
  entry = null;
  lastError = null;
}

// ---------------------------------------------------------------- F1 unlock

export function unlockView(params = {}) {
  if (!state.meta) { go('home'); return h('div'); }
  if (!entry) entry = makePhraseState();
  const then = params.then || 'read';
  const submit = btn(submitLabel(entry), {
    kind: 'primary', disabled: !entry.complete(),
    onclick: () => go('unlock-derive', { then }),
  });
  const repaint = () => {
    submit.textContent = submitLabel(entry);
    submit.disabled = !entry.complete();
  };

  const err = lastError ? errorBlock(lastError, repaint) : null;
  lastError = null;

  return h('div.screen.stack-lg',
    header(t('unlock.title'), () => { resetUnlock(); go('home'); }),
    err,
    err ? null : h('p.t-body', t('unlock.body')),
    phraseEntry(entry, { onchange: repaint }),
    h('div.pin-bottom', submit, h('p.t-caption', t('unlock.leave'))));
}

function errorBlock(e, repaint) {
  if (e.kind === 'checksum') {
    return h('div.stack',
      irreversible(t('unlock.err.checksum.t'), t('unlock.err.checksum.b')),
      h('div.t-heading', t('unlock.err.checksum.suspects')),
      h('div.list', e.suspects.map((s) => h('div.row', { style: { padding: '12px 14px' } },
        h('span.mo.entry__n', String(s.n)),
        h('div.grow', h('div.mo', s.w || '—'), h('div.entry__meta', s.why))))),
      h('p.t-small', t('unlock.err.checksum.note')),
      note(null, t('unlock.err.noattempts')),
      btn(t('unlock.err.cannotget'), { kind: 'quiet', onclick: () => go('guide', { section: 'stuck' }) }));
  }
  if (e.kind === 'passphrase') {
    return h('div.stack',
      irreversible(t('unlock.err.pass.t'), t('unlock.err.pass.b')),
      h('div.t-heading', t('unlock.err.pass.things')),
      h('ul.t-body', [1, 2, 3, 4, 5].map((n) => h('li', t('unlock.err.pass.t' + n)))),
      note(null, t('unlock.err.pass.empty')),
      h('p.t-small', t('unlock.err.pass.kept')),
      note(null, t('unlock.err.noattempts')));
  }
  return h('div.stack',
    irreversible(t('unlock.err.other.t'), t('unlock.err.other.b')),
    h('div.card.stack', { style: { gap: '8px' } },
      h('div.row', h('span.t-small.grow', t('unlock.err.other.here')),
        h('span.mo', state.meta ? state.meta.fingerprint : '')),
      h('div.row', h('span.t-small.grow', t('unlock.err.other.yours')), h('span.mo', e.other))),
    h('p.t-small', t('unlock.err.other.note')),
    btn(t('unlock.err.other.restore'), { onclick: () => { resetUnlock(); go('restore'); } }));
}

// ---------------------------------------------------------------- F3 deriving

export function unlockDeriveView(params = {}) {
  if (!entry) { go('unlock'); return h('div'); }
  const words = entry.currentWords();
  const hasPass = entry.passphrase.length > 0;

  const run = async (onProgress) => {
    try {
      // The vault must be in hand before a derivation is worth ten seconds of someone's time.
      if (!state.meta) await loadVault();
      if (!state.meta) { resetUnlock(); go('home'); return; }
      if (!(await checksumOk(words))) {
        keys.terminate();
        lastError = { kind: 'checksum', suspects: suspects(words) };
        go('unlock');
        return;
      }
      const res = await keys.call({
        t: 'derive', words, passphrase: entry.passphrase,
        kdf: state.meta.kdf, expect: { pkC: state.meta.pkC, pkPq: state.meta.pkPq },
      }, onProgress);

      if (res.result === 'checksum') {
        keys.terminate();
        lastError = { kind: 'checksum', suspects: suspects(words) };
        go('unlock');
        return;
      }
      if (res.result === 'mismatch') {
        keys.terminate();
        lastError = state.meta.hasPassphrase || hasPass
          ? { kind: 'passphrase' }
          : { kind: 'other', other: res.otherFingerprint };
        if (lastError.kind === 'passphrase') entry.passphrase = '';
        else { lastError.other = res.otherFingerprint; }
        go('unlock');
        return;
      }

      if (params.then === 'print') {
        hold(words);
        openSession([]);
        go('print', { from: 'settings' });
        return;
      }
      if (params.then === 'rekey') {
        hold(words);
        openSession([]);
        go('rekey');
        return;
      }
      const opened = await keys.call({ t: 'open', entries: state.entries });
      openSession(opened.items);
      go('read');
    } finally {
      words.fill('');
      if (entry) entry.clear();
    }
  };

  return derivingScreen({
    title: { step: '', text: t('derive.opening') },
    body: t('derive.opening.body'),
    footer: h('div.stack', { style: { gap: '8px' } },
      h('p.t-small.mo', t('derive.opening.state',
        { pass: hasPass ? t('derive.opening.passset') : t('derive.opening.passnone') })),
      h('p.t-caption', t('derive.opening.gone')),
      h('p.t-caption', t('derive.opening.keepon'))),
    run,
    onCancel: () => { resetUnlock(); go('home'); },
  });
}

function openSession(items) {
  const ttl = state.prefs.relock === 0 ? Infinity : state.prefs.relock * 1000;
  state.session = { items, openedAt: Date.now(), expiresAt: Date.now() + ttl };
  // Counted from when the vault opened, not from the last interaction, and running on every
  // screen that holds a key — the print sheet and the re-key included.
  startRelockTimer();
}

// ---------------------------------------------------------------- F5 read

export function readView() {
  if (!state.session) { go('home'); return h('div'); }
  const items = state.session.items;

  const clock = h('strong.relock__n');
  const pill = h('div.relock', { role: 'status' },
    h('span.relock__t', t('read.relock', { time: '' })), clock,
    h('button.relock__btn', { type: 'button', onclick: () => lock() }, t('read.locknow')));
  // Snooze: two more minutes per tap, as often as wanted, for as long as the screen stays open.
  // Backgrounding still locks at once; only the clock is negotiable, never the wipe.
  const extend = h('button.relock__btn', { type: 'button', onclick: () => extendRelock(120) },
    t('read.extend'));
  pill.append(extend);

  if (state.prefs.relock === 0) {
    clock.textContent = '—';
    pill.firstChild.textContent = t('set.relock.manual');
    extend.hidden = true;
  } else {
    const paintClock = (left) => {
      clock.textContent = formatClock(left);
      pill.classList.toggle('relock--soon', left <= 20);
    };
    paintClock(Math.ceil((state.session.expiresAt - Date.now()) / 1000));
    startRelockTimer(paintClock);
  }

  const list = h('div.stack');
  for (const it of items) {
    if (!it.ok) {
      const row = state.entries.find((e) => hex(e.id) === it.id);
      list.append(h('div.card.stack', { style: { gap: '6px' } },
        h('div.t-heading.t-danger', t('read.damaged')),
        h('div.entry__meta', t('home.entry.bad', {
          size: formatSize(it.size - 16),
          date: formatDate((row ? row.day : 0) * 86400000),
        }))));
      continue;
    }
    list.append(h('article.card.stack', { style: { gap: '8px' }, tabindex: '0' },
      h('h2.t-heading', it.label || t('read.nolabel')),
      h('div.entry__meta', t('read.when', { date: formatDateTime(it.timestamp), n: it.seq })),
      h('p.t-body', { style: { whiteSpace: 'pre-wrap' } }, it.message),
      btn(t('read.delete'), {
        kind: 'danger', class: 'btn--small',
        onclick: () => go('confirm-delete', { seq: it.seq, id: it.id }),
      })));
  }

  const screen = h('div.screen.stack-lg',
    pill,
    h('h1.t-display', t('read.title')),
    h('p.t-small', items.length === 1 ? t('read.sub.one') : t('read.sub', { n: items.length })),
    list,
    h('p.t-caption', t('read.norelease')),
    h('p.t-caption.mo', t('read.keys')));

  // Up/down moves between entries in the read view.
  screen.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const cards = [...list.querySelectorAll('article')];
    const i = cards.indexOf(document.activeElement);
    const next = cards[i + (e.key === 'ArrowDown' ? 1 : -1)];
    if (next) { e.preventDefault(); next.focus(); }
  });
  return screen;
}

// ---------------------------------------------------------------- delete confirmation

export function confirmDeleteView({ seq, id }) {
  return h('div.screen', { style: { justifyContent: 'center' } },
    confirmSheet({
      title: t('confirm.delete.entry.t', { n: seq }),
      body: t('confirm.delete.entry.b'),
      phrase: t('confirm.delete.entry.phrase', { n: seq }),
      goLabel: t('confirm.delete.entry.go'),
      onGo: async () => {
        const row = state.entries.find((e) => hex(e.id) === id);
        if (row) await db.deleteEntry(row.id);
        await loadVault();
        if (state.session) state.session.items = state.session.items.filter((i) => i.id !== id);
        announce(t('common.done'));
        go(state.session ? 'read' : 'home');
      },
      onCancel: () => go(state.session ? 'read' : 'home'),
    }));
}

export { release as releaseHeld };
