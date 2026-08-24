// engine/worldgen.js - seeded archipelago placement.
//
// Dart-throwing with a minimum-separation reject (Poisson-disc in spirit,
// without the grid): rolls a candidate centre, keeps it if it clears every
// island already placed. Deterministic from the seed alone, so the golden
// worldgen hash in test/ pins the whole map.
//
// Islands are the only terrain record in state. Their surface is a pure
// function of these integers (engine/heightmap.js), never a stored grid.

import { dist2D, floorDiv, isqrt, mulDiv, wrapAngle } from '../shared/fixed.js';
import { mulCos, mulSin } from '../shared/trig.js';
import { deriveSeed, rollBetween, rollRange } from '../shared/prng.js';
import { islandHeightAt, pickCommandNode, skirtRadius } from './heightmap.js';

// Island count and ocean size have to move together. At the base spacing eight
// islands fill about a quarter of the base box; thirty-two in the same box
// would need near-perfect packing, which dart-throwing cannot reach and which
// would leave no ocean to cross anyway. Area scales with the count, so the
// side scales with its square root - 8 islands in 20 km, 32 in 40 km, at
// identical density.
function worldSizeMetres(world) {
  const base = world.baseIslandCount;
  if (base < 1 || world.islandCount === base) return world.sizeMetres;
  // isqrt of a Q16 ratio gives a Q8 scale: sqrt(65536) is 256.
  const scaleQ8 = isqrt(mulDiv(world.islandCount, 65536, base));
  return mulDiv(world.sizeMetres, scaleQ8, 256);
}

const KIND_FACTORY = 0;
const KIND_RESOURCE = 1;
const KIND_RADAR = 2;
const KIND_AIRFIELD = 3;
const KIND_FORTRESS = 4;

function rollKind(rngState, weights) {
  let total = 0;
  for (let i = 0; i < weights.length; i++) total = total + weights[i];
  const rolled = rollRange(rngState, total);
  let cursor = rolled.value;
  for (let i = 0; i < weights.length; i++) {
    if (cursor < weights[i]) return { rngState: rolled.rngState, value: i };
    cursor = cursor - weights[i];
  }
  return { rngState: rolled.rngState, value: weights.length - 1 };
}

function clearsExisting(islands, x, y, radius, minSpacing) {
  for (let i = 0; i < islands.length; i++) {
    const other = islands[i];
    const dx = x - other.x;
    const dy = y - other.y;
    // minSpacing is an edge-to-edge gap, so both radii are added on top.
    const need = radius + other.radius + minSpacing;
    if (dx * dx + dy * dy < need * need) return false;
  }
  return true;
}

function createIslands(seed, world, unitsPerMetre) {
  const sizeUnits = worldSizeMetres(world) * unitsPerMetre;
  const margin = world.edgeMarginMetres * unitsPerMetre;
  const minSpacing = world.minSpacingMetres * unitsPerMetre;
  const radiusMin = world.islandRadiusMinMetres * unitsPerMetre;
  const radiusMax = world.islandRadiusMaxMetres * unitsPerMetre;
  const peakMin = world.peakHeightMinMetres * unitsPerMetre;
  const peakMax = world.peakHeightMaxMetres * unitsPerMetre;
  const noiseCell = world.noiseBaseCellMetres * unitsPerMetre;

  const islands = [];
  let rngState = deriveSeed(seed, 1);
  let attempts = 0;
  while (islands.length < world.islandCount && attempts < world.placementAttempts) {
    attempts = attempts + 1;
    const rx = rollBetween(rngState, margin, sizeUnits - margin);
    rngState = rx.rngState;
    const ry = rollBetween(rngState, margin, sizeUnits - margin);
    rngState = ry.rngState;
    const rr = rollBetween(rngState, radiusMin, radiusMax);
    rngState = rr.rngState;
    if (!clearsExisting(islands, rx.value, ry.value, rr.value, minSpacing)) continue;
    const rp = rollBetween(rngState, peakMin, peakMax);
    rngState = rp.rngState;
    const rk = rollKind(rngState, world.islandKindWeights);
    rngState = rk.rngState;
    const rs = rollRange(rngState, 2147483647);
    rngState = rs.rngState;
    const island = {
      id: islands.length,
      kind: rk.value,
      owner: -1,
      x: rx.value,
      y: ry.value,
      radius: rr.value,
      peak: rp.value,
      seed: rs.value,
      noiseCell: noiseCell,
      noiseOctaves: world.noiseOctaves,
      noisePermil: world.noiseAmplitudePermil,
      warpCell: mulDiv(rr.value, world.coastWarpCellPermil, 1000),
      warpPermil: world.coastWarpPermil,
      nodeX: rx.value,
      nodeY: ry.value,
      podTeam: -1,
      podTicks: 0,
      // A virus bomb working on this island's command centre, if any - and
      // WHOSE command centre it was subverting when it went in. A change of
      // owner, any change, abandons the conversion (engine/virus.js).
      virusTeam: -1,
      virusTicks: 0,
      virusVictim: -1,
      stockFuel: 0,
      stockMaterials: 0,
      stockOrdnance: 0,
      stockChassis: 0,
      // What the island is FOR: its owner decides after taking it, and until
      // then it produces nothing. -1 is ROLE_NONE; island.js owns the meaning.
      role: -1,
      factories: 0,
      warehouses: 0,
      turrets: 0,
      runway: 0,
      // The command centre: its shields while somebody owns the island (0
      // when neutral - a marker mast is not a building), and the node's
      // terrain height, computed once so the shot sweep never samples noise.
      nodeHp: 0,
      nodeZ: 0,
      building: -1,
      buildTicks: 0,
    };
    // The command node depends on the island's own terrain, so it can only be
    // chosen once the record is complete.
    const node = pickCommandNode(island);
    island.nodeX = node.x;
    island.nodeY = node.y;
    island.nodeZ = islandHeightAt(island, node.x, node.y);
    islands.push(island);
  }
  return { islands: islands, rngState: rngState, attempts: attempts };
}

// Team start positions: opposite corners of the playable box, pushed off any
// island that happens to sit near the corner.
function startPositions(islands, world, unitsPerMetre, teamCount) {
  const sizeUnits = worldSizeMetres(world) * unitsPerMetre;
  const offset = world.carrierStartOffsetMetres * unitsPerMetre;
  const corners = [
    { x: offset, y: offset },
    { x: sizeUnits - offset, y: sizeUnits - offset },
    { x: sizeUnits - offset, y: offset },
    { x: offset, y: sizeUnits - offset },
  ];
  // Up to four teams take the corners, exactly as before - two-team wars are
  // pinned by golden hashes and must not move. A bigger table (ruling
  // 2026-08-23: up to 16 carriers, free for all) sits around a ring inset
  // from the edges, first seat at the south-west so the flavour survives.
  const half = floorDiv(sizeUnits, 2);
  const ringRadius = half - offset;
  const out = [];
  for (let t = 0; t < teamCount; t++) {
    let x;
    let y;
    if (teamCount <= 4) {
      const corner = corners[t % corners.length];
      x = corner.x;
      y = corner.y;
    } else {
      const bam = wrapAngle(40960 + mulDiv(t, 65536, teamCount));
      x = half + mulCos(ringRadius, bam);
      y = half + mulSin(ringRadius, bam);
    }
    for (let step = 0; step < 64; step++) {
      let blocked = -1;
      for (let i = 0; i < islands.length; i++) {
        const island = islands[i];
        const dx = x - island.x;
        const dy = y - island.y;
        // Clear of the SHELF, not just the shore: the skirt of shallow water
        // plus the coastline warp plus room to build up speed. A carrier that
        // spawns with a shoal 200 m off the bow grounds on its first order.
        const clearance = skirtRadius(island)
          + mulDiv(island.radius, island.warpPermil, 1000)
          + 900 * unitsPerMetre;
        if (dx * dx + dy * dy < clearance * clearance) { blocked = i; break; }
      }
      if (blocked < 0) break;
      if (teamCount <= 4) {
        // The corner walk, exactly as always: pinned by the golden hashes.
        const towardCentre = x < half ? 1 : -1;
        x = x + towardCentre * 200 * unitsPerMetre;
        y = y + towardCentre * 200 * unitsPerMetre;
      } else {
        // A ring seat steps directly OFF the island that blocks it. Toward-
        // the-centre was tried first and walked seat 15 straight through an
        // island that sat on its centre line; away-from-the-obstacle leaves
        // the clearance circle in a bounded number of steps by construction.
        const island = islands[blocked];
        const off = dist2D(x, y, island.x, island.y);
        if (off <= 0) {
          x = x + 200 * unitsPerMetre;
        } else {
          x = x + mulDiv(x - island.x, 200 * unitsPerMetre, off);
          y = y + mulDiv(y - island.y, 200 * unitsPerMetre, off);
        }
        // Stay on the chart: a spawn pushed off the map is a watchdog
        // finding waiting to happen. Clamping turns an edge case into a
        // slide along the margin, which the next step resolves.
        if (x < offset) x = offset;
        if (x > sizeUnits - offset) x = sizeUnits - offset;
        if (y < offset) y = offset;
        if (y > sizeUnits - offset) y = sizeUnits - offset;
      }
    }
    out.push({ x: x, y: y });
  }
  return out;
}

export {
  worldSizeMetres,
  KIND_FACTORY,
  KIND_RESOURCE,
  KIND_RADAR,
  KIND_AIRFIELD,
  KIND_FORTRESS,
  createIslands,
  startPositions,
};
