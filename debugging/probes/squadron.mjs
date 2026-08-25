// debugging/probes/squadron.mjs
//
// The squadron console (ruled 2026-08-25), through the glass: the 1988 Manta
// and Walrus screens we did not have. Opens it, walks the three pages, fits
// a store and watches the weight move, types a pod, and runs a hull through
// the deck cycle from the hangar to away.
//
//   node debugging/probes/squadron.mjs

import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

import { createApp } from '../../server/app.js';
import { loadRules } from '../../server/rules.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SHOTS = join(HERE, '..', 'shots');
mkdirSync(SHOTS, { recursive: true });

const app = createApp({ seed: 20260818, rules: loadRules() });
const address = await app.listen(0, '127.0.0.1');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const problems = [];
page.on('pageerror', (error) => problems.push(`PAGEERROR ${error.message}`));
page.on('console', (message) => {
  if (message.type() === 'error') problems.push(`CONSOLE ${message.text()}`);
});

await page.goto(`http://127.0.0.1:${address.port}/?mode=solo`, { waitUntil: 'load' });
await page.waitForFunction(
  () => Number(document.getElementById('hud-tick')?.textContent) > 5,
  { timeout: 20000 },
);

// Open it. J, the same key the button dispatches.
await page.keyboard.press('j');
await page.waitForSelector('#squadron-panel.open', { timeout: 5000 });

const pages = await page.$$eval('#squadron-pages .sq-tab', (nodes) => nodes.map((n) => n.textContent));
const kinds = await page.$$eval('#squadron-kinds .sq-tab', (nodes) => nodes.map((n) => n.textContent));
const craft = await page.$$eval('#squadron-craft .sq-craft', (nodes) => nodes.map((n) => n.textContent));
console.log(`console: ${kinds.join('/')} | ${pages.join('/')} | hulls ${craft.join(',')}`);

// --- OUTFIT: land a store and watch the budget move ---
await page.locator('#squadron-pages .sq-tab', { hasText: 'OUTFIT' }).click();
await page.waitForTimeout(300);
const readWeight = () => page.evaluate(() => {
  const rows = [...document.querySelectorAll('#squadron-body .sq-row')];
  const carrying = rows.find((r) => /carrying/.test(r.textContent));
  return carrying === null || carrying === undefined ? -1
    : Number(carrying.textContent.replace(/[^0-9]/g, ''));
});
const before = await readWeight();
await page.locator('#squadron-body .sq-minus').first().click();
await page.waitForTimeout(400);
const after = await readWeight();
console.log(`fitting: carrying ${before} kg -> ${after} kg after landing one store`);
await page.screenshot({ path: join(SHOTS, 'squadron-outfit.png') });

// --- The Walrus, its capture devices and its typed pod ---
await page.locator('#squadron-kinds .sq-tab', { hasText: 'WALRUS' }).click();
await page.waitForTimeout(300);
const podBefore = await page.locator('#squadron-body .sq-act', { hasText: 'POD:' }).textContent();
await page.locator('#squadron-body .sq-act', { hasText: 'POD:' }).click();
await page.waitForTimeout(400);
const podAfter = await page.locator('#squadron-body .sq-act', { hasText: 'POD:' }).textContent();
console.log(`pod rack: ${podBefore.trim()} -> ${podAfter.trim()}`);
await page.screenshot({ path: join(SHOTS, 'squadron-walrus.png') });

// --- DECK: the cycle, from the hangar to away ---
await page.locator('#squadron-pages .sq-tab', { hasText: 'DECK' }).click();
await page.waitForTimeout(300);
const statusNow = () => page.evaluate(() => {
  const rows = [...document.querySelectorAll('#squadron-body .sq-row')];
  return rows.length === 0 ? '' : rows[0].textContent.replace('status', '').trim();
});
const atRest = await statusNow();
await page.locator('#squadron-body .sq-act', { hasText: 'LAUNCH' }).click();

const seen = [];
for (let i = 0; i < 60; i++) {
  await page.waitForTimeout(200);
  const now = await statusNow();
  if (seen[seen.length - 1] !== now) seen.push(now);
  if (now === 'away') break;
}
console.log(`deck cycle: ${atRest} -> ${seen.join(' -> ')}`);
await page.screenshot({ path: join(SHOTS, 'squadron-deck.png') });

// The console must have all three pages, both kinds, a numbered hull for
// every airframe, a fitting screen whose budget answers the buttons, a pod
// rack that types, and a deck cycle that visibly passes through the deck.
const ok = problems.length === 0
  && kinds.length === 2 && pages.length === 3 && craft.length >= 4
  && before > 0 && after < before
  && podBefore !== podAfter
  && seen.includes('on the flight deck') && seen[seen.length - 1] === 'away';
if (!ok) {
  for (const problem of problems) console.log(problem);
  console.log('FAIL: the squadron console is not the console the original had');
  process.exitCode = 1;
}

await browser.close();
await app.close();
console.log('squadron console walked and photographed');
