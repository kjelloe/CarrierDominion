// debugging/probes/start_menu.mjs
//
// The start menu, through the DOM: a plain visit to / must offer the choices,
// and BEGIN must start the war those choices describe.
//
//   node debugging/probes/start_menu.mjs

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
page.on('pageerror', (error) => console.log('PAGEERROR', error.message));

// No query at all: this is a player arriving, not a probe.
await page.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: 'load' });
await page.waitForSelector('#start-panel.open', { timeout: 15000 });

const offered = await page.evaluate(() => ({
  rows: [...document.querySelectorAll('.start-row')].map((n) => n.textContent),
  title: document.getElementById('start-title').textContent,
}));
await page.screenshot({ path: join(SHOTS, 'start-menu.png') });

// Change two of them, BY NAME - one up the islands ladder and one more
// carrier at the table. Positional clicks (`rows.nth(1)`) were what this
// probe did, and the label had already drifted from the row: nth(2) was
// commented "enemy carrier" while it cycled the table size. A row inserted
// above silently repoints every index below it.
const islandRow = page.locator('.start-row', { hasText: 'islands' }).first();
const tableRow = page.locator('.start-row', { hasText: 'carriers at war' }).first();
await islandRow.click();
await tableRow.click();
// Read back what was chosen; the menu's default island count is a ruling
// that has already moved once.
const wantedIslands = Number((await islandRow.textContent()).replace(/[^0-9]/g, ''));
const wantedTable = Number((await tableRow.textContent()).replace(/[^0-9]/g, ''));
const chosen = await page.evaluate(
  () => [...document.querySelectorAll('.start-row')].map((n) => n.textContent),
);

await page.locator('#start-begin').click();
await page.waitForFunction(() => Number(document.getElementById('hud-tick')?.textContent) > 20, {
  timeout: 20000,
});

const war = await page.evaluate(() => ({
  islands: window.__lastView.islands.length,
  // Own hull plus whatever is on the scope - NOT the table size, which fog
  // keeps to itself while the war runs. Context, not an assertion.
  carriersInView: window.__lastView.carriers.length,
  menuGone: !document.getElementById('start-panel').classList.contains('open'),
  seed: document.getElementById('hud-seed').textContent,
}));

console.log(`menu offered: ${offered.title} / ${offered.rows.length} rows`);
console.log(`after two clicks: ${JSON.stringify(chosen.slice(1, 3))}`);
console.log(`war: ${war.islands} islands, ${war.carriersInView} carriers in view,`
  + ` menu gone ${war.menuGone}, seed ${war.seed}`);
// The menu must describe the war it starts. Islands are visible through the
// fog; the table size is not, so what is checked there is that the row
// cycled off its default at all - that both rows are live, addressable and
// answering, which is what the positional-click drift hid.
if (offered.rows.length < 6 || !war.menuGone
  || war.islands !== wantedIslands || wantedTable === 2) {
  console.log('FAIL: the menu did not describe the war it started');
  process.exitCode = 1;
}

await browser.close();
await app.close();
