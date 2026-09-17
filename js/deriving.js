// The derivation screen. The bar is a real measure of Argon2id passes completed; when the
// worker has no fraction to report the bar is replaced by an indeterminate rule and the
// elapsed counter alone. A progress bar that lies about progress is worse than none.

import { announce, h } from './dom.js';
import { t } from './i18n.js';
import { btn, irreversible, note, progress, steps } from './ui.js';
import { terminate } from './keys.js';

export function derivingScreen({ title, body, stepList, footer, run, onCancel }) {
  const started = Date.now();
  let frac = null;
  const bar = progress({ title: t('derive.s2'), elapsed: 0, frac: null, body: t('derive.why') || '' });
  const tick = setInterval(() => {
    const elapsed = Math.floor((Date.now() - started) / 1000);
    bar.update({ elapsed, frac });
    if (elapsed === 6) announce(t('sr.derive', { n: elapsed }));
  }, 250);

  const stop = () => clearInterval(tick);

  const node = h('div.screen.stack-lg',
    h('div.t-step', title.step || ''),
    h('h1.t-display', title.text),
    h('p.t-body', body),
    bar,
    stepList ? steps(stepList) : null,
    note(null, t('derive.keepawake')),
    h('p.t-caption', t('derive.where')),
    footer || null,
    onCancel ? btn(t('derive.cancel'), { onclick: () => { stop(); terminate(); onCancel(); } }) : null);

  run((p) => { frac = p.phase === 'argon2' ? p.frac : frac; })
    .catch((err) => {
      terminate();
      node.replaceChildren(
        h('h1.t-display', title.text),
        irreversible(t('derive.failed'), String(err && err.message ? err.message : err)),
        onCancel ? btn(t('common.back'), { kind: 'primary', onclick: onCancel }) : null);
    })
    .finally(stop);

  return node;
}
