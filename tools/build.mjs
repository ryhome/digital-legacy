// Build: vendor the pinned crypto deps into one ESM file, stamp the release
// hash into sw.js + js/version.js, and write SHA256SUMS for publication.
//   node tools/build.mjs
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const pkg = JSON.parse(readFileSync(join(ROOT, 'tools/package.json'), 'utf8'));

await build({
  entryPoints: [join(ROOT, 'tools/vendor-entry.js')],
  outfile: join(ROOT, 'vendor/noble.js'),
  bundle: true, format: 'esm', target: 'es2022',
  minify: false,            // readable, so the vendored code stays auditable
  legalComments: 'inline',
  banner: { js: `// Vendored, pinned, no CDN. Rebuild: node tools/build.mjs\n` +
    Object.entries(pkg.dependencies).filter(([k]) => k !== 'esbuild')
      .map(([k, v]) => `//   ${k}@${v}`).join('\n') + '\n' },
});

// Files that make up a release, in a stable order.
const walk = (d, out = []) => {
  for (const n of readdirSync(d).sort()) {
    const p = join(d, n);
    if (n === 'node_modules' || n.startsWith('.')) continue;
    statSync(p).isDirectory() ? walk(p, out) : out.push(p);
  }
  return out;
};
const RELEASE = ['index.html', 'app.css', 'manifest.webmanifest', 'sw.js']
  .map((f) => join(ROOT, f))
  .concat(walk(join(ROOT, 'js')), walk(join(ROOT, 'vendor')), walk(join(ROOT, 'icons')));

// version.js and sw.js are rewritten below, so hash them with their hash slot blanked.
const BLANK = '0'.repeat(64);
const stampable = (p) => p.endsWith('/js/version.js') || p.endsWith('/sw.js');
const norm = (p, b) => stampable(p) ? Buffer.from(b.toString('utf8').replace(/[0-9a-f]{64}|__RELEASE__/g, BLANK)) : b;

const digests = RELEASE.map((p) => [relative(ROOT, p), sha(norm(p, readFileSync(p)))]);
const release = sha(digests.map(([f, h]) => `${h}  ${f}`).join('\n')).slice(0, 64);

for (const p of RELEASE.filter(stampable)) {
  writeFileSync(p, readFileSync(p, 'utf8').replace(/[0-9a-f]{64}|__RELEASE__/g, release));
}
// The catalogue rule: a missing Thai key falls back to English and is reported HERE, not at
// runtime. Safety copy is never machine-translated, so gaps are expected and must stay visible.
const strings = await import(pathToFileURL(join(ROOT, 'js/strings.js')).href);
const missingTh = Object.keys(strings.en).filter((k) => !(k in strings.th));
console.log(`strings: ${Object.keys(strings.en).length} en, ${Object.keys(strings.th).length} th, ${missingTh.length} falling back to English`);
if (missingTh.length) writeFileSync(join(ROOT, 'MISSING-TH.txt'), missingTh.join('\n') + '\n');
else rmSync(join(ROOT, 'MISSING-TH.txt'), { force: true });

writeFileSync(join(ROOT, 'SHA256SUMS'),
  digests.map(([f, h]) => `${h}  ${f}`).join('\n') + `\nrelease  ${release}\n`);
console.log('release', release);
