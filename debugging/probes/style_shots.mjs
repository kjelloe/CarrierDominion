// debugging/probes/style_shots.mjs
//
// Render the same moment of the same war in each art direction, so the choice
// can be made by looking. Two shots per style: the chase camera, and the
// strategic pull-back over an island.
//
//   node debugging/probes/style_shots.mjs

import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

import { createApp } from '../../server/app.js';
import { loadRules } from '../../server/rules.js';
import { styleNames } from '../../client/styles.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SHOTS = join(HERE, '..', 'shots', 'styles');
mkdirSync(SHOTS, { recursive: true });

// A seed and a spawn that put an island in frame from the start.
const SEED = 20260818;
const rules = loadRules();
const app = createApp({ seed: SEED, rules: rules });
const address = await app.listen(0, '127.0.0.1');
const browser = await chromium.launch();

// `node debugging/probes/style_shots.mjs retro` re-shoots one style while a
// look is being tuned; no argument shoots all three.
const only = process.argv[2];
const wanted = only === undefined ? styleNames() : [only];

for (const style of wanted) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (error) => console.log(`[${style}] PAGEERROR`, error.message));
  const query = `?mode=solo&style=${style}&graphics=medium&speed=8`;
  await page.goto(`http://127.0.0.1:${address.port}/${query}`, { waitUntil: 'load' });
  await page.waitForFunction(() => Number(document.getElementById('hud-tick')?.textContent) > 30);

  // Get under way at full throttle and put something on the deck, so the shot
  // has a ship doing something rather than a hull at anchor. Then run long
  // enough to close with the archipelago: the land treatment (facets, palette
  // steps) is the biggest difference between the styles and it is invisible
  // from five kilometres out.
  for (let i = 0; i < 10; i += 1) await page.keyboard.press('w');
  await page.keyboard.press('1');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: join(SHOTS, `${style}-open-sea.png`) });
  await page.waitForTimeout(22000);
  await page.screenshot({ path: join(SHOTS, `${style}-chase.png`) });

  await page.keyboard.press('c');
  await page.waitForTimeout(700);
  await page.screenshot({ path: join(SHOTS, `${style}-strategic.png`) });
  console.log(`${style}: two shots written`);
  await page.close();
}

await browser.close();
await app.close();
console.log(`shots in ${SHOTS}`);
