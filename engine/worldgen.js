// engine/worldgen.js - seeded archipelago placement.
//
// Dart-throwing with a minimum-separation reject (Poisson-disc in spirit,
// without the grid): rolls a candidate centre, keeps it if it clears every
// island already placed. Deterministic from the seed alone, so the golden
// worldgen hash in test/ pins the whole map.
//
// Islands are the only terrain record in state. Their surface is a pure
// function of these integers (engine/heightmap.js), never a stored grid.

import { floorDiv, mulDiv } from '../shared/fixed.js';
import { deriveSeed, rollBetween, rollRange } from '../shared/prng.js';
import { pickCommandNode, skirtRadius } from './heightmap.js';

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
  const sizeUnits = world.sizeMetres * unitsPerMetre;
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
    };
    // The command node depends on the island's own terrain, so it can only be
    // chosen once the record is complete.
    const node = pickCommandNode(island);
    island.nodeX = node.x;
    island.nodeY = node.y;
    islands.push(island);
  }
  return { islands: islands, rngState: rngState, attempts: attempts };
}

// Team start positions: opposite corners of the playable box, pushed off any
// island that happens to sit near the corner.
function startPositions(islands, world, unitsPerMetre, teamCount) {
  const sizeUnits = world.sizeMetres * unitsPerMetre;
  const offset = world.carrierStartOffsetMetres * unitsPerMetre;
  const corners = [
    { x: offset, y: offset },
    { x: sizeUnits - offset, y: sizeUnits - offset },
    { x: sizeUnits - offset, y: offset },
    { x: offset, y: sizeUnits - offset },
  ];
  const out = [];
  for (let t = 0; t < teamCount; t++) {
    const corner = corners[t % corners.length];
    let x = corner.x;
    let y = corner.y;
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
      const towardCentre = x < floorDiv(sizeUnits, 2) ? 1 : -1;
      x = x + towardCentre * 200 * unitsPerMetre;
      y = y + towardCentre * 200 * unitsPerMetre;
    }
    out.push({ x: x, y: y });
  }
  return out;
}

export {
  KIND_FACTORY,
  KIND_RESOURCE,
  KIND_RADAR,
  KIND_AIRFIELD,
  KIND_FORTRESS,
  createIslands,
  startPositions,
};
