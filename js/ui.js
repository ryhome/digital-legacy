// The component library from the design canvas: warning cards, buttons, banners, the word
// field, the plate grid, progress states, the typed destructive confirmation.
// Every interactive piece is a real button, input or label — nothing is a div with a handler.

import { announce, h, svg } from './dom.js';
import { formatDate, formatSize, t } from './i18n.js';
import { isWord, wordIndex, wordlist } from './vault.js';

export const WEIGHTS = [1024, 512, 256, 128, 64, 32, 16, 8, 4, 2, 1];

// ---------------------------------------------------------------- basics

export function btn(label, { kind = '', onclick, disabled, type = 'button', ...rest } = {}) {
  return h('button.btn' + (kind ? '.btn--' + kind : ''),
    { type, onclick, disabled: !!disabled, ...rest }, label);
}

export function header(title, onBack, right) {
  return h('div.row', { style: { gap: '8px' } },
    onBack && h('button.btn--link', { type: 'button', onclick: onBack }, t('common.back')),
    h('h1.t-title.grow', title),
    right || null);
}

const ICONS = {
  note: ['M10 2.6a8.5 8.5 0 100 17 8.5 8.5 0 000-17z', 'M10 9v5M10 6.2v.1'],
  caution: ['M10 2.6L18.6 17H1.4z', 'M10 7.8v4.1M10 14.4v.1'],
  irreversible: ['M10 1.5a8.5 8.5 0 100 17 8.5 8.5 0 000-17z', 'M6.6 6.6l6.8 6.8M13.4 6.6l-6.8 6.8'],
};

/** Every card carries a colour AND a shape AND a word. None of the three is load-bearing alone. */
export function card(kind, title, ...body) {
  return h('div.' + kind, { role: kind === 'note' ? null : 'note' },
    h('span.note__icon', svg(ICONS[kind])),
    h('div', title && h('span.note__t', title), ...body));
}

export const note = (title, ...b) => card('note', title, ...b);
export const caution = (title, ...b) => card('caution', title, ...b);
export const irreversible = (title, ...b) => card('irreversible', title, ...b);

export function ack({ title, body, checked, grave, onchange }) {
  const input = h('input', { type: 'checkbox', checked: !!checked, onchange: (e) => onchange(e.target.checked) });
  return h('label.ack' + (grave ? '.ack--grave' : ''), input,
    h('span', h('span.ack__t', title), h('span.ack__b', body)));
}

export function choice({ name, value, checked, title, body, onselect, extra }) {
  const input = h('input', { type: 'radio', name, value, checked: !!checked, onchange: () => onselect(value) });
  return h('label.choice', input,
    h('div.grow', h('span.ack__t', title), h('span.ack__b', body), extra || null));
}

/**
 * Single-choice control. It owns its own selected state: the caller may redraw what the choice
 * affects without redrawing the control, so the control cannot be left showing a stale answer.
 * A radiogroup, not a tablist — there are no tabpanels here, only one choice out of several.
 */
export function segmented(options, value, onchange, label) {
  const wrap = h('div.seg', { role: 'radiogroup', 'aria-label': label || '' });
  const buttons = options.map((o, i) => h('button.seg__b', {
    type: 'button', role: 'radio',
    onclick: () => select(i, false),
    onkeydown: (e) => {
      const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (!step) return;
      e.preventDefault();
      select((i + step + options.length) % options.length, true);
    },
  }, h('span', o.label), o.hint ? h('span.seg__hint', o.hint) : null));

  const paint = (v) => {
    buttons.forEach((b, i) => {
      const on = options[i].value === v;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;        // roving tabindex: the group is one Tab stop
    });
  };

  function select(i, focus) {
    paint(options[i].value);
    if (focus) buttons[i].focus();
    onchange(options[i].value);
  }

  wrap.append(...buttons);
  paint(value);
  wrap.setValue = paint;
  return wrap;
}

export function kv(label, value, mono) {
  return h('div.row',
    h('span.t-small.grow', label),
    h('span' + (mono ? '.mo' : ''), { style: { fontSize: '15px', fontWeight: '600' } }, value));
}

// ---------------------------------------------------------------- backup banner

export function backupBanner(lastBackupAt, unsavedCount, onBackup) {
  const days = lastBackupAt ? Math.floor((Date.now() - lastBackupAt) / 86400000) : null;
  let mod = '', title, sub;
  if (days === null) {
    mod = '.banner--urgent';
    title = t('home.backup.never');
    sub = t('home.backup.never.s');
  } else {
    title = days === 0 ? t('home.backup.today') : t('home.backup.days', { n: days });
    if (days >= 90) { mod = '.banner--urgent'; sub = t('home.backup.urgent'); }
    else if (days >= 30) { mod = '.banner--stale'; sub = t('home.backup.stale'); }
    else sub = unsavedCount > 0 ? unsavedSub(unsavedCount) : t('home.backup.fine');
  }
  if (days !== null && unsavedCount > 0 && days < 30) sub = unsavedSub(unsavedCount);
  return h('div.banner' + mod, { role: 'status' },
    h('span.banner__dot'),
    h('div.grow', h('div.banner__t', title), h('div.banner__s', sub)),
    h('button.banner__a', { type: 'button', onclick: onBackup }, t('home.backup')));
}

const unsavedSub = (n) => (n === 1 ? t('home.backup.one') : t('home.backup.some', { n }));

// ---------------------------------------------------------------- sealed entry row

/** Fixed pattern derived from the sequence number — identical on every launch, never a preview. */
export function bars(seq, count) {
  let x = (seq * 2654435761) >>> 0;
  const out = [];
  const n = count || 5 + (x % 4);
  for (let i = 0; i < n; i++) {
    x = (x * 1664525 + 1013904223) >>> 0;
    out.push(22 + (x % 42));
  }
  return out;
}

export function sealedRow(entry, { onclick, bad } = {}) {
  const size = formatSize(entry.ct.length - 16);
  const date = formatDate(entry.day * 86400000);
  const label = bad
    ? t('sr.entrybad', { n: entry.seq, size, date })
    : t('sr.entry', { n: entry.seq, size, date });
  const inner = [
    h('span.entry__n', String(entry.seq)),
    h('div.grow',
      h('div.entry__bars', { 'aria-hidden': 'true' },
        bars(entry.seq).map((w) => h('span.entry__bar', { style: { width: w + 'px' } }))),
      h('div.entry__meta', bad ? t('home.entry.bad', { size, date }) : t('home.entry.meta', { size, date }))),
  ];
  const cls = '.entry' + (bad ? '.entry--bad' : '');
  return onclick
    ? h('button' + cls, { type: 'button', onclick, 'aria-label': label }, inner)
    : h('div' + cls, { role: 'listitem', 'aria-label': label }, inner);
}

// ---------------------------------------------------------------- progress

export function progress({ title, elapsed, frac, body }) {
  const bar = h('div.prog__bar');
  const track = h('div.prog' + (frac === null ? '.prog--unknown' : ''),
    { role: 'progressbar', 'aria-label': title,
      'aria-valuemin': '0', 'aria-valuemax': '100',
      'aria-valuenow': frac === null ? null : String(Math.round(frac * 100)) },
    frac === null ? null : bar);
  if (frac !== null) bar.style.width = Math.round(frac * 100) + '%';
  const el = h('div.card.stack',
    h('div.row', h('div.t-heading.grow', title), h('span.mo.t-caption', t('derive.elapsed', { n: elapsed }))),
    track,
    h('p.t-small', body));
  el.update = (next) => {
    if (next.frac !== null && next.frac !== undefined) {
      bar.style.width = Math.round(next.frac * 100) + '%';
      track.setAttribute('aria-valuenow', String(Math.round(next.frac * 100)));
    }
    el.querySelector('.mo').textContent = t('derive.elapsed', { n: next.elapsed });
  };
  return el;
}

export function steps(list) {
  return h('div.steps', list.map((s) => h('div.step.step--' + s.state,
    h('span.step__dot'), h('span', s.label))));
}

// ---------------------------------------------------------------- typed destructive confirmation

/**
 * The button enables only on an exact match, and the match string always names the thing.
 * "Keep it" is second so a thumb reaching up from the bottom lands on it first.
 */
export function confirmSheet({ title, body, phrase, goLabel, onGo, onCancel }) {
  const go = btn(goLabel, { kind: 'danger', disabled: true, onclick: () => onGo() });
  const input = h('input.input', {
    type: 'text', autocomplete: 'off', autocorrect: 'off', autocapitalize: 'off',
    spellcheck: 'false', 'aria-describedby': 'confirm-hint',
    oninput: (e) => { go.disabled = e.target.value.trim() !== phrase; },
  });
  return h('div.sheet.stack',
    h('h2.t-title', title),
    h('p.t-body', body),
    h('div.field',
      h('label#confirm-hint.t-small', t('confirm.type', { phrase })),
      input),
    go,
    btn(t('common.keepit'), { onclick: onCancel }));
}

// ---------------------------------------------------------------- word fields

/**
 * 24 word inputs with a one-suggestion listbox. Never an <input type="password"> and never a
 * field a password manager will offer to fill: the phrase must not reach a keychain.
 */
export function wordFields(state, { onchange, onpastewarn } = {}) {
  const wrap = h('div.words', { role: 'group', 'aria-label': t('unlock.title') });
  const inputs = [];

  const suggestionFor = (v) => {
    if (v.length < 4) return null;
    if (isWord(v)) return null;
    const hit = wordlist.find((w) => w.startsWith(v));
    return hit && wordlist.filter((w) => w.startsWith(v)).length === 1 ? hit : null;
  };

  for (let i = 0; i < 24; i++) {
    const idx = i;
    const listId = `wl-${idx}`;
    const list = h('div.wf__list', { id: listId, role: 'listbox', hidden: true });
    const input = h('input.wf__in', {
      type: 'text', inputmode: 'text', value: state.words[idx] || '',
      autocomplete: 'off', autocorrect: 'off', autocapitalize: 'off', spellcheck: 'false',
      'aria-label': t('sr.wordfield', { n: idx + 1 }),
      'aria-autocomplete': 'list', 'aria-controls': listId,
      name: '',                       // unnamed: nothing for a form filler to key on
      enterkeyhint: idx === 23 ? 'go' : 'next',
    });
    const box = h('div.wf__box', h('span.wf__n', String(idx + 1)), input);
    const msg = h('div.wf__msg', { hidden: true }, t('unlock.notaword'));
    const field = h('div.wf', box, list, msg);

    const paint = () => {
      const v = input.value;
      field.className = 'wf' + (v === '' ? '' : isWord(v) ? ' wf--ok' : ' wf--bad');
      msg.hidden = v === '' || isWord(v) || !!suggestionFor(v);
      if (isWord(v)) {
        if (!box.querySelector('.wf__tick')) box.append(tick());
      } else {
        const tk = box.querySelector('.wf__tick');
        if (tk) tk.remove();
      }
    };

    const accept = (word, advance) => {
      input.value = word;
      state.words[idx] = word;
      list.hidden = true;
      paint();
      onchange && onchange();
      if (advance && inputs[idx + 1]) inputs[idx + 1].focus();
    };

    input.addEventListener('input', () => {
      const v = input.value.trim().toLowerCase().replace(/[^a-z]/g, '');
      if (v !== input.value) input.value = v;
      state.words[idx] = v;
      const s = suggestionFor(v);
      while (list.firstChild) list.removeChild(list.firstChild);
      if (s) {
        list.append(h('button.wf__opt', {
          type: 'button', role: 'option', 'aria-selected': 'true',
          onmousedown: (e) => e.preventDefault(),
          onclick: () => accept(s, true),
        }, s));
      }
      list.hidden = !s;
      paint();
      onchange && onchange();
    });

    input.addEventListener('keydown', (e) => {
      const s = suggestionFor(input.value);
      if ((e.key === 'Enter' || e.key === 'Tab' || e.key === ' ') && s) {
        e.preventDefault();
        accept(s, true);
      } else if (e.key === ' ' || (e.key === 'Enter' && idx < 23)) {
        e.preventDefault();
        if (inputs[idx + 1]) inputs[idx + 1].focus();
      } else if (e.key === 'Backspace' && input.value === '' && inputs[idx - 1]) {
        e.preventDefault();
        inputs[idx - 1].focus();
      }
    });

    input.addEventListener('blur', () => { setTimeout(() => { list.hidden = true; }, 120); });

    // The one paste the app helps with — and it warns, once, that a clipboard is not private.
    input.addEventListener('paste', (e) => {
      const text = (e.clipboardData && e.clipboardData.getData('text')) || '';
      const parts = text.trim().toLowerCase().split(/\s+/).filter(Boolean);
      if (parts.length < 2) return;
      e.preventDefault();
      for (let k = 0; k < 24; k++) {
        const w = parts[k] || '';
        state.words[k] = isWord(w) ? w : w.replace(/[^a-z]/g, '');
        inputs[k].value = state.words[k];
        inputs[k].dispatchEvent(new Event('input'));
      }
      onpastewarn && onpastewarn();
      onchange && onchange();
    });

    inputs.push(input);
    wrap.append(field);
    paint();
  }

  wrap.focusFirstEmpty = () => (inputs.find((i) => !i.value) || inputs[0]).focus();
  wrap.mask = () => {
    for (const i of inputs) { i.value = ''; i.disabled = true; }
    for (const f of wrap.querySelectorAll('.wf')) f.className = 'wf wf--masked';
  };
  wrap.clear = () => {
    for (let i = 0; i < 24; i++) { state.words[i] = ''; inputs[i].value = ''; }
    for (const f of wrap.querySelectorAll('.wf')) f.className = 'wf';
  };
  return wrap;
}

function tick() {
  const s = svg(['M3 9l3.5 3.5L14 5'], { size: 17, stroke: 'var(--good)', width: 2 });
  s.classList.add('wf__tick');
  s.style.flexShrink = '0';
  return s;
}

// ---------------------------------------------------------------- plate grid

/**
 * 24 rows x 11 weighted bits. One tap toggles one bit — there is no drag-to-fill, because a
 * finger dragged across a row is how someone punches eleven holes they did not mean to.
 * Nothing auto-advances: a valid-looking word is not a correct word.
 */
export function plateGrid(state, { onchange } = {}) {
  const rows = [];
  const wrap = h('div.stack', { style: { gap: '8px' } });

  wrap.append(h('div.grid__head', { 'aria-hidden': 'true' },
    h('span.grid__h', '#'),
    WEIGHTS.map((w) => h('span.grid__h', String(w))),
    h('span')));

  const grid = h('div.grid', { role: 'group', 'aria-label': t('unlock.mode.grid') });

  for (let i = 0; i < 24; i++) {
    const idx = i;
    const sum = h('span.grid__sum');
    const word = h('span.grid__word');
    const cells = WEIGHTS.map((w) => h('button.grid__cell', {
      type: 'button', 'aria-pressed': 'false',
      'aria-label': t('sr.gridcell', { w: idx + 1, bit: w, state: t('sr.notpunched') }),
      onclick: () => {
        state.bits[idx] ^= w;
        paint();
        onchange && onchange();
      },
    }, String(w)));

    const row = h('div.grid__row', { role: 'group' },
      h('div.grid__bits', h('span.grid__n', String(idx + 1)), cells),
      h('div.grid__res', sum, word));

    // Long-press clears one row — the only destructive gesture here, and it affects one row.
    let hold = null;
    const startHold = () => { hold = setTimeout(() => { state.bits[idx] = 0; paint(); onchange && onchange(); announce(t('unlock.grid.clear', { n: idx + 1 })); }, 600); };
    const endHold = () => { clearTimeout(hold); };
    row.addEventListener('pointerdown', startHold);
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) row.addEventListener(ev, endHold);

    row.addEventListener('keydown', (e) => {
      const pos = cells.indexOf(document.activeElement);
      if (e.key === 'ArrowRight' && pos >= 0 && cells[pos + 1]) { e.preventDefault(); cells[pos + 1].focus(); }
      else if (e.key === 'ArrowLeft' && pos > 0) { e.preventDefault(); cells[pos - 1].focus(); }
      else if (e.key === 'ArrowDown' && rows[idx + 1]) { e.preventDefault(); rows[idx + 1].cells[Math.max(pos, 0)].focus(); }
      else if (e.key === 'ArrowUp' && rows[idx - 1]) { e.preventDefault(); rows[idx - 1].cells[Math.max(pos, 0)].focus(); }
    });

    const paint = () => {
      const v = state.bits[idx];
      for (let c = 0; c < WEIGHTS.length; c++) {
        const on = (v & WEIGHTS[c]) !== 0;
        cells[c].setAttribute('aria-pressed', String(on));
        cells[c].setAttribute('aria-label', t('sr.gridcell',
          { w: idx + 1, bit: WEIGHTS[c], state: on ? t('sr.punched') : t('sr.notpunched') }));
      }
      const w = state.wordFor(idx);
      sum.textContent = v === 0 ? '—' : '= ' + v;
      word.textContent = v === 0 ? t('unlock.grid.notset') : (w || t('unlock.grid.outofrange'));
      row.className = 'grid__row' + (v !== 0 && !w ? ' grid__row--bad' : '');
      row.setAttribute('aria-label', v === 0
        ? t('sr.rowunset', { w: idx + 1 })
        : t('sr.rowresolves', { w: idx + 1, word: word.textContent, idx: v }));
    };

    rows.push({ paint, cells });
    grid.append(row);
    paint();
  }

  wrap.append(grid);
  wrap.repaint = () => rows.forEach((r) => r.paint());
  return wrap;
}

/** Plate numbering: TinySeed counts from 1, a raw BIP39 index counts from 0. */
export function resolveWord(sum, oneBased) {
  if (!sum) return '';
  const i = oneBased ? sum - 1 : sum;
  return i >= 0 && i < 2048 ? wordlist[i] : '';
}

export const indexOfWord = (w, oneBased) => {
  const i = wordIndex(w);
  return i < 0 ? 0 : i + (oneBased ? 1 : 0);
};

// ---------------------------------------------------------------- number fields

export function numberFields(state, { onchange } = {}) {
  const wrap = h('div.words');
  for (let i = 0; i < 24; i++) {
    const idx = i;
    const word = h('span.grid__word');
    const input = h('input.wf__in', {
      type: 'text', inputmode: 'numeric', pattern: '[0-9]*', value: state.bits[idx] || '',
      autocomplete: 'off', autocorrect: 'off', autocapitalize: 'off', spellcheck: 'false', name: '',
      'aria-label': t('sr.wordfield', { n: idx + 1 }),
      oninput: (e) => {
        const v = e.target.value.replace(/[^0-9]/g, '').slice(0, 4);
        e.target.value = v;
        state.bits[idx] = v === '' ? 0 : Number(v);
        paint();
        onchange && onchange();
      },
    });
    const field = h('div.wf',
      h('div.wf__box', h('span.wf__n', String(idx + 1)), input, word));
    const paint = () => {
      const v = state.bits[idx];
      const w = state.wordFor(idx);
      word.textContent = v === 0 ? '' : (w || t('unlock.grid.outofrange'));
      field.className = 'wf' + (v !== 0 && !w ? ' wf--bad' : '');
    };
    paint();
    wrap.append(field);
  }
  return wrap;
}
