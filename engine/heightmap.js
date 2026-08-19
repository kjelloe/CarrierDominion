// engine/heightmap.js - terrain altitude as a pure function of the island
// record. Nothing here is stored in state: an island is a dozen integers and
// the surface is re-derived wherever it is needed (collision on the server,
// mesh building in the client). That keeps the state hash small and guarantees
// the renderer and the simulation agree on where the ground is.

import { floorDiv, isqrt, mulDiv } from '../shared/fixed.js';
import { fbm2, valueNoise2 } from '../shared/noise.js';
import { mulCos, mulSin } from '../shared/trig.js';

const FALLOFF_ONE = 4096;
const SEABED_UNITS = -51200; // -200 m, the flat floor away from any island
// Each island sits on a skirt of shallow water reaching this much further than
// its own radius. Without it the seabed is a 200 m cliff at exactly the
// shoreline - which reads fine visually but means a Walrus meets an
// unclimbable wall at the beach and a carrier can anchor with its bow touching
// the sand. The skirt is what makes "keep the ship off the shallows" a thing.
const SKIRT_PERCENT = 160;

function skirtRadius(island) {
  return mulDiv(island.radius, SKIRT_PERCENT, 100);
}

// Altitude above sea level, fixed-point units, for one island only.
//
// The shape is a radial falloff plus fractal relief, but with the DISTANCE
// warped by a coarse noise field before either is applied. Without the warp
// every island is a perfect dome with a bullseye coastline; warping the
// distance is what makes a shoreline that has bays and headlands, and it costs
// one extra noise sample.
function islandHeightAt(island, wx, wy) {
  const dx = wx - island.x;
  const dy = wy - island.y;
  const r = island.radius;
  const d2 = dx * dx + dy * dy;
  const skirt = skirtRadius(island);
  const warpReach = mulDiv(r, island.warpPermil, 1000);
  const outerBound = skirt + warpReach;
  if (d2 >= outerBound * outerBound) return SEABED_UNITS;

  const warpNoise = valueNoise2(island.seed + 991, wx, wy, island.warpCell) - 32768;
  const d = isqrt(d2) + mulDiv(warpNoise, warpReach, 32768);
  if (d >= skirt) return SEABED_UNITS;
  if (d >= r) {
    // Offshore: 0 at the waterline falling to the seabed at the skirt edge,
    // quadratically so the water shelves gently close in.
    const s = mulDiv(d - r, FALLOFF_ONE, skirt - r);
    return -mulDiv(-SEABED_UNITS, floorDiv(s * s, FALLOFF_ONE), FALLOFF_ONE);
  }
  const clamped = d < 0 ? 0 : d;
  const t = FALLOFF_ONE - mulDiv(clamped, FALLOFF_ONE, r);
  const falloff = floorDiv(t * t, FALLOFF_ONE);
  const base = mulDiv(island.peak, falloff, FALLOFF_ONE);
  const noise = fbm2(island.seed, wx, wy, island.noiseCell, island.noiseOctaves) - 32768;
  const amplitude = mulDiv(island.peak, island.noisePermil, 1000);
  const relief = mulDiv(mulDiv(noise, amplitude, 32768), falloff, FALLOFF_ONE);
  return base + relief;
}

// Altitude across the whole archipelago: islands never overlap, so the highest
// contribution wins and the seabed shows through everywhere else.
function worldHeightAt(islands, wx, wy) {
  let best = SEABED_UNITS;
  for (let i = 0; i < islands.length; i++) {
    const h = islandHeightAt(islands[i], wx, wy);
    if (h > best) best = h;
  }
  return best;
}

function isLandAt(islands, wx, wy) {
  return worldHeightAt(islands, wx, wy) > 0;
}

// Where the command node stands: a spot that is properly ashore but flat
// enough for a Walrus to reach. Scanning a fixed ring of candidates keeps this
// deterministic and cheap - it runs once per island at worldgen, never in a
// tick. Putting the node on the summit would look right and make some islands
// impossible to capture.
function pickCommandNode(island) {
  const angles = 16;
  const rings = [30, 45, 60]; // per cent of the island radius
  let bestX = island.x;
  let bestY = island.y;
  let bestScore = -2147483647;
  for (let r = 0; r < rings.length; r++) {
    const radius = mulDiv(island.radius, rings[r], 100);
    for (let a = 0; a < angles; a++) {
      const bam = mulDiv(a, 65536, angles);
      const x = island.x + mulCos(radius, bam);
      const y = island.y + mulSin(radius, bam);
      const height = islandHeightAt(island, x, y);
      if (height < 8 * 256) continue; // must be properly ashore
      // Flat is good, high is not: score falls with local relief and with
      // height above a comfortable 40 m.
      const probe = 8 * 256;
      const slope = absDiff(islandHeightAt(island, x + probe, y), height)
        + absDiff(islandHeightAt(island, x, y + probe), height);
      const score = -slope * 4 - absDiff(height, 40 * 256);
      if (score > bestScore) {
        bestScore = score;
        bestX = x;
        bestY = y;
      }
    }
  }
  return { x: bestX, y: bestY };
}

function absDiff(a, b) {
  return a > b ? a - b : b - a;
}

// Cheap pre-test used by movement before paying for the noise sample.
function nearIsland(island, wx, wy, marginUnits) {
  const dx = wx - island.x;
  const dy = wy - island.y;
  const reach = island.radius + marginUnits;
  return dx * dx + dy * dy < reach * reach;
}

export {
  FALLOFF_ONE,
  SEABED_UNITS,
  SKIRT_PERCENT,
  skirtRadius,
  islandHeightAt,
  worldHeightAt,
  isLandAt,
  nearIsland,
  pickCommandNode,
};
