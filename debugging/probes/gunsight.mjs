// debugging/probes/gunsight.mjs
//
// Takes the controls of a Manta and checks the gunsight appears, that firing
// down the boresight actually produces a round, and photographs it.
//
//   node debugging/probes/gunsight.mjs

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

await page.goto(`http://127.0.0.1:${address.port}/?mode=solo&graphics=medium&speed=4`, {
  waitUntil: 'load',
});
await page.waitForFunction(() => Number(document.getElementById('hud-tick')?.textContent) > 20);

// Launch a Manta, wait for her to be AWAY, select her, take the controls.
// Launching is a deck operation now (ruled 2026-08-25); pressing N and T on
// a timer used to take the controls of a ship that had nothing to fly, and
// read as a broken gunsight.
await page.keyboard.press('1');
await page.waitForFunction(
  () => {
    const view = window.__lastView;
    if (view === undefined) return false;
    return view.units.some((u) => u.kind === 0 && u.team === view.team && u.state === 1);
  },
  undefined,
  { timeout: 90000 },
);
await page.waitForTimeout(300);
await page.keyboard.press('n');
await page.keyboard.press('t');
await page.waitForTimeout(900);

// The weapon selector, wherever it lives. It was a HUD row until the
// round-four rulings moved it to the weapon group above the panel, at which
// point this probe read null and died on the spot - a probe reporting a
// broken gunsight when the gunsight was fine.
const readWeapons = (target) => target.evaluate(() => {
  const chips = [...document.querySelectorAll('#weapon-group .wep')];
  const armed = chips.find((chip) => chip.classList.contains('on')) ?? chips[0];
  return {
    all: chips.map((chip) => chip.textContent.replace(/\s+/g, ' ').trim()).join(' | '),
    armed: armed === undefined ? '' : armed.textContent.replace(/\s+/g, ' ').trim(),
  };
});

const flying = await page.evaluate(() => ({
  sight: document.getElementById('sight').classList.contains('on'),
  unit: document.getElementById('hud-unit').textContent,
}));
const weaponsBefore = await readWeapons(page);

// Fire down the nose. A gun always fires - aiming is the player's problem -
// so the round count must drop whether or not anything was in front of it.
const before = await page.evaluate(() => {
  const view = window.__lastView;
  const unit = view.units.find((u) => u.control !== -1);
  if (unit === undefined) return -1;
  const entry = unit.arms.find((a) => a.w === unit.weapon);
  return entry === undefined ? -1 : entry.n;
});
await page.keyboard.press('f');
await page.waitForTimeout(600);
const after = await page.evaluate(() => {
  const view = window.__lastView;
  const unit = view.units.find((u) => u.control !== -1);
  if (unit === undefined) return -1;
  const entry = unit.arms.find((a) => a.w === unit.weapon);
  return entry === undefined ? -1 : entry.n;
});

// And the weapon-select key walks the 1988 loadout.
await page.keyboard.press('v');
await page.waitForTimeout(400);
const weaponsAfter = await readWeapons(page);

await page.screenshot({ path: join(SHOTS, 'gunsight.png') });
console.log(`sight ${flying.sight}, rounds ${before} -> ${after}`);
console.log(`carrying: ${weaponsBefore.all}`);
console.log(`armed: "${weaponsBefore.armed}"  -[V]->  "${weaponsAfter.armed}"`);
if (!flying.sight || after >= before) {
  console.log('FAIL: no gunsight while piloting, or the trigger did nothing');
  process.exitCode = 1;
} else if (weaponsBefore.all === '') {
  console.log('FAIL: a piloted Manta showed no weapons to select');
  process.exitCode = 1;
} else if (weaponsAfter.armed === weaponsBefore.armed) {
  console.log('FAIL: V did not walk the loadout');
  process.exitCode = 1;
}

await browser.close();
await app.close();
