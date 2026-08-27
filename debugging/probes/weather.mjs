// debugging/probes/weather.mjs
//
// The sky, through the glass (owner's ask, 2026-08-26). `shared/weather.js`
// is tested as arithmetic; this probe asks the harder question: does the war
// LOOK different when the weather says it should?
//
// It finds a tick for each of five moods, freezes the sky there with
// ?weather=<tick>, photographs the war, and MEASURES the frame - the average
// colour of a band of sky and a band of sea. A shader that silently does
// nothing still produces a beautiful screenshot; only the numbers catch it.
//
// Pixels are read in the same JS turn as the render (docs/07 lesson 7): the
// game's own loop restores the camera between frames, so a read in a later
// turn sees a buffer that has already been cleared.
//
//   node debugging/probes/weather.mjs

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

// The five moods, as questions asked of the weather function. Selecting by
// CONDITION rather than by a hardcoded tick means the probe still finds a
// storm after the front periods are re-tuned.
const MOODS = [
  ['dawn', (w) => w.sunHeightPermil > 80 && w.sunHeightPermil < 220 && w.stormPermil === 0],
  ['noon', (w) => w.sunHeightPermil > 700 && w.cloudPermil < 300],
  ['overcast', (w) => w.cloudPermil > 600 && w.stormPermil < 200 && w.sunHeightPermil > 300],
  ['storm', (w) => w.stormPermil > 700 && w.sunHeightPermil > 200],
  ['night', (w) => w.sunHeightPermil < -150],
  // The stroke itself. Lightning lasts seven ticks, so this is the one mood
  // that has to be caught rather than found - hence the tick-by-tick scan
  // below rather than the every-60 stride.
  ['lightning', (w) => w.flashPermil > 700],
];

const problems = [];
const found = [];
for (const [name, test] of MOODS) {
  let at = -1;
  const stride = name === 'lightning' ? 1 : 60;
  for (let tick = 0; tick < 400000; tick += stride) {
    if (test(weatherAt(SEED, tick))) { at = tick; break; }
  }
  if (at === -1) problems.push(`no ${name} in 400,000 ticks of seed ${SEED}`);
  else found.push([name, at]);
}
// The control for the lightning check: the tick BEFORE the stroke. Every
// other field of the weather is identical there - same storm, same cloud,
// same wind, same sun - so any difference in the scope is the stroke and
// nothing else. Comparing the strike against a different mood would pass
// whether or not the clutter drew at all, which is worse than no test.
const struck = found.find(([name]) => name === 'lightning');
if (struck !== undefined) found.push(['nostroke', struck[1] - 1]);

console.log(`moods: ${found.map(([n, t]) => `${n}@${t}`).join(' ')}`);

const app = createApp({ seed: SEED, rules: loadRules() });
const address = await app.listen(0, '127.0.0.1');
const browser = await chromium.launch();

// Average colour of a horizontal band of the live frame, rendered and read in
// one turn. `top` and `bottom` are fractions down from the top of the canvas.
const BAND_READER = ([top, bottom]) => {
  const v = window.__scene3d;
  v.renderer.render(v.scene, v.camera);
  const gl = v.renderer.getContext();
  const width = gl.drawingBufferWidth;
  const height = gl.drawingBufferHeight;
  // readPixels counts from the BOTTOM, so a band measured from the top of
  // the picture starts at height - bottom.
  const y = Math.floor(height * (1 - bottom));
  const rows = Math.max(1, Math.floor(height * (bottom - top)));
  const buffer = new Uint8Array(width * rows * 4);
  gl.readPixels(0, y, width, rows, gl.RGBA, gl.UNSIGNED_BYTE, buffer);
  let r = 0; let g = 0; let b = 0;
  for (let i = 0; i < buffer.length; i += 4) { r += buffer[i]; g += buffer[i + 1]; b += buffer[i + 2]; }
  const n = buffer.length / 4;
  return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) };
};

// ONE page, navigated seven times, rather than seven pages. This probe is
// the heaviest in the suite - seven loads of the High tier, which headless
// Chromium rasterises in software - and it sorts last, so it runs when the
// machine is at its most loaded. Seven browser contexts on top of that was
// the difference between passing alone and timing out in a full sweep.
const shot = {};
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
let mood = '';
page.on('pageerror', (error) => problems.push(`[${mood}] PAGEERROR ${error.message}`));
page.on('console', (message) => {
  if (message.type() === 'error') problems.push(`[${mood}] CONSOLE ${message.text()}`);
});

for (const [name, tick] of found) {
  mood = name;
  await page.goto(
    `http://127.0.0.1:${address.port}/?mode=solo&style=modern&graphics=high&weather=${tick}`,
    { waitUntil: 'load' },
  );
  // Patience, not a lighter scene - the same lesson graphics_shots.mjs
  // records. What a 4070 does per frame, SwiftShader does per breakfast, and
  // a 20-second wait here was a probe that passed alone and failed in a
  // sweep, which is the worst of both.
  await page.waitForFunction(
    () => Number(document.getElementById('hud-tick')?.textContent) > 5,
    undefined,
    { timeout: 90000 },
  );
  // Let the swell settle and the environment map bake at the new sun.
  await page.waitForTimeout(1800);
  await page.screenshot({ path: join(SHOTS, `weather-${name}.png`) });

  // The sky band sits above the horizon in the chase view; the sea band is
  // the water in front of the ship.
  const sky = await page.evaluate(BAND_READER, [0.03, 0.09]);
  const sea = await page.evaluate(BAND_READER, [0.30, 0.45]);
  const w = await page.evaluate(() => window.__lastView.weather);
  shot[name] = { sky, sea, w };
  console.log(
    `${name.padEnd(9)} sun ${String(w.sunHeightPermil).padStart(4)} cloud ${String(w.cloudPermil).padStart(4)}`
    + ` storm ${String(w.stormPermil).padStart(4)} wind ${String(w.windPermil).padStart(4)}`
    + ` | sky ${sky.r},${sky.g},${sky.b} | sea ${sea.r},${sea.g},${sea.b}`,
  );

  // The scope box, for the lightning check below. It sits in the instrument
  // panel along the bottom of the screen.
  shot[name].scope = await page.evaluate(BAND_READER, [0.76, 0.96]);

  // And the pull-back, where there is sky in frame rather than a horizon.
  await page.keyboard.press('c');
  await page.keyboard.press('c');
  await page.waitForTimeout(900);
  await page.screenshot({ path: join(SHOTS, `weather-${name}-wide.png`) });
}
await page.close();

await browser.close();
await app.close();

// --- what the pictures have to prove ---------------------------------------
//
// Each of these is a way the feature has actually failed, or could fail
// silently: a shader that compiles and draws nothing, a sky that ignores the
// weather, a night so dark the owner's "no complete darkness" is broken, a
// storm that comes out warm because the low sun's peach was applied first.

function check(condition, complaint) {
  if (!condition) problems.push(complaint);
}

const lum = (c) => Math.round(c.r * 0.30 + c.g * 0.59 + c.b * 0.11);

if (shot.noon !== undefined && shot.storm !== undefined) {
  check(lum(shot.storm.sky) < lum(shot.noon.sky) - 20,
    `the storm sky (${lum(shot.storm.sky)}) is no darker than noon (${lum(shot.noon.sky)})`);
  check(lum(shot.storm.sea) < lum(shot.noon.sea),
    'the storm sea is no darker than the noon sea');
  // Grey-blue, not brown. The band has island peaks in it, which are warm
  // terrain and pull red up by a few counts, so the test is "not warm"
  // rather than "strictly blue" - at 0.85 storm weight this band came out
  // 134,128,127 with a peach cast and 113,108,108 without.
  check(shot.storm.sky.r - shot.storm.sky.b <= 10,
    `the storm sky is warm (${shot.storm.sky.r},${shot.storm.sky.g},${shot.storm.sky.b}) - it should be grey-blue`);
}
if (shot.night !== undefined && shot.noon !== undefined) {
  check(lum(shot.night.sea) < lum(shot.noon.sea) - 20, 'night looks like day on the water');
  // The owner's ask, measured: never completely dark.
  check(lum(shot.night.sea) > 6, `night fell to ${lum(shot.night.sea)} - it must stay steerable`);
}
if (shot.dawn !== undefined) {
  check(shot.dawn.sky.r > shot.dawn.sky.b, 'dawn is not warm');
}
if (shot.overcast !== undefined && shot.noon !== undefined) {
  check(lum(shot.overcast.sky) < lum(shot.noon.sky),
    'an overcast sky is as bright as a clear one');
}
if (shot.lightning !== undefined && shot.nostroke !== undefined) {
  check(shot.lightning.w.flashPermil > 700,
    'the lightning mood was photographed without a stroke in it');
  check(shot.nostroke.w.flashPermil === 0,
    'the control tick has a stroke in it too - pick another');
  // Same storm, same cloud, same wind, same sun: the stroke is the only
  // difference, so the scope must be BRIGHTER with it than without.
  const lit = lum(shot.lightning.scope);
  const dark = lum(shot.nostroke.scope);
  check(lit > dark,
    `the scope reads ${lit} with a strike and ${dark} without`
    + ' - the clutter is not reaching the instrument');
}

// Five distinct pictures, not one picture five times: this is the assertion
// that would catch the whole weather path being switched off.
const seen = {};
for (const [name] of found) {
  const key = `${shot[name].sky.r}/${shot[name].sky.g}/${shot[name].sky.b}`;
  check(seen[key] === undefined, `${name} and ${seen[key]} rendered the same sky`);
  seen[key] = name;
}

if (problems.length > 0) {
  for (const problem of problems) console.log(problem);
  console.log('FAIL: the weather is not reaching the picture');
  process.exitCode = 1;
} else {
  console.log(`${found.length} skies photographed and measured`);
}
