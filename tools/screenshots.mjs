// Drives the real app through a throwaway vault and captures every screen the README shows,
// in both themes. Nothing here is a mockup. Run: node tools/screenshots.mjs
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { join, extname, dirname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'docs/screenshots');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

const server = createServer(async (req, res) => {
  const p = normalize(decodeURIComponent(req.url.split('?')[0]));
  const f = join(ROOT, p === '/' ? 'index.html' : p);
  try {
    res.writeHead(200, { 'content-type': MIME[extname(f)] || 'application/octet-stream' });
    res.end(await readFile(f));
  } catch { res.writeHead(404).end('no'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({
  channel: process.env.DM_CHANNEL || 'chrome',
  // The install gate refuses to render on localhost, so give it a real-looking origin.
  args: ['--host-resolver-rules=MAP dyngmsg.test 127.0.0.1'],
});

async function walk(theme) {
  const sfx = theme === 'dark' ? '-dark' : '';
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await ctx.addInitScript((t) => {
    try { localStorage.setItem('dm.theme', t); } catch { /* ignore */ }
  }, theme);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('  [pageerror]', e.message));

  const shot = async (name) => {
    await page.waitForTimeout(220);
    await page.screenshot({ path: join(OUT, `${name}${sfx}.png`) });
    console.log('  ', `${name}${sfx}.png`);
  };
  const click = async (s) => {
    await page.locator(`#app button:has-text("${s}")`).first().click();
    await page.waitForTimeout(140);
  };

  // The install gate renders only outside an installed app, so it needs a non-localhost origin.
  const gate = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
  });
  await gate.addInitScript((t) => { try { localStorage.setItem('dm.theme', t); } catch {} }, theme);
  const gp = await gate.newPage();
  await gp.goto(base.replace('127.0.0.1', 'dyngmsg.test'));
  await gp.waitForTimeout(500);
  await gp.screenshot({ path: join(OUT, `01-install-gate${sfx}.png`) });
  console.log('  ', `01-install-gate${sfx}.png`);
  await gate.close();

  await page.goto(base);
  await page.waitForTimeout(400);

  await shot('02-warnings');
  for (let i = 0; i < 5; i++) await page.locator('#app .ack input').nth(i).check();
  await click('Create my vault');

  await page.locator('#app input[type=radio]').nth(1).check();   // generated passphrase
  await page.waitForTimeout(150);
  await shot('03-passphrase');
  const generated = (await page.locator('#app .choice .mo').first().innerText()).trim();
  await click('Continue');

  await shot('04-phrase');
  const words = [];
  for (let p = 0; p < 6; p++) {
    for (const w of await page.locator('#app .phrase__t').allInnerTexts()) words.push(w.trim());
    await click(p === 5 ? 'I have written all 24 down' : 'Next four');
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(500);
  await shot('05-deriving');
  await page.waitForSelector('#app:has-text("Prove you wrote them down")', { timeout: 120000 });

  await shot('06-verify');
  for (let i = 0; i < 24; i++) await page.locator('#app .wf__in').nth(i).fill(words[i]);
  await page.locator('#app input[aria-label="Passphrase"]').fill(generated);
  await page.waitForTimeout(150);
  await click('Check and create the vault');
  await page.waitForSelector('#app:has-text("Your vault exists")', { timeout: 120000 });
  await shot('07-vault-created');

  await click('Skip for now');
  await click('Write');
  await page.locator('#app input.input').fill('For Nok, and only Nok');
  await page.locator('#app textarea').fill(
    'If you are reading this, then the rest of it happened the way we both knew it might. '
    + 'I want to start with the boat, because you never let me finish that story.');
  await page.waitForTimeout(150);
  await shot('08-write');
  await click('Seal');
  await page.waitForTimeout(250);
  await click('Done');
  await shot('09-home-locked');

  await click('Unlock to read');
  await shot('10-unlock-type');
  await page.locator('#app .seg button:has-text("Plate grid")').first().click();
  await page.waitForTimeout(200);
  await shot('11-unlock-grid');
  await page.locator('#app .seg button:has-text("Type words")').first().click();
  await page.waitForTimeout(150);

  for (let i = 0; i < 24; i++) await page.locator('#app .wf__in').nth(i).fill(words[i]);
  await page.locator('#app input[aria-label="Passphrase"]').fill(generated);
  await page.waitForTimeout(150);
  await page.locator('#app .pin-bottom button').first().click();
  await page.waitForSelector('#app:has-text("Locks again in")', { timeout: 120000 });
  await shot('12-read');

  // The task-switcher state: content removed from the DOM, not merely covered.
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { get: () => 'hidden', configurable: true });
    Object.defineProperty(document, 'hidden', { get: () => true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(200);
  await page.screenshot({ path: join(OUT, `13-backgrounded${sfx}.png`) });
  console.log('  ', `13-backgrounded${sfx}.png`);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true });
    Object.defineProperty(document, 'hidden', { get: () => false, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.locator('#blank').click();
  await page.waitForTimeout(200);

  await click('Back up');
  await shot('14-backup');
  await click('Back');
  await click('Settings');
  await shot('15-settings');
  await click('Back');

  await page.evaluate(async () => (await import('./js/app.js')).go('guide'));
  await shot('16-guide');

  await ctx.close();
}

// The printed plate sheet, at print size, so the README shows the real thing.
async function plate() {
  const page = await browser.newPage({ viewport: { width: 1000, height: 1400 } });
  await page.goto(base);
  await page.waitForTimeout(300);
  await page.evaluate(async () => {
    const held = await import('./js/held.js');
    const views = await import('./js/views-genesis.js');
    const { wordlist } = await import('./js/vault.js');
    const indices = [268, 1245, 1943, 986, 728, 1090, 1862, 1310, 843, 410, 1691, 1936,
      1108, 63, 1400, 219, 992, 1810, 1234, 1465, 1580, 764, 1315, 570];
    held.hold(indices.map((i) => wordlist[i - 1]));
    document.body.className = 'route-print';
    views.printView({ from: 'home' });
  });
  await page.emulateMedia({ media: 'print' });
  await page.waitForTimeout(300);
  await page.locator('#print .sheet').first().screenshot({ path: join(OUT, 'plate.png'), scale: 'css' });
  console.log('   plate.png');
  await page.close();
}

for (const theme of ['light', 'dark']) {
  console.log(theme);
  await walk(theme);
}
await plate();
await browser.close();
server.close();
console.log('\nscreenshots written to docs/screenshots');
