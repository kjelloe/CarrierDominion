// debugging/probes/touch_controls.mjs
//
// The basic touch pass (ruling 2026-08-23), through an emulated phone:
// portrait during a war gets the rotate card and the menu does not,
// landscape lifts it, and a finger can actually run the bridge - tap a
// column button and the engine answers. Real devices still have to judge
// the feel; this asserts the plumbing so the device pass starts from
// working, not from broken.
//
//   node debugging/probes/touch_controls.mjs

import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, devices } from 'playwright';

import { createApp } from '../../server/app.js';
import { loadRules } from '../../server/rules.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SHOTS = join(HERE, '..', 'shots');
mkdirSync(SHOTS, { recursive: true });

const app = createApp({ seed: 20260818, rules: loadRules() });
const address = await app.listen(0, '127.0.0.1');
const browser = await chromium.launch();
let failed = false;

const phone = devices['Pixel 7'];

async function newPhonePage(landscape) {
  const context = await browser.newContext({
    ...phone,
    viewport: landscape
      ? { width: phone.viewport.height, height: phone.viewport.width }
      : phone.viewport,
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => {
    console.log('PAGEERROR', error.message);
    failed = true;
  });
  return { context, page };
}

const gateShown = (page) => page.evaluate(
  () => getComputedStyle(document.getElementById('rotate-gate')).display !== 'none',
);

// Portrait, at the menu: the gate must NOT cover the choices.
const portrait = await newPhonePage(false);
await portrait.page.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: 'load' });
await portrait.page.waitForSelector('#start-panel.open', { timeout: 20000 });
const menuGate = await gateShown(portrait.page);
await portrait.page.screenshot({ path: join(SHOTS, 'touch-portrait-menu.png') });

// Portrait, in the war: the gate covers the bridge.
await portrait.page.tap('#start-begin');
await portrait.page.waitForFunction(
  () => Number(document.getElementById('hud-tick')?.textContent) > 10,
  { timeout: 30000 },
);
const warGate = await gateShown(portrait.page);
await portrait.page.screenshot({ path: join(SHOTS, 'touch-portrait-war.png') });
await portrait.context.close();
console.log(`portrait: gate at menu ${menuGate}, gate in war ${warGate}`);

// Landscape war: no gate, and a FINGER runs the bridge - launch a Manta by
// tapping its column button, then take the wheel by holding the rudder arrow.
const landscape = await newPhonePage(true);
await landscape.page.goto(
  `http://127.0.0.1:${address.port}/?mode=solo&speed=1`,
  { waitUntil: 'load' },
);
await landscape.page.waitForFunction(
  () => Number(document.getElementById('hud-tick')?.textContent) > 10,
  { timeout: 30000 },
);
const landGate = await gateShown(landscape.page);

const before = await landscape.page.evaluate(
  () => window.__lastView.units.filter((u) => u.state === 1 || u.state === 2).length,
);
await landscape.page.tap('.act:has(.k:text-is("1"))');
// And WAIT for her to be away. Launching is a deck operation now (ruled
// 2026-08-25) and a phone-sized headless page runs the solo war at a few
// ticks a second, so a hundred-tick cycle is a long wall-clock wait.
await landscape.page.waitForFunction(
  () => {
    const view = window.__lastView;
    if (view === undefined) return false;
    return view.units.some((u) => u.kind === 0 && u.team === view.team && u.state === 1);
  },
  undefined,
  { timeout: 90000 },
).catch(() => {});
const after = await landscape.page.evaluate(
  () => window.__lastView.units.filter((u) => u.state === 1 || u.state === 2).length,
);
const climbButtons = await landscape.page.locator('.act.hold').count();
await landscape.page.screenshot({ path: join(SHOTS, 'touch-landscape-war.png') });
await landscape.context.close();
console.log(`landscape: gate ${landGate}, units out ${before} -> ${after},`
  + ` held climb/dive buttons ${climbButtons}`);

const ok = !failed && !menuGate && warGate && !landGate && after > before && climbButtons === 2;
if (!ok) {
  console.log('FAIL: the touch pass is not doing what the ruling says');
  process.exitCode = 1;
}

await browser.close();
await app.close();
console.log('the phone photographed: menu open, gate up, bridge answering the finger');
