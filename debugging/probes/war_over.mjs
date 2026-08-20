// debugging/probes/war_over.mjs
//
// Two states a live war takes hours to reach, photographed in seconds: the
// war-over screen, and a scope with remembered ghosts on it. The probe pauses
// the solo war and swaps in a doctored copy of the last real view through the
// __debugView hook - the renderer cannot tell the difference, which is the
// point: what is photographed is exactly what a player would see.
//
//   node debugging/probes/war_over.mjs

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

await page.goto(`http://127.0.0.1:${address.port}/?mode=solo&graphics=medium`, {
  waitUntil: 'load',
});
await page.waitForFunction(() => Number(document.getElementById('hud-tick')?.textContent) > 30);

// Freeze the war so the doctored view is not overwritten by the next snapshot.
await page.keyboard.press(' ');
await page.waitForTimeout(300);

// Ghosts on the scope: three remembered marks near the ship.
await page.evaluate(() => {
  const view = window.__lastView;
  const own = view.carriers.find((c) => c.team === view.team && c.contact === 0);
  view.contacts = [
    { kind: 1, id: 9, unitKind: -1, x: own.x + 900 * 256, y: own.y + 500 * 256, heading: 0, tick: 1 },
    { kind: 0, id: 8, unitKind: 0, x: own.x - 700 * 256, y: own.y + 300 * 256, heading: 0, tick: 1 },
    { kind: 0, id: 7, unitKind: 1, x: own.x + 300 * 256, y: own.y - 800 * 256, heading: 0, tick: 1 },
  ];
  window.__debugView(view);
});
await page.waitForTimeout(700);
await page.screenshot({
  path: join(SHOTS, 'scope-ghosts.png'),
  clip: { x: 260, y: 524, width: 210, height: 196 },
});

// The war ends, won by sinking, and the screen says so.
await page.evaluate(() => {
  const view = window.__lastView;
  view.phase = 1;
  view.winner = view.team;
  view.winReason = 2;
  view.scores = [{ id: 0, score: 1240 }, { id: 1, score: 830 }];
  window.__debugView(view);
});
await page.waitForTimeout(500);
await page.screenshot({ path: join(SHOTS, 'war-over.png') });

const title = await page.textContent('#warover-title');
const body = await page.textContent('#warover-body');
console.log(`war-over screen reads "${title}" / "${body}"`);
if (!/WON|VANT/.test(String(title))) {
  console.log('FAIL: the war was won and the screen did not say so');
  process.exitCode = 1;
}
if (!/1240/.test(String(body))) {
  console.log('FAIL: the scoreboard is missing');
  process.exitCode = 1;
}

// KEEP WATCHING dismisses it.
await page.click('#warover-watch');
const open = await page.evaluate(
  () => document.getElementById('warover-panel').classList.contains('open'),
);
if (open) {
  console.log('FAIL: KEEP WATCHING did not dismiss the screen');
  process.exitCode = 1;
}

await browser.close();
await app.close();
console.log('war-over screen and scope ghosts photographed');
