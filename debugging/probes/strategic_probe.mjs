// debugging/probes/strategic_probe.mjs
//
// Take one screenshot of the strategic pull-back and say whether WebGL is
// alive. Written while chasing "the strategic view shows an empty ocean",
// which turned out to be terrain triangles wound the wrong way round - a bug
// no headless test could ever have caught.
//
//   node debugging/probes/strategic_probe.mjs [?query]

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

import { createApp } from '../../server/app.js';
import { loadRules } from '../../server/rules.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SHOT = join(HERE, '..', 'shots', 'strategic-probe.png');
const QUERY = process.argv[2] ?? '?mode=solo';

const app = createApp({ seed: 20260818, rules: loadRules() });
const address = await app.listen(0, '127.0.0.1');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (error) => console.log('PAGEERROR', error.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text()); });

await page.goto(`http://127.0.0.1:${address.port}/${QUERY}`, { waitUntil: 'load' });
await page.waitForFunction(() => Number(document.getElementById('hud-tick')?.textContent) > 20);
await page.keyboard.press('c'); // strategic pull-back
await page.waitForTimeout(500);

const info = await page.evaluate(() => {
  const canvas = document.getElementById('view');
  const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
  return {
    canvas: `${canvas.width}x${canvas.height}`,
    webgl: gl === null ? 'none' : (gl.isContextLost() ? 'lost' : 'ok'),
    tick: document.getElementById('hud-tick').textContent,
    islands: document.getElementById('hud-islands').textContent,
  };
});
console.log(info);

await page.screenshot({ path: SHOT });
console.log(`wrote ${SHOT}`);
await browser.close();
await app.close();
