// debugging/probes/round3_findings.mjs
//
// The round-3 browser findings (CB14, CB15, CB20, CB26 in
// ../unityworks/specs/server_change_requests.md), checked where only a
// browser can see them: what covers what at 1280x720 and 1920x1080, the
// chart's height over a short window's panel, and a LAN war of another size.
//
//   node debugging/probes/round3_findings.mjs

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
const bigRules = loadRules();
bigRules.world.islandCount = 16;
const big = createApp({ seed: 20260818, rules: bigRules });
const bigAddress = await big.listen(0, '127.0.0.1');
const browser = await chromium.launch();
let failed = false;

function check(name, ok, detail) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${detail}`);
  if (!ok) failed = true;
}

async function open(url, width, height) {
  const page = await browser.newPage({ viewport: { width: width, height: height } });
  page.on('pageerror', (error) => {
    console.log('PAGEERROR', error.message);
    failed = true;
  });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => Number(document.getElementById('hud-tick')?.textContent) > 10,
    undefined, { timeout: 30000 });
  return page;
}

function overlap(a, b) {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

for (const [width, height] of [[1280, 720], [1920, 1080]]) {
  const page = await open(`http://127.0.0.1:${address.port}/?mode=solo&speed=1`, width, height);
  // A Manta out, so the chip row has more than the lighter in it.
  await page.keyboard.press('1');
  await page.waitForFunction(() => {
    const view = window.__lastView;
    return view !== undefined && view.units.some((u) => u.kind === 0 && u.team === view.team && u.state === 1);
  }, undefined, { timeout: 20000 });
  await page.waitForTimeout(400);
  const seen = await page.evaluate(() => {
    const box = (node) => {
      const r = node.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    };
    const msg = document.getElementById('msg-button');
    const m = box(msg);
    const hit = document.elementFromPoint((m.left + m.right) / 2, (m.top + m.bottom) / 2);
    return {
      msg: m,
      msgOnTop: hit === msg || msg.contains(hit),
      tabs: [...document.querySelectorAll('#console-tabs .console-tab, #camera-tabs .cam-tab')].map(box),
      chips: [...document.querySelectorAll('#unit-chips .unit-chip')].map(box),
      buttons: [...document.querySelectorAll('#actions-left .act')].map(box),
    };
  });
  const size = `${width}x${height}`;
  check(`CB14 MSG at ${size}`, seen.msgOnTop && !seen.tabs.some((tab) => overlap(tab, seen.msg)),
    `MSG ${Math.round(seen.msg.left)}-${Math.round(seen.msg.right)}px, on top ${seen.msgOnTop}`);
  const under = seen.chips.filter((chip) => seen.buttons.some((button) => overlap(chip, button)));
  check(`CB15 chips at ${size}`, seen.chips.length >= 2 && under.length === 0,
    `${seen.chips.length} chips from ${Math.round(seen.chips[0]?.left ?? -1)}px, ${under.length} under the column`);
  await page.screenshot({ path: join(SHOTS, `round3-${size}.png`) });
  await page.close();
}

// CB26: on a short window the panel is 124 px and the chart stops at it.
const short = await open(`http://127.0.0.1:${address.port}/?mode=solo&speed=1`, 1000, 480);
await short.click('.cam-tab:has-text("CHART")');
await short.waitForTimeout(400);
const chart = await short.evaluate(() => ({
  canvas: document.getElementById('chart-canvas').height,
  panel: getComputedStyle(document.documentElement).getPropertyValue('--panel-h').trim(),
  inner: window.innerHeight,
}));
check('CB26 chart height', chart.canvas === chart.inner - parseInt(chart.panel, 10),
  `canvas ${chart.canvas} in ${chart.inner} over a ${chart.panel} panel`);
await short.screenshot({ path: join(SHOTS, 'round3-chart-480.png') });
await short.close();

// CB20: a LAN war of sixteen islands, joined by a page whose own rules say eight.
const lan = await open(`http://127.0.0.1:${bigAddress.port}/?mode=lan`, 1280, 720);
const sizes = await lan.evaluate(() => ({
  scene: window.__scene3d.sizeMetres,
  view: Math.round(window.__lastView.params.sizeUnits / 256),
}));
check('CB20 world size', sizes.scene === sizes.view, `scene ${sizes.scene} m, war ${sizes.view} m`);
await lan.close();

await browser.close();
await app.close();
await big.close();
console.log(failed ? 'round3_findings: FAILED' : 'round3_findings: all ok');
process.exit(failed ? 1 : 0);
