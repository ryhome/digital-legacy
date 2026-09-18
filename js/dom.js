// Minimal DOM building. textContent only — there is no innerHTML anywhere in this app,
// and no string of markup is ever assembled, so there is nothing for an injection to ride in on.

const SVG = 'http://www.w3.org/2000/svg';

/** h('div.card', {onclick}, ...children) — tag#id.class.class */
export function h(spec, props, ...kids) {
  const [head, ...cls] = String(spec).split('.');
  const [tag, id] = head.split('#');
  const el = document.createElement(tag || 'div');
  if (id) el.id = id;
  if (cls.length) el.className = cls.join(' ');
  if (props && (props.nodeType || Array.isArray(props) || typeof props === 'string')) {
    kids.unshift(props);
  } else if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = el.className ? el.className + ' ' + v : v;
      else if (k === 'style') Object.assign(el.style, v);
      else if (k === 'text') el.textContent = String(v);
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k in el && k !== 'list' && typeof el[k] !== 'object') el[k] = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  add(el, kids);
  return el;
}

function add(el, kids) {
  for (const k of kids) {
    if (k === null || k === undefined || k === false) continue;
    if (Array.isArray(k)) add(el, k);
    else el.append(k.nodeType ? k : document.createTextNode(String(k)));
  }
}

export function svg(d, { size = 20, stroke = 'currentColor', width = 1.6, fill = 'none' } = {}) {
  const s = document.createElementNS(SVG, 'svg');
  s.setAttribute('width', size); s.setAttribute('height', size);
  s.setAttribute('viewBox', `0 0 ${size} ${size}`);
  s.setAttribute('aria-hidden', 'true');
  s.setAttribute('focusable', 'false');
  for (const path of [].concat(d)) {
    const p = document.createElementNS(SVG, 'path');
    p.setAttribute('d', path);
    p.setAttribute('fill', fill); p.setAttribute('stroke', stroke);
    p.setAttribute('stroke-width', width);
    p.setAttribute('stroke-linecap', 'round'); p.setAttribute('stroke-linejoin', 'round');
    s.append(p);
  }
  return s;
}

/**
 * Append with h()'s child rules — null, undefined and false are skipped, arrays flattened.
 * The native Element.append() turns a null into the text "null", which is how a conditional
 * child once printed the word under the install button.
 */
export function append(el, ...kids) { add(el, kids); return el; }

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

/** Announce to screen readers without moving focus. */
let liveEl = null;
export function announce(msg) {
  if (!liveEl) {
    liveEl = h('div.vh', { role: 'status', 'aria-live': 'polite' });
    document.body.append(liveEl);
  }
  liveEl.textContent = '';
  setTimeout(() => { liveEl.textContent = msg; }, 30);
}
