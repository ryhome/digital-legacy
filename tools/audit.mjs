// The rules from the requirements that are cheap to enforce mechanically, checked on every build.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const app = readdirSync('js').filter((f) => f.endsWith('.js')).map((f) => ['js/' + f, readFileSync('js/' + f, 'utf8')]);
const all = app.concat([['index.html', readFileSync('index.html', 'utf8')], ['sw.js', readFileSync('sw.js', 'utf8')]]);
const fails = [];
const must = (cond, label) => { console.log(`${cond ? ' ok ' : 'FAIL'}  ${label}`); if (!cond) fails.push(label); };

// §10 supply chain
for (const [f, s] of all) {
  must(!/\.innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(s), `${f}: no HTML injection sink`);
  must(!/\beval\(|new Function\(/.test(s), `${f}: no eval`);
  must(!/https?:\/\/(?!dyngmsg|example|www\.w3\.org)/.test(s.replace(/^\s*\/\/.*$/gm, '')), `${f}: no external URL (w3.org XML namespaces excepted)`);
}
// §2 zero runtime network: nothing but the service worker may fetch.
for (const [f, s] of app) {
  if (f === 'js/app.js') continue;                    // registers the service worker only
  must(!/\bfetch\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon/.test(s), `${f}: no network call`);
}
// §5 the phrase must never sit in a field a password manager will touch
for (const [f, s] of app) must(!/type:\s*'password'/.test(s), `${f}: no password field`);
// §4 one crypto source
for (const [f, s] of app) {
  if (f === 'js/vault.js') continue;
  must(!/vendor\/noble/.test(s), `${f}: imports crypto only through vault.js`);
}
// §10 CSP
const html = readFileSync('index.html', 'utf8');
for (const d of ["default-src 'none'", "script-src 'self'", "connect-src 'none'", "form-action 'none'",
  "base-uri 'none'", "object-src 'none'", "worker-src 'self'", "img-src 'self' data:"]) {
  must(html.includes(d), `CSP: ${d}`);
}
must(!/'unsafe-inline'|'unsafe-eval'/.test(html), 'CSP: no unsafe-inline or unsafe-eval');
must(/no-referrer/.test(html), 'meta referrer no-referrer');
must(!/<script(?![^>]*src=)/.test(html.replace(/<script type="module" src[^>]*>/g, '')), 'no inline script in index.html');

// §5 no clipboard or download path for the phrase
for (const [f, s] of app) {
  must(!/navigator\.clipboard|execCommand\(/.test(s), `${f}: no clipboard write`);
}

console.log(fails.length ? `\n${fails.length} FAILURES` : '\naudit clean');
process.exit(fails.length ? 1 : 0);
