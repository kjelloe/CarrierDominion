// debugging/probes/island_board.mjs
//
// The island board, through the DOM a player actually uses. The engine side is
// covered by test/engine_island.test.js; what is checked here is that holding
// an island puts a board on screen with real decisions on it, and that the
// board disappears again when the island is not yours.
//
// The view is doctored rather than earned: capturing an island takes ~37,000
// ticks, which is no way to check that a panel renders.
//
//   node debugging/probes/island_board.mjs

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

// Freeze, then hand the player an island with a full quarry behind it. The
// board reads the view, so the view is what has to say so.
await page.keyboard.press(' ');
await page.waitForTimeout(400);
const planned = await page.evaluate(() => {
  const view = window.__lastView;
  const island = view.islands[0];
  island.owner = view.team;
  island.role = -1;
  island.factories = 0;
  island.warehouses = 0;
  island.turrets = 0;
  island.building = -1;
  island.buildTicks = 0;
  island.stockMaterials = 40000;
  island.stockFuel = 1200;
  island.stockOrdnance = 300;
  view.resources.stockpileIsland = island.id;
  // Open the board the way a click does.
  window.__openIsland(island.id);
  return island.id;
});
await page.waitForTimeout(500);

const bare = await page.evaluate(() => ({
  open: document.getElementById('island-panel').classList.contains('open'),
  actions: document.querySelectorAll('.island-act:not(.off)').length,
  title: document.getElementById('island-title').textContent,
}));

// Choosing a role should replace the three role choices with the buildings that
// role allows.
await page.evaluate(() => {
  const island = window.__lastView.islands[0];
  island.role = 1; // factory
});
await page.waitForTimeout(500);
const planned2 = await page.evaluate(() => ({
  actions: [...document.querySelectorAll('.island-act')].map((n) => n.textContent),
}));

await page.screenshot({ path: join(SHOTS, 'island-board.png') });

// And an island that changes hands takes its board with it.
await page.evaluate(() => {
  window.__lastView.islands[0].owner = 1;
});
await page.waitForTimeout(500);
const lost = await page.evaluate(
  () => document.getElementById('island-panel').classList.contains('open'),
);

console.log(`island #${planned}: open ${bare.open}, ${bare.actions} choices, title "${bare.title}"`);
console.log(`as a factory island: ${JSON.stringify(planned2.actions)}`);
console.log(`board closes when the island is lost: ${!lost}`);
if (!bare.open || bare.actions < 3 || planned2.actions.length === 0 || lost) {
  console.log('FAIL: the island board does not follow the view');
  process.exitCode = 1;
}

await browser.close();
await app.close();
