// debugging/probes/mobile.mjs
//
// Does the interface FIT a phone? (mobile pass, 2026-08-30)
//
// The game grew a great deal in a week - a top bar of screens, a camera bar, a
// tier chip, wrapping action columns, a 196px instrument panel - all of it
// designed on a desktop. On an 844x390 phone in landscape the result was a
// mess: the columns wrapped into five or six each, sprawled across the whole
// window, sat on top of the camera tabs, and the panel took half the height.
// Eleven buttons were entirely off screen. None of that was visible from a
// desktop window, and none of it was guessed - it was measured.
//
// What this asserts is FIT and REACH, not speed. Frame timings from a headless
// software rasteriser are not a phone (docs/07 lesson: a headless browser
// doing software rendering is not a clock), so this deliberately measures no
// frame rate. Real devices judge that, which is the standing ruling.
//
//   node debugging/probes/mobile.mjs

import { chromium } from 'playwright';

import { createApp } from '../../server/app.js';
import { loadRules } from '../../server/rules.js';

const app = createApp({ seed: 20260818, rules: loadRules() });
const address = await app.listen(0, '127.0.0.1');
const browser = await chromium.launch();
const problems = [];

// Landscape, which is the only orientation the game plays in (the rotate gate
// holds portrait), across the range of phones a friend is likely to hold.
const PHONES = [
  ['iphone-14', 844, 390],
  ['pixel-7', 915, 412],
  ['small-android', 740, 360],
];

// The panel may not eat the war. Half the screen was instruments before this.
const PANEL_SHARE_MAX = 38;

for (const [name, width, height] of PHONES) {
  const context = await browser.newContext({
    viewport: { width: width, height: height },
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => problems.push(`[${name}] PAGEERROR ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`[${name}] CONSOLE ${message.text()}`);
  });

  await page.goto(`http://127.0.0.1:${address.port}/?mode=solo&graphics=low`, { waitUntil: 'load' });
  await page.waitForFunction(
    () => Number(document.getElementById('hud-tick')?.textContent) > 3,
    undefined,
    { timeout: 60000 },
  );
  await page.waitForTimeout(800);

  const seen = await page.evaluate(() => {
    // Anything that has escaped the window entirely.
    const escaped = [];
    for (const id of ['top-bar', 'panel', 'actions-left', 'actions-right', 'pause-button']) {
      const node = document.getElementById(id);
      if (node === null) continue;
      const box = node.getBoundingClientRect();
      if (box.right > window.innerWidth + 1 || box.left < -1
        || box.bottom > window.innerHeight + 1 || box.top < -1) escaped.push(id);
    }

    // A control in a SCROLLING column is not lost - it is below the fold and
    // a drag away. Unreachable means off the side, or outside its column's
    // own scroll extent.
    const unreachable = [];
    for (const node of document.querySelectorAll('.act')) {
      const box = node.getBoundingClientRect();
      const label = node.textContent.replace(/\s+/g, '').slice(0, 9);
      if (box.right > window.innerWidth + 1 || box.left < -1) { unreachable.push(label); continue; }
      const column = node.closest('.actions');
      if (column === null) continue;
      const style = window.getComputedStyle(column);
      if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
        if (node.offsetTop < 0 || node.offsetTop + node.offsetHeight > column.scrollHeight + 1) {
          unreachable.push(label);
        }
        continue;
      }
      if (box.bottom > window.innerHeight + 1 || box.top < -1) unreachable.push(label);
    }

    // THE SPRAWL. This is what actually went wrong: with desktop wrapping on
    // a coarse pointer the columns fanned into five or six each, ran across
    // the whole window and sat on top of the camera tabs and one another.
    // Everything was still "reachable" by the scroll test, so reach alone
    // would have called that layout fine.
    const overlaps = [];
    const boxOf = (id) => {
      const node = document.getElementById(id);
      return node === null ? null : node.getBoundingClientRect();
    };
    const pairs = [
      ['actions-left', 'top-bar'], ['actions-right', 'top-bar'],
      ['actions-left', 'panel'], ['actions-right', 'panel'],
      ['actions-left', 'actions-right'],
    ];
    for (const [a, b] of pairs) {
      const A = boxOf(a);
      const B = boxOf(b);
      if (A === null || B === null) continue;
      if (A.left < B.right && B.left < A.right && A.top < B.bottom && B.top < A.bottom) {
        overlaps.push(`${a}/${b}`);
      }
    }

    const panel = document.getElementById('panel').getBoundingClientRect();
    const canvas = document.getElementById('panel');
    return {
      escaped: escaped,
      unreachable: unreachable,
      overlaps: overlaps,
      panelShare: Math.round((panel.height / window.innerHeight) * 100),
      // The canvas must be exactly as tall as the box it is drawn into, or
      // the instruments are drawn for a panel that is not there.
      canvasMatches: Math.abs(canvas.height / (window.devicePixelRatio || 1) - panel.height) < 2
        || canvas.height === Math.round(panel.height),
      // NOT offsetParent: that is null for any position:fixed element,
      // visible or not, so a test written on it can never fail. The gate is
      // fixed, so both of its checks here were vacuous until this line.
      gateShown: window.getComputedStyle(document.getElementById('rotate-gate')).display !== 'none',
    };
  });

  console.log(`${name.padEnd(14)} ${width}x${height}: panel ${seen.panelShare}% of height, `
    + `${seen.unreachable.length} unreachable, gate ${seen.gateShown}`);

  if (seen.escaped.length > 0) {
    problems.push(`${name}: off the window entirely - ${seen.escaped.join(' ')}`);
  }
  if (seen.overlaps.length > 0) {
    problems.push(`${name}: the controls are sitting on each other - ${seen.overlaps.join(' ')}`);
  }
  if (seen.unreachable.length > 0) {
    problems.push(`${name}: a finger cannot reach ${seen.unreachable.join(' ')}`);
  }
  if (seen.panelShare > PANEL_SHARE_MAX) {
    problems.push(`${name}: the instruments take ${seen.panelShare}% of the screen`);
  }
  if (seen.gateShown) {
    problems.push(`${name}: the rotate-to-landscape gate is up IN landscape`);
  }

  // And portrait must still be held: the game does not play sideways.
  await page.setViewportSize({ width: height, height: width });
  await page.waitForTimeout(400);
  const portraitGate = await page.evaluate(
    () => window.getComputedStyle(document.getElementById('rotate-gate')).display !== 'none',
  );
  if (!portraitGate) problems.push(`${name}: portrait was allowed through without the gate`);

  // ROTATING IS NOT A RELOAD. The pixel ratio and the panel's height are both
  // chosen from the window's shape, and both were decided once at startup -
  // so a phone turned from portrait to landscape kept the wrong ones for the
  // rest of the session.
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.waitForTimeout(600);
  const wide = await page.evaluate(() => ({
    dpr: window.__scene3d.renderer.getPixelRatio(),
    panel: document.getElementById('panel').height,
  }));
  await page.setViewportSize({ width: width, height: height });
  await page.waitForTimeout(600);
  const narrow = await page.evaluate(() => ({
    dpr: window.__scene3d.renderer.getPixelRatio(),
    panel: document.getElementById('panel').height,
  }));
  if (!(wide.dpr > narrow.dpr)) {
    problems.push(`${name}: the pixel ratio did not follow the window `
      + `(${narrow.dpr} small, ${wide.dpr} large)`);
  }
  if (!(wide.panel > narrow.panel)) {
    problems.push(`${name}: the instrument panel did not resize with the window `
      + `(${narrow.panel}px small, ${wide.panel}px large)`);
  }

  await page.screenshot({ path: `debugging/shots/mobile-${name}.png` });
  await context.close();
}

await browser.close();
await app.close();

if (problems.length > 0) {
  for (const problem of problems) console.log(problem);
  console.log('FAIL: the interface does not fit a phone');
  process.exitCode = 1;
} else {
  console.log('the interface fits a phone: nothing off the window, nothing out of reach');
}
