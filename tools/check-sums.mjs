// SHA256SUMS must verify against the bytes actually on disk, with no special knowledge.
// If it only verifies with the build's own blanking rules, it is not a checksum file.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const lines = readFileSync(join(ROOT, 'SHA256SUMS'), 'utf8').trim().split('\n');
let bad = 0;
let files = 0;
let release = null;

for (const line of lines) {
  const [hash, file] = line.split(/\s{2,}/);
  if (hash === 'release') { release = file; continue; }
  files++;
  let actual;
  try {
    actual = createHash('sha256').update(readFileSync(join(ROOT, file))).digest('hex');
  } catch {
    console.log('MISSING', file); bad++; continue;
  }
  if (actual !== hash) { console.log('MISMATCH', file); bad++; }
}
if (!release || !/^[0-9a-f]{64}$/.test(release)) { console.log('no release hash'); bad++; }

console.log(bad
  ? `${bad} problems in SHA256SUMS`
  : `SHA256SUMS verifies: ${files} files, release ${release.slice(0, 8)}`);
process.exit(bad ? 1 : 0);
