// debugging/probes/chart_and_chips.mjs
//
// The second source review's UI slice, probed: the SCORE is always on
// screen, PAUSE is a lit button, the CHART tab opens the original's map
// screen - named islands, a click on its water lays the course and the A
// chip lights, CLEAR COURSE puts it out - and the hulls that are out stand
// as chips that select on a click.
//
//   node debugging/probes/chart_and_chips.mjs

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

// The always-on strip: a score line without opening anything.
const score = await page.evaluate(() => document.getElementById('score-strip').textContent);
console.log(`score strip: "${score}"`);

// PAUSE is a button and it lights.
await page.click('#pause-button');
await page.waitForTimeout(300);
const paused = await page.evaluate(
  () => document.getElementById('pause-button').classList.contains('on'),
);
await page.click('#pause-button'); // and resume
console.log(`pause button lights: ${paused}`);

// The chart: open by tab, click its open water, and the course stands.
await page.click('.cam-tab:has-text("CHART")');
await page.waitForTimeout(400);
const chartOpen = await page.evaluate(
  () => document.getElementById('chart-panel').classList.contains('open'),
);
// The ship spawns in the south-west; the map centre is open water on this
// seed. Click the canvas centre.
const box = await page.evaluate(() => {
  const rect = document.getElementById('chart-canvas').getBoundingClientRect();
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
});
await page.mouse.click(box.x, box.y);
await page.waitForTimeout(600);
const course = await page.evaluate(() => {
  const own = window.__lastView.carriers.find((c) => c.team === window.__lastView.team);
  return {
    set: own.courseX >= 0,
    autoLit: document.getElementById('auto-chip').classList.contains('on'),
  };
});
await page.screenshot({ path: join(SHOTS, 'chart-open.png') });
await page.click('#chart-clear');
await page.waitForTimeout(500);
const cleared = await page.evaluate(() => {
  const own = window.__lastView.carriers.find((c) => c.team === window.__lastView.team);
  return {
    gone: own.courseX < 0,
    autoOut: !document.getElementById('auto-chip').classList.contains('on'),
  };
});
await page.click('#chart-network');
const network = await page.evaluate(
  () => document.getElementById('chart-network').classList.contains('on'),
);
await page.click('.cam-tab:has-text("HELM")');
const chartClosed = await page.evaluate(
  () => !document.getElementById('chart-panel').classList.contains('open'),
);
console.log(`chart: open ${chartOpen}, course set ${course.set} (A lit ${course.autoLit}),`
  + ` cleared ${cleared.gone} (A out ${cleared.autoOut}), network toggles ${network},`
  + ` HELM tab closes it ${chartClosed}`);

// The chips: launch a Manta, a chip appears, clicking it names the hull.
await page.keyboard.press('1');
await page.waitForTimeout(600);
const chips = await page.evaluate(() => ({
  count: document.getElementById('unit-chips').children.length,
  label: document.getElementById('unit-chips').children[0]?.textContent ?? '',
}));
await page.click('#unit-chips .unit-chip');
await page.waitForTimeout(200);
const chipSelected = await page.evaluate(() => ({
  lit: document.getElementById('unit-chips').children[0].classList.contains('on'),
  marker: window.__scene3d.marker !== null && window.__scene3d.marker.visible,
}));
await page.screenshot({ path: join(SHOTS, 'chart-chips.png') });
console.log(`chips: ${chips.count} ("${chips.label}"), click selects ${chipSelected.lit},`
  + ` marker ${chipSelected.marker}`);

const ok = !failed
  && score.length > 0 && paused
  && chartOpen && course.set && course.autoLit
  && cleared.gone && cleared.autoOut && network && chartClosed
  && chips.count >= 1 && chipSelected.lit && chipSelected.marker;
if (!ok) {
  console.log('FAIL: the chart-and-chips slice is not doing what the sources show');
  process.exitCode = 1;
}

await browser.close();
await app.close();
console.log('the chart, the chips, the score and the pause all photographed');
