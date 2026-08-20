// debugging/probes/scope_zoom.mjs
//
// The scope's range control: `[` widens, `]` narrows, and what is drawn changes
// with it. Photographs three ranges of the same moment so the difference can be
// judged by looking.
//
//   node debugging/probes/scope_zoom.mjs

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
page.on('pageerror', (error) => console.log('PAGEERROR', error.message));

await page.goto(`http://127.0.0.1:${address.port}/?mode=solo&graphics=medium&speed=8`, {
  waitUntil: 'load',
});
await page.waitForFunction(() => Number(document.getElementById('hud-tick')?.textContent) > 30);

// Get under way so there is something on the scope besides the ship.
for (let i = 0; i < 10; i += 1) await page.keyboard.press('w');
await page.keyboard.press('1');
await page.waitForTimeout(12000);

async function shot(name) {
  await page.waitForTimeout(700);
  const clip = { x: 260, y: 524, width: 210, height: 196 };
  await page.screenshot({ path: join(SHOTS, `scope-${name}.png`), clip: clip });
}

await shot('8k');
await page.keyboard.press(']');
await page.keyboard.press(']');
await shot('2k');
await page.keyboard.press('[');
await page.keyboard.press('[');
await page.keyboard.press('[');
await page.keyboard.press('[');
await shot('32k');

const status = await page.textContent('#hud-status');
console.log(`three ranges photographed; status reads "${status}"`);
if (!/32000|32k/.test(String(status))) {
  console.log('FAIL: the widest range was never reached');
  process.exitCode = 1;
}

await browser.close();
await app.close();
