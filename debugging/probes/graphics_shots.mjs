// debugging/probes/graphics_shots.mjs
//
// The tier contract, photographed (docs/07-graphics.md): Medium is the pinned
// reference look, High adds the detailed water WITHOUT changing the art, and
// retro at High stays 1988 - hard horizon, grid sea, no fresnel anywhere.
// Four screenshots of the same moment of the same war, for judging by eye.
//
//   node debugging/probes/graphics_shots.mjs

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

// Same seed, same tick window, same camera: only the tier (and one style)
// varies, so any difference in the pictures is the tier's doing.
async function shoot(name, query) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (error) => console.log(`[${name}] PAGEERROR`, error.message));
  await page.goto(
    `http://127.0.0.1:${address.port}/?mode=solo&${query}`,
    { waitUntil: 'load' },
  );
  // Headless SwiftShader rasterises the High tier in software; what a 4070
  // does per frame it does per breakfast. Patience, not a lighter scene.
  await page.waitForFunction(
    () => Number(document.getElementById('hud-tick')?.textContent) > 30,
    undefined,
    { timeout: 90000 },
  );
  await page.keyboard.press(' '); // freeze, so the four shots compare
  await page.waitForTimeout(900);
  const facts = await page.evaluate(() => ({
    graphics: document.getElementById('hud-graphics')?.textContent,
    oceanShader: window.__scene3d.ocean.material.type,
  }));
  await page.screenshot({ path: join(SHOTS, `graphics-${name}.png`) });
  await page.close();
  console.log(`${name}: ${facts.graphics} (${facts.oceanShader})`);
  return facts;
}

const shots = [
  await shoot('modern-low', 'style=modern&graphics=low'),
  await shoot('modern-medium', 'style=modern&graphics=medium'),
  await shoot('modern-high', 'style=modern&graphics=high'),
  await shoot('retro-high', 'style=retro&graphics=high'),
];

// The one machine-checkable clause of the contract: the detail shader is a
// ShaderMaterial on shader styles, and retro's sea stays the flat 1988 one
// whatever the tier says.
const ok = shots[0].oceanShader === 'MeshBasicMaterial'
  && shots[1].oceanShader === 'ShaderMaterial'
  && shots[2].oceanShader === 'ShaderMaterial'
  && shots[3].oceanShader === 'MeshBasicMaterial';
if (!ok) {
  console.log('FAIL: a tier changed the art, or a style changed the cost class');
  process.exitCode = 1;
}

await browser.close();
await app.close();
console.log('four tiers photographed - judge the water by eye');
