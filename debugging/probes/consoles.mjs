// debugging/probes/consoles.mjs
//
// The last three 1988 consoles (docs/10 gap 5, built 2026-08-26), through
// the glass:
//
//   GUNNERY    the turret orientation dial, the TEMP gauge, and the two
//              lines of plain words the original put beside them
//   RESOURCES  the archipelago counted by role, the depot, and what your
//              own islands are holding
//   SCREEN     the defence drones: where they ride, and the picture of it
//
//   node debugging/probes/consoles.mjs

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
const problems = [];
page.on('pageerror', (error) => problems.push(`PAGEERROR ${error.message}`));
page.on('console', (message) => {
  if (message.type() === 'error') problems.push(`CONSOLE ${message.text()}`);
});

await page.goto(`http://127.0.0.1:${address.port}/?mode=solo`, { waitUntil: 'load' });
await page.waitForFunction(
  () => Number(document.getElementById('hud-tick')?.textContent) > 10,
  { timeout: 20000 },
);

// --- GUNNERY: the right-hand box becomes the gun's at the gun -------------
await page.click('.cam-tab:has-text("WEAPON")');
await page.waitForTimeout(700);
const atGun = await page.evaluate(() => window.__panelMode);
await page.screenshot({ path: join(SHOTS, 'console-gunnery.png') });
// The panel is a canvas, so what is checkable from here is that the WEAPON
// console is the one being drawn and that the ship reports a heat ceiling
// for the gauge to read against.
const heat = await page.evaluate(() => {
  const view = window.__lastView;
  const own = view.carriers.find((c) => c.team === view.team && c.contact === 0);
  return { max: own.heatMax, now: own.heat, overheated: own.overheated };
});
console.log(`gunnery: panel ${atGun}, heat ${heat.now}/${heat.max}, overheated ${heat.overheated}`);

// --- RESOURCES: the chart's second reading --------------------------------
await page.click('.cam-tab:has-text("CHART")');
await page.waitForTimeout(400);
await page.click('#chart-resources');
await page.waitForTimeout(600);
const resLit = await page.evaluate(
  () => document.getElementById('chart-resources').classList.contains('on'),
);
await page.screenshot({ path: join(SHOTS, 'console-resources.png') });
console.log(`resources: lit ${resLit}`);

// --- SCREEN: the drones, and moving them ----------------------------------
await page.click('.cam-tab:has-text("HELM")');
await page.keyboard.press('j');
await page.waitForSelector('#squadron-panel.open', { timeout: 5000 });
await page.locator('#squadron-pages .sq-tab', { hasText: 'SCREEN' }).click();
await page.waitForTimeout(300);
// The craft rows belong to the craft pages, not to the ship's screen.
const craftHidden = await page.evaluate(
  () => document.getElementById('squadron-craft').style.display === 'none',
);
await page.locator('#squadron-body .sq-act', { hasText: 'DEPLOY' }).click();
await page.waitForTimeout(600);
await page.locator('#squadron-body .sq-act', { hasText: 'FLANKS' }).click();
await page.waitForTimeout(600);
const screen = await page.evaluate(() => {
  const view = window.__lastView;
  const own = view.carriers.find((c) => c.team === view.team && c.contact === 0);
  const decoys = view.units.filter((u) => u.kind === 4 && u.team === view.team);
  return {
    pattern: own.decoyPattern,
    spread: own.decoySpread,
    out: decoys.filter((d) => d.state === 1).length,
    lit: [...document.querySelectorAll('#squadron-body .sq-act')]
      .filter((n) => n.classList.contains('on')).map((n) => n.textContent).join(','),
  };
});
await page.screenshot({ path: join(SHOTS, 'console-screen.png') });
console.log(`screen: ${screen.out} drones out, pattern ${screen.pattern},`
  + ` spread ${screen.spread}, lit "${screen.lit}", craft rows hidden ${craftHidden}`);

const ok = problems.length === 0
  && atGun === 'ship' && heat.max > 0
  && resLit
  && screen.out === 4 && screen.pattern === 3 && craftHidden
  && screen.lit.includes('FLANKS');
if (!ok) {
  for (const problem of problems) console.log(problem);
  console.log('FAIL: the last three consoles are not what the original had');
  process.exitCode = 1;
}

await browser.close();
await app.close();
console.log('gunnery, resources and the screen photographed');
