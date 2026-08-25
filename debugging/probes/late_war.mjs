// debugging/probes/late_war.mjs
//
// The start ladder, through the glass (ruled 2026-08-25): the menu offers
// one row - "the war starts" - with five shapes. The LATE one drops a human
// into a finished archipelago with a refitted ship and the front about
// 10 km off; NOSE TO NOSE is the same war begun in the enemy's face.
// Screenshots both, which is the whole point of the options.
//
//   node debugging/probes/late_war.mjs [late|nose]

import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

import { createApp } from '../../server/app.js';
import { loadRules } from '../../server/rules.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SHOTS = join(HERE, '..', 'shots');
mkdirSync(SHOTS, { recursive: true });

// The menu is the subject here, so the server runs lobbyless and the client
// picks the war itself.
const app = createApp({ seed: 20260818, rules: loadRules() });
const address = await app.listen(0, '127.0.0.1');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
let failed = false;
page.on('pageerror', (error) => {
  console.log('PAGEERROR', error.message);
  failed = true;
});

await page.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: 'load' });
await page.waitForSelector('#start-panel.open', { timeout: 20000 });

// Sixteen islands: enough sea for a late war to look like one, and the
// count the assertions below are written against. The menu now opens on 8
// (a four-island sea is a knife fight), so one click gets there.
const islandRow = page.locator('.start-row', { hasText: 'islands' }).first();
await islandRow.click();

// Walk the ladder: five shapes, each named.
const row = page.locator('.start-row', { hasText: 'the war starts' });
const rung = async () => (await row.textContent()).replace('the war starts', '').trim();
const shapes = [];
for (let i = 0; i < 5; i++) {
  shapes.push(await rung());
  await row.click();
}
console.log(`the ladder: ${shapes.join(' / ')}`);

// Land on the rung this run is for and sail.
const wanted = process.argv[2] === 'nose' ? 'nose' : 'late';
for (let i = 0; i < 5; i++) {
  if ((await rung()).startsWith(wanted)) break;
  await row.click();
}
await page.screenshot({ path: join(SHOTS, `${wanted}-war-menu.png`) });
await page.locator('#start-begin').click();
await page.waitForFunction(
  () => Number(document.getElementById('hud-tick')?.textContent) > 10,
  { timeout: 30000 },
);
await page.waitForTimeout(800);

const war = await page.evaluate(() => {
  const view = window.__lastView;
  const own = view.carriers.find((c) => c.team === view.team);
  return {
    islands: view.islands.length,
    teams: new Set(view.islands.map((i) => i.owner)).size,
    mine: view.islands.filter((i) => i.owner === view.team).length,
    neutral: view.islands.filter((i) => i.owner === -1).length,
    refits: [own.upSpeed, own.upPd, own.upRadar, own.upComm].join(''),
    hammer: own.hammerRounds,
    contacts: view.carriers.filter((c) => c.team !== view.team).length,
    // The point of the option is that the war is already in reach: the
    // front - somebody else's developed island - inside the 20 km leash a
    // Manta flies on, without a twenty-minute sail to find it.
    frontKm: Math.round(Math.min(...view.islands
      .filter((i) => i.owner >= 0 && i.owner !== view.team)
      .map((i) => Math.hypot(i.x - own.x, i.y - own.y) / 256 / 1000))),
    works: view.islands.filter((i) => i.owner === view.team
      && i.factories + i.warehouses + i.turrets > 0).length,
  };
});
await page.screenshot({ path: join(SHOTS, `${wanted}-war-opening.png`) });
console.log(`${wanted} war: ${war.mine} of ${war.islands} islands held`
  + ` (${war.works} developed), ${war.neutral} neutral, refits ${war.refits},`
  + ` hammer ${war.hammer}, enemy carriers on the scope: ${war.contacts},`
  + ` nearest enemy island ${war.frontKm} km`);

// The whole archipelago, split evenly, every rock of mine built out, the
// ship as a long war would have left it, and the front within strike range.
// Nose to nose promises more than reach: the enemy SHIP on the scope.
const ok = !failed
  && shapes.length === 5
  && war.islands === 16 && war.mine === 8 && war.neutral === 0
  && war.works === war.mine
  && war.refits === '1111' && war.hammer > 0 && war.frontKm <= 20
  && (wanted !== 'nose' || war.contacts >= 1);
if (!ok) {
  console.log('FAIL: the late war is not the endgame it promises');
  process.exitCode = 1;
}

await browser.close();
await app.close();
console.log(`the ladder walked, and the ${wanted} war photographed`);
