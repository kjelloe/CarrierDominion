// debugging/probes/turret_shot.mjs
//
// What a defence island looks like from the sea. The guns are injected into the
// paused view rather than earned - building four turrets takes ~14,000 ticks of
// construction on top of a capture - and the renderer reads the view, so what
// is drawn is what a real defence island would draw.
//
//   node debugging/probes/turret_shot.mjs

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

await page.goto(`http://127.0.0.1:${address.port}/?mode=solo&graphics=medium&speed=8`, {
  waitUntil: 'load',
});
await page.waitForFunction(() => Number(document.getElementById('hud-tick')?.textContent) > 30);

// Close with the archipelago, then freeze and fortify the nearest island.
for (let i = 0; i < 10; i += 1) await page.keyboard.press('w');
await page.waitForTimeout(22000);
await page.keyboard.press(' ');
await page.waitForTimeout(400);

// What the renderer already holds. This probe used to assert the scene held
// EXACTLY the four guns it injects, which was true while a war began on a
// bare ocean; the home island (two guns a side) and the neutral silos put
// real batteries on the chart from tick zero, and fourteen drawn read as a
// broken turret layer. What it always meant to check is that the layer
// FOLLOWS the view, so it measures the four it adds.
const before = await page.evaluate(() => Object.keys(window.__scene3d.turrets).length);

const placed = await page.evaluate(() => {
  const view = window.__lastView;
  const own = view.carriers.find((c) => c.team === view.team && c.contact === 0);
  // The island the ship is actually looking at.
  let nearest;
  let best = Infinity;
  for (const island of view.islands) {
    const d = Math.hypot(island.x - own.x, island.y - own.y);
    if (d < best) { best = d; nearest = island; }
  }
  nearest.owner = 1;
  nearest.role = 2;
  nearest.turrets = 4;
  // Four guns on the ring, alternating laser and missile, as engine/turret.js
  // lays them out.
  const ring = Math.round(nearest.radius * 0.62);
  for (let i = 0; i < 4; i++) {
    const bearing = (i * Math.PI) / 2;
    view.turrets.push({
      id: 900 + i,
      island: nearest.id,
      team: 1,
      kind: i % 2,
      x: nearest.nodeX + Math.round(Math.cos(bearing) * ring),
      y: nearest.nodeY + Math.round(Math.sin(bearing) * ring),
      z: 0,
      hp: -1,
      maxHp: 260,
      overheated: 0,
    });
  }
  // Stand off the way a strike would: the chase camera follows the view's own
  // carrier, so moving it moves the eye.
  const bearing = Math.atan2(own.y - nearest.y, own.x - nearest.x);
  const standOff = nearest.radius + 900 * 256;
  own.x = Math.round(nearest.x + Math.cos(bearing) * standOff);
  own.y = Math.round(nearest.y + Math.sin(bearing) * standOff);
  own.heading = Math.round(((Math.atan2(nearest.y - own.y, nearest.x - own.x)) / (Math.PI * 2)) * 65536) & 65535;
  return { island: nearest.id, distanceMetres: Math.round(best / 256) };
});
await page.waitForTimeout(900);

const drawn = await page.evaluate(() => Object.keys(window.__scene3d.turrets).length);
await page.screenshot({ path: join(SHOTS, 'defence-island.png') });
await page.keyboard.press('c');
await page.waitForTimeout(700);
await page.screenshot({ path: join(SHOTS, 'defence-island-strategic.png') });

console.log(`island #${placed.island} at ${placed.distanceMetres} m,`
  + ` ${before} batteries already drawn, ${drawn} after four were added`);
if (drawn - before !== 4) {
  console.log('FAIL: the turret layer does not follow the view');
  process.exitCode = 1;
}

await browser.close();
await app.close();
