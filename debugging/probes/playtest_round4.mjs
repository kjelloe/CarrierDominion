// debugging/probes/playtest_round4.mjs
//
// Round four's rulings, asserted in a real browser: the camera tabs say
// where you are and click to move you; WEAPON view puts the selector at the
// bottom centre (which is also where the carrier's gun stops being a
// secret); the legend opens screen-centre; buttons sleep until their moment
// (PILOT wakes when NEXT names a hull, and the named hull wears a marker);
// and at the controls the panel is the CRAFT's, not the ship's.
//
//   node debugging/probes/playtest_round4.mjs

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

const activeTab = () => page.evaluate(
  () => [...document.querySelectorAll('.cam-tab')].find(
    (tab) => tab.classList.contains('on'),
  )?.textContent,
);

// The tabs: HELM at the start, C cycles to WEAPON, a click goes straight to
// BIRDSEYE, and WEAPON mode moves the selector to the bottom centre.
const atStart = await activeTab();
await page.keyboard.press('c');
const afterC = await activeTab();
const weaponBar = await page.evaluate(() => {
  const group = document.getElementById('weapon-group');
  const box = group.getBoundingClientRect();
  return {
    mode: document.body.classList.contains('weapon-mode'),
    centred: Math.abs(box.x + box.width / 2 - window.innerWidth / 2) < 40,
    low: box.y > window.innerHeight / 2,
    chips: group.children.length,
    firstChip: group.children[0]?.textContent ?? '',
  };
});
await page.screenshot({ path: join(SHOTS, 'round4-weapon-view.png') });
await page.click('.cam-tab:has-text("BIRDSEYE")');
const afterClick = await activeTab();
await page.keyboard.press('c'); // birdseye -> helm
console.log(`tabs: ${atStart} -> C -> ${afterC} -> click -> ${afterClick}`);
console.log(`weapon view: mode ${weaponBar.mode}, centred ${weaponBar.centred},`
  + ` low ${weaponBar.low}, ${weaponBar.chips} chip(s), first "${weaponBar.firstChip}"`);

// The legend: centred on the screen, not squinting in a corner.
await page.click('#help-button');
const help = await page.evaluate(() => {
  const box = document.getElementById('help').getBoundingClientRect();
  return {
    centredX: Math.abs(box.x + box.width / 2 - window.innerWidth / 2) < 40,
    centredY: Math.abs(box.y + box.height / 2 - window.innerHeight / 2) < 80,
  };
});
await page.screenshot({ path: join(SHOTS, 'round4-help.png') });
await page.click('#help-button');
console.log(`legend centred: ${help.centredX} / ${help.centredY}`);

// Context: before any launch, PILOT sleeps; after launch + NEXT it wakes,
// the marker rides the named hull, and T swaps the panel to the craft's.
const isOff = (key) => page.evaluate(
  (k) => [...document.querySelectorAll('.act')].find(
    (b) => b.querySelector('.k')?.textContent === k,
  )?.classList.contains('off'),
  key,
);
const pilotAsleep = await isOff('T');
const podAsleep = await isOff('P');
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

await page.keyboard.press('1'); // launch a Manta
await awaitAway(page, 0);
await page.waitForTimeout(600);
await page.keyboard.press('n'); // name it
await page.waitForTimeout(300);
const afterSelect = await page.evaluate(() => ({
  pilotAwake: ![...document.querySelectorAll('.act')].find(
    (b) => b.querySelector('.k')?.textContent === 'T',
  ).classList.contains('off'),
  marker: window.__scene3d.marker !== null && window.__scene3d.marker.visible,
}));
await page.keyboard.press('t'); // take the controls
await page.waitForTimeout(400);
const flying = await page.evaluate(() => ({
  panel: window.__panelMode,
  climbAwake: ![...document.querySelectorAll('.act.hold')][0].classList.contains('off'),
  markerHidden: window.__scene3d.marker === null || !window.__scene3d.marker.visible,
}));
await page.screenshot({ path: join(SHOTS, 'round4-flight-panel.png') });
await page.keyboard.press('t'); // hand back
await page.waitForTimeout(300);
const back = await page.evaluate(() => window.__panelMode);
console.log(`context: PILOT asleep ${pilotAsleep}, POD asleep ${podAsleep},`
  + ` after NEXT awake ${afterSelect.pilotAwake} marker ${afterSelect.marker}`);
console.log(`piloting: panel ${flying.panel}, climb awake ${flying.climbAwake},`
  + ` marker hidden ${flying.markerHidden}; handed back -> ${back}`);

const ok = !failed
  && atStart === 'HELM' && afterC === 'WEAPON' && afterClick === 'BIRDSEYE'
  && weaponBar.mode && weaponBar.centred && weaponBar.low && weaponBar.chips >= 1
  && help.centredX && help.centredY
  && pilotAsleep === true && podAsleep === true
  && afterSelect.pilotAwake && afterSelect.marker
  && flying.panel === 'flight' && flying.climbAwake && flying.markerHidden
  && back === 'ship';
if (!ok) {
  console.log('FAIL: round four is not doing what the rulings say');
  process.exitCode = 1;
}

await browser.close();
await app.close();
console.log('round four probed: tabs, weapon console, legend, sleeping buttons, flight panel');
