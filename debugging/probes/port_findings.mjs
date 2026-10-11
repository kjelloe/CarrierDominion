// debugging/probes/port_findings.mjs
//
// The browser-client bugs the Unity port found by copying the client line by
// line (CB1-CB10 in ../unityworks/specs/server_change_requests.md), checked in
// a real browser. Most are canvas drawing that no DOM read can see, so the
// chart's 2D context is wrapped and its text and box calls recorded.
//
//   node debugging/probes/port_findings.mjs

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
const room = createApp({ seed: 20260818, rules: loadRules(), lobby: true, bootId: 'port-findings' });
const roomAddress = await room.listen(0, '127.0.0.1');
const browser = await chromium.launch();
let failed = false;

// Printed as they land, so a probe that dies half way still says how far it got.
function check(name, ok, detail) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${detail}`);
  if (!ok) failed = true;
}

async function open(url) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (error) => {
    console.log('PAGEERROR', error.message);
    failed = true;
  });
  // Record what the 2D canvases draw: text with its position, and outlines.
  await page.addInitScript(() => {
    window.__drawn = { text: [], rects: [] };
    const proto = CanvasRenderingContext2D.prototype;
    const fillText = proto.fillText;
    proto.fillText = function recordText(text, x, y, ...rest) {
      window.__drawn.text.push({ text: String(text), x: x, y: y });
      return fillText.call(this, text, x, y, ...rest);
    };
    const strokeRect = proto.strokeRect;
    proto.strokeRect = function recordRect(x, y, w, h) {
      window.__drawn.rects.push({ x: x, y: y, w: w, h: h });
      return strokeRect.call(this, x, y, w, h);
    };
  });
  await page.goto(url, { waitUntil: 'load' });
  return page;
}

// CB5: one Escape in the first three seconds must ARM, not strike the colours.
// On its own page: the bug scuttles the ship, and nothing after it would run.
const fresh = await open(`http://127.0.0.1:${address.port}/?mode=solo&speed=1`);
await fresh.waitForFunction(() => window.__lastView !== undefined, undefined, { timeout: 30000 });
const early = await fresh.evaluate(() => {
  const at = performance.now();
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  return { at: Math.round(at), status: document.getElementById('hud-status')?.textContent ?? '' };
});
if (early.at < 3000) {
  check('CB5 surrender', !/scuttled/.test(early.status), `Escape at ${early.at} ms: "${early.status}"`);
} else {
  console.log(`skip CB5 surrender: the page took ${early.at} ms, past the window`);
}
await fresh.close();

const solo = await open(`http://127.0.0.1:${address.port}/?mode=solo&speed=1`);
await solo.waitForFunction(
  () => Number(document.getElementById('hud-tick')?.textContent) > 10,
  undefined,
  { timeout: 30000 },
);

// CB3: LAY COURSE with no legs laid looks disabled.
await solo.click('.cam-tab:has-text("CHART")');
await solo.waitForTimeout(400);
const lay = await solo.evaluate(() => {
  const node = document.getElementById('chart-lay');
  return { off: node.classList.contains('off'), opacity: getComputedStyle(node).opacity };
});
check('CB3 lay course', lay.off && lay.opacity === '0.35', `off ${lay.off}, opacity ${lay.opacity}`);

// CB1 + CB4: the RESOURCES box names the depot and stays clear of the column.
await solo.click('#chart-resources');
await solo.evaluate(() => { window.__drawn.text = []; window.__drawn.rects = []; });
await solo.waitForTimeout(400);
const resources = await solo.evaluate(() => {
  const depotId = window.__lastView.resources.stockpileIsland;
  const line = window.__drawn.text.filter((entry) => entry.text.startsWith('STOCKPILE')).pop();
  const box = window.__drawn.rects.filter((rect) => rect.y === 48).pop();
  const column = document.getElementById('actions-right').getBoundingClientRect().left;
  return {
    depotId: depotId,
    line: line === undefined ? '' : line.text,
    boxRight: box === undefined ? -1 : Math.round(box.x + box.w),
    column: Math.round(column),
  };
});
check('CB1 depot', resources.depotId >= 0 && !/-\s*$/.test(resources.line),
  `depot ${resources.depotId}, "${resources.line}"`);
check('CB4 resources box', resources.boxRight > 0 && resources.boxRight <= resources.column,
  `box right edge ${resources.boxRight}, column starts ${resources.column}`);
await solo.screenshot({ path: join(SHOTS, 'port-findings-chart.png') });

// CB2 is a field read (view.contacts); a war with ghosts in it is a long way
// from a fresh solo start, so here it is only checked that the chart reads a
// field that exists.
const contacts = await solo.evaluate(() => Array.isArray(window.__lastView.contacts));
check('CB2 ghosts field', contacts, `view.contacts is ${contacts ? '' : 'not '}an array`);

// CB6 + CB10: the war room's chat line fits its panel, and typing in it is
// typing, not pressing hotkeys.
const lobby = await open(`http://127.0.0.1:${roomAddress.port}/?mode=lan`);
await lobby.waitForSelector('#lobby-say', { state: 'visible', timeout: 20000 });
const fit = await lobby.evaluate(() => {
  const input = document.getElementById('lobby-say').getBoundingClientRect();
  const panel = document.getElementById('lobby-chat').getBoundingClientRect();
  return { input: Math.round(input.right), panel: Math.round(panel.right) };
});
check('CB6 chat width', fit.input <= fit.panel, `input right ${fit.input}, panel right ${fit.panel}`);
await lobby.click('#lobby-say');
await lobby.keyboard.type('mm');
const typed = await lobby.evaluate(() => ({
  value: document.getElementById('lobby-say').value,
  status: document.getElementById('hud-status')?.textContent ?? '',
}));
check('CB10 typing', typed.value === 'mm' && !/sound off/.test(typed.status),
  `field "${typed.value}", status "${typed.status}"`);
await lobby.screenshot({ path: join(SHOTS, 'port-findings-room.png') });

if (failed) {
  console.log('FAIL: a port finding is still in the browser client');
  process.exitCode = 1;
}
await browser.close();
await app.close();
await room.close();
console.log('the port findings, checked in a browser');
