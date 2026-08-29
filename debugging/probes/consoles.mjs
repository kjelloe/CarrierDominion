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

import { mkdirSync, readFileSync } from 'node:fs';
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


// --- the top bar says what the game has (playtest 2026-08-28) ---------------
//
// Two bars along the top: the console's screens on the left where the eye
// starts, the camera's ways-of-seeing beside them. The console strip used to
// live INSIDE the console, so the six screens behind it were invisible until
// you already knew a key that opened one.
//
// CHART belongs to the camera bar and nowhere else. It was on both for an
// afternoon, and the console's copy was the worse of the two: it opened the
// same map but left the camera bar lit on HELM.
const bar = await page.evaluate(() => {
  const text = (sel) => [...document.querySelectorAll(sel)]
    .map((n) => n.textContent.replace(/\s+/g, ' ').trim());
  const box = (id) => {
    const e = document.getElementById(id);
    if (e === null) return null;
    const r = e.getBoundingClientRect();
    return { left: Math.round(r.left), right: Math.round(r.right) };
  };
  return { tabs: text('.console-tab'), cameras: text('.cam-tab'),
    consoleBox: box('console-tabs'), cameraBox: box('camera-tabs') };
});
console.log(`top bar: [${bar.tabs.join('] [')}] | [${bar.cameras.join('] [')}]`);
const chartTabs = bar.tabs.filter((t) => /CHART|KART/.test(t));
if (chartTabs.length > 0) {
  console.log('FAIL: CHART is on the console bar as well as the camera bar');
  process.exitCode = 1;
}
if (bar.tabs.length < 5) {
  console.log(`FAIL: the console bar has only ${bar.tabs.length} screens on it`);
  process.exitCode = 1;
}
// Side by side, not on top of each other. The first attempt pinned the camera
// bar at a fixed left margin and the two overlapped by 75 pixels.
if (bar.consoleBox.right > bar.cameraBox.left) {
  console.log(`FAIL: the two top bars overlap (console ends ${bar.consoleBox.right},`
    + ` camera starts ${bar.cameraBox.left})`);
  process.exitCode = 1;
}


// --- the controls audit (playtest 2026-08-28, item 4) ------------------------
//
// "Verify that all actions that have a keyboard key assigned also exist as a
// clickable entity on screen." Four did not: Y put the decoy screen out, O
// looked astern, ] worked the scope and , / . proposed a clock - all
// keyboard-only, so a player who never opened the key list could not reach
// them. Y was the worst: a whole ruled feature whose button label had been
// sitting unused in both language files.
//
// The key list is read from the SOURCE rather than from a hook in the client,
// so it cannot drift: add a key to the handler and this notices on the next
// run whether you gave it a button.
const KEYS_WITHOUT_BUTTONS = {
  w: 'the throttle scale on the helm IS the control - click it',
  s: 'the throttle scale on the helm IS the control',
  a: 'the rudder buttons on the helm',
  d: 'the rudder buttons on the helm',
  arrowleft: 'the rudder buttons',
  arrowright: 'the rudder buttons',
  arrowup: 'the CLIMB button, and right-drag',
  arrowdown: 'the DIVE button, and right-drag',
  '[': 'SCOPE steps out and wraps round; one button covers the ring',
  g: 'the tier chip in the top right - it is a button now, because the tier'
    + ' decides whether there is weather at all',
  v: 'the weapon selector is the row of buttons V cycles',
  h: 'the ? button',
  i: 'the SIGNALS tab on the console bar',
  q: 'the STORES tab',
  j: 'the SQUADRON tab',
  z: 'the DAMAGE tab',
  escape: 'surrender is deliberately keyboard-only, and deliberately twice',
  tab: 'chat opens on its own in a LAN game',
  ' ': 'the PAUSE button',
  c: 'the camera tabs',
  t: 'the PILOT button',
  1: 'the MANTA button', 2: 'the WALRUS button', 3: 'the EYE button',
};

const source = readFileSync(join(HERE, '..', '..', 'client', 'main.js'), 'utf8');
const answered = [];
for (const match of source.matchAll(/key === '([^']+)'/g)) {
  if (!answered.includes(match[1])) answered.push(match[1]);
}
const clickable = await page.$$eval('.act .k, .console-tab .k, .cam-tab',
  (nodes) => nodes.map((n) => n.textContent.trim().toLowerCase()));

// The tier chip: on screen always, warning when the look is asking for more
// than the tier pays for. A playtester on modern/Medium asked why there were
// no waves, and nothing on screen answered (2026-08-29).
const tier = await page.evaluate(() => {
  const chip = document.getElementById('tier-chip');
  return chip === null ? null
    : { text: chip.textContent.trim(), warns: chip.classList.contains('short'),
        onScreen: chip.getBoundingClientRect().width > 0 };
});
// Nothing in the top row may sit on anything else. The tier chip was pinned
// at a guessed `right: 148px` and landed on the autopilot indicator at every
// width measured - guessing a margin against other fixed elements is how two
// things end up in one place (2026-08-30).
const collisions = await page.evaluate(() => {
  const names = { tier: '#tier-chip', pause: '#pause-button', help: '#help-button',
    auto: '#auto-chip', consoleTabs: '#console-tabs', cameraTabs: '#camera-tabs' };
  const keys = Object.keys(names).filter((k) => document.querySelector(names[k]) !== null);
  const hit = [];
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const ea = document.querySelector(names[keys[i]]);
      const eb = document.querySelector(names[keys[j]]);
      if (ea.contains(eb) || eb.contains(ea)) continue;
      const A = ea.getBoundingClientRect();
      const B = eb.getBoundingClientRect();
      if (A.width === 0 || B.width === 0) continue;
      if (A.left < B.right && B.left < A.right && A.top < B.bottom && B.top < A.bottom) {
        hit.push(`${keys[i]}/${keys[j]}`);
      }
    }
  }
  return hit;
});
if (collisions.length > 0) {
  console.log(`FAIL: things in the top row are sitting on each other: ${collisions.join(' ')}`);
  process.exitCode = 1;
}

if (tier === null || !tier.onScreen) {
  console.log('FAIL: the look and tier are not shown anywhere on screen');
  process.exitCode = 1;
} else {
  console.log(`tier chip: "${tier.text}"${tier.warns ? ' (warning)' : ''}`);
}
const unreachable = [];
for (const key of answered) {
  if (clickable.includes(key)) continue;
  if (KEYS_WITHOUT_BUTTONS[key] !== undefined) continue;
  unreachable.push(key);
}
console.log(`controls: ${answered.length} keys answered, ${clickable.length} clickable captions`);
if (unreachable.length > 0) {
  console.log(`FAIL: keys a mouse cannot reach: ${unreachable.map((k) => `"${k}"`).join(' ')}`);
  process.exitCode = 1;
}

await browser.close();
await app.close();
console.log('gunnery, resources and the screen photographed');

