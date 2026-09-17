// C: genesis, and C4 the printable TinySeed plate template.
// The 24 words exist in this module's memory between generation and verification, and nowhere
// else. They are dropped the moment the vault is written, or the moment the user leaves.

import { clear, h, svg } from './dom.js';
import { getLocale, t } from './i18n.js';
import { WEIGHTS, ack, btn, card, caution, header, irreversible, note } from './ui.js';
import { makePhraseState, phraseEntry } from './phrase-entry.js';
import { derivingScreen } from './deriving.js';
import * as keys from './keys.js';
import * as db from './db.js';
import { go, loadVault, render, state } from './app.js';
import {
  KDF_DEFAULTS, fingerprint, generateWords, sealEntry, wordIndex, wordlist,
} from './vault.js';
import { randomBytes, zero } from './codec.js';
import { heldWords, hold, release } from './held.js';

let g = null;

export function resetGenesis() {
  if (g && g.words) g.words.fill('');
  if (g && g.verify) g.verify.clear();
  g = null;
  release();
}

function fresh() {
  return {
    acks: [false, false, false, false, false],
    passMode: 'off',
    generated: [],
    custom: '',
    words: null,
    page: 0,
    showNumbers: false,
    kdf: null,
    pub: null,
    fp: null,
    verify: makePhraseState(),
  };
}

const passphrase = () =>
  (g.passMode === 'gen' ? g.generated.join(' ') : g.passMode === 'custom' ? g.custom : '');

// ---------------------------------------------------------------- C1 warnings

export function genesisView() {
  if (!g) g = fresh();
  const marked = g.acks.filter(Boolean).length;
  const create = btn(t('genesis.warn.create'), {
    kind: 'primary', disabled: marked < 5,
    onclick: () => go('genesis-pass'),
  });
  return h('div.screen.stack-lg',
    h('h1.t-display', t('genesis.warn.title')),
    h('p.t-body', t('genesis.warn.sub')),
    h('div.stack', [1, 2, 3, 4, 5].map((n) => ack({
      title: t(`genesis.w${n}.t`), body: t(`genesis.w${n}.b`),
      grave: n === 1, checked: g.acks[n - 1],
      onchange: (v) => { g.acks[n - 1] = v; render(); },
    }))),
    h('div.pin-bottom',
      h('p.t-caption', { style: { textAlign: 'center' } },
        t('genesis.warn.count', { n: marked, total: 5 })),
      create,
      btn(t('genesis.warn.guidefirst'), { kind: 'quiet', onclick: () => go('guide', { from: 'genesis' }) })));
}

// ---------------------------------------------------------------- C2 passphrase

function drawDiceware() {
  const out = [];
  const r = new Uint16Array(5);
  crypto.getRandomValues(r);
  for (let i = 0; i < 5; i++) out.push(wordlist[r[i] % 2048]);
  zero(r);
  return out;
}

function strength(s) {
  const n = s.normalize('NFKD').length;
  if (n < 12) return { ok: false, msg: t('pass.own.short') };
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^\w\s]/, /[^\x00-\x7F]/].filter((re) => re.test(s)).length;
  if (n < 16 && classes < 2) return { ok: false, msg: t('pass.own.weak') };
  return { ok: true, msg: t('pass.own.ok') };
}

export function genesisPassView() {
  if (!g) { go('genesis'); return h('div'); }
  if (!g.generated.length) g.generated = drawDiceware();

  const st = g.passMode === 'custom' ? strength(g.custom) : { ok: true, msg: '' };
  const pick = (m) => { g.passMode = m; render(); };

  const genExtra = g.passMode !== 'gen' ? null : h('div.stack', { style: { marginTop: '10px', gap: '8px' } },
    h('div.mo', { style: { fontSize: '20px', lineHeight: '1.7', userSelect: 'none' } }, g.generated.join('  ')),
    btn(t('pass.gen.redraw'), { kind: 'quiet', onclick: () => { g.generated = drawDiceware(); render(); } }),
    h('p.t-caption', t('pass.gen.note')));

  const customExtra = g.passMode !== 'custom' ? null : h('div.stack', { style: { marginTop: '10px', gap: '8px' } },
    h('input.input', {
      type: 'text', value: g.custom, autocomplete: 'off', autocorrect: 'off',
      autocapitalize: 'off', spellcheck: 'false', name: '',
      style: { fontFamily: 'var(--mono)' },
      'aria-label': t('pass.own.t'),
      oninput: (e) => { g.custom = e.target.value; repaintStrength(); },
    }),
    h('p.t-small', { id: 'pw-strength', style: { color: st.ok ? 'var(--good)' : 'var(--caution)' } }, st.msg));

  const repaintStrength = () => {
    const el = document.getElementById('pw-strength');
    if (!el) return;
    const s2 = strength(g.custom);
    el.textContent = s2.msg;
    el.style.color = s2.ok ? 'var(--good)' : 'var(--caution)';
    const cont = document.getElementById('pass-continue');
    if (cont) cont.disabled = !s2.ok;
  };

  return h('div.screen.stack-lg',
    h('div.t-step', t('pass.step')),
    h('h1.t-display', t('pass.title')),
    h('p.t-body', t('pass.body')),
    h('p.t-small', t('pass.split')),
    h('div.stack',
      h('label.choice', h('input', { type: 'radio', name: 'pm', checked: g.passMode === 'off', onchange: () => pick('off') }),
        h('div.grow', h('span.ack__t', t('pass.off.t')), h('span.ack__b', t('pass.off.b')))),
      h('label.choice', h('input', { type: 'radio', name: 'pm', checked: g.passMode === 'gen', onchange: () => pick('gen') }),
        h('div.grow', h('span.ack__t', t('pass.gen.t')), h('span.ack__b', t('pass.gen.b')), genExtra)),
      h('label.choice', h('input', { type: 'radio', name: 'pm', checked: g.passMode === 'custom', onchange: () => pick('custom') }),
        h('div.grow', h('span.ack__t', t('pass.own.t')), h('span.ack__b', t('pass.own.b')), customExtra))),
    note(null, t('pass.nfkd')),
    h('p.t-caption', t('pass.thai')),
    h('div.pin-bottom',
      btn(t('common.continue'), {
        kind: 'primary', id: 'pass-continue', disabled: !st.ok,
        onclick: async () => {
          g.words = await generateWords();
          g.page = 0;
          go('genesis-phrase');
        },
      }),
      h('p.t-caption', { style: { textAlign: 'center' } }, t('pass.locked'))));
}

// ---------------------------------------------------------------- C3 four words at a time

export function genesisPhraseView() {
  if (!g || !g.words) { go('genesis'); return h('div'); }
  const page = g.page;
  const from = page * 4;
  const slice = g.words.slice(from, from + 4);
  const last = page === 5;

  return h('div.screen.stack-lg',
    caution(null, t('phrase.screenshot')),
    h('div.t-step', t('phrase.step')),
    h('h1.t-display', t('phrase.title')),
    h('p.t-body', t('phrase.sub')),
    h('div.row',
      h('span.t-small.grow', t('phrase.range', { from: from + 1, to: from + 4, total: 24 })),
      h('div.dots', { 'aria-hidden': 'true' },
        [0, 1, 2, 3, 4, 5].map((i) => h('span.dot' + (i <= page ? '.dot--on' : ''))))),
    h('div.phrase', slice.map((w, i) => h('div.phrase__w',
      h('span.phrase__n', String(from + i + 1)),
      h('span.phrase__t', w),
      g.showNumbers ? h('span.phrase__i', String(wordIndex(w) + 1)) : null))),
    h('label.ack',
      h('input', { type: 'checkbox', checked: g.showNumbers, onchange: (e) => { g.showNumbers = e.target.checked; render(); } }),
      h('span', h('span.ack__t', t('phrase.shownumber')), h('span.ack__b', t('phrase.shownumber.b')))),
    h('p.t-caption', t('phrase.english')),
    h('div.pin-bottom',
      // The page is replaced, never animated sideways — a slide paints eight words at once.
      btn(last ? t('phrase.last') : t('phrase.next'), {
        kind: 'primary',
        onclick: () => { if (last) go('genesis-derive'); else { g.page++; render(); } },
      }),
      page > 0 ? btn(t('common.back'), { onclick: () => { g.page--; render(); } }) : null,
      btn(t('phrase.print'), { kind: 'quiet', onclick: () => go('print', { from: 'genesis' }) })));
}

// ---------------------------------------------------------------- C6 initial derivation

export function genesisDeriveView() {
  if (!g || !g.words) { go('genesis'); return h('div'); }

  const run = async (onProgress) => {
    // Time one pass on THIS device, then freeze a t that costs roughly four seconds here.
    const bench = await keys.call({ t: 'bench', m: KDF_DEFAULTS.m });
    const t_ = Math.max(1, Math.min(12, Math.round(4000 / Math.max(bench.msPerPass, 1))));
    const kdf = { algo: 'argon2id', m: bench.m, t: t_, p: 1, salt: randomBytes(16) };

    const res = await keys.call(
      { t: 'derive', words: g.words.slice(), passphrase: passphrase(), kdf }, onProgress);
    if (res.result !== 'ok') { keys.terminate(); throw new Error('derive failed: ' + res.result); }
    g.kdf = res.kdf;
    g.pub = { pkC: res.pkC, pkPq: res.pkPq };
    g.fp = res.fingerprint;
    keys.terminate();           // the key is not needed again until the user proves the phrase
    go('genesis-verify');
  };

  return derivingScreen({
    title: { step: t('derive.step'), text: t('derive.title') },
    body: t('derive.body'),
    stepList: [
      { state: 'done', label: t('derive.s1') },
      { state: 'busy', label: t('derive.s2') },
      { state: 'wait', label: t('derive.s3') },
    ],
    footer: h('p.t-caption', t('derive.bench')),
    run,
  });
}

// ---------------------------------------------------------------- C5 verification

export function genesisVerifyView() {
  if (!g || !g.pub) { go('genesis'); return h('div'); }
  const s = g.verify;
  const err = h('div', { hidden: true });

  const submit = btn(t('verify.submit'), { kind: 'primary', disabled: true, onclick: () => start() });
  const counter = h('p.t-caption');

  const repaint = () => {
    const n = s.filled();
    counter.textContent = `${t('verify.count', { n, total: 24 })} · ${t('verify.pending')}`;
    submit.disabled = n !== 24;
  };

  const entry = phraseEntry(s, { onchange: repaint });
  repaint();

  const start = () => {
    const words = s.currentWords();
    if (!words.every(Boolean)) return;
    // Compare the full public keys, not the fingerprint — the fingerprint is display-only.
    if (!words.every((w, i) => w === g.words[i]) || s.passphrase !== passphrase()) {
      err.hidden = false;
      err.replaceChildren(caution(null, t('verify.mismatch')));
      return;
    }
    go('genesis-create');
  };

  return h('div.screen.stack-lg',
    h('div.t-step', t('verify.step')),
    h('h1.t-display', t('verify.title')),
    h('p.t-body', t('verify.body')),
    err,
    entry,
    h('p.t-small', t('verify.checksumnote')),
    h('div.pin-bottom', counter, submit,
      btn(t('verify.showagain'), { kind: 'quiet', onclick: () => { g.page = 0; go('genesis-phrase'); } })));
}

// ---------------------------------------------------------------- derivation 3 + canary + write

export function genesisCreateView() {
  if (!g || !g.pub) { go('genesis'); return h('div'); }

  const run = async (onProgress) => {
    const res = await keys.call({
      t: 'derive', words: g.verify.currentWords(), passphrase: g.verify.passphrase,
      kdf: g.kdf, expect: g.pub,
    }, onProgress);
    if (res.result !== 'ok') throw new Error('verification derive: ' + res.result);

    // Canary: seal a sample and open it again before anything is written.
    const canary = await sealEntry({
      pkC: res.pkC, pkPq: res.pkPq, seq: 0, timestamp: Date.now(),
      label: '', message: 'dm canary',
    });
    const opened = await keys.call({ t: 'open', entries: [canary] });
    if (!opened.items[0] || !opened.items[0].ok || opened.items[0].message !== 'dm canary') {
      throw new Error('self-test failed');
    }

    await db.putMeta({
      id: 'vault', v: 1, createdAt: Date.now(),
      pkC: res.pkC, pkPq: res.pkPq,
      fingerprint: res.fingerprint,
      kdf: res.kdf, norm: 'NFKD',
      hasPassphrase: g.verify.passphrase.length > 0,
      lastBackupAt: null, backedUpSeq: 0,
    });
    await db.persist();
    await loadVault();
    g.fp = res.fingerprint;
    // Held only for the plate print offered on the next screen; released on lock or on leaving.
    hold(g.words);
    // The phrase has done its job. Everything but the fingerprint goes now.
    g.words.fill('');
    g.words = null;
    g.verify.clear();
    g.custom = '';
    g.generated.fill('');
    go('genesis-done');
  };

  return derivingScreen({
    title: { step: t('derive.step'), text: t('derive.title') },
    body: t('derive.body'),
    stepList: [
      { state: 'done', label: t('derive.s1') },
      { state: 'done', label: t('derive.s2') },
      { state: 'busy', label: t('derive.s3') },
    ],
    run,
  });
}

// ---------------------------------------------------------------- C7 done

export function genesisDoneView() {
  const fp = g ? g.fp : (state.meta && state.meta.fingerprint);
  return h('div.screen.stack-lg',
    h('h1.t-display', t('done.title')),
    h('p.t-body', t('done.body')),
    h('div.card.stack', { style: { gap: '6px' } },
      h('div.t-caption', t('done.fp')),
      h('div.fp', fp || ''),
      h('p.t-small', t('done.fp.note'))),
    card('caution', t('done.left.t'), t('done.left.b')),
    btn(t('done.backup'), { kind: 'primary', onclick: () => { resetGenesis(); go('backup', { first: true }); } }),
    btn(t('done.print'), { onclick: () => go('print', { from: 'done' }) }),
    h('p.t-caption', t('done.print.note')),
    btn(t('done.skip'), { kind: 'quiet', onclick: () => { resetGenesis(); go('home'); } }),
    h('p.t-caption', t('done.skip.note')));
}

// ---------------------------------------------------------------- C4 plate template

/**
 * The one page this app prints, drawn to artboard C4.
 *
 * Punched squares are SVG fills rather than CSS backgrounds: a browser set not to print
 * background graphics would hand back an empty grid, and a plate punched from an empty grid
 * is a vault nobody can open. Everything on the sheet is black on white — no colour carries
 * meaning, because this comes out of whatever office printer is to hand.
 */
const backTo = (from) =>
  from === 'genesis' ? 'genesis-phrase' : from === 'done' ? 'genesis-done' : 'home';

/** 15 x 15 square: filled means punch, outline means leave. */
const square = (on) => svg(['M1 1h13v13H1z'], {
  size: 15, stroke: '#000', width: 1, fill: on ? '#000' : 'none',
});

function plateTable(words) {
  const head = h('tr',
    h('th', '#'),
    h('th', { style: { textAlign: 'left', paddingLeft: '1.5mm' } }, t('print.word')),
    WEIGHTS.map((w) => h('th.plate__w', String(w))),
    h('th', { style: { borderLeft: '1.5px solid #000' } }, t('print.sum')));

  const rows = words.map((w, i) => {
    const idx = wordIndex(w) + 1;          // TinySeed numbering, counting from 1
    return h('tr',
      h('td.plate__n', String(i + 1)),
      h('td.plate__word', w),
      WEIGHTS.map((v) => h('td.plate__c', square((idx & v) !== 0))),
      h('td.plate__sum', String(idx)));
  });

  return h('table.plate',
    h('colgroup',
      h('col.plate__cn'), h('col.plate__cw'),
      WEIGHTS.map(() => h('col.plate__cb')),
      h('col.plate__cs')),
    h('thead', head),
    h('tbody', rows));
}

function sheet(words, fp, { pages, page, notes }) {
  return h('section.sheet',
    h('header.sheet__head',
      h('div',
        h('h1.sheet__title', t('print.title')),
        h('div.sheet__sub', t('print.sub'))),
      h('div.sheet__fields',
        h('div.sheet__field',
          h('span.sheet__flabel', t('print.vault')),
          h('span.sheet__fval.sheet__fval--vault', fp)),
        h('div.sheet__field',
          h('span.sheet__flabel', t('print.date')),
          h('span.sheet__fval.sheet__fval--date', '\u00a0')))),
    notes,
    words ? plateTable(words) : null,
    h('footer.sheet__foot',
      h('span', words ? t('print.legend') : ''),
      h('span', t('print.foot', { n: page, total: pages }))));
}

const noteColumns = () => h('div.sheet__notes',
  h('p', t('print.how')), h('p', t('print.burn')), h('p', t('print.nopass')));

export function printView({ from } = {}) {
  if (g && g.words) hold(g.words);
  const words = heldWords();
  const fp = (g && g.fp) || (state.meta && state.meta.fingerprint) || '';
  const target = document.getElementById('print');
  clear(target);

  if (!words) {
    return h('div.screen.stack-lg',
      header(t('print.title'), () => go(backTo(from))),
      note(null, t('set.print.s')),
      btn(t('home.unlock'), { kind: 'primary', onclick: () => go('unlock', { then: 'print' }) }));
  }

  // Thai sets about a third taller, so the three note columns move to a second page rather
  // than squeezing the grid. The 24 rows always stay whole on page one.
  const bad = words.findIndex((w) => wordIndex(w) < 0);
  if (bad >= 0) {
    return h('div.screen.stack-lg',
      header(t('print.title'), () => go(backTo(from))),
      irreversible(null, t('print.badword', { n: bad + 1 })));
  }

  const twoPages = getLocale() === 'th';
  target.append(sheet(words, fp, {
    pages: twoPages ? 2 : 1, page: 1, notes: twoPages ? null : noteColumns(),
  }));
  if (twoPages) {
    target.append(h('section.sheet',
      h('header.sheet__head',
        h('div',
          h('h1.sheet__title', t('print.notes.title')),
          h('div.sheet__sub', t('print.sub'))),
        h('div.sheet__field',
          h('span.sheet__flabel', t('print.vault')),
          h('span.sheet__fval.sheet__fval--vault', fp))),
      noteColumns(),
      h('footer.sheet__foot',
        h('span', t('print.legend')),
        h('span', t('print.foot', { n: 2, total: 2 })))));
  }

  return h('div.screen.stack-lg',
    header(t('print.title'), () => go(backTo(from))),
    caution(null, t('phrase.screenshot')),
    irreversible(null, t('print.burn')),
    note(null, t('print.nopass')),
    h('p.t-small', t('print.preview')),
    btn(t('print.go'), { kind: 'primary', onclick: () => window.print() }));
}
