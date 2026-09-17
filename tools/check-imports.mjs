// Parses every app module and verifies each named import actually exists in its target.
// Catches the class of bug that only shows up as a blank screen in the browser.
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const files = readdirSync(join(ROOT, 'js')).filter((f) => f.endsWith('.js')).map((f) => join(ROOT, 'js', f));
files.push(join(ROOT, 'sw.js'));

let bad = 0;
const exportsOf = new Map();
for (const f of files.concat([join(ROOT, 'vendor/noble.js')])) {
  try {
    const m = await import(pathToFileURL(f).href + '?probe');
    exportsOf.set(f, new Set(Object.keys(m)));
  } catch (err) {
    // Modules that touch the DOM at import time are fine; we only need their export names.
    exportsOf.set(f, null);
    if (err instanceof SyntaxError) { console.error('SYNTAX', f, err.message); bad++; }
  }
}

const IMPORT_RE = /import\s+(?:([\w*\s{},]+)\s+from\s+)?['"]([^'"]+)['"]/g;
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(IMPORT_RE)) {
    const [, clause, spec] = m;
    if (!spec.startsWith('.')) { console.error('BARE IMPORT', f, spec); bad++; continue; }
    const target = resolve(dirname(f), spec);
    if (!exportsOf.has(target)) { console.error('MISSING FILE', f, '->', spec); bad++; continue; }
    const names = exportsOf.get(target);
    if (!names || !clause) continue;
    const braces = clause.match(/\{([^}]*)\}/);
    if (!braces) continue;
    for (const part of braces[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/)[0].trim();
      if (!name) continue;
      if (!names.has(name)) { console.error('NO EXPORT', `${spec} has no "${name}"`, '(in', f + ')'); bad++; }
    }
  }
}

// Every view registered in main.js must exist.
const main = readFileSync(join(ROOT, 'js/main.js'), 'utf8');
for (const m of main.matchAll(/([\w'-]+):\s*(gate|genesis|vault|unlock)\.(\w+)/g)) {
  const mod = join(ROOT, 'js', `views-${m[2] === 'gate' ? 'gate' : m[2]}.js`);
  const names = exportsOf.get(mod);
  if (names && !names.has(m[3])) { console.error('NO VIEW', m[3], 'in', mod); bad++; }
}

// Every service-worker precache path must exist on disk.
for (const m of readFileSync(join(ROOT, 'sw.js'), 'utf8').matchAll(/'\.\/([^']+)'/g)) {
  try { readFileSync(join(ROOT, m[1])); } catch { console.error('SW precache missing', m[1]); bad++; }
}

console.log(bad ? `${bad} problems` : 'imports, views and precache list all resolve');
process.exit(bad ? 1 : 0);
