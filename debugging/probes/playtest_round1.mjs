// debugging/probes/playtest_round1.mjs
//
// The first playtest's three asks, photographed: the key list lives behind the
// ? button (hidden until clicked), C's second stop is the gunsight - the
// camera ON the mount, crosshair centred - and a flown Manta answers the
// arrow keys with altitude.
//
//   node debugging/probes/playtest_round1.mjs

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

// 1. The legend starts hidden and the ? button toggles it.
const hiddenAtBoot = await page.evaluate(
  () => document.getElementById('help').classList.contains('hidden'),
);
if (!hiddenAtBoot) {
  console.log('FAIL: the key list was on screen before anybody asked');
  process.exitCode = 1;
}
await page.click('#help-button');
const shownOnClick = await page.evaluate(
  () => !document.getElementById('help').classList.contains('hidden'),
);
if (!shownOnClick) {
  console.log('FAIL: the ? button did not open the key list');
  process.exitCode = 1;
}
await page.screenshot({ path: join(SHOTS, 'help-open.png') });
await page.click('#help-button');

// 2. C's second stop: the gunsight, with the crosshair on.
await page.keyboard.press('c');
await page.waitForTimeout(600);
const sighted = await page.evaluate(() => ({
  gunsight: window.__scene3d.gunsight === true,
  crosshair: document.getElementById('sight').classList.contains('on'),
}));
if (!sighted.gunsight || !sighted.crosshair) {
  console.log(`FAIL: gunsight=${sighted.gunsight} crosshair=${sighted.crosshair}`);
  process.exitCode = 1;
}
await page.screenshot({ path: join(SHOTS, 'gunsight-carrier.png') });
await page.keyboard.press('c');
await page.keyboard.press('c'); // back to chase

// 3. A flown Manta climbs on ArrowUp and dives on ArrowDown.
await page.keyboard.press('1');
// Away first. Launching is a deck operation now (ruled 2026-08-25), and T
// on a timer took the controls of a Manta still on the lift - so the stick
// did nothing and the probe blamed the vertical axis.
await page.waitForFunction(
  () => {
    const view = window.__lastView;
    if (view === undefined) return false;
    return view.units.some((u) => u.kind === 0 && u.team === view.team && u.state === 1);
  },
  undefined,
  { timeout: 90000 },
);
await page.waitForTimeout(400);
// Down to x1 for the stick. At x8 the 4-second holds are ~640 ticks, which
// flew her into island 1's battery: the neutral silos (the island teeth, added
// after this probe) put two rounds into her mid-dive and the altitude read hit
// a hull that was no longer flying. At x1 the whole test is ~180 ticks, long
// before she reaches it - and 80 ticks of climb is still metres of altitude.
for (let i = 0; i < 3; i++) {
  await page.keyboard.press(',');
  await page.waitForTimeout(200);
}
const rate = await page.evaluate(async () => {
  const from = window.__lastView.tick;
  await new Promise((resolve) => setTimeout(resolve, 1000));
  return window.__lastView.tick - from;
});
if (rate > 30) {
  console.log(`FAIL: still running at ${rate} ticks a second; the stick test needs x1`);
  process.exitCode = 1;
}
await page.keyboard.press('t');
await page.waitForTimeout(500);
const before = await page.evaluate(
  () => window.__lastView.units.find((u) => u.kind === 0 && u.state === 1).z,
);
await page.keyboard.down('ArrowUp');
await page.waitForTimeout(4000);
await page.keyboard.up('ArrowUp');
const climbed = await page.evaluate(() => window.__lastView.units.find((u) => u.kind === 0 && u.state === 1).z);
if (climbed <= before) {
  console.log(`FAIL: ArrowUp did not climb (${before} -> ${climbed})`);
  process.exitCode = 1;
}
await page.keyboard.down('ArrowDown');
await page.waitForTimeout(4000);
await page.keyboard.up('ArrowDown');
// -1 if she was lost on the way down: say so, rather than throwing on .z.
const dived = await page.evaluate(
  () => window.__lastView.units.find((u) => u.kind === 0 && u.state === 1)?.z ?? -1,
);
if (dived === -1) {
  console.log('FAIL: the Manta was lost during the test, so the stick was never read');
  process.exitCode = 1;
}
if (dived >= climbed) {
  console.log(`FAIL: ArrowDown did not dive (${climbed} -> ${dived})`);
  process.exitCode = 1;
}
console.log(`altitude answered the stick: ${before} -> ${climbed} -> ${dived}`);

await browser.close();
await app.close();
console.log('help button, gunsight and the vertical axis photographed');
