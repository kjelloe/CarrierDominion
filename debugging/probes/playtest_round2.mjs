// debugging/probes/playtest_round2.mjs
//
// Round two's three asks, exercised for real: the DBG toggle (with the status
// toast that keeps feedback alive while the strip is hidden), the clickable
// helm (throttle scale and held rudder arrows) and icon columns, and the
// recognisable models - photographed from the deck and from the wing.
//
//   node debugging/probes/playtest_round2.mjs

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

// 1. The diagnostic strip: hidden at boot, DBG toggles it, and while it is
// hidden a refused action still surfaces as a toast.
check(await page.evaluate(
  () => document.getElementById('hud').classList.contains('hidden'),
), 'the debug strip was on screen before anybody asked');
await page.keyboard.press('p'); // no Walrus selected: refused, must toast
await page.waitForTimeout(300);
check(await page.evaluate(
  () => document.getElementById('toast').classList.contains('on'),
), 'a refused action vanished into the hidden strip');
await page.click('#debug-button');
check(await page.evaluate(
  () => !document.getElementById('hud').classList.contains('hidden'),
), 'DBG did not open the strip');
await page.click('#debug-button');

// 2. The clickable helm. The throttle bar is the 1988 speed scale: a click at
// four fifths sets 80.
const panelBox = await page.evaluate(() => {
  const rect = document.getElementById('panel').getBoundingClientRect();
  return { left: rect.left, top: rect.top };
});
const helm = await page.evaluate(async () => {
  const m = await import('/client/render/instruments.js');
  return m.HELM;
});
await page.mouse.click(
  panelBox.left + helm.gaugeX + helm.gaugeW * 0.8,
  panelBox.top + helm.throttleY + helm.throttleH / 2,
);
await page.waitForTimeout(400);
const throttle = await page.evaluate(
  () => window.__lastView.carriers.find((c) => c.contact === 0).throttle,
);
check(throttle === 80, `a click at four fifths of the scale set ${throttle}, not 80`);

// The rudder arrows act while held and centre up on release.
const portX = panelBox.left + helm.gaugeX + helm.rudderW / 2;
const portY = panelBox.top + helm.rudderY + helm.rudderH / 2;
await page.mouse.move(portX, portY);
await page.mouse.down();
await page.waitForTimeout(400);
const heldRudder = await page.evaluate(
  () => window.__lastView.carriers.find((c) => c.contact === 0).rudder,
);
await page.mouse.up();
await page.waitForTimeout(400);
const releasedRudder = await page.evaluate(
  () => window.__lastView.carriers.find((c) => c.contact === 0).rudder,
);
check(heldRudder === 1, `holding the port arrow read rudder ${heldRudder}`);
check(releasedRudder === 0, 'releasing the arrow did not centre up');

// 3. The icon columns: the MANTA button launches one, same as the key.
await page.locator('#actions-right .act').first().dispatchEvent('pointerdown');
await page.waitForTimeout(600);
const airborne = await page.evaluate(
  () => window.__lastView.units.filter((u) => u.state === 1).length,
);
check(airborne >= 1, 'the MANTA button launched nothing');

// 4. The models, photographed. The deck view first, then from the wing.
await page.keyboard.press('2'); // a Walrus in the water beside the ship
await page.waitForTimeout(1200);
await page.keyboard.press(' ');
await page.waitForTimeout(700);
await page.screenshot({ path: join(SHOTS, 'models-fleet.png') });
await page.keyboard.press(' ');
await page.keyboard.press('t'); // ride the selected unit: the chase camera frames it
await page.waitForTimeout(900);
await page.keyboard.press(' ');
await page.waitForTimeout(700);
await page.screenshot({ path: join(SHOTS, 'models-unit.png') });

await browser.close();
await app.close();
if (failed) process.exitCode = 1;
else console.log('DBG toggle, clickable helm, icon columns and models all answered');
