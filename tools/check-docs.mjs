// Every image the README points at must exist. A broken screenshot link is a lie about the app.
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const md = readFileSync(join(ROOT, 'README.md'), 'utf8');
let bad = 0;
for (const m of md.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) {
  if (!existsSync(join(ROOT, m[1]))) { console.log('MISSING', m[1]); bad++; }
}
for (const m of md.matchAll(/\]\((docs\/[^)]+|tools\/[^)]+|js\/[^)]+)\)/g)) {
  if (!existsSync(join(ROOT, m[1]))) { console.log('MISSING LINK', m[1]); bad++; }
}
console.log(bad ? `${bad} broken references` : 'README: every image and link resolves');
process.exit(bad ? 1 : 0);
