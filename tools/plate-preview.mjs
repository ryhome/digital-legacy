// Renders the plate sheet at print size and saves a PNG + PDF, so the sheet can be eyeballed
// against artboard C4 without a printer. node tools/plate-preview.mjs [outdir]
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, dirname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.argv[2] || ROOT;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = createServer(async (req, res) => {
  const p = normalize(decodeURIComponent(req.url.split('?')[0]));
  const file = join(ROOT, p === '/' ? 'index.html' : p);
  try {
    const b = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(b);
  } catch { res.writeHead(404).end('no'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

// The design canvas used plausible-looking placeholders, some of which are not BIP39 words.
// Take the artboard's TinySeed numbers and read the real words off the list, so the preview is
// directly comparable to artboard C4 and every row resolves.
const INDICES = [268, 1245, 1943, 986, 728, 1090, 1862, 1310, 843, 410, 1691, 1936,
  1108, 63, 1400, 219, 992, 1810, 1234, 1465, 1580, 764, 1315, 570];

let failed = false;
const browser = await chromium.launch({ channel: process.env.DM_CHANNEL || 'chrome' });
for (const locale of ['en', 'th']) {
  const page = await browser.newPage({ viewport: { width: 1000, height: 1400 } });
  page.on('console', (m) => { if (m.type() === 'error') console.log('[c]', m.text()); });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto(base);
  await page.waitForTimeout(300);
  await page.evaluate(async ([indices, loc]) => {
    // Drive the real view directly: this preview only needs the sheet, not the whole app shell.
    const i18n = await import('./js/i18n.js');
    const held = await import('./js/held.js');
    const views = await import('./js/views-genesis.js');
    const { wordlist } = await import('./js/vault.js');
    i18n.setLocale(loc);
    held.hold(indices.map((i) => wordlist[i - 1]));
    document.body.className = 'route-print';
    views.printView({ from: 'home' });
  }, [INDICES, locale]);
  await page.waitForTimeout(400);
  await page.emulateMedia({ media: 'print' });
  await page.waitForTimeout(150);
  const sheets = await page.locator('#print .sheet').count();
  for (let i = 0; i < sheets; i++) {
    const file = join(OUT, `plate-${locale}${sheets > 1 ? '-p' + (i + 1) : ''}.png`);
    await page.locator('#print .sheet').nth(i).screenshot({ path: file, scale: 'css' });
    console.log('wrote', file);
  }
  for (const format of ['A4', 'Letter']) {
    const path = join(OUT, `plate-${locale}-${format}.pdf`);
    await page.pdf({ path, format, printBackground: true });
    const pages = (await readFile(path, 'latin1')).match(/\/Type\s*\/Page[^s]/g).length;
    const ok = pages === sheets;
    if (!ok) failed = true;
    console.log(`${ok ? ' ok ' : 'FAIL'}  ${locale} on ${format}: ${pages} printed page(s), expected ${sheets}`);
  }
  await page.close();
}
await browser.close();
server.close();
console.log(failed ? '\nthe plate sheet does not paginate correctly' : '\nplate sheet paginates correctly on A4 and Letter');
process.exit(failed ? 1 : 0);
