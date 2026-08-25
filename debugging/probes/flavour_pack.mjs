// debugging/probes/flavour_pack.mjs
//
// The small trio from the manual coverage review (items 4, 9, 10), probed:
// the astern gear takes the ship backwards from the keyboard and the scale,
// the signals log keeps readable history, the location line names the water,
// rear view flips, digits name hulls directly, and two Escapes strike the
// colours - which ends a duel, so that one runs last.
//
//   node debugging/probes/flavour_pack.mjs

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

// Astern: S below zero, capped at -25, and the ship actually makes sternway.
for (let i = 0; i < 5; i++) await page.keyboard.press('s');
await page.waitForTimeout(1200);
const astern = await page.evaluate(() => {
  const own = window.__lastView.carriers.find((c) => c.team === window.__lastView.team);
  return { throttle: own.throttle, speed: own.speed };
});
console.log(`astern: throttle ${astern.throttle}, speed ${astern.speed}`);
await page.keyboard.press('x'); // all stop

// Signals: launch a Manta, open the log, expect the launch reported.
await page.keyboard.press('1');
// Wait for her to be AWAY. Launching is a deck operation now (ruled
// 2026-08-25) and the signals log announces the launch when she leaves the
// ramp, not when the order is given - which is the honest moment, and which
// a fixed half-second pause arrives well before.
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
await page.keyboard.press('i');
const signals = await page.evaluate(() => ({
  open: document.getElementById('log-panel').classList.contains('open'),
  lines: document.getElementById('log-body').children.length,
  first: document.getElementById('log-body').children[0]?.textContent ?? '',
}));
await page.screenshot({ path: join(SHOTS, 'flavour-signals.png') });
await page.keyboard.press('i');
console.log(`signals: open ${signals.open}, ${signals.lines} line(s), newest "${signals.first}"`);

// Location line: X/Y, a bearing, and (this seed spawns off a corner) maybe a name.
const location = await page.evaluate(() => document.getElementById('location').textContent);
console.log(`location: "${location}"`);

// Rear view and direct select.
await page.keyboard.press('o');
const rear = await page.evaluate(() => window.__scene3d.rearView === true);
await page.keyboard.press('o');
await page.keyboard.press('5');
const selected = await page.evaluate(() => ({
  id: window.__scene3d.selectedUnitId,
  marker: window.__scene3d.marker !== null && window.__scene3d.marker.visible,
}));
console.log(`rear view ${rear}; direct select id ${selected.id}, marker ${selected.marker}`);

// The colours: one Escape arms, a second inside three seconds strikes them.
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
await page.keyboard.press('Escape');
await page.waitForFunction(
  () => document.getElementById('warover-panel').classList.contains('open'),
  { timeout: 20000 },
);
await page.screenshot({ path: join(SHOTS, 'flavour-surrendered.png') });
console.log('colours struck: the ending screen stands');

const ok = !failed
  && astern.throttle === -25 && astern.speed < 0
  && signals.open && signals.lines >= 1
  && /X \d+.*Y \d+.*°/.test(location)
  && rear && selected.id >= 0 && selected.marker;
if (!ok) {
  console.log('FAIL: the flavour pack is not doing what the manual says');
  process.exitCode = 1;
}

await browser.close();
await app.close();
console.log('items 4, 9 and 10 probed');
