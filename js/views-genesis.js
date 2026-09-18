// C: genesis, C4 the printable TinySeed plate template, and the sheet for whoever gets the words.
// The 24 words exist in this module's memory between generation and verification, and nowhere
// else. They are dropped the moment the vault is written, or after setup has sat in the
// background for longer than SUSPEND_LIMIT.

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
import { hex, randomBytes, zero } from './codec.js';
import { heldWords, hold, release } from './held.js';

let g = null;

/**
 * Backgrounding during setup. The screen is already emptied by the blanking in app.js, so a task
 * switcher sees nothing; the only question is whether the phrase survives in memory. A phone
 * call or a glance at another app must not cost twenty-four words half written down, so it does
 * — for a bounded time. Longer than that and the phrase is wiped and setup starts over, with the
 * screen saying why. The acknowledgements and the passphrase choice are not secrets and always
 * survive. `at` exists for the test that exercises the limit.
 */
const SUSPEND_LIMIT = 10 * 60 * 1000;
let suspendedAt = 0;

export function suspendGenesis(at = Date.now()) {
  if (g) suspendedAt = at;
}

/** Wraps a genesis view: applies the limit on the way back in, then renders as normal. */
export const guard = (view) => (params) => {
  if (suspendedAt && Date.now() - suspendedAt > SUSPEND_LIMIT) resetGenesis();
  suspendedAt = 0;
  return view(params);
};

export function resetGenesis() {
  if (!g) return;
  const lost = !!g.words;          // true only past C3: a phrase existed, and it is gone now
  if (g.words) g.words.fill('');
  g.generated.fill('');
  g.verify.clear();
  release();
  g = { ...fresh(), acks: g.acks, passMode: g.passMode, interrupted: lost };
}

/** Setup finished: the next vault, if there is one, starts from nothing. */
export function clearGenesis() {
  resetGenesis();
  g = null;
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
  const create = btn(t('genesis.warn.create'), {
    kind: 'primary',
    onclick: () => { g.interrupted = false; go('genesis-pass'); },
  });
  const count = h('p.t-caption', { style: { textAlign: 'center' } });
  // Ticking a box changes two things on this screen. A full render() would rebuild the page
  // and scroll it to the top, which on a phone throws the reader away from the box they ticked.
  const repaint = () => {
    const marked = g.acks.filter(Boolean).length;
    count.textContent = t('genesis.warn.count', { n: marked, total: 5 });
    create.disabled = marked < 5;
  };
  repaint();
  return h('div.screen.stack-lg',
    h('h1.t-display', t('genesis.warn.title')),
    h('p.t-body', t('genesis.warn.sub')),
    // Landing back here with no explanation reads as the app having lost the work.
    g.interrupted ? caution(null, t('genesis.warn.restarted')) : null,
    h('div.stack', [1, 2, 3, 4, 5].map((n) => ack({
      title: t(`genesis.w${n}.t`), body: t(`genesis.w${n}.b`),
      grave: n === 1, checked: g.acks[n - 1],
      onchange: (v) => { g.acks[n - 1] = v; repaint(); },
    }))),
    h('div.pin-bottom',
      count,
      create,
      btn(t('genesis.warn.guidefirst'), { kind: 'quiet', onclick: () => go('guide', { from: 'genesis' }) }),
      // A vault that already exists elsewhere is adopted, not made again. restoreView already
      // handles the no-vault-here case; it was simply unreachable before a vault existed.
      btn(t('genesis.warn.import'), { kind: 'quiet', onclick: () => go('restore', { from: 'genesis' }) }),
      state.vaults.length ? btn(t('vaults.back'), { kind: 'quiet', onclick: () => go('vaults') }) : null));
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
    entry,
    h('p.t-small', t('verify.checksumnote')),
    // The error lives in the pinned block, next to the button that produced it. Above the
    // twenty-four fields it was off-screen on a phone and the tap looked like it did nothing.
    h('div.pin-bottom', err, counter, submit,
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

    const id = hex(randomBytes(8));
    // Resumed after backgrounding at exactly the wrong moment, the write may already be done.
    // Same fingerprint means same keys: adopt that record rather than make a twin.
    const twin = (await db.allMeta()).find((v) => v.fingerprint === res.fingerprint);
    if (!twin) {
      await db.putMeta({
        id, v: 1, createdAt: Date.now(),
        pkC: res.pkC, pkPq: res.pkPq,
        fingerprint: res.fingerprint,
        kdf: res.kdf, norm: 'NFKD',
        hasPassphrase: g.verify.passphrase.length > 0,
        lastBackupAt: null, backedUpSeq: 0,
      });
      await db.persist();
    }
    await loadVault(twin ? twin.id : id);
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
    btn(t('done.backup'), { kind: 'primary', onclick: () => { clearGenesis(); go('backup', { first: true }); } }),
    btn(t('done.print'), { onclick: () => go('print', { from: 'done' }) }),
    h('p.t-caption', t('done.print.note')),
    btn(t('done.heir'), { onclick: () => go('print-heir', { from: 'done' }) }),
    btn(t('done.skip'), { kind: 'quiet', onclick: () => { clearGenesis(); go('home'); } }),
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

// ---------------------------------------------------------------- the sheet for the heir

/**
 * The other page this app prints. It carries no secret — no words, no passphrase — only what
 * to do with them, written for someone who has never seen the app and is not having a good
 * day. Meant to be kept with the words, so whoever finds them knows what they are for.
 */
function heirSheet(fp) {
  const step = (n) => h('li', h('strong', t(`heir.s${n}.t`)), t(`heir.s${n}.b`));
  return h('section.sheet',
    h('header.sheet__head',
      h('div',
        h('h1.sheet__title', t('heir.title')),
        h('div.sheet__sub', t('heir.sub'))),
      h('div.sheet__fields',
        h('div.sheet__field',
          h('span.sheet__flabel', t('print.vault')),
          h('span.sheet__fval.sheet__fval--vault', fp || '\u00a0')),
        h('div.sheet__field',
          h('span.sheet__flabel', t('print.date')),
          h('span.sheet__fval.sheet__fval--date', '\u00a0')))),
    h('p.heir__lead', t('heir.lead')),
    h('p.heir__lead', t('heir.language', { language: getLocale() === 'th' ? t('lang.th') : t('lang.en') })),
    h('ol.heir__steps', [1, 2, 3, 4, 5, 6, 7, 8].map(step)),
    h('div.heir__lines',
      h('span.sheet__flabel', t('heir.from')),
      [1, 2, 3, 4].map(() => h('div.heir__line'))),
    h('footer.sheet__foot',
      h('span', t('heir.keep')),
      h('span', t('print.foot', { n: 1, total: 1 }))));
}

export function heirView({ from } = {}) {
  const target = document.getElementById('print');
  clear(target);
  target.append(heirSheet((state.meta && state.meta.fingerprint) || (g && g.fp) || ''));
  return h('div.screen.stack-lg',
    header(t('heir.title'), () => go(from === 'done' ? 'genesis-done' : 'settings')),
    note(null, t('heir.about')),
    h('p.t-small', t('print.preview')),
    btn(t('print.go'), { kind: 'primary', onclick: () => window.print() }));
}
