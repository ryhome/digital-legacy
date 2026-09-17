// End-to-end: boot -> genesis -> write -> unlock -> read -> backup -> restore, in a real browser,
// against a real server, with the real CSP. Run: node tools/e2e.mjs
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, dirname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json',
};

const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  const file = join(ROOT, path === '/' ? 'index.html' : path);
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': MIME[extname(file)] || 'application/octet-stream',
      'service-worker-allowed': '/',
    });
    res.end(body);
  } catch { res.writeHead(404).end('no'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch({ channel: process.env.DM_CHANNEL || 'chrome' });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
// Desktop without Web Share: exercises the download path. The share path is the same code with
// navigator.share in place of the anchor.
await ctx.addInitScript(() => {
  delete Navigator.prototype.canShare;
  delete Navigator.prototype.share;
});
const page = await ctx.newPage();

const problems = [];
let expectCspError = false;   // the CSP probe below trips one on purpose
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  if (expectCspError && /Content Security Policy/.test(m.text())) return;
  problems.push('console: ' + m.text());
  console.log('  [console]', m.text());
});
page.on('pageerror', (e) => {
  if (/deliberate test fault/.test(e.message)) return;   // thrown on purpose below
  problems.push('pageerror: ' + e.message);
  console.log('  [pageerror]', e.message);
});

const check = (cond, label) => {
  console.log(`${cond ? ' ok ' : 'FAIL'}  ${label}`);
  if (!cond) problems.push(label);
};
const text = () => page.locator('#app').innerText();
const has = async (s) => (await text()).includes(s);
const clickText = async (s) => {
  await page.locator(`#app button:has-text("${s}")`).first().click();
  await page.waitForTimeout(80);
};

await page.goto(base);
await page.waitForTimeout(400);

// --- boot straight into genesis (127.0.0.1 counts as installed for development)
check(await has('Before you begin'), 'boot reaches genesis warnings');

// --- C1: create stays disabled until all five are marked
let create = page.locator('#app button:has-text("Create my vault")');
check(await create.isDisabled(), 'C1 create disabled with nothing marked');
for (let i = 0; i < 5; i++) await page.locator('#app .ack input').nth(i).check();
await page.waitForTimeout(60);
check(await has('5 of 5 marked'), 'C1 counts acknowledgements');
await clickText('Create my vault');

// --- C2: passphrase, custom, strength gate
check(await has('A passphrase, or not'), 'C2 passphrase choice');
await page.locator('#app input[type=radio]').nth(2).check();
await page.waitForTimeout(60);
const cont = page.locator('#app button:has-text("Continue")');
check(await cont.isDisabled(), 'C2 continue blocked by weak passphrase');
const PASS = 'the boat story 1998';
await page.locator('#app .choice input.input').fill(PASS);
await page.waitForTimeout(60);
check(!(await cont.isDisabled()), 'C2 continue enabled once strong enough');
await clickText('Continue');

// --- C3: four words at a time, six pages, nothing to copy
check(await has('Write these down'), 'C3 phrase display');
check(await has('Words 1–4 of 24'), 'C3 first page is words 1-4');
check((await page.locator('#app .phrase__w').count()) === 4, 'C3 exactly four words on screen');
check((await page.locator('#app [data-copy], #app button:has-text("Copy")').count()) === 0,
  'C3 offers no copy affordance');

const words = [];
for (let p = 0; p < 6; p++) {
  for (const w of await page.locator('#app .phrase__t').allInnerTexts()) words.push(w.trim());
  await clickText(p === 5 ? 'I have written all 24 down' : 'Next four');
  await page.waitForTimeout(120);
}
check(words.length === 24, `C3 paged through all 24 words (${words.length})`);

// --- C6: first derivation (bench + argon2)
check(await has('Working out your key'), 'C6 derivation screen');
await page.waitForSelector('#app:has-text("Prove you wrote them down")', { timeout: 120000 });
check(true, 'C6 initial derivation completed');

// --- C5: verification rejects a wrong word, accepts the real phrase
const fill = async (list, pass) => {
  for (let i = 0; i < 24; i++) await page.locator('#app .wf__in').nth(i).fill(list[i]);
  await page.locator('#app input[aria-label="Passphrase"]').fill(pass);
  await page.waitForTimeout(80);
};
const wrong = words.slice(); wrong[6] = wrong[6] === 'zoo' ? 'abandon' : 'zoo';
await fill(wrong, PASS);
await clickText('Check and create the vault');
check(await has('not the words this app just gave you'), 'C5 rejects a wrong word');

await fill(words, PASS);
await clickText('Check and create the vault');
await page.waitForSelector('#app:has-text("Your vault exists")', { timeout: 120000 });
const fp = (await page.locator('#app .fp').innerText()).trim();
check(/^[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}$/.test(fp), `C7 fingerprint shown (${fp})`);

// --- C4: the printed plate template must encode the phrase correctly
await clickText('Print the plate template');
await page.waitForTimeout(250);
const plate = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('#print .plate tbody tr')];
  const W = [1024, 512, 256, 128, 64, 32, 16, 8, 4, 2, 1];
  return {
    sheets: document.querySelectorAll('#print .sheet').length,
    rows: rows.length,
    heads: [...document.querySelectorAll('#print .plate thead th')].map((t) => t.textContent),
    foot: document.querySelector('#print .sheet__foot span:last-child').textContent,
    vault: document.querySelector('#print .sheet__fval--vault').textContent,
    dateBlank: document.querySelector('#print .sheet__fval--date').textContent.trim() === '',
    notes: document.querySelectorAll('#print .sheet__notes p').length,
    // Reconstruct each row's number from the squares that are actually filled black.
    read: rows.map((r) => {
      const word = r.querySelector('.plate__word').textContent;
      const cells = [...r.querySelectorAll('.plate__c path')];
      const sum = cells.reduce((n, p, i) => n + (p.getAttribute('fill') === '#000' ? W[i] : 0), 0);
      return { word, sum, printed: Number(r.querySelector('.plate__sum').textContent) };
    }),
    anyCssBackground: [...document.querySelectorAll('#print .plate__c')]
      .some((td) => getComputedStyle(td).backgroundImage !== 'none'),
  };
});
check(plate.sheets === 1, `C4 one page in English (${plate.sheets})`);
check(plate.rows === 24, `C4 24 rows (${plate.rows})`);
check(plate.heads.join(',') === '#,Word,1024,512,256,128,64,32,16,8,4,2,1,Sum', 'C4 header matches the design');
check(plate.notes === 3, 'C4 three note columns above the grid');
check(plate.vault === fp, 'C4 vault fingerprint printed');
check(plate.dateBlank, 'C4 date is a blank ruled line to fill in by hand');
check(/Page 1 of 1/.test(plate.foot), `C4 footer names the page (${plate.foot})`);
check(plate.read.every((r) => r.sum === r.printed), 'C4 punched squares add up to the printed number');
check(plate.read.every((r, i) => r.word === words[i]), 'C4 rows carry the phrase in order');
check(plate.read.every((r) => r.printed >= 1 && r.printed <= 2048), 'C4 every number is in TinySeed range');
check(plate.read.some((r) => r.sum !== 0), 'C4 squares are actually filled');

// The sheet holds all 24 words: it must not survive leaving the screen.
await clickText('Back');
await page.waitForTimeout(150);
const leftover = await page.evaluate(() => document.getElementById('print').textContent.trim());
check(leftover === '', 'C4 the sheet is emptied on leaving the print view');

await clickText('Skip for now');
check(await has('Never backed up'), 'D1 never-backed-up banner, no dismiss');
check((await page.locator('#app .banner button:has-text("Back up")').count()) === 1,
  'D1 banner action opens backup');

// --- E: write (no phrase asked for)
await clickText('Write');
check(await has('New message'), 'E1 compose');
await page.locator('#app input.input').fill('For Nok, and only Nok');
const MSG = 'If you are reading this, then the rest of it happened the way we both knew it might.';
await page.locator('#app textarea').fill(MSG);
await page.waitForTimeout(80);
check(await has('characters'), 'E1 character count');
await clickText('Seal');
await page.waitForTimeout(200);
check(await has('Sealed'), 'E2 sealed confirmation');
check(!(await has(MSG.slice(0, 30))), 'E2 no preview of the message after sealing');
await clickText('Done');

// --- D2: the locked list shows no content
check(await has('One sealed message'), 'D2 count without content');
check(!(await has('Nok')), 'D2 label is not readable while locked');

// --- B: a cold restart must find the vault. Resolving a read on transaction-complete alone
// hands back undefined, which reads as "no vault" and crashes the unlock on meta.kdf.
await page.reload();
await page.waitForSelector('#app:has-text("One sealed message")', { timeout: 30000 });
check(await has(fp), 'B restart finds the vault and shows its fingerprint');
const reads = await page.evaluate(async () => {
  const db = await import('./js/db.js');
  const out = { undef: 0, badKdf: 0 };
  for (let i = 0; i < 200; i++) {
    const m = await db.getMeta();
    if (!m) out.undef++;
    else if (!m.kdf || typeof m.kdf.t !== 'number') out.badKdf++;
  }
  return out;
});
check(reads.undef === 0, `B 200 reads of the vault record, none undefined (${reads.undef} were)`);
check(reads.badKdf === 0, `B every read carries a usable kdf (${reads.badKdf} did not)`);

// --- F: unlock with the wrong passphrase, then the right one
await clickText('Unlock to read');

// --- F1: the three input modes, and the control that switches them
const segState = () => page.evaluate(() => {
  const seg = document.querySelector('#app .seg');
  return {
    checked: [...seg.querySelectorAll('button')]
      .filter((b) => b.getAttribute('aria-checked') === 'true').map((b) => b.textContent),
    tabStops: [...seg.querySelectorAll('button')].filter((b) => b.tabIndex === 0).length,
    words: document.querySelectorAll('#app .wf__in').length,
    cells: document.querySelectorAll('#app .grid__cell').length,
  };
});
let seg = await segState();
check(seg.checked.join() === 'Type words' && seg.words === 24 && seg.cells === 0,
  'F1 opens on Type words with 24 fields');
check(seg.tabStops === 1, 'F1 the mode group is a single Tab stop');

await page.locator('#app .seg button:has-text("Plate grid")').first().click();
await page.waitForTimeout(150);
seg = await segState();
check(seg.checked.join() === 'Plate grid', `F1 choosing Plate grid moves the highlight (${seg.checked})`);
check(seg.cells === 264, `F1 plate grid draws 24 x 11 cells (${seg.cells})`);

// Labels must not clip: a cell reading "102" instead of "1024" is a plate punched wrong.
const overflow = await page.evaluate(() => {
  const clipped = [...document.querySelectorAll('#app .grid__cell, #app .grid__h')]
    .filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent);
  return { clipped, pageWider: document.documentElement.scrollWidth > window.innerWidth + 1 };
});
check(overflow.clipped.length === 0, `F1 no weight label is clipped (${overflow.clipped.slice(0, 4)})`);
check(!overflow.pageWider, 'F1 the grid does not push the page wider than the screen');

// Switching numbering re-resolves every row; the punches do not move, only the words under them.
await page.locator('#app .grid__row').first().locator('.grid__cell').last().click();
await page.waitForTimeout(100);
const tiny = await page.locator('#app .grid__row').first().locator('.grid__word').innerText();
await page.locator('#app .seg').nth(1).locator('button:has-text("BIP39")').click();
await page.waitForTimeout(150);
const bip = await page.locator('#app .grid__row').first().locator('.grid__word').innerText();
const stillPunched = await page.locator('#app .grid__row').first()
  .locator('.grid__cell[aria-pressed="true"]').count();
check(tiny === 'abandon' && bip === 'ability', `F1 numbering shifts the word by one (${tiny} -> ${bip})`);
check(stillPunched === 1, 'F1 switching numbering does not move the punches');
const numbering = await page.locator('#app .seg').nth(1).locator('button[aria-checked="true"]').innerText();
check(/BIP39/.test(numbering), `F1 the numbering control shows its own choice (${numbering})`);

await page.locator('#app .seg button:has-text("Numbers")').first().click();
await page.waitForTimeout(150);
seg = await segState();
check(seg.checked.join() === 'Numbers' && seg.cells === 0, 'F1 choosing Numbers switches again');

// Arrow keys move and select within the group, as a radiogroup should.
await page.locator('#app .seg button:has-text("Numbers")').first().focus();
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(150);
seg = await segState();
check(seg.checked.join() === 'Type words', `F1 arrow keys wrap around the group (${seg.checked})`);
check(seg.words === 24, 'F1 arrow-key selection redraws the fields too');

await fill(words, 'wrong passphrase entirely');
await page.locator('#app button:has-text("Open the vault")').last().click();
await page.waitForSelector('#app:has-text("The words are right. The passphrase is not.")', { timeout: 120000 });
check(true, 'F4 wrong passphrase is distinguished from wrong words');

await fill(words, PASS);
await page.locator('#app .pin-bottom button').first().click();
await page.waitForSelector('#app:has-text("Locks again in")', { timeout: 120000 });
check(await has(MSG.slice(0, 40)), 'F5 message decrypts and reads back');
check(await has('For Nok, and only Nok'), 'F5 intended-for label decrypts');
check(await has('Locks again in'), 'F5 relock countdown always visible');

// --- F6: backgrounding blanks and locks
await page.evaluate(() => {
  Object.defineProperty(document, 'visibilityState', { get: () => 'hidden', configurable: true });
  Object.defineProperty(document, 'hidden', { get: () => true, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
});
await page.waitForTimeout(120);
check(await page.locator('#blank').isVisible(), 'F6 blank overlay painted on background');
const domText = await page.evaluate(() => document.getElementById('app').textContent);
check(!domText.includes(MSG.slice(0, 30)), 'F6 decrypted text removed from the DOM, not hidden');

await page.evaluate(() => {
  Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true });
  Object.defineProperty(document, 'hidden', { get: () => false, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
});
await page.locator('#blank').click();
await page.waitForTimeout(150);
check(await has('One sealed message'), 'F6 returns to the locked list');

// --- G1: backup writes a file with only public data in it
await clickText('Back up');
await page.waitForTimeout(200);
check(await has('Download'), 'G1 offers Download where Web Share is unavailable');
const dl = page.waitForEvent('download');
await clickText('Download');
const file = await dl;
const blob = await readFile(await file.path(), 'utf8');
check(blob.includes('dying-message-vault'), 'G1 export is a Dying Message backup');
check(blob.includes(fp), 'G1 export carries the fingerprint');
check(!blob.includes(words[0]) && !blob.includes(PASS), 'G1 export contains no phrase or passphrase');
check(!blob.includes(MSG.slice(0, 20)), 'G1 export contains no plaintext');
check(file.suggestedFilename().endsWith('.dmv'), `G1 filename is ${file.suggestedFilename()}`);
await page.waitForTimeout(150);
check(await has('Saved'), 'G1 backup banner reset');

// --- G2: restoring the same file is a no-op merge
await clickText('Back');
await clickText('Restore');
await page.locator('#app input[type=file]').setInputFiles(await file.path());
await page.waitForTimeout(300);
check(await has('nothing new in this file'), 'G2 same-vault restore adds nothing');

// --- a crash must surface, not break a screen silently
await page.evaluate(() => { setTimeout(() => { throw new Error('deliberate test fault'); }, 0); });
await page.waitForTimeout(250);
const crash = await text();
check(/Something in the app went wrong/.test(crash), 'crash reporter catches a thrown error');
check(/deliberate test fault/.test(crash), 'crash screen names the fault');
check(/route ->/.test(crash), 'crash screen carries diagnostics');
check(!crash.includes(PASS) && !crash.includes(words[0]) && !crash.includes(MSG.slice(0, 20)),
  'crash screen leaks no phrase, passphrase or message');
await page.reload();
await page.waitForSelector('#app:has-text("One sealed message")', { timeout: 30000 });
check(true, 'the app recovers on reload after a crash');

// --- destructive confirmation is typed, never a single tap
await clickText('Settings');
await clickText('Remove this vault from this device');
await page.waitForTimeout(120);
const erase = page.locator('#app button:has-text("Erase this vault")');
check(await erase.isDisabled(), 'H remove-vault disabled before the fingerprint is typed');
await page.locator('#app input.input').fill(fp.slice(0, -1));
await page.waitForTimeout(60);
check(await erase.isDisabled(), 'H remove-vault still disabled on a near-miss');
await page.locator('#app input.input').fill(fp);
await page.waitForTimeout(60);
check(!(await erase.isDisabled()), 'H remove-vault enabled only on an exact match');
await clickText('Keep it');
check(await has('Settings'), 'H "Keep it" leaves the vault alone');

// --- CSP actually applied
const csp = await page.evaluate(() =>
  document.querySelector('meta[http-equiv="Content-Security-Policy"]').content);
for (const d of ["default-src 'none'", "connect-src 'none'", "script-src 'self'", "base-uri 'none'"]) {
  check(csp.includes(d), `CSP has ${d}`);
}
expectCspError = true;
const blocked = await page.evaluate(async () => {
  try { await fetch('https://example.com'); return false; } catch { return true; }
});
check(blocked, 'CSP blocks an outbound request from the page');

// --- Thai renders, and the words stay English (still on Settings after "Keep it")
await page.locator('#app button:has-text("ไทย")').first().click();
await page.waitForTimeout(150);
check(await has('ตั้งค่า'), 'localisation switches the app to Thai');
check(await has('ลายนิ้วมือของที่เก็บ'), 'Thai reaches the vault section');
check(await has(fp), 'the fingerprint is never localised');
check(!/[๐-๙]/.test(await text()), 'no Thai numerals anywhere');
await page.locator('#app button:has-text("English")').first().click();
await page.waitForTimeout(150);

await browser.close();

// --- A: the install gate, on an origin that is not localhost
const gated = await chromium.launch({
  channel: process.env.DM_CHANNEL || 'chrome',
  args: [`--host-resolver-rules=MAP dyngmsg.test 127.0.0.1`],
});
const gp = await gated.newPage();
const gateProblems = [];
gp.on('pageerror', (e) => gateProblems.push(e.message));
await gp.goto(base.replace('127.0.0.1', 'dyngmsg.test'));
await gp.waitForTimeout(600);
const gtext = await gp.locator('#app').innerText();
check(gtext.includes('This app has to be installed'), 'A: a browser tab gets the install guide');
check(gtext.includes('Do not set up your vault here'), 'A5: the warning strip is shown');
check(gtext.includes('Already installed?'), 'A4: always-visible "already installed" note');
check(!gtext.includes('Before you begin') && !gtext.includes('Write'),
  'A: no genesis and no vault outside the installed app');
check(gateProblems.length === 0, 'A: install gate renders without errors');
await gated.close();

server.close();

console.log(problems.length ? `\n${problems.length} PROBLEMS:\n- ` + problems.join('\n- ') : '\nall checks passed');
process.exit(problems.length ? 1 : 0);
