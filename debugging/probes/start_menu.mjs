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

// Change two of them: islands 4 -> 8, and the enemy off. Rows are seed first,
// then the options in order.
const rows = page.locator('.start-row');
await rows.nth(1).click(); // islands
await rows.nth(2).click(); // enemy carrier
const chosen = await page.evaluate(
  () => [...document.querySelectorAll('.start-row')].map((n) => n.textContent),
);

await page.locator('#start-begin').click();
await page.waitForFunction(() => Number(document.getElementById('hud-tick')?.textContent) > 20, {
  timeout: 20000,
});

const war = await page.evaluate(() => ({
  islands: window.__lastView.islands.length,
  enemyCarriers: window.__lastView.carriers.filter((c) => c.team !== window.__lastView.team).length,
  menuGone: !document.getElementById('start-panel').classList.contains('open'),
  seed: document.getElementById('hud-seed').textContent,
}));

console.log(`menu offered: ${offered.title} / ${offered.rows.length} rows`);
console.log(`after two clicks: ${JSON.stringify(chosen.slice(1, 3))}`);
console.log(`war: ${war.islands} islands, menu gone ${war.menuGone}, seed ${war.seed}`);
if (offered.rows.length < 6 || !war.menuGone || war.islands !== 8) {
  console.log('FAIL: the menu did not describe the war it started');
  process.exitCode = 1;
}

await browser.close();
await app.close();
