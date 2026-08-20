// engine/ai_estate.js - the AI's civil engineering.
//
// An island the AI takes and never develops produces nothing, so without this
// module the enemy carrier runs out of fuel three hours into a war and drifts.
// The plan is deliberately plain, because a plain plan executed is worth more
// than a clever one that stalls:
//
//   1. ground that is resource-rich becomes a Resource island
//   2. once there is something to refine, the next island becomes the Factory
//   3. a natural fortress becomes a Defence island
//   4. anything else mines, because materials are the bottleneck for all of it
//
// Then it builds, one site at a time, whatever the island's role allows and its
// own stock can pay for.

import { floorDiv } from '../shared/fixed.js';
import {
  BUILD_FACTORY,
  BUILD_TURRET,
  BUILD_WAREHOUSE,
  ROLE_DEFENCE,
  ROLE_FACTORY,
  ROLE_NONE,
  ROLE_RESOURCE,
  builtCount,
  setRole,
  startBuild,
} from './island.js';
import { KIND_FORTRESS, KIND_RESOURCE } from './worldgen.js';

function countRole(state, team, role) {
  let count = 0;
  for (let i = 0; i < state.islands.length; i++) {
    const island = state.islands[i];
    if (island.owner === team && island.role === role) count = count + 1;
  }
  return count;
}

// The plant comes second, whatever the ground. Terrain-first was the earlier
// rule and it starved a side whose islands happened to all be resource-rich:
// every one of them became a mine, no factory was ever planned, and the carrier
// ran on the trickle of crude a mine produces. A factory on poor ground beats
// no factory at all.
function planFor(state, team, island) {
  const mines = countRole(state, team, ROLE_RESOURCE);
  const plants = countRole(state, team, ROLE_FACTORY);
  const guns = countRole(state, team, ROLE_DEFENCE);
  if (mines > 0 && plants < 1) return ROLE_FACTORY;
  if (island.kind === KIND_FORTRESS && plants > 0) return ROLE_DEFENCE;
  // Mine, plant, guns: the third island is the defended one. At "second mine
  // first" the AI never raised a gun at all in a whole war - it kept finding a
  // better use for every island it took, and there is always a better use.
  if (mines >= 1 && plants > 0 && guns < 1) return ROLE_DEFENCE;
  if (island.kind === KIND_RESOURCE) return ROLE_RESOURCE;
  return ROLE_RESOURCE;
}

// A plant is only worth what it can be fed. Two factories are within reach of a
// single mine; the third is only worth building when materials are actually
// piling up, or the AI builds a plant it then starves - which is exactly what
// the first version did, and both sides drifted to a stop with full warehouses
// of nothing.
const FED_PERMIL = 400;

function materialsPermil(state, team) {
  let have = 0;
  let cap = 0;
  for (let i = 0; i < state.islands.length; i++) {
    const island = state.islands[i];
    if (island.owner !== team) continue;
    have = have + island.stockMaterials;
    cap = cap + state.economy.stockCap;
  }
  if (cap <= 0) return 0;
  return floorDiv(have * 1000, cap);
}

// What to put up next on an island that already has a purpose. Factories first
// on a factory island - the plant is the point - then storage; a defence island
// simply keeps adding guns.
function nextBuild(state, island, economy) {
  if (island.role === ROLE_FACTORY) {
    const built = builtCount(island, BUILD_FACTORY);
    const room = built < economy.builds[BUILD_FACTORY].max;
    const fed = built < 2 || materialsPermil(state, island.owner) > FED_PERMIL;
    if (room && fed) return BUILD_FACTORY;
    return BUILD_WAREHOUSE;
  }
  if (island.role === ROLE_DEFENCE) return BUILD_TURRET;
  if (island.role === ROLE_RESOURCE) return BUILD_WAREHOUSE;
  return -1;
}

// One estate decision for one team, on the AI cadence. It does at most one
// thing per island per turn: this runs alongside a war, not instead of it.
function manageIslands(state, brain) {
  for (let i = 0; i < state.islands.length; i++) {
    const island = state.islands[i];
    if (island.owner !== brain.team) continue;
    if (island.role === ROLE_NONE) {
      setRole(state, island, planFor(state, brain.team, island));
      continue;
    }
    if (island.building !== -1) continue;
    const what = nextBuild(state, island, state.economy);
    if (what === -1) continue;
    startBuild(state, island, what, state.economy);
  }
}

export { countRole, planFor, nextBuild, manageIslands };
