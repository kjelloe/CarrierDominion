// debugging/probes/damage_board.mjs
//
// Opens the damage control board on a ship that has been knocked about, checks
// the wireframe picks up a click, and screenshots it.
//
// The damage is injected into the live view rather than earned in battle, for
// the same reason the shot probe does it: waiting ~160,000 ticks for the two
// carriers to meet is no way to check that a panel draws.
//
//   node debugging/probes/damage_board.mjs

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

await page.goto(`http://127.0.0.1:${address.port}/?mode=solo&graphics=medium&speed=1`, {
  waitUntil: 'load',
});
await page.waitForFunction(() => Number(document.getElementById('hud-tick')?.textContent) > 20);

await page.keyboard.press('z');
await page.waitForTimeout(400);

// The list rows are the same control as the model: clicking one must move that
// section's priority on, and the ENGINE must be the one that says so - which is
// why this runs first, while snapshots are still arriving to confirm it.
const before = await page.evaluate(() => {
  const own = window.__lastView.carriers.find((c) => c.contact === 0);
  return own.sections.map((s) => s.priority).join(',');
});
await page.locator('.damage-row').first().click();
await page.waitForTimeout(700);
const after = await page.evaluate(() => {
  const own = window.__lastView.carriers.find((c) => c.contact === 0);
  return own.sections.map((s) => s.priority).join(',');
});

// Now freeze it: a running game replaces the view object every tick, so damage
// injected for the photograph would be gone before the shutter opened.
await page.keyboard.press(' ');
await page.waitForTimeout(400);
await page.evaluate(() => {
  const view = window.__lastView;
  const own = view.carriers.find((c) => c.team === view.team && c.contact === 0);
  const left = { 0: 0.82, 1: 0.55, 2: 0.9, 3: 0.2, 4: 1, 5: 0, 6: 0 };
  for (const section of own.sections) {
    section.hp = Math.round(section.maxHp * left[section.id]);
  }
  own.sections[3].priority = 2;
  own.sections[1].priority = 0;
  own.hull = Math.round(own.maxHull * 0.44);
  own.materials = 3200;
});
await page.waitForTimeout(900);
await page.screenshot({ path: join(SHOTS, 'damage-board.png') });

const panelOpen = await page.evaluate(
  () => document.getElementById('damage-panel').classList.contains('open'),
);
console.log(`panel open: ${panelOpen}, priorities ${before} -> ${after}`);
if (!panelOpen || before === after) {
  console.log('FAIL: the board did not open, or the click changed nothing');
  process.exitCode = 1;
}

await browser.close();
await app.close();
