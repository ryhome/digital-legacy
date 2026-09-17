// Flags imported names that never appear again in the file. Keeps the modules honest.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
let n = 0;
for (const f of readdirSync('js').filter((x) => x.endsWith('.js'))) {
  const src = readFileSync(join('js', f), 'utf8');
  for (const m of src.matchAll(/import\s+\{([^}]*)\}\s+from\s+['"][^'"]+['"];?/g)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop().trim();
      if (!name) continue;
      const uses = src.split(new RegExp(`\\b${name}\\b`)).length - 1;
      const inImport = (m[0].split(new RegExp(`\\b${name}\\b`)).length - 1);
      if (uses <= inImport) { console.log(`${f}: ${name}`); n++; }
    }
  }
}
console.log(n ? `${n} unused imports` : 'no unused imports');
