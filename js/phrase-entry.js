// The phrase input, shared by genesis verification and unlock — three input modes, one
// validator. Never a password field: the phrase must never reach a keychain or a sync service.

import { h } from './dom.js';
import { t } from './i18n.js';
import { caution, note, numberFields, plateGrid, resolveWord, segmented, wordFields } from './ui.js';
import { isWord } from './vault.js';

export function makePhraseState() {
  const s = {
    mode: 'type',
    words: Array(24).fill(''),
    bits: Array(24).fill(0),
    oneBased: true,          // TinySeed plates count from 1
    passphrase: '',
    pasteWarned: false,
  };
  s.wordFor = (i) => resolveWord(s.bits[i], s.oneBased);
  s.currentWords = () => (s.mode === 'type' ? s.words.slice() : s.bits.map((_, i) => s.wordFor(i)));
  s.filled = () => s.currentWords().filter((w) => w && isWord(w)).length;
  s.outOfRange = () => s.bits.some((b, i) => b !== 0 && !s.wordFor(i));
  s.complete = () => s.filled() === 24;
  s.clear = () => {
    s.words.fill('');
    s.bits.fill(0);
    s.passphrase = '';
  };
  return s;
}

/**
 * Renders the mode switch, the fields, and the passphrase box.
 * onchange fires on every keystroke so the caller can repaint its submit button.
 */
export function phraseEntry(s, { onchange, showPassphrase = true } = {}) {
  const wrap = h('div.stack-lg');
  const fields = h('div');
  const pasteNote = h('div', { hidden: true });

  const drawFields = () => {
    fields.replaceChildren();
    if (s.mode === 'type') {
      fields.append(wordFields(s, {
        onchange,
        onpastewarn: () => {
          if (s.pasteWarned) return;
          s.pasteWarned = true;
          pasteNote.hidden = false;
          pasteNote.replaceChildren(caution(null, t('unlock.paste.warn')));
        },
      }));
    } else if (s.mode === 'grid') {
      const numbering = h('div.stack', { style: { gap: '8px' } },
        h('div.t-heading', t('unlock.numbering')),
        h('p.t-small', t('unlock.numbering.note')),
        segmented([
          { value: true, label: t('unlock.numbering.tiny'), hint: t('unlock.numbering.tiny.s') },
          { value: false, label: t('unlock.numbering.bip39'), hint: t('unlock.numbering.bip39.s') },
        ], s.oneBased, (v) => { s.oneBased = v; grid.repaint(); onchange && onchange(); },
        t('unlock.numbering.current')));
      const grid = plateGrid(s, { onchange });
      fields.append(numbering, grid,
        h('p.t-small', t('unlock.grid.note')),
        h('p.t-caption', t('unlock.grid.arabic')));
    } else {
      fields.append(numberFields(s, { onchange }),
        h('p.t-small', t('unlock.grid.note')));
    }
  };

  wrap.append(segmented([
    { value: 'type', label: t('unlock.mode.type') },
    { value: 'grid', label: t('unlock.mode.grid') },
    { value: 'numbers', label: t('unlock.mode.numbers') },
  ], s.mode, (m) => { s.mode = m; drawFields(); onchange && onchange(); }, t('unlock.title')));

  wrap.append(pasteNote, fields);
  drawFields();

  if (showPassphrase) {
    const field = passphraseField(t('unlock.passphrase'),
      (v) => { s.passphrase = v; onchange && onchange(); });
    field.input.value = s.passphrase;
    wrap.append(h('div.field',
      h('label.field__label', t('unlock.passphrase')),
      ...field.parts,
      h('p.t-caption', t('unlock.passphrase.note')),
      h('p.t-caption', t('pass.thai'))));
    wrap.passphraseInput = field.input;
  }

  wrap.clearPassphrase = () => {
    s.passphrase = '';
    if (wrap.passphraseInput) wrap.passphraseInput.value = '';
  };
  return wrap;
}

/**
 * Masked, but never an <input type="password"> — a password field makes the browser and every
 * password manager offer to remember the passphrase, which is exactly what must not happen.
 * Where -webkit-text-security is unsupported the field stays legible and says so, because a
 * broken mask that looks like a mask is worse than an honest one.
 */
export function passphraseField(label, onInput) {
  const input = h('input.input', {
    type: 'text', autocomplete: 'off', autocorrect: 'off', autocapitalize: 'off',
    spellcheck: 'false', name: '', style: { fontFamily: 'var(--mono)' },
    'aria-label': label,
    oninput: (e) => onInput(e.target.value),
  });
  const canMask = 'webkitTextSecurity' in input.style;
  const parts = [input];
  if (canMask) {
    let revealed = false;
    input.style.webkitTextSecurity = 'disc';
    const toggle = h('button.btn--link', {
      type: 'button',
      onclick: () => {
        revealed = !revealed;
        input.style.webkitTextSecurity = revealed ? 'none' : 'disc';
        toggle.textContent = revealed ? t('unlock.hide') : t('unlock.reveal');
      },
    }, t('unlock.reveal'));
    parts.push(toggle);
  } else {
    parts.push(h('p.t-caption.t-caution', t('unlock.nomask')));
  }
  return { input, parts };
}

export function submitLabel(s) {
  if (s.outOfRange()) return t('unlock.submit.outofrange');
  const n = s.filled();
  return n === 24 ? t('unlock.submit.ready') : t('unlock.submit', { n });
}

/** Positions worth checking when the checksum fails — never a claim about which word is right. */
export function suspects(words) {
  const out = [{ n: 24, w: words[23], why: t('unlock.err.checksum.why.last') }];
  for (let i = 0; i < 23 && out.length < 3; i++) {
    const w = words[i];
    if (!w) continue;
    if (words.slice(0, i).includes(w)) out.push({ n: i + 1, w, why: t('unlock.err.checksum.why.near') });
  }
  for (let i = 0; i < 23 && out.length < 3; i++) {
    if (words[i]) out.push({ n: i + 1, w: words[i], why: t('unlock.err.checksum.why.near') });
  }
  return out.slice(0, 3);
}

export { note };
