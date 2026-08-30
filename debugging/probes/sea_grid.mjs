// debugging/probes/sea_grid.mjs
//
// The 1988 grid sea, capped by distance (docs/07 §4, the last item left of the
// mobile plan).
//
// The grid was built over the WHOLE ocean, so it grew with the square of the
// map: about 42,000 vertices at 8 islands and 337,000 at 64, of which roughly
// three per cent were ever inside the shader's 8 km fade. On a phone that was
// the largest single thing in the scene and nearly all of it was discarded a
// vertex at a time, every frame.
//
// It is one patch under the eye now. Two claims, and this probe checks both,
// because either one alone can be true while the feature is broken:
//
//   1. The cost no longer follows the map. 8 islands and 32 islands must
//      build the SAME number of vertices - not merely fewer, the same.
//   2. The lines have not come loose. A grid that slid smoothly with the
//      camera would be nailed to the ship, and a grid nailed to the ship is
//      the one thing this mesh must never be: it exists to give the eye
//      something stationary to measure motion against. So the patch may only
//      sit on whole-cell positions, and always within half a cell of the eye.
//
//   node debugging/probes/sea_grid.mjs

import { chromium } from 'playwright';

import { createApp } from '../../server/app.js';
import { loadRules } from '../../server/rules.js';

const SEED = 20260818;
const app = createApp({ seed: SEED, rules: loadRules() });
const address = await app.listen(0, '127.0.0.1');
const browser = await chromium.launch();
let failures = 0;

function check(ok, what) {
  if (ok !== true) failures += 1;
  console.log(`${ok === true ? '  ok  ' : ' FAIL '} ${what}`);
}

// Retro is the only style with a grid sea (client/styles.js), so the look is
// not a variable here - only the island count is. Low tier: this probe is
// about a buffer's length, and software rasterising a High sea to ask it
// would cost a minute a page for nothing.
async function measure(islands) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 640 } });
  page.on('pageerror', (error) => console.log(`[${islands}] PAGEERROR`, error.message));
  await page.goto(
    `http://127.0.0.1:${address.port}/?mode=solo&style=retro&graphics=low`
      + `&islands=${islands}&teams=2&start=0`,
    { waitUntil: 'load' },
  );
  await page.waitForFunction(
    () => Number(document.getElementById('hud-tick')?.textContent) > 20,
    undefined,
    { timeout: 90000 },
  );
  const facts = await page.evaluate(() => {
    const grid = window.__scene3d.oceanGrid;
    if (grid === 0 || grid === undefined) return { missing: 1 };
    const camera = window.__scene3d.camera;
    const step = grid.userData.step;
    return {
      missing: 0,
      follows: grid.userData.follows,
      step: step,
      vertices: grid.geometry.getAttribute('position').count,
      // Rounded to a millimetre: these are floats that went through a matrix.
      offLattice: Math.max(
        Math.abs(Math.round((grid.position.x % step) * 1000) / 1000),
        Math.abs(Math.round((grid.position.z % step) * 1000) / 1000),
      ),
      fromEye: Math.max(
        Math.abs(grid.position.x - camera.position.x),
        Math.abs(grid.position.z - camera.position.z),
      ),
      culled: grid.frustumCulled === true ? 1 : 0,
    };
  });
  await page.close();
  return facts;
}

const small = await measure(8);
const large = await measure(32);

console.log(`8 islands:  ${small.vertices} vertices, step ${small.step} m, follows ${small.follows}`);
console.log(`32 islands: ${large.vertices} vertices, step ${large.step} m, follows ${large.follows}`);

check(small.missing === 0 && large.missing === 0, 'retro has a grid sea at all');
check(small.follows === 1 && large.follows === 1, 'both maps are bigger than the reach, so both follow');
check(small.vertices === large.vertices,
  `the cost does not follow the map (${small.vertices} vs ${large.vertices})`);
// The uncapped mesh was ~168,000 vertices at 32 islands. Anything near that is
// the old behaviour wearing the new name.
check(large.vertices < 20000, `the patch is a patch (${large.vertices} vertices)`);
check(small.offLattice < 0.01 && large.offLattice < 0.01,
  `the patch sits on whole cells (worst off-lattice ${Math.max(small.offLattice, large.offLattice)} m)`);
check(small.fromEye <= small.step / 2 + 0.01 && large.fromEye <= large.step / 2 + 0.01,
  `the patch is under the eye (worst ${Math.round(Math.max(small.fromEye, large.fromEye))} m of ${small.step / 2})`);
// A patch centred on the camera cannot be culled against a bounding sphere
// computed for where it was BUILT - that would blink the whole sea out.
check(small.culled === 0 && large.culled === 0, 'a following patch is not frustum-culled');

await browser.close();
await app.close();
console.log(failures === 0 ? '\nsea_grid: ok' : `\nsea_grid: ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
