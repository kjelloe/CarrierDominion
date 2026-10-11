// debugging/probes/native_link.mjs
//
// The native client's download line (request C10): on the start menu and in
// the war room when the server offers builds, a real download behind it, and
// nowhere on a touch screen or when nothing is configured.
//
//   node debugging/probes/native_link.mjs

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

import { createApp } from '../../server/app.js';
import { loadRules } from '../../server/rules.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SHOTS = join(HERE, '..', 'shots');
mkdirSync(SHOTS, { recursive: true });

const folder = mkdtempSync(join(tmpdir(), 'cd-native-probe-'));
writeFileSync(join(folder, 'CarrierDominion-20261011-abc-win64.zip'), Buffer.alloc(3 * 1048576, 1));
writeFileSync(join(folder, 'CarrierDominion-20261011-abc-linux64.zip'), Buffer.alloc(2 * 1048576, 1));
writeFileSync(join(folder, 'boombrawl-20261011-def-win64.zip'), Buffer.alloc(1024, 1));

const offering = createApp({ seed: 20260818, rules: loadRules(), lobby: true, bootId: 'native-probe', nativeDownloads: folder });
const offered = await offering.listen(0, '127.0.0.1');
const bare = createApp({ seed: 20260818, rules: loadRules() });
const bareAddress = await bare.listen(0, '127.0.0.1');
const browser = await chromium.launch();
let failed = false;

function check(name, ok, detail) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${detail}`);
  if (!ok) failed = true;
}

async function lineOn(url, contextOptions) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, ...contextOptions });
  const page = await context.newPage();
  page.on('pageerror', (error) => {
    console.log('PAGEERROR', error.message);
    failed = true;
  });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForSelector('#start-panel.open', { timeout: 20000 });
  await page.waitForTimeout(800);
  const line = await page.evaluate(() => {
    const box = document.getElementById('native-links');
    const style = getComputedStyle(box);
    return {
      visible: !box.hidden && style.display !== 'none' && box.getBoundingClientRect().height > 0,
      text: box.textContent,
      hrefs: [...box.querySelectorAll('a')].map((a) => a.getAttribute('href')),
    };
  });
  return { page: page, context: context, line: line };
}

const menu = await lineOn(`http://127.0.0.1:${offered.port}/`);
check('menu shows the builds', menu.line.visible && menu.line.hrefs.length === 2,
  `visible ${menu.line.visible}, "${menu.line.text}"`);
check('only this game', !/boombrawl/.test(menu.line.text), menu.line.hrefs.join(', '));
const download = await menu.page.evaluate(async (href) => {
  const response = await fetch(href);
  return { status: response.status, bytes: (await response.arrayBuffer()).byteLength };
}, menu.line.hrefs[0]);
check('the link downloads', download.status === 200 && download.bytes > 0,
  `${download.status}, ${download.bytes} bytes`);
await menu.page.screenshot({ path: join(SHOTS, 'native-link-menu.png') });
await menu.context.close();

const room = await lineOn(`http://127.0.0.1:${offered.port}/?mode=lan`);
check('war room shows the builds', room.line.visible, `"${room.line.text}"`);
await room.page.screenshot({ path: join(SHOTS, 'native-link-room.png') });
await room.context.close();

const phone = await lineOn(`http://127.0.0.1:${offered.port}/`, { hasTouch: true, isMobile: true, viewport: { width: 740, height: 360 } });
check('a touch screen gets no line', !phone.line.visible, `visible ${phone.line.visible}`);
await phone.context.close();

const none = await lineOn(`http://127.0.0.1:${bareAddress.port}/`);
check('nothing configured, no line', !none.line.visible && none.line.text === '', `visible ${none.line.visible}`);
await none.context.close();

if (failed) {
  console.log('FAIL: the native client line is not doing what C10 asks');
  process.exitCode = 1;
}
await browser.close();
await offering.close();
await bare.close();
rmSync(folder, { recursive: true });
console.log('the native client line, checked on the menu, in the room and on a phone');
