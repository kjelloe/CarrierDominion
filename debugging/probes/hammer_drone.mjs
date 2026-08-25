// debugging/probes/hammer_drone.mjs
//
// Proposal 5, through the glass: launch the Viewing Drone (3 or the EYE
// button), the DRONE tab appears with it, the view looks straight down with
// a crosshair cursor and the console readout, and a click IS the trigger -
// a Hammerhead at the point, the rail count down by one. The tab leaves
// when the eye does.
//
//   node debugging/probes/hammer_drone.mjs

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
let failed = false;
page.on('pageerror', (error) => {
  console.log('PAGEERROR', error.message);
  failed = true;
});

await page.goto(`http://127.0.0.1:${address.port}/?mode=solo&speed=1`, { waitUntil: 'load' });
await page.waitForFunction(
  () => Number(document.getElementById('hud-tick')?.textContent) > 10,
  { timeout: 30000 },
);

const tabHiddenBefore = await page.evaluate(
  () => [...document.querySelectorAll('.cam-tab')].find((t) => t.textContent === 'DRONE')
    ?.style.display === 'none',
);
await page.keyboard.press('3'); // the eye goes up
await page.waitForFunction(
  () => [...document.querySelectorAll('.cam-tab')].find((t) => t.textContent === 'DRONE')
    ?.style.display !== 'none',
  { timeout: 15000 },
);
await page.click('.cam-tab:has-text("DRONE")');
await page.waitForTimeout(600);
const droneView = await page.evaluate(() => ({
  view: window.__scene3d.droneView === true,
  info: document.getElementById('drone-info').classList.contains('on'),
  infoText: document.getElementById('drone-info').textContent,
  rounds: window.__lastView.carriers.find((c) => c.team === window.__lastView.team).hammerRounds,
}));
// The trigger: a click just off centre - under the eye, inside its picture.
await page.mouse.click(640, 300);
// The mark is close under the eye - the round flies scant ticks, so the
// in-flight check races it. Rounds-on-the-rail is the real proof.
await page.waitForTimeout(150);
const fired = await page.evaluate(() => ({
  rounds: window.__lastView.carriers.find((c) => c.team === window.__lastView.team).hammerRounds,
  shots: window.__lastView.shots.length,
}));
await page.screenshot({ path: join(SHOTS, 'hammer-drone.png') });
console.log(`tab hidden before ${tabHiddenBefore}; drone view ${droneView.view},`
  + ` console ${droneView.info} ("${droneView.infoText}"), rounds ${droneView.rounds}`);
console.log(`after the click: rounds ${fired.rounds}, shots in the air ${fired.shots}`);

const ok = !failed
  && tabHiddenBefore && droneView.view && droneView.info
  && droneView.rounds === 4 && fired.rounds === 3;
if (!ok) {
  console.log('FAIL: the drone console is not doing what proposal 5 says');
  process.exitCode = 1;
}

await browser.close();
await app.close();
console.log('the eye went up, the tab appeared, the click was the trigger');
