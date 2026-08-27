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
import { weatherAt } from '../../shared/weather.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SHOTS = join(HERE, '..', 'shots');
mkdirSync(SHOTS, { recursive: true });

const SEED = 20260818;
let NOON_TICK = 0;
for (let tick = 0; tick < 400000; tick += 30) {
  const w = weatherAt(SEED, tick);
  if (w.sunHeightPermil > 700 && w.cloudPermil < 250 && w.stormPermil === 0) {
    NOON_TICK = tick;
    break;
  }
}

const app = createApp({ seed: SEED, rules: loadRules() });
const address = await app.listen(0, '127.0.0.1');
const browser = await chromium.launch();

// Same seed, same tick window, same camera, and - since 2026-08-26 - the same
// SKY: only the tier (and one style) varies, so any difference in the pictures
// is the tier's doing.
//
// The weather made this probe non-deterministic overnight. It asserts a blue
// zenith, which was a fact about the pipeline while the sun was nailed at 49
// degrees and is a fact about the WEATHER now that the sun crosses. Freezing
// the sky at a clear noon puts the question back to the one this probe is
// actually asking. NOON_TICK is found rather than hardcoded, so re-tuning the
// day cannot quietly turn this into a test of a cloudy afternoon.
async function shoot(name, query) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (error) => console.log(`[${name}] PAGEERROR`, error.message));
  await page.goto(
    `http://127.0.0.1:${address.port}/?mode=solo&weather=${NOON_TICK}&${query}`,
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
  const facts = await page.evaluate(() => {
    const v = window.__scene3d;
    const gl = v.renderer.getContext();
    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;
    const pixels = new Uint8Array(width * height * 4);
    // Render, then read back in the SAME task: without preserveDrawingBuffer
    // the buffer is only valid until the browser composites it.
    const grab = () => {
      v.renderer.render(v.scene, v.camera);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    };
    // readPixels rows run bottom-up: the near water is the bottom quarter of
    // the screen, which is the FIRST quarter of the buffer.
    const meanOver = (fromRow, toRow, f) => {
      let sum = 0;
      let count = 0;
      for (let y = fromRow; y < toRow; y++) {
        for (let x = 0; x < width; x += 4) {
          sum += f((y * width + x) * 4);
          count++;
        }
      }
      return sum / Math.max(1, count);
    };
    grab();
    const luma = (i) => 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
    const waterMean = meanOver(0, Math.floor(height * 0.25), luma);
    const waterVariance = meanOver(0, Math.floor(height * 0.25),
      (i) => (luma(i) - waterMean) * (luma(i) - waterMean));
    // The chase camera never sees the zenith - its frame top is the horizon
    // band, which a Preetham sky keeps hazy-white by design. To measure the
    // blueness the spec means, look straight up, grab, and let the game's
    // own render loop restore the view before the screenshot.
    const keepPosition = v.camera.position.clone();
    const keepQuaternion = v.camera.quaternion.clone();
    v.camera.lookAt(keepPosition.x, keepPosition.y + 1000, keepPosition.z + 0.001);
    grab();
    const zenithBlueness = meanOver(Math.floor(height * 0.4), Math.floor(height * 0.6),
      (i) => pixels[i + 2] - pixels[i]);
    v.camera.position.copy(keepPosition);
    v.camera.quaternion.copy(keepQuaternion);
    // The models pass, counted: the own carrier's part count at High must
    // exceed Medium's - the dressing is real geometry, not a setting.
    const carriers = Object.values(window.__scene3d.carriers);
    return {
      graphics: document.getElementById('hud-graphics')?.textContent,
      oceanShader: window.__scene3d.ocean.material.type,
      oceanName: window.__scene3d.ocean.material.name,
      zenithBlueness: Math.round(zenithBlueness),
      waterVariance: Math.round(waterVariance),
      carrierParts: carriers.length === 0 ? 0 : carriers[0].children.length,
    };
  });
  await page.screenshot({ path: join(SHOTS, `graphics-${name}.png`) });
  await page.close();
  console.log(`${name}: ${facts.graphics} (${facts.oceanShader}/${facts.oceanName})`
    + ` zenith B-R ${facts.zenithBlueness}, water variance ${facts.waterVariance},`
    + ` carrier parts ${facts.carrierParts}`);
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

// Phase 2's machine-checkable clauses (docs/07 §3, the reference scene's own
// verification, stolen as specced). Modern at High runs the Preetham sky and
// the mirror water: the zenith must be measurably BLUE (a washed-out white
// sky means the ACES exposure or rayleigh went wrong), the sea must be a
// MirrorShader, and the near water must have texture - a flat sea means a
// broken pipeline (no normals, no reflection, or a dead time uniform).
// Retro's checks are the same contract mirrored: no MirrorShader anywhere
// near 1988, and its zenith stays night-black however high the tier.
const modernHigh = shots[2];
const retroHigh = shots[3];
const phase2Ok = modernHigh.oceanName === 'MirrorShader'
  && modernHigh.zenithBlueness >= 20
  && modernHigh.waterVariance >= 2
  && retroHigh.oceanName !== 'MirrorShader'
  && retroHigh.zenithBlueness < 20;
if (!phase2Ok) {
  console.log('FAIL: the phase-2 sky or water is not doing what the spec says');
  process.exitCode = 1;
}

// The models pass: High carries more carrier geometry than Medium, in the
// modern style AND in retro - sharper 1988 is still 1988, but sharper.
const modelsOk = modernHigh.carrierParts > shots[1].carrierParts
  && retroHigh.carrierParts === modernHigh.carrierParts;
if (!modelsOk) {
  console.log('FAIL: the High-tier model dressing is missing somewhere');
  process.exitCode = 1;
}

await browser.close();
await app.close();
console.log('four tiers photographed - judge the water by eye');
