// debugging/probes/playtest_round3.mjs
//
// Round three at the controls: a click on open water lays a course for the
// SHIP (the original's map + PROG + A in one click), a hand on the rudder
// takes it back, ESCORT puts a Manta on station, and the quartermaster panel
// sets the production bias. Photographed with the course on the scope.
//
//   node debugging/probes/playtest_round3.mjs

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

let failed = false;
function check(ok, what) {
  if (ok) return;
  console.log(`FAIL: ${what}`);
  failed = true;
}
const ship = () => page.evaluate(
  () => window.__lastView.carriers.find((c) => c.contact === 0),
);

// A click on open water with nothing selected lays a course.
await page.mouse.click(640, 250);
await page.waitForTimeout(400);
check((await ship()).courseX >= 0, 'a click on open water laid no course');
await page.screenshot({
  path: join(SHOTS, 'course-scope.png'),
  clip: { x: 260, y: 524, width: 210, height: 196 },
});

// A hand on the rudder takes the wheel back.
await page.keyboard.down('a');
await page.waitForTimeout(300);
await page.keyboard.up('a');
await page.waitForTimeout(300);
check((await ship()).courseX === -1, 'the rudder and the autopilot shared the wheel');

// ESCORT from its button: launch, order, confirm.
// Launching is a deck OPERATION now (ruled 2026-08-25): about a hundred
// ticks from the order to the ramp. A fixed pause after pressing the button
// looks at the world while the craft is still on the lift.
//
// The wait is generous because in SOLO the engine is driven by the animation
// frame, and a headless browser on a loaded machine can run the war at a
// couple of ticks a second - a hundred ticks is five seconds at the table
// and the better part of a minute here.
async function awaitAway(target, kind) {
  await target.waitForFunction(
    (want) => {
      const view = window.__lastView;
      if (view === undefined) return false;
      return view.units.some((u) => u.kind === want && u.team === view.team && u.state === 1);
    },
    kind,
    { timeout: 90000 },
  );
}

await page.keyboard.press('1');
await awaitAway(page, 0);
await page.waitForTimeout(400);
await page.keyboard.press('u');
await page.waitForTimeout(400);
const escorting = await page.evaluate(
  // The MANTA's order. `units.find(u => u.state === 1)` used to pick the
  // supply lighter, which is at sea from tick one and reported ORDER_LOAD.
  () => window.__lastView.units.find((u) => u.kind === 0 && u.state === 1)?.order,
);
check(escorting === 6, `the escort order read ${escorting}, not 6`);

// The quartermaster: open, lean the plants on fuel, see the lamp move.
await page.keyboard.press('q');
await page.waitForTimeout(300);
check(await page.evaluate(
  () => document.getElementById('stores-panel').classList.contains('open'),
), 'Q did not open the quartermaster');
await page.locator('#stores-bias .bias-cell >> nth=2').dispatchEvent('pointerdown'); // fuel HIGH
await page.waitForTimeout(400);
check(await page.evaluate(
  () => window.__lastView.resources.biasFuel,
) === 2, 'the HIGH cell did not reach the plant');
await page.screenshot({ path: join(SHOTS, 'quartermaster.png') });

await browser.close();
await app.close();
if (failed) process.exitCode = 1;
else console.log('course, escort and quartermaster all answered');
