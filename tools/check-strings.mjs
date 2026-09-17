// Catalogue rules: matching placeholders, Arabic digits only, no markup, nothing untranslated
// that should not be. A dropped {n} is a broken screen, so this runs on every build.
import { en, th } from '../js/strings.js';

const fails = [];
const must = (cond, label) => { if (!cond) { fails.push(label); console.log('FAIL  ' + label); } };
const ph = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

// Names, hostnames, the wordlist and library names stay English on purpose.
const KEEP_ENGLISH = new Set([
  'app.name', 'app.origin', 'common.words24', 'boot.idb', 'unlock.numbering.tiny', 'lang.en',
]);

for (const [k, v] of Object.entries(en)) {
  const t = th[k];
  must(t !== undefined, `${k}: missing from th`);
  if (t === undefined) continue;
  must(ph(v) === ph(t), `${k}: placeholders differ — en {${ph(v)}} vs th {${ph(t)}}`);
  must(!/[๐-๙]/.test(t), `${k}: contains Thai numerals`);
  must(!/[<>]/.test(t), `${k}: contains markup`);
  must(t.trim() === t, `${k}: leading or trailing whitespace`);
  if (!KEEP_ENGLISH.has(k)) {
    must(/[฀-๿]/.test(t), `${k}: no Thai characters — left untranslated?`);
  }
}
for (const k of Object.keys(th)) must(k in en, `${k}: in th but not in en`);

console.log(fails.length
  ? `\n${fails.length} problems`
  : `strings: ${Object.keys(en).length} keys, en and th complete and consistent`);
process.exit(fails.length ? 1 : 0);
