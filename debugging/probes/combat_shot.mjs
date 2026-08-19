// debugging/probes/combat_shot.mjs
//
// Does a missile actually get drawn? A real engagement is no use for
// answering that: the two carriers do not meet for ~140,000 ticks, and at the
// time compression needed to get there the browser renders one frame per
// thirty ticks, so a 64-tick round is easy to miss entirely.
//
// So this drives the render path directly. Shots are pushed into the live
// view object - the same object the renderer is handed every frame - and the
// scene graph is then read back. The engine's own firing is covered by
// test/engine_weapons.test.js; what is checked here is that a shot in a view
// becomes a mesh on screen, and comes off again when it is gone.
//
//   node debugging/probes/combat_shot.mjs

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

// Pause first. A running game replaces the view object every tick, so an
// injected shot is gone before the next frame draws it.
await page.keyboard.press(' ');
await page.waitForTimeout(400);

// A flight of missiles crossing the bow, half of them the enemy's.
const injected = await page.evaluate(() => {
  const view = window.__lastView;
  const own = view.carriers.find((c) => c.team === view.team && c.contact === 0);
  for (let i = 0; i < 6; i++) {
    view.shots.push({
      id: 900 + i,
      team: i % 2,
      x: own.x + (240 + i * 90) * 256,
      y: own.y + (i - 3) * 70 * 256,
      z: (40 + i * 25) * 256,
      heading: 16384,
    });
  }
  return view.shots.length;
});
await page.waitForTimeout(600);

const drawn = await page.evaluate(() => Object.keys(window.__scene3d.shots).length);
await page.screenshot({ path: join(SHOTS, 'combat-shots.png') });

// And they must come off again: the renderer keeps no shot the view dropped.
await page.evaluate(() => {
  window.__lastView.shots.length = 0;
});
await page.waitForTimeout(600);
const remaining = await page.evaluate(() => Object.keys(window.__scene3d.shots).length);

console.log(`injected ${injected}, drawn ${drawn}, remaining after removal ${remaining}`);
if (drawn !== injected || remaining !== 0) {
  console.log('FAIL: the shot layer does not follow the view');
  process.exitCode = 1;
}

await browser.close();
await app.close();
