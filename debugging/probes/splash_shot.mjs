// debugging/probes/splash_shot.mjs
//
// The diorama behind the start menu: a plain visit to / gets the staged
// island assault - island, defences, carrier, Mantas, Walrus, tracers - and
// BEGIN tears it down whole before the war's renderer takes the screen.
// Screenshots retro and modern for the owner's eye; asserts the scene is
// actually varied pixels (a flat backdrop means a dead pipeline) and that
// nothing of it survives into the war.
//
//   node debugging/probes/splash_shot.mjs

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
let failed = false;

async function visit(name, query) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (error) => {
    console.log(`[${name}] PAGEERROR`, error.message);
    failed = true;
  });
  await page.goto(`http://127.0.0.1:${address.port}/${query}`, { waitUntil: 'load' });
  await page.waitForSelector('#start-panel.open', { timeout: 15000 });
  await page.waitForSelector('#diorama', { timeout: 15000 });
  await page.waitForTimeout(1500); // let the tracers fly and the camera move
  const facts = await page.evaluate(() => {
    const d = window.__diorama;
    d.renderer.render(d.scene, d.camera);
    const gl = d.renderer.getContext();
    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;
    const pixels = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let sum = 0;
    let count = 0;
    const luma = (i) => 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
    for (let i = 0; i < pixels.length; i += 64) { sum += luma(i); count++; }
    const mean = sum / count;
    let varSum = 0;
    for (let i = 0; i < pixels.length; i += 64) { varSum += (luma(i) - mean) ** 2; }
    let meshes = 0;
    d.scene.traverse((node) => { if (node.isMesh || node.isLineSegments) meshes++; });
    return {
      variance: Math.round(varSum / count),
      meshes: meshes,
      showcase: document.getElementById('start-panel').classList.contains('showcase'),
    };
  });
  await page.screenshot({ path: join(SHOTS, `splash-${name}.png`) });
  console.log(`${name}: ${facts.meshes} meshes, pixel variance ${facts.variance},`
    + ` scrim ${facts.showcase}`);
  return { page: page, facts: facts };
}

const retro = await visit('retro', '');
const modern = await visit('modern', '?style=modern');

// BEGIN on the retro page: the diorama must be gone, whole, before the war.
await retro.page.locator('#start-begin').click();
await retro.page.waitForFunction(
  () => Number(document.getElementById('hud-tick')?.textContent) > 10,
  { timeout: 30000 },
);
const after = await retro.page.evaluate(() => ({
  canvasGone: document.getElementById('diorama') === null,
  hookGone: window.__diorama === undefined,
}));
console.log(`after BEGIN: canvas gone ${after.canvasGone}, hook gone ${after.hookGone}`);

// The staged scene has an island, an ocean, five hulls and three tracers -
// well over a dozen meshes - and cannot be a flat backdrop.
const ok = !failed
  && retro.facts.meshes > 12 && retro.facts.variance > 50 && retro.facts.showcase
  && modern.facts.meshes > 12 && modern.facts.variance > 50
  && after.canvasGone && after.hookGone;
if (!ok) {
  console.log('FAIL: the diorama is not staging, or not leaving');
  process.exitCode = 1;
}

await retro.page.close();
await modern.page.close();
await browser.close();
await app.close();
console.log('the shop window photographed, both styles');
